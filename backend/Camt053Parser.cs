using System.Globalization;
using System.Text;
using System.Xml.Linq;

namespace FinanceDuck.Api;

// Bankunabhaengiger CAMT.052/053-Import (ISO 20022). Elementnamen sind laut Schema stabil,
// nur der XML-Namespace variiert je nach Version/Bank - deshalb hier per LocalName gesucht
// statt ueber einen festen XName mit Namespace.
public static class Camt053Parser
{
    public static List<BankTransaction> Parse(Stream xml)
    {
        var doc = XDocument.Load(xml);
        return doc.Descendants()
            .Where(e => e.Name.LocalName == "Ntry")
            .Select(ParseEntry)
            .Where(tx => tx is not null)
            .Select(tx => tx!)
            .ToList();
    }

    private static BankTransaction? ParseEntry(XElement ntry)
    {
        var amountText = Child(ntry, "Amt")?.Value;
        if (amountText is null || !decimal.TryParse(amountText, NumberStyles.Number, CultureInfo.InvariantCulture, out var amount))
            return null;

        var isDebit = Child(ntry, "CdtDbtInd")?.Value == "DBIT";
        if (isDebit) amount = -amount;

        var bookingDateText = Descendant(Child(ntry, "BookgDt"), "Dt")?.Value ?? Descendant(Child(ntry, "BookgDt"), "DtTm")?.Value;
        if (bookingDateText is null || !DateOnly.TryParse(bookingDateText.AsSpan(0, 10), CultureInfo.InvariantCulture, out var bookingDate))
            return null;

        // Gegenpartei- und Referenzdetails stecken (falls vorhanden) in NtryDtls/TxDtls, nicht
        // direkt in Ntry - manche Banken liefern sie gar nicht mit (z.B. Kartenzahlungen).
        var txDtls = Descendant(ntry, "TxDtls");

        // Leere Elemente (<AcctSvcrRef/>) liefern "" statt null und wuerden die Kette sonst
        // faelschlich stoppen - und "NOTPROVIDED" ist der ISO-20022-Platzhalter fuer "vom
        // Absender nicht gesetzt", kein echter Wert. Beides wuerde sonst unzusammenhaengende
        // Buchungen auf dieselbe ExternalId kollabieren lassen.
        var externalId = MeaningfulReference(Descendant(txDtls, "AcctSvcrRef")?.Value)
            ?? MeaningfulReference(Descendant(txDtls, "EndToEndId")?.Value)
            ?? MeaningfulReference(Child(ntry, "AcctSvcrRef")?.Value)
            ?? MeaningfulReference(Child(ntry, "NtryRef")?.Value);

        var relatedParties = Descendant(txDtls, "RltdPties");
        // Bei einer Belastung (DBIT) ist die Gegenpartei der Kreditor (Empfaenger), bei einer
        // Gutschrift der Debitor (Absender) - der jeweils andere Part ist der Kontoinhaber selbst.
        var counterpartyName = isDebit
            ? Descendant(Child(relatedParties, "Cdtr"), "Nm")?.Value
            : Descendant(Child(relatedParties, "Dbtr"), "Nm")?.Value;

        var purpose = string.Join(" ", Descendant(txDtls, "RmtInf")?.Elements().Where(e => e.Name.LocalName == "Ustrd").Select(e => e.Value) ?? []).Trim();
        if (string.IsNullOrEmpty(purpose))
            purpose = Child(ntry, "AddtlNtryInf")?.Value ?? "";

        // Manche Banken liefern gar keine Referenz - dann deterministisch aus den Buchungsdaten
        // ableiten, damit ein erneuter Import derselben Datei trotzdem als Duplikat erkannt wird.
        externalId ??= $"camt:{bookingDate:O}:{amount}:{purpose}";

        return new BankTransaction(externalId, bookingDate, amount, counterpartyName, purpose);
    }

    private static string? MeaningfulReference(string? value) =>
        string.IsNullOrWhiteSpace(value) || value.Equals("NOTPROVIDED", StringComparison.OrdinalIgnoreCase) ? null : value;

    private static XElement? Child(XElement? parent, string localName) =>
        parent?.Elements().FirstOrDefault(e => e.Name.LocalName == localName);

    private static XElement? Descendant(XElement? parent, string localName) =>
        parent?.Descendants().FirstOrDefault(e => e.Name.LocalName == localName);
}

