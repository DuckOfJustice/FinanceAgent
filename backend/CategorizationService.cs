using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace FinanceAgent.Api;

public sealed class CategorizationService(HttpClient ollama, IConfiguration cfg)
{
    public static readonly string[] Categories =
        ["Lebensmittel", "Miete", "Freizeit", "Transport", "Versicherung",
         "Gehalt", "Abo", "Gesundheit", "Sonstiges"];

    public async Task<string> CategorizeAsync(string? counterpartyName, string purpose)
    {
        var maskedName = MaskSensitiveData(counterpartyName ?? "");
        var maskedPurpose = MaskSensitiveData(purpose);

        var systemPrompt = $$"""
            Du bist ein Kategorisierer fuer Bankumsaetze. Ordne den Umsatz GENAU EINER
            der folgenden Kategorien zu: {{string.Join(", ", Categories)}}.
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
