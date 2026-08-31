using Microsoft.EntityFrameworkCore;

namespace FinanceDuck.Api;

public sealed class CategorizationService(FinanceDbContext db)
{
    public async Task<string> CategorizeAsync(string? counterpartyName, string purpose, decimal amount)
    {
        var rules = await db.Rules
            .Join(db.Categories, r => r.CategoryId, c => c.Id, (r, c) => new RuleMatch(r.Pattern, c.Name))
            .ToListAsync();

        var category = TryGetConfiguredCategory(counterpartyName, purpose, rules) ?? "Sonstiges";

        // "Gehalt" ist per Definition eine Gutschrift - eine Belastung (negativer Betrag)
        // kann nie Gehalt sein, egal was die Regel dazu sagt.
        if (category == "Gehalt" && amount <= 0) category = "Sonstiges";

        return category;
    }

    // Feste Zuordnungen pruefen (z.B. "FitX" -> "Freizeit") - kein Treffer heisst "Sonstiges".
    internal static string? TryGetConfiguredCategory(string? counterpartyName, string purpose, List<RuleMatch> rules)
    {
        // PayPal steht als Gegenpartei immer gleich (generischer Zahlungsdienstleister) - nur der
        // Verwendungszweck verraet den eigentlichen Haendler, daher hier ohne counterpartyName suchen.
        if (counterpartyName?.Contains("PayPal", StringComparison.OrdinalIgnoreCase) == true)
            return BestMatch(purpose, rules);

        // Gegenpartei ist der zuverlaessigere Hinweis (fester Firmenname) - erst dort suchen,
        // Verwendungszweck (freier Text, oft generisch) nur als Fallback ohne Treffer dort.
        return BestMatch(counterpartyName ?? "", rules) ?? BestMatch(purpose, rules);
    }

    // Bei mehreren treffenden Mustern gewinnt das laengste (spezifischste), damit z.B.
    // "Telekom Deutschland GmbH" nicht vom generischen Muster "vertrag" ueberdeckt wird,
    // nur weil "Vertragskonto" zufaellig "vertrag" enthaelt.
    private static string? BestMatch(string haystack, List<RuleMatch> rules)
    {
        string? bestCategory = null;
        var bestLength = -1;
        foreach (var rule in rules)
        {
            if (!haystack.Contains(rule.Pattern, StringComparison.OrdinalIgnoreCase)) continue;
            if (rule.Pattern.Length > bestLength)
            {
                bestLength = rule.Pattern.Length;
                bestCategory = rule.CategoryName;
            }
        }
        return bestCategory;
    }

    internal sealed record RuleMatch(string Pattern, string CategoryName);
}

// ponytail: kein Testprojekt im Repo fuer dieses Ein-Personen-Tool - Assert-Selbsttest statt
// xUnit-Setup. Aufruf: `dotnet run -- --selftest-categorization`.
public static class CategorizationServiceSelfTest
{
    public static void Run()
    {
        var rules = new List<CategorizationService.RuleMatch>
        {
            new("Telekom", "Sonstiges"),
            new("Telekom Deutschland GmbH", "Telefon & Internet"),
            new("vertrag", "Abo"),
            new("Netflix", "Abo"),
        };

        // Gegenpartei-Treffer gewinnt, obwohl der Verwendungszweck ebenfalls passen wuerde.
        var telekom = CategorizationService.TryGetConfiguredCategory("Telekom Deutschland GmbH", "Vertragskonto 123", rules);
        Assert(telekom == "Telefon & Internet", $"war {telekom}");

        // Kein Treffer in der Gegenpartei -> Fallback auf Verwendungszweck.
        var vertrag = CategorizationService.TryGetConfiguredCategory("Unbekannte Firma XY", "Vertragskonto 123", rules);
        Assert(vertrag == "Abo", $"war {vertrag}");

        // Weder Gegenpartei noch Verwendungszweck passen -> kein Treffer (Aufrufer faellt auf "Sonstiges" zurueck).
        var none = CategorizationService.TryGetConfiguredCategory("Unbekannte Firma XY", "Diverses", rules);
        Assert(none is null, $"war {none}");

        // PayPal bleibt Sonderfall: Gegenpartei wird ignoriert, nur der Verwendungszweck zaehlt.
        var paypal = CategorizationService.TryGetConfiguredCategory("PayPal Europe", "Netflix.com", rules);
        Assert(paypal == "Abo", $"war {paypal}");

        Console.WriteLine("CategorizationService self-test: OK");
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition) throw new Exception($"CategorizationService self-test FAILED: {message}");
    }
}
