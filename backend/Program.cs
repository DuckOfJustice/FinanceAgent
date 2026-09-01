using FinanceDuck.Api;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

if (args is ["--selftest-camt053"])
{
    Camt053ParserSelfTest.Run();
    return;
}
if (args is ["--selftest-categorization"])
{
    CategorizationServiceSelfTest.Run();
    return;
}
if (args is ["--selftest-import-dedup"])
{
    await ImportDedupSelfTestAsync();
    return;
}
if (args is ["--selftest-user-schema"])
{
    UserSchemaSelfTest.Run();
    return;
}
if (args is ["--selftest-auth"])
{
    AuthSelfTest.Run();
    return;
}

Directory.CreateDirectory("data");

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<FinanceDbContext>(o =>
    o.UseSqlite("Data Source=data/finance.db"));

builder.Services.AddHttpClient<EnableBankingClient>(c =>
    c.BaseAddress = new Uri(builder.Configuration["EnableBanking:BaseUrl"]!));

builder.Services.AddScoped<CategorizationService>();

builder.Services.AddFinanceAuth();

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<FinanceDbContext>();
    db.Database.EnsureCreated();

    // EnsureCreated() legt das Schema nur bei komplett neuer DB-Datei an - bestehende
    // Installationen (DB existierte schon vor der Categories-Tabelle) bekommen die neue
    // Tabelle sonst nie. Keine echten EF-Migrations fuer dieses Ein-Personen-Tool, daher hier
    // idempotent per Raw-SQL nachziehen statt eine ganze Migrations-Pipeline aufzusetzen.

    // Bestehende Datenbanken haben ExternalId noch als Unique-Index angelegt (aus einer Zeit,
    // bevor klar war, dass manche Zahlungsdienstleister dieselbe Referenz fuer mehrere echte
    // Buchungen wiederverwenden, z.B. wiederkehrende Lohn-/Gehaltslaeufe). Ohne diesen Drop
    // wirft der CAMT.053-Import fuer solche Faelle weiterhin eine SQLite-Constraint-Verletzung,
    // obwohl die eigentliche Duplikat-Pruefung in ImportTransactionsAsync das korrekt erkennt.
    // Fuer eine komplett neue DB legt EnsureCreated() den Index bereits nicht-eindeutig an
    // (siehe FinanceDbContext.OnModelCreating), das Drop+Recreate hier ist dafuer ein No-op.
    db.Database.ExecuteSqlRaw("""DROP INDEX IF EXISTS "IX_Transactions_ExternalId" """);
    db.Database.ExecuteSqlRaw("""CREATE INDEX IF NOT EXISTS "IX_Transactions_ExternalId" ON "Transactions" ("ExternalId")""");

    db.Database.ExecuteSqlRaw("""
        CREATE TABLE IF NOT EXISTS "Categories" (
            "Id" INTEGER NOT NULL CONSTRAINT "PK_Categories" PRIMARY KEY AUTOINCREMENT,
            "Name" TEXT NOT NULL
        )
        """);
    db.Database.ExecuteSqlRaw("""CREATE UNIQUE INDEX IF NOT EXISTS "IX_Categories_Name" ON "Categories" ("Name")""");
    db.Database.ExecuteSqlRaw("""
        CREATE TABLE IF NOT EXISTS "Rules" (
            "Id" INTEGER NOT NULL CONSTRAINT "PK_Rules" PRIMARY KEY AUTOINCREMENT,
            "Pattern" TEXT NOT NULL,
            "CategoryId" INTEGER NOT NULL
        )
        """);

    // Farbspalte fuer bestehende DBs nachziehen - SQLite kennt kein "ADD COLUMN IF NOT EXISTS",
    // daher hier auf die "Spalte gibt es schon"-Fehlermeldung pruefen statt vorher extra abzufragen.
    try
    {
        db.Database.ExecuteSqlRaw("""ALTER TABLE "Categories" ADD COLUMN "Color" TEXT""");
    }
    catch (Microsoft.Data.Sqlite.SqliteException ex) when (ex.Message.Contains("duplicate column name"))
    {
        // Spalte existiert schon (DB aus einer frueheren App-Version) - nichts zu tun.
    }

    db.Database.ExecuteSqlRaw("""
        CREATE TABLE IF NOT EXISTS "Users" (
            "Id" INTEGER NOT NULL CONSTRAINT "PK_Users" PRIMARY KEY AUTOINCREMENT,
            "Username" TEXT NOT NULL,
            "PasswordHash" TEXT NOT NULL,
            "IsAdmin" INTEGER NOT NULL,
            "CreatedAt" TEXT NOT NULL
        )
        """);
    db.Database.ExecuteSqlRaw("""CREATE UNIQUE INDEX IF NOT EXISTS "IX_Users_Username" ON "Users" ("Username")""");
    db.Database.ExecuteSqlRaw("""
        CREATE TABLE IF NOT EXISTS "EnableBankingConfigs" (
            "UserId" INTEGER NOT NULL CONSTRAINT "PK_EnableBankingConfigs" PRIMARY KEY,
            "AppId" TEXT,
            "PrivateKeyPem" TEXT,
            "AspspName" TEXT,
            "AspspCountry" TEXT,
            "SessionId" TEXT,
            "AccountIban" TEXT
        )
        """);

    foreach (var (table, column) in new[] { ("Transactions", "UserId"), ("Categories", "UserId"), ("Rules", "UserId") })
    {
        try
        {
            db.Database.ExecuteSqlRaw($"""ALTER TABLE "{table}" ADD COLUMN "{column}" INTEGER""");
        }
        catch (SqliteException ex) when (ex.Message.Contains("duplicate column name"))
        {
            // Spalte existiert schon.
        }
    }
    db.Database.ExecuteSqlRaw("""DROP INDEX IF EXISTS "IX_Categories_Name" """);
    db.Database.ExecuteSqlRaw("""CREATE UNIQUE INDEX IF NOT EXISTS "IX_Categories_UserId_Name" ON "Categories" ("UserId", "Name")""");
}

