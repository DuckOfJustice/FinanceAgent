# Datenschutzerklärung – FinanceAgent

FinanceAgent ist ein privates Ein-Personen-Tool zur lokalen Kategorisierung
und Auswertung der eigenen Bankumsätze. Es wird nicht öffentlich betrieben
und verarbeitet ausschließlich die Kontodaten des Betreibers selbst.

## Welche Daten werden abgerufen

Über die PSD2-Schnittstelle von Enable Banking werden Kontostammdaten,
Kontostände und Transaktionsdaten (Buchungsdatum, Betrag, Empfänger/Absender,
Verwendungszweck) des vom Nutzer selbst autorisierten Bankkontos abgerufen.

## Zweck der Verarbeitung

Die Daten werden ausschließlich zur automatischen Kategorisierung
(z. B. "Miete", "Lebensmittel") und zur monatlichen Ausgabenübersicht
für den Kontoinhaber selbst verwendet.

## Speicherung und Verarbeitung

- Alle Daten werden ausschließlich lokal auf dem Rechner des Betreibers
  gespeichert (lokale SQLite-Datenbank) und verlassen dieses Gerät nicht.
- Die Kategorisierung erfolgt durch ein lokal betriebenes Sprachmodell
  (Ollama), das ohne Internetverbindung läuft. Vor der Übergabe an das
  Modell werden IBANs und der Name des Kontoinhabers aus den Texten entfernt.
- Es findet keine Weitergabe der Bankdaten an Dritte statt, mit Ausnahme
  des technisch notwendigen Abrufs über die Enable-Banking-API (als
  regulierter PSD2-Kontoinformationsdienst) beim kontoführenden Institut.
- Es gibt kein Tracking, keine Analytics, keine Cookies, keine Werbung.

## Löschung

Die lokale Datenbank kann jederzeit durch Löschen der Datei
`backend/data/finance.db` vollständig entfernt werden. Der Zugriff auf das
Bankkonto kann jederzeit über das Online-Banking der Bank oder im
Enable-Banking-Control-Panel widerrufen werden.

## Kontakt

Bei Fragen zu dieser Datenschutzerklärung: amireldanaf@outlook.de
