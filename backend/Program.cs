using FinanceAgent.Api;
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

        var category = await categorizer.CategorizeAsync(tx.CounterpartyName, tx.Purpose);
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

// Einzelabrechnungen fuer einen Balken (Kategorie + Zeitraum), fuer die Drilldown-Liste im Dashboard.
app.MapGet("/api/transactions", async (DateOnly from, DateOnly to, string category, FinanceDbContext db) =>
{
    var transactions = await db.Transactions
        .Where(t => t.BookingDate >= from && t.BookingDate <= to && t.Category == category)
        .OrderByDescending(t => t.BookingDate)
        .Select(t => new { t.BookingDate, t.Amount, t.CounterpartyName, t.Purpose })
        .ToListAsync();

    return Results.Ok(transactions);
});

app.Run();