app.UseFinanceAuth();
app.MapAuthEndpoints();
app.MapAdminEndpoints();

// Hilfsendpunkt fuer die Ersteinrichtung: exakten ASPSP-Namen der eigenen Volksbank finden.
app.MapGet("/api/institutions", async (EnableBankingClient bank) =>
    Results.Ok(await bank.ListInstitutionsAsync(app.Configuration["EnableBanking:AspspCountry"] ?? "DE")));

// Einmalig bei der Ersteinrichtung aufrufen: liefert den Consent-Link fuer den Browser.
app.MapPost("/api/consent-link", async (EnableBankingClient bank) =>
{
    var aspspName = app.Configuration["EnableBanking:AspspName"]
        ?? throw new InvalidOperationException("EnableBanking:AspspName fehlt - siehe GET /api/institutions.");
    var aspspCountry = app.Configuration["EnableBanking:AspspCountry"] ?? "DE";
    var url = await bank.StartAuthorizationAsync(aspspName, aspspCountry);
    return Results.Ok(new { url });
});

// Redirect-Ziel nach dem Bank-Login: zeigt die SessionId zum Eintragen in .env an.
app.MapGet("/api/consent-callback", async (string code, EnableBankingClient bank) =>
{
    var sessionId = await bank.CreateSessionAsync(code);
    return Results.Text($"Session erstellt. In .env eintragen:\nEnableBanking__SessionId={sessionId}");
});

