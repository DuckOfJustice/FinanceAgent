# Backlog

- **Manage categories (create/rename/delete)**
  Categories are currently a hardcoded array in `backend/CategorizationService.cs:10-14`. Add a way to add, rename, and remove categories without editing code (API endpoint + backend/frontend), including what happens to transactions already tagged with a deleted category.

- **Assign Verwendungszweck → category via UI** *(later)*
  Currently done by hand-editing `backend/category-rules.json` (pattern → category map). Replace/extend with a UI flow: pick a transaction, assign it a category, and have that turn into a rule so future matching transactions auto-categorize the same way.

- **Import historical transactions from a CAMT.053 file**
  EnableBanking only gives us 90 days of history. Add a nav bar button that opens a file upload for a CAMT.053 (ISO 20022) XML export, parses its `Ntry` entries into `BankTransaction`s (amount, date, counterparty, purpose), and inserts them — letting us backfill data further back than the API allows. Skip entries whose `ExternalId` (bank transaction reference, e.g. `AcctSvcrRef`/`NtryRef`) already exists in the DB, so re-uploading an overlapping export is a no-op. Needs to tolerate banks that leave `RltdPties`/counterparty fields empty and put everything in `AddtlNtryInf` instead.
