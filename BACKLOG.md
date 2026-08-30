# Backlog

- **Manage categories (create/rename/delete)**
  Categories are currently a hardcoded array in `backend/CategorizationService.cs:10-14`. Add a way to add, rename, and remove categories without editing code (API endpoint + backend/frontend), including what happens to transactions already tagged with a deleted category.

- **Assign Verwendungszweck → category via UI** *(later)*
  Currently done by hand-editing `backend/category-rules.json` (pattern → category map). Replace/extend with a UI flow: pick a transaction, assign it a category, and have that turn into a rule so future matching transactions auto-categorize the same way.