app.MapPost("/api/refresh", async (HttpContext http, EnableBankingClient bank, CategorizationService categorizer, FinanceDbContext db, DateOnly? from, DateOnly? to) =>
{
    var userId = http.User.GetUserId();
    var sessionId = app.Configuration["EnableBanking:SessionId"];
    if (string.IsNullOrEmpty(sessionId))
        return Results.BadRequest("Kein EnableBanking:SessionId gesetzt - erst /api/consent-link durchlaufen und Ergebnis in .env eintragen.");

    var iban = app.Configuration["EnableBanking:AccountIban"]
        ?? throw new InvalidOperationException("EnableBanking:AccountIban fehlt in der Konfiguration.");

    // Ohne Angabe: aktueller Monat (bisheriges Verhalten fuer den monatlichen Lauf ohne UI).
    var rangeFrom = from ?? new DateOnly(DateTime.Today.Year, DateTime.Today.Month, 1);
    var rangeTo = to ?? DateOnly.FromDateTime(DateTime.Today);

    List<BankTransaction> transactions;
    try
    {
        transactions = await bank.GetTransactionsAsync(sessionId, iban, rangeFrom, rangeTo);
    }
    catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
    {
        // "Maximum daily access exceeded" kommt von der Bank selbst (PSD2-Tageslimit fuer
        // ungefragte Zugriffe) und setzt sich erst am naechsten Tag zurueck, nicht in Minuten.
        return Results.Json(new { error = $"Zugriff blockiert: {ex.Message}" }, statusCode: 429);
    }

    var (imported, _) = await ImportTransactionsAsync(userId, transactions, categorizer, db);
    return Results.Ok(new { imported });
}).RequireAuthorization();

// Bankunabhaengiger Nachimport: eine oder mehrere CAMT.052/053-Dateien hochladen, um Buchungen
// zu importieren, die weiter zurueckliegen als das 90-Tage-Limit der EnableBanking-Session.
// Gleiche Dedup-/Kategorisierungslogik wie /api/refresh, nur die Quelle der Transaktionen
// unterscheidet sich. Eine einzelne kaputte Datei bricht nicht den ganzen Batch ab - sie wird
// uebersprungen und als Fehler gemeldet, waehrend die uebrigen Dateien trotzdem importiert werden.
app.MapPost("/api/import/camt053", async (HttpContext http, IFormFileCollection files, CategorizationService categorizer, FinanceDbContext db) =>
{
    var userId = http.User.GetUserId();
    var imported = 0;
    var total = 0;
    var errors = new List<object>();
    var skipped = new List<object>();

    foreach (var file in files)
    {
        List<BankTransaction> transactions;
        try
        {
            await using var stream = file.OpenReadStream();
            transactions = Camt053Parser.Parse(stream);
        }
        catch (Exception ex) when (ex is System.Xml.XmlException or InvalidOperationException)
        {
            errors.Add(new { file = file.FileName, message = ex.Message });
            continue;
        }

        total += transactions.Count;
        var (fileImported, fileSkipped) = await ImportTransactionsAsync(userId, transactions, categorizer, db);
        imported += fileImported;
        skipped.AddRange(fileSkipped);
    }

    return Results.Ok(new { imported, total, errors, skipped });
}).RequireAuthorization().DisableAntiforgery(); // DisableAntiforgery: Cookie-Auth schuetzt bereits per RequireAuthorization, kein zusaetzlicher CSRF-Token-Flow fuer diesen Upload-Endpoint.

