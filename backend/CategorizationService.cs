using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace FinanceDuck.Api;

public sealed class CategorizationService(HttpClient ollama, IConfiguration cfg)
{
    public static readonly string[] Categories =
        ["Lebensmittel", "Miete", "Transport", "Gehalt", "Abo", "Sonstiges",
         "Diva", "Partnerkarten", "Strom und Gas", "Verträge"];

    private const string RulesPath = "category-rules.json";

    public async Task<string> CategorizeAsync(string? counterpartyName, string purpose, decimal amount)
    {
        var category = TryGetConfiguredCategory(counterpartyName, purpose)
            ?? await CategorizeWithLlmAsync(counterpartyName, purpose);

        // "Gehalt" ist per Definition eine Gutschrift - eine Belastung (negativer Betrag)
        // kann nie Gehalt sein, egal was Regel oder Modell dazu sagen.
        if (category == "Gehalt" && amount <= 0) category = "Sonstiges";

        return category;
    }

    private async Task<string> CategorizeWithLlmAsync(string? counterpartyName, string purpose)
    {
        var maskedName = MaskSensitiveData(counterpartyName ?? "");
        var maskedPurpose = MaskSensitiveData(purpose);

        var systemPrompt = $$"""
            Du bist ein Kategorisierer fuer Bankumsaetze auf einem privaten Girokonto.
            Ordne den Umsatz GENAU EINER der folgenden Kategorien zu:
            {{string.Join(", ", Categories)}}.

            Wichtige Regeln:
            - "Gehalt" NUR bei einer eingehenden Lohn-/Gehaltszahlung eines Arbeitgebers
              (Verwendungszweck enthaelt typischerweise "Lohn", "Gehalt" oder "Verguetung").
              Einzelne Kartenzahlungen, Ueberweisungen an/von Online-Shops, Zahlungs-
              dienstleistern (z.B. Adyen, PAYONE), Supermaerkten oder Privatpersonen sind
              KEIN "Gehalt" - auch nicht, wenn der Betrag positiv ist.
            - Bei Unsicherheit "Sonstiges" waehlen statt zu raten.

            Antworte AUSSCHLIESSLICH mit validem JSON in diesem Format, kein Freitext,
            keine Erklaerung, kein Markdown:
            {"category": "<eine der Kategorien>"}
            """;

        var res = await ollama.PostAsJsonAsync("api/generate", new
        {
            model = cfg["Ollama:Model"],
            system = systemPrompt,
            prompt = $"Empfaenger: {maskedName}\nVerwendungszweck: {maskedPurpose}",
            format = "json",
            stream = false
        });
        res.EnsureSuccessStatusCode();

        var body = await res.Content.ReadFromJsonAsync<OllamaResponse>();
        var result = JsonSerializer.Deserialize<CategoryResult>(body!.Response);

        return Categories.Contains(result?.Category) ? result!.Category! : "Sonstiges";
    }

    // Feste Zuordnungen vor dem LLM pruefen (z.B. "FitX" -> "Freizeit") - muss nicht vollstaendig
    // sein, nur Treffer werden genutzt, alles andere geht weiter an Ollama. Datei wird bei jedem
    // Aufruf neu gelesen, damit Aenderungen ohne Neustart wirken (kleine Datei, unkritisch).
    private string? TryGetConfiguredCategory(string? counterpartyName, string purpose)
    {
        if (!File.Exists(RulesPath)) return null;

        var rules = JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(RulesPath));
        if (rules is null) return null;

        var haystack = $"{counterpartyName} {purpose}";

        // Bei mehreren treffenden Mustern gewinnt das laengste (spezifischste), damit z.B.
        // "Telekom Deutschland GmbH" nicht vom generischen Muster "vertrag" ueberdeckt wird,
        // nur weil "Vertragskonto" im Verwendungszweck zufaellig "vertrag" enthaelt.
        string? bestCategory = null;
        var bestLength = -1;
        foreach (var (pattern, category) in rules)
        {
            if (!Categories.Contains(category)) continue;
            if (!haystack.Contains(pattern, StringComparison.OrdinalIgnoreCase)) continue;
            if (pattern.Length > bestLength)
            {
                bestLength = pattern.Length;
                bestCategory = category;
            }
        }
        return bestCategory;
    }

    private string MaskSensitiveData(string text)
    {
        var withoutIban = Regex.Replace(text, @"\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b", "[IBAN]");
        var ownName = cfg["App:OwnName"];
        return string.IsNullOrEmpty(ownName)
            ? withoutIban
            : Regex.Replace(withoutIban, Regex.Escape(ownName), "[NAME]", RegexOptions.IgnoreCase);
    }

    private sealed record OllamaResponse([property: JsonPropertyName("response")] string Response);
    private sealed record CategoryResult([property: JsonPropertyName("category")] string? Category);
}
