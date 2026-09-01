# Multi-user auth & per-user EnableBanking config

Date: 2026-09-01
Status: approved design, not yet implemented

## Goal

Today FinanceAgent runs as one instance per friend, each with its own SQLite
db and its own `.env` (EnableBanking bank-connection credentials). We want to
consolidate all friends onto a single Raspberry Pi instance. That requires:

1. Login, so the app knows which friend is making a request.
2. Per-user data isolation (transactions/categories/rules).
3. Per-user EnableBanking config (every one of `AppId`, `PrivateKey`,
   `AspspName`, `AspspCountry`, `SessionId`, `AccountIban` varies per user —
   confirmed, no shared EnableBanking app registration).
4. A way for an admin to attach a user's EnableBanking config to their
   account, since that config is exchanged with the admin out-of-band (chat),
   not entered by the user in the app.
5. A one-time migration of each friend's existing db into the shared instance,
   so nobody has to recreate their categories/rules.

## Non-goals

- No email verification, password reset flow, or account lockout policy —
  small trusted friend group, admin can reset a password by hand in the db if
  needed.
- No role system beyond `IsAdmin` (bool).
- No change to the CAMT.053 parsing, categorization matching logic, or
  dashboard/summary logic — only how those things get scoped to a user.

## Data model

New tables (added to `FinanceDbContext`, `backend/FinanceDbContext.cs`):

```csharp
public sealed class User
{
    public int Id { get; set; }
    public required string Username { get; set; }
    public required string PasswordHash { get; set; }
    public bool IsAdmin { get; set; }
    public DateTime CreatedAt { get; set; }
}

public sealed class EnableBankingConfig
{
    public int UserId { get; set; } // PK + FK, 1:1 with User
    public string? AppId { get; set; }
    public string? PrivateKeyPem { get; set; }   // encrypted at rest, see Security
    public string? AspspName { get; set; }
    public string? AspspCountry { get; set; }
    public string? SessionId { get; set; }       // encrypted at rest
    public string? AccountIban { get; set; }
}
```

All fields on `EnableBankingConfig` are nullable: a freshly-registered user
has a row (or no row) with everything empty until the admin fills it in via
the admin panel.

Existing entities gain a `UserId` int FK: `StoredTransaction`, `Category`,
`Rule`. The unique index on `Category.Name` (`FinanceDbContext.cs:19`)
becomes a composite unique index on `(UserId, Name)` — category names only
need to be unique within one user's data, not globally.

Every existing query against `Transactions`/`Categories`/`Rules` in
`Program.cs` and `CategorizationService.cs` gets a `.Where(x => x.UserId ==
currentUserId)` (or the `CategorizeAsync` call gets a `userId` parameter it
threads through to its two queries). This is the majority of the backend
diff — no single query changes shape, they all just gain one filter.

### Schema migration

The project doesn't use EF Core migrations — `Program.cs:36-110` hand-rolls
idempotent `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ADD COLUMN` raw SQL at
startup (see the comment at `Program.cs:41-44` explaining why). Follow the
same pattern: add `CREATE TABLE IF NOT EXISTS "Users"` /
`"EnableBankingConfigs"`, and `ALTER TABLE ... ADD COLUMN "UserId" INTEGER`
(wrapped in the existing try/catch-duplicate-column pattern already used for
`Category.Color` at `Program.cs:73-80`) for the three existing tables.