async Task<(int imported, List<object> skipped)> ImportTransactionsAsync(int userId, List<BankTransaction> transactions, CategorizationService categorizer, FinanceDbContext db)
{
    var imported = 0;
    var skipped = new List<object>();
    foreach (var tx in transactions)
    {
        // ExternalId allein reicht nicht - in beide Richtungen:
        // 1) EnableBanking (/api/refresh) und ein CAMT.053-Import vergeben fuer dieselbe reale
        //    Buchung unterschiedliche Referenzen (API-eigene Transaktions-ID vs. AcctSvcrRef der
        //    Bank). Bei ueberlappenden Zeitraeumen aus beiden Quellen faellt hier daher
        //    zusaetzlich auf Datum+Betrag+Verwendungszweck zurueck.
        // 2) Manche Zahlungsdienstleister vergeben dieselbe Referenz mehrfach fuer echt
        //    verschiedene Buchungen - z.B. Lohn/Gehalt-Ueberweisungen, bei denen AcctSvcrRef/
        //    EndToEndId eine feste Kunden-/Zahlungslaufnummer statt einer pro Buchung eindeutigen
        //    ID ist. Deshalb muessen bei einem ExternalId-Treffer Datum UND Betrag ebenfalls
        //    uebereinstimmen, sonst ist es trotz gleicher Referenz offensichtlich eine andere
        //    Buchung und faellt weiter unten in die Inhalts-Pruefung durch.
        // In beiden Faellen wird der Match-Grund mitgeloggt, um einen echten Doppel-Eintrag vom
        // seltenen Fall zweier wirklich verschiedener Buchungen mit zufaellig identischem
        // Datum/Betrag/Zweck zu unterscheiden.
        var existingById = await db.Transactions.FirstOrDefaultAsync(t =>
            t.ExternalId == tx.ExternalId && t.BookingDate == tx.BookingDate && t.Amount == tx.Amount && t.UserId == userId);
        if (existingById is not null)
        {
            skipped.Add(new
            {
                tx.BookingDate,
                tx.Amount,
                tx.Purpose,
                matchedBy = "externalId",
                sharedExternalId = tx.ExternalId,
                existingId = existingById.Id,
                existingBookingDate = existingById.BookingDate,
                existingAmount = existingById.Amount,
                existingPurpose = existingById.Purpose
            });
            continue;
        }
        var existingByContent = await db.Transactions.FirstOrDefaultAsync(t =>
            t.BookingDate == tx.BookingDate && t.Amount == tx.Amount && t.Purpose == tx.Purpose && t.UserId == userId);
        if (existingByContent is not null)
        {
            skipped.Add(new { tx.BookingDate, tx.Amount, tx.Purpose, matchedBy = "content", existingId = existingByContent.Id, existingExternalId = existingByContent.ExternalId, newExternalId = tx.ExternalId });
            continue;
        }

        var category = await categorizer.CategorizeAsync(userId, tx.CounterpartyName, tx.Purpose, tx.Amount);
        db.Transactions.Add(new StoredTransaction
        {
            UserId = userId,
            ExternalId = tx.ExternalId,
            BookingDate = tx.BookingDate,
            Amount = tx.Amount,
            CounterpartyName = tx.CounterpartyName,
            Purpose = tx.Purpose,
            Category = category
        });
        // Pro Eintrag statt einmal am Ende speichern: die Duplikat-Abfragen oben laufen gegen die
        // DB, wuerden also einen bereits in DIESEM Batch verarbeiteten Eintrag sonst nicht sehen
        // (z.B. wenn eine Datei versehentlich denselben Ntry zweimal enthaelt).
        await db.SaveChangesAsync();
        imported++;
    }
    return (imported, skipped);
}