// ponytail: kein Testprojekt im Repo fuer dieses Ein-Personen-Tool - Assert-Selbsttest statt
// xUnit-Setup. Aufruf: `dotnet run -- --selftest-camt053`.
public static class Camt053ParserSelfTest
{
    private const string SampleXml = """
        <?xml version="1.0" encoding="ISO-8859-1" ?>
        <Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.052.001.08">
          <BkToCstmrAcctRpt>
            <Rpt>
              <Ntry>
                <Amt Ccy="EUR">39.99</Amt>
                <CdtDbtInd>DBIT</CdtDbtInd>
                <BookgDt><Dt>2026-08-20</Dt></BookgDt>
                <NtryDtls>
                  <TxDtls>
                    <Refs><AcctSvcrRef>REF-001</AcctSvcrRef></Refs>
                    <RltdPties><Cdtr><Nm>Netflix</Nm></Cdtr></RltdPties>
                    <RmtInf><Ustrd>Netflix Abo August</Ustrd></RmtInf>
                  </TxDtls>
                </NtryDtls>
              </Ntry>
              <Ntry>
                <Amt Ccy="EUR">2500.00</Amt>
                <CdtDbtInd>CRDT</CdtDbtInd>
                <BookgDt><Dt>2026-08-01</Dt></BookgDt>
                <NtryDtls>
                  <TxDtls>
                    <Refs><AcctSvcrRef>REF-002</AcctSvcrRef></Refs>
                    <RltdPties><Dbtr><Nm>Arbeitgeber GmbH</Nm></Dbtr></RltdPties>
                    <RmtInf><Ustrd>Gehalt</Ustrd></RmtInf>
                  </TxDtls>
                </NtryDtls>
              </Ntry>
              <Ntry>
                <Amt Ccy="EUR">4.50</Amt>
                <CdtDbtInd>DBIT</CdtDbtInd>
                <BookgDt><Dt>2026-08-15</Dt></BookgDt>
                <AddtlNtryInf>Kartenzahlung Baeckerei</AddtlNtryInf>
              </Ntry>
              <Ntry>
                <Amt Ccy="EUR">10.00</Amt>
                <CdtDbtInd>DBIT</CdtDbtInd>
                <BookgDt><Dt>2026-08-05</Dt></BookgDt>
                <NtryDtls>
                  <TxDtls>
                    <Refs><AcctSvcrRef></AcctSvcrRef><EndToEndId>NOTPROVIDED</EndToEndId></Refs>
                    <RltdPties><Cdtr><Nm>Haendler A</Nm></Cdtr></RltdPties>
                    <RmtInf><Ustrd>Kauf A</Ustrd></RmtInf>
                  </TxDtls>
                </NtryDtls>
              </Ntry>
              <Ntry>
                <Amt Ccy="EUR">77.00</Amt>
                <CdtDbtInd>DBIT</CdtDbtInd>
                <BookgDt><Dt>2026-08-06</Dt></BookgDt>
                <NtryDtls>
                  <TxDtls>
                    <Refs><AcctSvcrRef></AcctSvcrRef><EndToEndId>NOTPROVIDED</EndToEndId></Refs>
                    <RltdPties><Cdtr><Nm>Haendler B</Nm></Cdtr></RltdPties>
                    <RmtInf><Ustrd>Kauf B</Ustrd></RmtInf>
                  </TxDtls>
                </NtryDtls>
              </Ntry>
            </Rpt>
          </BkToCstmrAcctRpt>
        </Document>
        """;

    public static void Run()
    {
        using var stream = new MemoryStream(Encoding.UTF8.GetBytes(SampleXml));
        var result = Camt053Parser.Parse(stream);

        Assert(result.Count == 5, $"erwartet 5 Eintraege, war {result.Count}");

        var netflix = result[0];
        Assert(netflix.ExternalId == "REF-001", $"ExternalId war {netflix.ExternalId}");
        Assert(netflix.Amount == -39.99m, $"Amount war {netflix.Amount}");
        Assert(netflix.BookingDate == new DateOnly(2026, 8, 20), $"BookingDate war {netflix.BookingDate}");
        Assert(netflix.CounterpartyName == "Netflix", $"CounterpartyName war {netflix.CounterpartyName}");
        Assert(netflix.Purpose == "Netflix Abo August", $"Purpose war {netflix.Purpose}");

        var gehalt = result[1];
        Assert(gehalt.Amount == 2500.00m, $"Amount war {gehalt.Amount}");
        Assert(gehalt.CounterpartyName == "Arbeitgeber GmbH", $"CounterpartyName war {gehalt.CounterpartyName}");

        // Kein TxDtls/RltdPties (typisch fuer Kartenzahlungen) -> Purpose faellt auf AddtlNtryInf zurueck,
        // ExternalId wird deterministisch aus den Buchungsdaten abgeleitet.
        var card = result[2];
        Assert(card.CounterpartyName is null, "CounterpartyName sollte null sein");
        Assert(card.Purpose == "Kartenzahlung Baeckerei", $"Purpose war {card.Purpose}");
        Assert(card.ExternalId == $"camt:{card.BookingDate:O}:{card.Amount}:{card.Purpose}", $"ExternalId war {card.ExternalId}");

        // Leeres <AcctSvcrRef/> und der ISO-20022-Platzhalter "NOTPROVIDED" fuer EndToEndId sind
        // beide kein echter Wert - zwei verschiedene Buchungen mit beidem duerfen NICHT auf
        // dieselbe ExternalId kollabieren (sonst wuerde die zweite als Duplikat der ersten gelten).
        var haendlerA = result[3];
        var haendlerB = result[4];
        Assert(haendlerA.ExternalId != haendlerB.ExternalId, $"ExternalIds kollidieren: {haendlerA.ExternalId}");
        Assert(haendlerA.ExternalId != "NOTPROVIDED" && haendlerB.ExternalId != "NOTPROVIDED", "ExternalId darf nicht der ISO-Platzhalter sein");
        Assert(haendlerA.ExternalId != "", "ExternalId darf nicht leer sein");

        Console.WriteLine("Camt053Parser self-test: OK");
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition) throw new Exception($"Camt053Parser self-test FAILED: {message}");
    }
}
