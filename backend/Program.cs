using FinanceDuck.Api;
using Microsoft.EntityFrameworkCore;

Directory.CreateDirectory("data");

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<FinanceDbContext>(o =>
    o.UseSqlite("Data Source=data/finance.db"));

builder.Services.AddHttpClient<EnableBankingClient>(c =>
    c.BaseAddress = new Uri(builder.Configuration["EnableBanking:BaseUrl"]!));

builder.Services.AddHttpClient<CategorizationService>(c =>
    c.BaseAddress = new Uri(builder.Configuration["Ollama:BaseUrl"]!));

var app = builder.Build();

using (var scope = app.Services.CreateScope())
    scope.ServiceProvider.GetRequiredService<FinanceDbContext>().Database.EnsureCreated();

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

app.MapPost("/api/refresh", async (EnableBankingClient bank, CategorizationService categorizer, FinanceDbContext db, DateOnly? from, DateOnly? to) =>
{
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

    var imported = 0;
    foreach (var tx in transactions)
    {
        if (await db.Transactions.AnyAsync(t => t.ExternalId == tx.ExternalId)) continue;

        var category = await categorizer.CategorizeAsync(tx.CounterpartyName, tx.Purpose, tx.Amount);
        db.Transactions.Add(new StoredTransaction
        {
            ExternalId = tx.ExternalId,
            BookingDate = tx.BookingDate,
            Amount = tx.Amount,
            CounterpartyName = tx.CounterpartyName,
            Purpose = tx.Purpose,
            Category = category
        });
        imported++;
    }
    await db.SaveChangesAsync();
    return Results.Ok(new { imported });
});

// Kategorisiert bereits gespeicherte Buchungen neu (z.B. nach Anpassung von
// category-rules.json oder des Prompts) - /api/refresh setzt die Kategorie sonst
// nur einmalig beim Import und fasst bestehende Zeilen nie wieder an.
app.MapPost("/api/recategorize", async (CategorizationService categorizer, FinanceDbContext db) =>
{
    var all = await db.Transactions.ToListAsync();
    var changed = 0;
    foreach (var tx in all)
    {
        var category = await categorizer.CategorizeAsync(tx.CounterpartyName, tx.Purpose, tx.Amount);
        if (category != tx.Category)
        {
            tx.Category = category;
            changed++;
        }
    }
    await db.SaveChangesAsync();
    return Results.Ok(new { total = all.Count, changed });
});

app.MapGet("/api/summary", async (DateOnly from, DateOnly to, FinanceDbContext db) =>
{
    // ponytail: EF Core/Sqlite kann SUM() nicht auf decimal uebersetzen - bei der kleinen
    // Datenmenge eines persoenlichen Kontos reicht Aggregieren nach dem Laden.
    var rangeTransactions = await db.Transactions
        .Where(t => t.BookingDate >= from && t.BookingDate <= to)
        .ToListAsync();

    var summary = rangeTransactions
        .GroupBy(t => t.Category)
        .Select(g => new { category = g.Key, totalAmount = g.Sum(t => t.Amount) })
        .ToList();

    return Results.Ok(summary);
});

// Einzelabrechnungen fuer einen Balken (Kategorie + Zeitraum) im Drilldown - oder, ohne
// category, die juengsten Buchungen im Zeitraum, damit die Buchungsliste im Dashboard beim
// initialen Laden nicht leer ist. Mit category weiterhin unlimitiert (bisheriges Verhalten).
app.MapGet("/api/transactions", async (DateOnly from, DateOnly to, string? category, int? limit, FinanceDbContext db) =>
{
    var query = db.Transactions
        .Where(t => t.BookingDate >= from && t.BookingDate <= to);

    if (!string.IsNullOrEmpty(category))
        query = query.Where(t => t.Category == category);

    var take = limit ?? (string.IsNullOrEmpty(category) ? 30 : int.MaxValue);

    var transactions = await query
        .OrderByDescending(t => t.BookingDate)
        .Take(take)
        .Select(t => new { t.BookingDate, t.Amount, t.CounterpartyName, t.Purpose })
        .ToListAsync();

    return Results.Ok(transactions);
});

// Monatsverlauf (Einnahmen/Ausgaben/Saldo) fuer den Trend-Chart im Dashboard. Endmonat per
// Query steuerbar (Default: aktueller Monat), sonst wie /api/summary nach dem Laden aggregiert.
app.MapGet("/api/history", async (DateOnly? end, int? months, FinanceDbContext db) =>
{
    var endDate = end ?? DateOnly.FromDateTime(DateTime.Today);
    var monthCount = months is > 0 and <= 24 ? months.Value : 6;

    var endMonthStart = new DateOnly(endDate.Year, endDate.Month, 1);
    var startMonth = endMonthStart.AddMonths(-(monthCount - 1));
    var rangeEnd = endMonthStart.AddMonths(1).AddDays(-1);

    var rangeTransactions = await db.Transactions
        .Where(t => t.BookingDate >= startMonth && t.BookingDate <= rangeEnd)
        .ToListAsync();

    var result = Enumerable.Range(0, monthCount)
        .Select(i => startMonth.AddMonths(i))
        .Select(m =>
        {
            var monthTx = rangeTransactions.Where(t => t.BookingDate.Year == m.Year && t.BookingDate.Month == m.Month).ToList();
            var income = monthTx.Where(t => t.Amount > 0).Sum(t => t.Amount);
            var expenses = monthTx.Where(t => t.Amount < 0).Sum(t => t.Amount);
            return new { month = $"{m.Year}-{m.Month:D2}", income, expenses, balance = income + expenses };
        })
        .ToList();

    return Results.Ok(result);
});

app.Run();