// ponytail: kein Testprojekt im Repo fuer dieses Ein-Personen-Tool - Assert-Selbsttest statt
// xUnit-Setup, mit einer echten (fluechtigen) Sqlite-In-Memory-DB. Aufruf:
// `dotnet run -- --selftest-import-dedup`.
async Task ImportDedupSelfTestAsync()
{
    using var connection = new SqliteConnection("Data Source=:memory:");
    connection.Open();
    var options = new DbContextOptionsBuilder<FinanceDbContext>().UseSqlite(connection).Options;
    using var testDb = new FinanceDbContext(options);
    testDb.Database.EnsureCreated();
    var testCategorizer = new CategorizationService(testDb);
    const int testUserId = 1; // ponytail: kein echter User noetig - Sqlite erzwingt hier keinen FK (siehe Rule.CategoryId-Kommentar).

    // Quelle 1: EnableBanking-Refresh legt eine Buchung mit API-eigener ExternalId an.
    var enableBankingTx = new BankTransaction("eb-tx-123", new DateOnly(2025, 9, 15), -49.99m, "Testhaendler", "Testkauf");
    var (imported1, skipped1) = await ImportTransactionsAsync(testUserId, [enableBankingTx], testCategorizer, testDb);
    SelfTestAssert(imported1 == 1 && skipped1.Count == 0, $"erster Import: erwartet 1/0, war {imported1}/{skipped1.Count}");

    // Quelle 2: CAMT-Import derselben realen Buchung mit der AcctSvcrRef der Bank - andere
    // ExternalId, aber gleiches Datum/Betrag/Verwendungszweck -> muss als Duplikat erkannt werden.
    var camtTx = new BankTransaction("camt-acctsvcrref-456", new DateOnly(2025, 9, 15), -49.99m, "Testhaendler", "Testkauf");
    var (imported2, skipped2) = await ImportTransactionsAsync(testUserId, [camtTx], testCategorizer, testDb);
    SelfTestAssert(imported2 == 0 && skipped2.Count == 1, $"zweiter Import (Duplikat ueber Quellen hinweg): erwartet 0/1, war {imported2}/{skipped2.Count}");

    // Andere Buchung (abweichender Betrag) am selben Tag mit demselben Haendler darf nicht uebersprungen werden.
    var distinctTx = new BankTransaction("camt-acctsvcrref-789", new DateOnly(2025, 9, 15), -12.00m, "Testhaendler", "Testkauf");
    var (imported3, skipped3) = await ImportTransactionsAsync(testUserId, [distinctTx], testCategorizer, testDb);
    SelfTestAssert(imported3 == 1 && skipped3.Count == 0, $"echte andere Buchung: erwartet 1/0, war {imported3}/{skipped3.Count}");

    // Regression: manche Zahlungsdienstleister (z.B. Lohn/Gehalt-Laeufe) vergeben dieselbe
    // AcctSvcrRef/EndToEndId fuer jede Ueberweisung wieder - hier zwei Gehaltszahlungen an
    // verschiedenen Tagen (identischer Betrag, wie im real gemeldeten Fall) mit identischer
    // ExternalId. Beide muessen importiert werden, keine darf faelschlich als Duplikat gelten.
    var gehaltSep = new BankTransaction("00560023", new DateOnly(2025, 9, 16), 2170.17m, "DT Privatkunden GmbH", "Lohn/Gehalt 00560023/202509");
    var (imported4, skipped4) = await ImportTransactionsAsync(testUserId, [gehaltSep], testCategorizer, testDb);
    SelfTestAssert(imported4 == 1 && skipped4.Count == 0, $"erste Gehaltszahlung: erwartet 1/0, war {imported4}/{skipped4.Count}");

    var gehaltOkt = new BankTransaction("00560023", new DateOnly(2025, 10, 16), 2170.17m, "DT Privatkunden GmbH", "Lohn/Gehalt 00560023/202510");
    var (imported5, skipped5) = await ImportTransactionsAsync(testUserId, [gehaltOkt], testCategorizer, testDb);
    SelfTestAssert(imported5 == 1 && skipped5.Count == 0, $"zweite Gehaltszahlung trotz gleicher Referenz: erwartet 1/0, war {imported5}/{skipped5.Count}");

    Console.WriteLine("Import-Dedup self-test: OK");
}

void SelfTestAssert(bool condition, string message)
{
    if (!condition) throw new Exception($"Import-Dedup self-test FAILED: {message}");
}

// Kategorisiert bereits gespeicherte Buchungen neu (z.B. nach Anpassung von
// category-rules.json oder des Prompts) - /api/refresh setzt die Kategorie sonst
// nur einmalig beim Import und fasst bestehende Zeilen nie wieder an.
app.MapPost("/api/recategorize", async (HttpContext http, CategorizationService categorizer, FinanceDbContext db) =>
{
    var userId = http.User.GetUserId();
    var all = await db.Transactions.Where(t => t.UserId == userId).ToListAsync();
    var changed = 0;
    foreach (var tx in all)
    {
        var category = await categorizer.CategorizeAsync(userId, tx.CounterpartyName, tx.Purpose, tx.Amount);
        if (category != tx.Category)
        {
            tx.Category = category;
            changed++;
        }
    }
    await db.SaveChangesAsync();
    return Results.Ok(new { total = all.Count, changed });
}).RequireAuthorization();