Default-category seeding (`Program.cs:83-92`, currently "if the whole
Categories table is empty, seed once") becomes "when a new user registers,
seed these same default categories for that `UserId`."

## Backend changes

### `EnableBankingClient.cs`

Currently takes `IConfiguration cfg` in its constructor and reads
`AppId`/`PrivateKeyPath` straight out of it inside `BuildJwt()`
(`EnableBankingClient.cs:131-132`), and every public method already takes the
other values (`aspspName`, `aspspCountry`, `sessionId`, `targetIban`) as
parameters. Drop the `IConfiguration` dependency entirely and add `appId` +
`privateKeyPem` (string, not a file path — matches "everything per-user,
private key stored not as a path") as parameters to `BuildJwt()` and
`AuthenticateRequest()`, sourced from the caller's `EnableBankingConfig` row
instead of global config.

### `Program.cs` endpoints

Every endpoint that touches `Transactions`/`Categories`/`Rules`, or that
currently reads `app.Configuration["EnableBanking:*"]`
(`/api/institutions`, `/api/consent-link`, `/api/consent-callback`,
`/api/refresh`), needs `[Authorize]` (or the minimal-API equivalent
`.RequireAuthorization()`) and the current user's id/config resolved from
`HttpContext.User` claims instead of from `IConfiguration`.

`/api/consent-callback` (`Program.cs:128-132`) currently returns instructions
to paste the SessionId into `.env`; it changes to write `SessionId` directly
into the calling user's `EnableBankingConfig` row.

`/api/import/camt053` currently has `.DisableAntiforgery()` with a comment
explaining that's safe because there's no cookie auth (`Program.cs:196`).
Once cookie auth exists, that comment is no longer true. Rather than
reintroducing full antiforgery tokens, set the auth cookie's
`SameSite=Strict` (built-in cookie option, no new dependency) — the frontend
and backend are served same-origin through the nginx proxy per
`docker-compose.yml`, so `SameSite` alone blocks cross-site POSTs and the
antiforgery-disable comment can be updated to explain that instead.

### Auth endpoints (new, same minimal-API style — no controllers)

- `POST /api/auth/register { username, password }` → creates `User` (first
  user ever = admin), seeds default categories for them, signs them in.
- `POST /api/auth/login { username, password }` → validates via
  `PasswordHasher<User>` (built into `Microsoft.AspNetCore.Identity`, no new
  package), issues the auth cookie.
- `POST /api/auth/logout`.
- `GET /api/auth/me` → `{ username, isAdmin }` or 401, used by the frontend
  to decide login-screen vs. dashboard on load.

### Admin endpoints (new, `.RequireAuthorization("Admin")`)

- `GET /api/admin/users` → list of users (id, username, whether their
  EnableBankingConfig is filled in yet).
- `PUT /api/admin/users/{id}/enablebanking-config` → upsert the six fields.

### Security

- Passwords: `PasswordHasher<User>` (PBKDF2, framework-provided).
- `PrivateKeyPem` and `SessionId` encrypted at rest with ASP.NET Core's Data
  Protection API (`IDataProtector`, framework-provided) — these are live bank
  API credentials, worth the few lines it costs.
- Auth cookie: `HttpOnly`, `Secure`, `SameSite=Strict`.

## Frontend changes

No router exists today and none is needed — `App.tsx` calls `GET
/api/auth/me` on mount and renders either a new `LoginForm`/`RegisterForm`
component or the existing dashboard. All existing `fetch` calls need
`credentials: 'include'` added (currently same-origin already, per
`docker-compose.yml`'s nginx proxy, so no CORS config needed).

A new admin-only panel (rendered only when `/api/auth/me` returns
`isAdmin: true`) lists users and exposes a form for the six EnableBanking
fields per user, calling the new `PUT /api/admin/users/{id}/enablebanking-config`
endpoint.

## Migration of existing friends' data

One-off console command (same pattern as the existing `--selftest-*` args
handled at the top of `Program.cs:6-20`), run once per friend during cutover,
not a UI feature:

1. Create the friend's `User` row (admin sets a temporary password) +
   `EnableBankingConfig` row from their `.env` file.
2. Open their existing standalone `finance.db` as a second SQLite connection
   and bulk-copy `Transactions`/`Categories`/`Rules` into the shared db,
   stamping every row with the new `UserId`.
3. Decommission their old standalone instance.

## Open follow-ups (explicitly out of scope for this pass)

- Password reset / forgot-password flow.
- Per-user rate limiting or usage quotas.
- Anything beyond the binary `IsAdmin` flag (e.g. per-user admin scoping).
