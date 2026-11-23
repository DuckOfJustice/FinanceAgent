using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace FinanceDuck.Api;

public sealed class EnableBankingClient(HttpClient http, IConfiguration configuration)
{
    // Einmalig bei der Ersteinrichtung: Link im Browser oeffnen, Volksbank-Login bestaetigen.
    public async Task<string> StartAuthorizationAsync(string appId, string privateKeyPem, string aspspName, string aspspCountry)
    {
        AuthenticateRequest(appId, privateKeyPem);
        // Konfigurierbar statt hartcodiert: auf einem gemeinsam genutzten Pi zeigt eine feste
        // "https://localhost:8443/..."-URL auf den Rechner des jeweiligen Browsers, nicht auf den
        // Server. Default in appsettings.json haelt lokales Dev-Verhalten unveraendert.
        var redirectUrl = configuration["EnableBanking:RedirectUrl"] ?? "https://localhost:8443/api/consent-callback";
        var res = await http.PostAsJsonAsync("auth", new
        {
            aspsp = new { name = aspspName, country = aspspCountry },
            access = new { valid_until = DateTime.UtcNow.AddDays(90).ToString("o") },
            redirect_url = redirectUrl,
            state = Guid.NewGuid().ToString("N"),
            psu_type = "personal"
        });
        await EnsureOkAsync(res);
        var body = await res.Content.ReadFromJsonAsync<AuthStartResponse>();
        return body!.Url;
    }

    // Ziel des Redirects nach dem Bank-Login: tauscht den "code" aus der Callback-URL gegen eine SessionId.
    public async Task<string> CreateSessionAsync(string appId, string privateKeyPem, string code)
    {
        AuthenticateRequest(appId, privateKeyPem);
        var res = await http.PostAsJsonAsync("sessions", new { code });
        await EnsureOkAsync(res);
        // ponytail: POST /sessions liefert "accounts" verschachtelt, GET /sessions/{id} liefert
        // "accounts" als reine UID-Strings - hier interessiert uns nur session_id, den Rest ignorieren
        // wir bewusst statt ein drittes DTO fuer das Erstellungs-Schema zu pflegen.
        var body = await res.Content.ReadFromJsonAsync<CreateSessionResponse>();
        return body!.SessionId;
    }

    // Hilfsendpunkt fuer die Ersteinrichtung: den exakten ASPSP-Namen der eigenen Volksbank finden.
    public async Task<JsonElement> ListInstitutionsAsync(string appId, string privateKeyPem, string country)
    {
        AuthenticateRequest(appId, privateKeyPem);
        var res = await http.GetAsync($"aspsps?country={country}");
        res.EnsureSuccessStatusCode();
        return JsonDocument.Parse(await res.Content.ReadAsStreamAsync()).RootElement.Clone();
    }

    public async Task<List<BankTransaction>> GetTransactionsAsync(string appId, string privateKeyPem, string sessionId, string targetIban, DateOnly from, DateOnly to)
    {
        AuthenticateRequest(appId, privateKeyPem);
        var sessionRes = await http.GetAsync($"sessions/{sessionId}");
        await EnsureOkAsync(sessionRes);
        var session = await sessionRes.Content.ReadFromJsonAsync<SessionResponse>();
        var accountId = await FindAccountByIbanAsync(appId, privateKeyPem, session!.Accounts, targetIban);

        AuthenticateRequest(appId, privateKeyPem);
        var transactionsRes = await http.GetAsync(
            $"accounts/{accountId}/transactions?date_from={from:yyyy-MM-dd}&date_to={to:yyyy-MM-dd}");
        await EnsureOkAsync(transactionsRes);
        var response = await transactionsRes.Content.ReadFromJsonAsync<TransactionsEnvelope>();

        return response!.Transactions
            .Select(t =>
            {
                var isDebit = t.CreditDebitIndicator == "DBIT";
                return new BankTransaction(
                    // ponytail: manche Banken (u.a. VR Bank RheinAhrEifel) liefern transaction_id nicht,
                    // dann auf entry_reference ausweichen.
                    ExternalId: t.TransactionId ?? t.EntryReference ?? Guid.NewGuid().ToString(),
                    BookingDate: t.BookingDate,
                    Amount: decimal.Parse(t.TransactionAmount.Amount, System.Globalization.CultureInfo.InvariantCulture) * (isDebit ? -1 : 1),
                    // Zahlt der Kunde ueber einen Zahlungsdienstleister (z.B. Adyen), steht dort dessen
                    // Name - der eigentliche Haendler steckt dann im abweichenden Zahlungsempfaenger.
                    CounterpartyName: isDebit
                        ? t.UltimateCreditor?.Name ?? t.Creditor?.Name
                        : t.UltimateDebtor?.Name ?? t.Debtor?.Name,
                    Purpose: t.RemittanceInformation is { Count: > 0 } r ? string.Join(" ", r) : "");
            })
            .ToList();
    }

    // Der Volksbank-Account hat mehrere verknuepfte Konten - hier gezielt das mit der
    // konfigurierten IBAN raussuchen statt uns auf die Reihenfolge zu verlassen.
    // ponytail: prozessweiter Cache statt pro Request neu aufzuloesen - die Kontozuordnung
    // aendert sich nicht, und Enable Banking rate-limitet /details recht knapp.
    private static readonly Dictionary<string, string> AccountUidCache = new();