app.MapGet("/api/categories", async (HttpContext http, FinanceDbContext db) =>
{
    var userId = http.User.GetUserId();
    return Results.Ok(await db.Categories.Where(c => c.UserId == userId).OrderBy(c => c.Name).Select(c => new { c.Id, c.Name, c.Color }).ToListAsync());
}).RequireAuthorization();

app.MapPost("/api/categories", async (HttpContext http, CategoryRequest body, FinanceDbContext db) =>
{
    var userId = http.User.GetUserId();
    var name = body.Name?.Trim();
    if (string.IsNullOrEmpty(name)) return Results.BadRequest("Name darf nicht leer sein.");
    if (await db.Categories.AnyAsync(c => c.Name == name && c.UserId == userId)) return Results.Conflict("Kategorie existiert bereits.");

    var color = body.Color?.Trim();
    if (!string.IsNullOrEmpty(color))
    {
        if (!CategoryColors.Palette.Contains(color)) return Results.BadRequest("Ungueltige Farbe.");
    }
    else
    {
        // Keine Farbe mitgegeben - automatisch eine nehmen, die noch keine andere Kategorie nutzt.
        color = CategoryColors.PickUnused(await db.Categories.Where(c => c.UserId == userId).Select(c => c.Color).ToListAsync());
    }

    var category = new Category { Name = name, Color = color, UserId = userId };
    db.Categories.Add(category);
    await db.SaveChangesAsync();
    return Results.Ok(new { category.Id, category.Name, category.Color });
}).RequireAuthorization();

app.MapPut("/api/categories/{id:int}", async (int id, HttpContext http, CategoryRequest body, FinanceDbContext db) =>
{
    var userId = http.User.GetUserId();
    var name = body.Name?.Trim();
    if (string.IsNullOrEmpty(name)) return Results.BadRequest("Name darf nicht leer sein.");

    var category = await db.Categories.FirstOrDefaultAsync(c => c.Id == id && c.UserId == userId);
    if (category is null) return Results.NotFound();

    if (category.Name != name)
    {
        if (await db.Categories.AnyAsync(c => c.Name == name && c.UserId == userId)) return Results.Conflict("Kategorie existiert bereits.");

        var oldName = category.Name;
        category.Name = name;
        // StoredTransaction.Category ist ein reiner String (kein Fremdschluessel) - beim Umbenennen
        // muessen bereits gespeicherte Buchungen mitgezogen werden, sonst verwaisen sie unter dem alten Namen.
        await db.Transactions.Where(t => t.Category == oldName && t.UserId == userId)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.Category, name));
    }

    // Farbe ist optional im Request - nur mitgeschickt, wenn im Bearbeiten-Dialog ein Swatch
    // gewaehlt wurde. Leerer String setzt bewusst auf "keine Farbe" (Hash-Fallback) zurueck.
    if (body.Color is not null)
    {
        var color = body.Color.Trim();
        if (!string.IsNullOrEmpty(color) && !CategoryColors.Palette.Contains(color))
            return Results.BadRequest("Ungueltige Farbe.");
        category.Color = string.IsNullOrEmpty(color) ? null : color;
    }

    await db.SaveChangesAsync();
    return Results.Ok(new { category.Id, category.Name, category.Color });
}).RequireAuthorization();

