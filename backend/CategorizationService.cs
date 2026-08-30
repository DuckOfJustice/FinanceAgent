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
    private string? TryGetConfiguredCategory(string? counterpartyName, string purpose, List<RuleMatch> rules)
    {
        // PayPal steht als Gegenpartei immer gleich (generischer Zahlungsdienstleister) - nur der
        // Verwendungszweck verraet den eigentlichen Haendler, daher hier ohne counterpartyName suchen.
        var haystack = counterpartyName?.Contains("PayPal", StringComparison.OrdinalIgnoreCase) == true
            ? purpose
            : $"{counterpartyName} {purpose}";

        // Bei mehreren treffenden Mustern gewinnt das laengste (spezifischste), damit z.B.
        // "Telekom Deutschland GmbH" nicht vom generischen Muster "vertrag" ueberdeckt wird,
        // nur weil "Vertragskonto" im Verwendungszweck zufaellig "vertrag" enthaelt.
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

    private sealed record RuleMatch(string Pattern, string CategoryName);
}