    private async Task<string> FindAccountByIbanAsync(string appId, string privateKeyPem, List<string> accountUids, string targetIban)
    {
        // Cache-Key enthaelt appId, nicht nur die IBAN: mehrere Nutzer teilen sich diesen
        // process-weiten Cache, ein IBAN-Duplikat/-Tippfehler zwischen zwei Nutzern darf nicht
        // dazu fuehren, dass die unter dem einen appId/Session aufgeloeste Account-UID fuer den
        // anderen Nutzer wiederverwendet wird.
        var cacheKey = $"{appId}:{targetIban}";
        if (AccountUidCache.TryGetValue(cacheKey, out var cached))
            return cached;

        foreach (var uid in accountUids)
        {
            AuthenticateRequest(appId, privateKeyPem);
            var detailsRes = await http.GetAsync($"accounts/{uid}/details");
            await EnsureOkAsync(detailsRes);
            var details = await detailsRes.Content.ReadFromJsonAsync<AccountDetails>();
            if (details?.AccountId.Iban == targetIban)
            {
                AccountUidCache[cacheKey] = uid;
                return uid;
            }
        }
        throw new InvalidOperationException($"Kein verknuepftes Konto mit IBAN {targetIban} gefunden.");
    }

    // Enable Banking/die Bank liefern bei Fehlern eine sprechende "message" im JSON-Body -
    // die geht mit reinem EnsureSuccessStatusCode() verloren, hier extra rausziehen.
    private static async Task EnsureOkAsync(HttpResponseMessage res)
    {
        if (res.IsSuccessStatusCode) return;

        string? message = null;
        try
        {
            var body = await res.Content.ReadFromJsonAsync<JsonElement>();
            if (body.TryGetProperty("message", out var m)) message = m.GetString();
        }
        catch { /* Fehlerantwort war kein JSON - Fallback unten */ }

        throw new HttpRequestException(message ?? res.ReasonPhrase, null, res.StatusCode);
    }

    private void AuthenticateRequest(string appId, string privateKeyPem) =>
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", BuildJwt(appId, privateKeyPem));

    // ponytail: RS256-JWT von Hand gebaut statt einer JWT-Lib - drei Base64Url-Segmente,
    // dafuer braucht's kein zusaetzliches NuGet-Package.
    private string BuildJwt(string appId, string privateKeyPem)
    {
        var header = Base64UrlEncode(JsonSerializer.SerializeToUtf8Bytes(new { typ = "JWT", alg = "RS256", kid = appId }));
        var now = DateTimeOffset.UtcNow;
        var payload = Base64UrlEncode(JsonSerializer.SerializeToUtf8Bytes(new
        {
            iss = "enablebanking.com",
            aud = "api.enablebanking.com",
            iat = now.ToUnixTimeSeconds(),
            exp = now.AddHours(1).ToUnixTimeSeconds()
        }));

        var unsigned = $"{header}.{payload}";
        using var rsa = RSA.Create();
        rsa.ImportFromPem(privateKeyPem);
        var signature = rsa.SignData(Encoding.UTF8.GetBytes(unsigned), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);

        return $"{unsigned}.{Base64UrlEncode(signature)}";
    }

    private static string Base64UrlEncode(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private sealed record AuthStartResponse([property: JsonPropertyName("url")] string Url);

    private sealed record CreateSessionResponse([property: JsonPropertyName("session_id")] string SessionId);

    private sealed record SessionResponse(
        [property: JsonPropertyName("session_id")] string SessionId,
        [property: JsonPropertyName("accounts")] List<string> Accounts);

    private sealed record TransactionsEnvelope([property: JsonPropertyName("transactions")] List<RawTransaction> Transactions);

    private sealed record RawTransaction(
        [property: JsonPropertyName("transaction_id")] string? TransactionId,
        [property: JsonPropertyName("entry_reference")] string? EntryReference,
        [property: JsonPropertyName("booking_date")] DateOnly BookingDate,
        [property: JsonPropertyName("transaction_amount")] RawAmount TransactionAmount,
        [property: JsonPropertyName("credit_debit_indicator")] string CreditDebitIndicator,
        [property: JsonPropertyName("creditor")] Party? Creditor,
        [property: JsonPropertyName("debtor")] Party? Debtor,
        [property: JsonPropertyName("ultimate_creditor")] Party? UltimateCreditor,
        [property: JsonPropertyName("ultimate_debtor")] Party? UltimateDebtor,
        [property: JsonPropertyName("remittance_information")] List<string>? RemittanceInformation);

    private sealed record RawAmount([property: JsonPropertyName("amount")] string Amount);

    private sealed record AccountDetails([property: JsonPropertyName("account_id")] AccountIdInfo AccountId);

    private sealed record AccountIdInfo([property: JsonPropertyName("iban")] string? Iban);

    private sealed record Party([property: JsonPropertyName("name")] string? Name);
}

public sealed record BankTransaction(string ExternalId, DateOnly BookingDate, decimal Amount, string? CounterpartyName, string Purpose);