app.MapDelete("/api/categories/{id:int}", async (int id, HttpContext http, FinanceDbContext db) =>
{
    var userId = http.User.GetUserId();
    var category = await db.Categories.FirstOrDefaultAsync(c => c.Id == id && c.UserId == userId);
    if (category is null) return Results.NotFound();
    // "Sonstiges" ist das Reassignment-Ziel fuer geloeschte Kategorien und der LLM-Fallback -
    // ohne sie liefe beides ins Leere.
    if (category.Name == "Sonstiges") return Results.BadRequest("\"Sonstiges\" kann nicht geloescht werden.");

    await db.Transactions.Where(t => t.Category == category.Name && t.UserId == userId)
        .ExecuteUpdateAsync(s => s.SetProperty(t => t.Category, "Sonstiges"));
    // Eine Regel, die auf eine geloeschte Kategorie zeigt, ist sinnlos (anders als bei Buchungen
    // gibt es fuer Regeln kein sinnvolles "Sonstiges"-Reassignment) - also mit loeschen.
    await db.Rules.Where(r => r.CategoryId == id && r.UserId == userId).ExecuteDeleteAsync();
    db.Categories.Remove(category);
    await db.SaveChangesAsync();
    return Results.Ok();
}).RequireAuthorization();

app.MapGet("/api/rules", async (HttpContext http, FinanceDbContext db) =>
{
    var userId = http.User.GetUserId();
    return Results.Ok(await db.Rules.Where(r => r.UserId == userId)
        .Join(db.Categories.Where(c => c.UserId == userId), r => r.CategoryId, c => c.Id, (r, c) => new { r.Id, r.Pattern, CategoryId = c.Id, CategoryName = c.Name })
        .OrderBy(x => x.Pattern)
        .ToListAsync());
}).RequireAuthorization();

app.MapPost("/api/rules", async (HttpContext http, RuleRequest body, FinanceDbContext db) =>
{
    var userId = http.User.GetUserId();
    var pattern = body.Pattern?.Trim();
    if (string.IsNullOrEmpty(pattern)) return Results.BadRequest("Muster darf nicht leer sein.");

    var category = await db.Categories.FirstOrDefaultAsync(c => c.Id == body.CategoryId && c.UserId == userId);
    if (category is null) return Results.BadRequest("Unbekannte Kategorie.");

    // Muster existiert schon in einer anderen Kategorie -> Regel umhaengen statt Fehler.
    var rule = await db.Rules.FirstOrDefaultAsync(r => r.Pattern == pattern && r.UserId == userId);
    if (rule is null)
    {
        rule = new Rule { Pattern = pattern, CategoryId = category.Id, UserId = userId };
        db.Rules.Add(rule);
    }
    else
    {
        rule.CategoryId = category.Id;
    }
    await db.SaveChangesAsync();
    return Results.Ok(new { rule.Id, rule.Pattern, CategoryId = category.Id, CategoryName = category.Name });
}).RequireAuthorization();

app.MapDelete("/api/rules/{id:int}", async (int id, HttpContext http, FinanceDbContext db) =>
{
    var userId = http.User.GetUserId();
    var rule = await db.Rules.FirstOrDefaultAsync(r => r.Id == id && r.UserId == userId);
    if (rule is null) return Results.NotFound();
    db.Rules.Remove(rule);
    await db.SaveChangesAsync();
    return Results.Ok();
}).RequireAuthorization();

app.MapGet("/api/summary", async (DateOnly from, DateOnly to, HttpContext http, FinanceDbContext db) =>
{
    var userId = http.User.GetUserId();
    // ponytail: EF Core/Sqlite kann SUM() nicht auf decimal uebersetzen - bei der kleinen
    // Datenmenge eines persoenlichen Kontos reicht Aggregieren nach dem Laden.
    var rangeTransactions = await db.Transactions
        .Where(t => t.BookingDate >= from && t.BookingDate <= to && t.UserId == userId)
        .ToListAsync();

    var summary = rangeTransactions
        .GroupBy(t => t.Category)
        .Select(g => new { category = g.Key, totalAmount = g.Sum(t => t.Amount) })
        .ToList();

    return Results.Ok(summary);
}).RequireAuthorization();

// Einzelabrechnungen fuer einen Balken (Kategorie + Zeitraum) im Drilldown - oder, ohne
// category, die juengsten Buchungen im Zeitraum, damit die Buchungsliste im Dashboard beim
// initialen Laden nicht leer ist. Mit category weiterhin unlimitiert (bisheriges Verhalten).
app.MapGet("/api/transactions", async (DateOnly from, DateOnly to, string? category, int? limit, HttpContext http, FinanceDbContext db) =>
{
    var userId = http.User.GetUserId();
    var query = db.Transactions
        .Where(t => t.UserId == userId)
        .Where(t => t.BookingDate >= from && t.BookingDate <= to);

    if (!string.IsNullOrEmpty(category))
        query = query.Where(t => t.Category == category);

    var take = limit ?? (string.IsNullOrEmpty(category) ? 30 : int.MaxValue);

    var transactions = await query
        .OrderByDescending(t => t.BookingDate)
        .Take(take)
        .Select(t => new { t.Id, t.BookingDate, t.Amount, t.CounterpartyName, t.Purpose, t.Category })
        .ToListAsync();

    return Results.Ok(transactions);
}).RequireAuthorization();

// Alle Buchungen im gewaehlten Zeitraum loeschen (z.B. um einen fehlerhaften Import wieder
// rueckgaengig zu machen) - unabhaengig von einem evtl. gesetzten Kategorie-Filter im Dashboard.
app.MapDelete("/api/transactions", async (DateOnly from, DateOnly to, HttpContext http, FinanceDbContext db) =>
{
    var userId = http.User.GetUserId();
    var deleted = await db.Transactions
        .Where(t => t.BookingDate >= from && t.BookingDate <= to && t.UserId == userId)
        .ExecuteDeleteAsync();
    return Results.Ok(new { deleted });
}).RequireAuthorization();

// Einzelne Buchung manuell umkategorisieren (z.B. Dropdown in der Buchungsliste im Dashboard) -
// unabhaengig von Regeln/Neu-kategorisieren, greift sofort nur fuer diese eine Buchung.
app.MapPut("/api/transactions/{id:int}/category", async (int id, HttpContext http, CategoryAssignRequest body, FinanceDbContext db) =>
{
    var userId = http.User.GetUserId();
    var categoryName = body.Category?.Trim();
    if (string.IsNullOrEmpty(categoryName)) return Results.BadRequest("Kategorie darf nicht leer sein.");
    if (!await db.Categories.AnyAsync(c => c.Name == categoryName && c.UserId == userId)) return Results.BadRequest("Unbekannte Kategorie.");

    var tx = await db.Transactions.FirstOrDefaultAsync(t => t.Id == id && t.UserId == userId);
    if (tx is null) return Results.NotFound();

    tx.Category = categoryName;
    await db.SaveChangesAsync();
    return Results.Ok(new { tx.Id, tx.Category });
}).RequireAuthorization();

app.Run();

record CategoryRequest(string? Name, string? Color = null);

// Feste Farbpalette (Slot-Keys, keine Hex-Werte - die CSS-Variablen dazu leben in index.css /
// categoryColor.ts). Server validiert nur gegen diese Liste, damit keine beliebigen Strings ins UI durchsickern.
static class CategoryColors
{
    public static readonly string[] Palette =
        ["lebensmittel", "miete", "freizeit", "transport", "versicherung", "gehalt", "abo", "gesundheit",
         "diva", "partnerkarten", "stromgas", "vertraege"];

    public static string PickUnused(IEnumerable<string?> usedColors)
    {
        var used = new HashSet<string>(usedColors.Where(c => !string.IsNullOrEmpty(c))!);
        var free = Palette.FirstOrDefault(p => !used.Contains(p));
        if (free is not null) return free;

        // Alle Farben sind schon mindestens einmal vergeben - die am seltensten genutzte
        // nehmen statt einen Fehler zu werfen.
        return usedColors
            .Where(c => !string.IsNullOrEmpty(c))
            .GroupBy(c => c!)
            .OrderBy(g => g.Count())
            .Select(g => g.Key)
            .FirstOrDefault() ?? Palette[0];
    }
}
record RuleRequest(string? Pattern, int CategoryId);
record CategoryAssignRequest(string? Category);
