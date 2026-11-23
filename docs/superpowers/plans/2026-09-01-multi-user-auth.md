# Multi-user auth & per-user EnableBanking config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn FinanceAgent from a single-tenant, one-instance-per-friend app into a multi-user app (cookie login, per-user data, per-user EnableBanking bank credentials, admin panel to attach those credentials) that all friends can share on one Raspberry Pi, plus a one-off CLI to migrate each friend's existing standalone db into it.

**Architecture:** Add `User`/`EnableBankingConfig` tables and a `UserId` FK on the three existing tables (`Transactions`, `Categories`, `Rules`). Add ASP.NET Core cookie authentication + a `PasswordHasher<User>`, both built into the `Microsoft.NET.Sdk.Web` shared framework already referenced — no new NuGet packages. Every existing minimal-API endpoint gets `.RequireAuthorization()` and a `UserId` filter sourced from the authenticated user's claims. `EnableBankingClient` stops reading `IConfiguration` and takes `appId`/`privateKeyPem` as call parameters instead, sourced per-request from the caller's `EnableBankingConfig` row. Frontend gets a login/register gate in front of the existing dashboard and a small admin-only panel; no router needed since none exists today.

**Tech Stack:** .NET 8 minimal APIs, EF Core + Sqlite, ASP.NET Core cookie auth (`Microsoft.AspNetCore.Authentication.Cookies`), `Microsoft.AspNetCore.Identity`'s `PasswordHasher<T>`, ASP.NET Core Data Protection API — all part of the already-referenced `Microsoft.NET.Sdk.Web` shared framework. React 18 + TypeScript + Vite on the frontend, no new frontend dependency.

**Spec:** `docs/superpowers/specs/2026-09-01-multi-user-auth-design.md`

## Global Constraints

- No new NuGet or npm packages (spec: "Security" section — password hashing, cookie auth, and encryption-at-rest are all framework-provided).
- No EF Core migrations — this codebase hand-rolls idempotent schema patches with raw SQL in `Program.cs` (existing pattern, see `Program.cs:36-110`); new schema changes follow the same pattern.
- No test project / test framework — this codebase uses assert-based self-tests invoked via `dotnet run -- --selftest-X` (see `CategorizationServiceSelfTest`, `ImportDedupSelfTestAsync` in `Program.cs`/`CategorizationService.cs`). New backend logic that doesn't require a live HTTP server follows the same self-test pattern; new minimal-API endpoints (which would require spinning up `Microsoft.AspNetCore.Mvc.Testing`, a package this repo has deliberately avoided) are verified with documented manual `curl` commands instead.
- Auth cookie: `HttpOnly`, `Secure`, `SameSite=Strict` (spec: "Security").
- `PrivateKeyPem` and `SessionId` on `EnableBankingConfig` are encrypted at rest via the Data Protection API (spec: "Security").
- First user ever to register becomes admin automatically (spec: "Auth endpoints").
- Category name uniqueness becomes per-user, not global (spec: "Data model").

---

### Task 1: `User` + `EnableBankingConfig` entities and schema

**Files:**
- Modify: `backend/FinanceDbContext.cs`
- Modify: `backend/Program.cs:36-111` (bootstrap block)
- Test: self-test in `backend/Program.cs` (new `--selftest-user-schema` arg)

**Interfaces:**
- Produces: `User { int Id; string Username; string PasswordHash; bool IsAdmin; DateTime CreatedAt; }`, `EnableBankingConfig { int UserId; string? AppId; string? PrivateKeyPem; string? AspspName; string? AspspCountry; string? SessionId; string? AccountIban; }`, `FinanceDbContext.Users`, `FinanceDbContext.EnableBankingConfigs`.

- [ ] **Step 1: Add the entities and DbSets**

In `backend/FinanceDbContext.cs`, add two DbSets to the class body (after `public DbSet<Rule> Rules => Set<Rule>();`):

```csharp
    public DbSet<User> Users => Set<User>();
    public DbSet<EnableBankingConfig> EnableBankingConfigs => Set<EnableBankingConfig>();
```

And add the entity classes at the bottom of the file, after `StoredTransaction`:

```csharp
public sealed class User
{
    public int Id { get; set; }
    public required string Username { get; set; }
    public required string PasswordHash { get; set; }
    public bool IsAdmin { get; set; }
    public DateTime CreatedAt { get; set; }
}

// 1:1 mit User - jeder Nutzer hat genau eine eigene EnableBanking-App-Registrierung
// (eigener AppId/PrivateKey, ggf. sogar andere Bank). PrivateKeyPem/SessionId werden
// verschluesselt gespeichert (siehe SecretProtector in Auth.cs).
public sealed class EnableBankingConfig
{
    public int UserId { get; set; }
    public string? AppId { get; set; }
    public string? PrivateKeyPem { get; set; }
    public string? AspspName { get; set; }
    public string? AspspCountry { get; set; }
    public string? SessionId { get; set; }
    public string? AccountIban { get; set; }
}
```

- [ ] **Step 2: Configure the 1:1 key in `OnModelCreating`**

In `backend/FinanceDbContext.cs`, add to `OnModelCreating` (after the existing two `HasIndex` calls):

```csharp
        modelBuilder.Entity<User>().HasIndex(u => u.Username).IsUnique();
        modelBuilder.Entity<EnableBankingConfig>().HasKey(c => c.UserId);
```

- [ ] **Step 3: Patch the schema-bootstrap block for new dbs**

In `backend/Program.cs`, inside the `using (var scope = ...)` block, after the `Color` column `ALTER TABLE` try/catch (currently ending at line 80) and before the default-category seed block, add:

```csharp
    db.Database.ExecuteSqlRaw("""
        CREATE TABLE IF NOT EXISTS "Users" (
            "Id" INTEGER NOT NULL CONSTRAINT "PK_Users" PRIMARY KEY AUTOINCREMENT,
            "Username" TEXT NOT NULL,
            "PasswordHash" TEXT NOT NULL,
            "IsAdmin" INTEGER NOT NULL,
            "CreatedAt" TEXT NOT NULL
        )
        """);
    db.Database.ExecuteSqlRaw("""CREATE UNIQUE INDEX IF NOT EXISTS "IX_Users_Username" ON "Users" ("Username")""");
    db.Database.ExecuteSqlRaw("""
        CREATE TABLE IF NOT EXISTS "EnableBankingConfigs" (
            "UserId" INTEGER NOT NULL CONSTRAINT "PK_EnableBankingConfigs" PRIMARY KEY,
            "AppId" TEXT,
            "PrivateKeyPem" TEXT,
            "AspspName" TEXT,
            "AspspCountry" TEXT,
            "SessionId" TEXT,
            "AccountIban" TEXT
        )
        """);
```

- [ ] **Step 4: Remove the now-obsolete global seed blocks**

Still in `backend/Program.cs`, delete the two blocks that follow (the default-category seed, lines ~82-92, and the `category-rules.json` legacy migration, lines ~94-110). Both assumed one global tenant; category seeding moves to per-user registration in Task 5, and the `category-rules.json` migration was already a one-time historical step that's obsolete now that `Rule` requires a `UserId` it has no way to supply. Also remove the now-unused `category-rules.json` volume mount line from `docker-compose.yml` (`./backend/category-rules.json:/app/category-rules.json:ro`).

- [ ] **Step 5: Write the self-test**

Add near the other `--selftest-*` self-tests at the top of `backend/Program.cs`:

```csharp
if (args is ["--selftest-user-schema"])
{
    UserSchemaSelfTest.Run();
    return;
}
```

Create `backend/UserSchemaSelfTest.cs`:

```csharp
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace FinanceDuck.Api;

public static class UserSchemaSelfTest
{
    public static void Run()
    {
        using var connection = new SqliteConnection("Data Source=:memory:");
        connection.Open();
        var options = new DbContextOptionsBuilder<FinanceDbContext>().UseSqlite(connection).Options;
        using var db = new FinanceDbContext(options);
        db.Database.EnsureCreated();

        var user = new User { Username = "amir", PasswordHash = "hash", IsAdmin = true, CreatedAt = DateTime.UtcNow };
        db.Users.Add(user);
        db.SaveChanges();

        db.EnableBankingConfigs.Add(new EnableBankingConfig { UserId = user.Id, AccountIban = "DE00" });
        db.SaveChanges();

        var reloaded = db.EnableBankingConfigs.Single(c => c.UserId == user.Id);
        Assert(reloaded.AccountIban == "DE00", $"war {reloaded.AccountIban}");

        var duplicateUsernameThrew = false;
        try
        {
            db.Users.Add(new User { Username = "amir", PasswordHash = "x", CreatedAt = DateTime.UtcNow });
            db.SaveChanges();
        }
        catch (DbUpdateException) { duplicateUsernameThrew = true; }
        Assert(duplicateUsernameThrew, "doppelter Username haette einen Fehler werfen muessen");

        Console.WriteLine("User schema self-test: OK");
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition) throw new Exception($"User schema self-test FAILED: {message}");
    }
}
```

- [ ] **Step 6: Run it**

Run: `dotnet run --project backend -- --selftest-user-schema`
Expected: prints `User schema self-test: OK` and exits 0.

- [ ] **Step 7: Commit**

```bash
git add backend/FinanceDbContext.cs backend/Program.cs backend/UserSchemaSelfTest.cs docker-compose.yml
git commit -m "Add User/EnableBankingConfig tables"
```

---

### Task 2: `UserId` on Transactions/Categories/Rules + per-user category uniqueness

**Files:**
- Modify: `backend/FinanceDbContext.cs`
- Modify: `backend/Program.cs` (schema-bootstrap block)
- Test: extend `backend/UserSchemaSelfTest.cs`

**Interfaces:**
- Consumes: `User`, `EnableBankingConfig` (Task 1).
- Produces: `StoredTransaction.UserId`, `Category.UserId`, `Rule.UserId` (all `int`, required on the fresh-schema path).

- [ ] **Step 1: Add `UserId` to the three entities**

In `backend/FinanceDbContext.cs`, add `public int UserId { get; set; }` to `Category`, `Rule`, and `StoredTransaction`.

- [ ] **Step 2: Replace the global unique index with a per-user composite one**

Replace `modelBuilder.Entity<Category>().HasIndex(c => c.Name).IsUnique();` with:

```csharp
        modelBuilder.Entity<Category>().HasIndex(c => new { c.UserId, c.Name }).IsUnique();
```

- [ ] **Step 3: Patch existing dbs**

In `backend/Program.cs`'s schema-bootstrap block, after the `EnableBankingConfigs` table creation from Task 1, add (columns are nullable at the SQLite level — mirrors the existing `Color` column precedent — since any pre-existing rows here only ever come from a fresh multi-tenant db or get backfilled by the Task 3 migration tool, never read live with a null `UserId`):

```csharp
    foreach (var (table, column) in new[] { ("Transactions", "UserId"), ("Categories", "UserId"), ("Rules", "UserId") })
    {
        try
        {
            db.Database.ExecuteSqlRaw($"""ALTER TABLE "{table}" ADD COLUMN "{column}" INTEGER""");
        }
        catch (SqliteException ex) when (ex.Message.Contains("duplicate column name"))
        {
            // Spalte existiert schon.
        }
    }
    db.Database.ExecuteSqlRaw("""DROP INDEX IF EXISTS "IX_Categories_Name" """);
    db.Database.ExecuteSqlRaw("""CREATE UNIQUE INDEX IF NOT EXISTS "IX_Categories_UserId_Name" ON "Categories" ("UserId", "Name")""");
```

- [ ] **Step 4: Extend the self-test for per-user category uniqueness**

Add to `UserSchemaSelfTest.Run()`, after the existing assertions:

```csharp
        var userB = new User { Username = "friend", PasswordHash = "hash", CreatedAt = DateTime.UtcNow };
        db.Users.Add(userB);
        db.SaveChanges();

        db.Categories.Add(new Category { Name = "Miete", UserId = user.Id });
        db.Categories.Add(new Category { Name = "Miete", UserId = userB.Id });
        db.SaveChanges(); // same name, different users - must succeed

        var duplicateCategoryThrew = false;
        try
        {
            db.Categories.Add(new Category { Name = "Miete", UserId = user.Id });
            db.SaveChanges();
        }
        catch (DbUpdateException) { duplicateCategoryThrew = true; }
        Assert(duplicateCategoryThrew, "doppelte Kategorie fuer denselben User haette einen Fehler werfen muessen");
```

- [ ] **Step 5: Run it**

Run: `dotnet run --project backend -- --selftest-user-schema`
Expected: `User schema self-test: OK`.

- [ ] **Step 6: Commit**

```bash
git add backend/FinanceDbContext.cs backend/Program.cs backend/UserSchemaSelfTest.cs
git commit -m "Add per-user UserId scoping to Transactions/Categories/Rules"
```

---

### Task 3: Auth infrastructure (password hashing, cookie auth, claims, secret encryption)

**Files:**
- Create: `backend/Auth.cs`
- Modify: `backend/Program.cs` (service registration + middleware pipeline)
- Test: self-test in new `--selftest-auth` arg

**Interfaces:**
- Consumes: `User` (Task 1).
- Produces: `AuthExtensions.AddFinanceAuth(this IServiceCollection)`, `AuthExtensions.UseFinanceAuth(this WebApplication)`, `ClaimsPrincipalExtensions.GetUserId(this ClaimsPrincipal)`, `ClaimsPrincipalExtensions.IsAdmin(this ClaimsPrincipal)`, `SecretProtector` with `string Protect(string)` / `string Unprotect(string)`.

- [ ] **Step 1: Write `backend/Auth.cs`**

```csharp
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;

namespace FinanceDuck.Api;

public static class AuthExtensions
{
    public static IServiceCollection AddFinanceAuth(this IServiceCollection services)
    {
        services.AddSingleton<IPasswordHasher<User>, PasswordHasher<User>>();
        services.AddSingleton<SecretProtector>();
        services.AddDataProtection().PersistKeysToFileSystem(new DirectoryInfo("data/keys"));

        services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
            .AddCookie(options =>
            {
                options.Cookie.HttpOnly = true;
                options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
                options.Cookie.SameSite = SameSiteMode.Strict;
                options.ExpireTimeSpan = TimeSpan.FromDays(30);
                options.SlidingExpiration = true;
                // Minimal API statt MVC-Login-Seite - bei fehlender/abgelaufener Session
                // soll der Endpoint 401/403 liefern, kein Redirect auf eine HTML-Login-Seite.
                options.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = 401; return Task.CompletedTask; };
                options.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = 403; return Task.CompletedTask; };
            });

        services.AddAuthorization(options =>
            options.AddPolicy("Admin", p => p.RequireRole("Admin")));

        return services;
    }

    public static WebApplication UseFinanceAuth(this WebApplication app)
    {
        app.UseAuthentication();
        app.UseAuthorization();
        return app;
    }

    public static ClaimsPrincipal BuildPrincipal(User user)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new(ClaimTypes.Name, user.Username),
        };
        if (user.IsAdmin) claims.Add(new Claim(ClaimTypes.Role, "Admin"));
        return new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme));
    }
}

public static class ClaimsPrincipalExtensions
{
    public static int GetUserId(this ClaimsPrincipal user) =>
        int.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier)!);

    public static bool IsAdmin(this ClaimsPrincipal user) => user.IsInRole("Admin");
}

// EnableBankingConfig.PrivateKeyPem/SessionId sind Bank-Zugangsdaten - hier per Data
// Protection API verschluesselt statt im Klartext in der Sqlite-Datei.
public sealed class SecretProtector(IDataProtectionProvider provider)
{
    private readonly IDataProtector protector = provider.CreateProtector("EnableBankingConfig.Secrets");

    public string Protect(string plaintext) => protector.Protect(plaintext);
    public string Unprotect(string ciphertext) => protector.Unprotect(ciphertext);
}
```

- [ ] **Step 2: Wire it into `Program.cs`**

After `builder.Services.AddScoped<CategorizationService>();`, add:

```csharp
builder.Services.AddFinanceAuth();
```

After `var app = builder.Build();` and its `using (var scope = ...)` bootstrap block, before the first `app.Map...` call, add:

```csharp
app.UseFinanceAuth();
```

- [ ] **Step 3: Self-test the pure logic (hashing, claims, encryption roundtrip)**

Add near the other `--selftest-*` args:

```csharp
if (args is ["--selftest-auth"])
{
    AuthSelfTest.Run();
    return;
}
```

Create `backend/AuthSelfTest.cs`:

```csharp
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;

namespace FinanceDuck.Api;

public static class AuthSelfTest
{
    public static void Run()
    {
        var user = new User { Id = 1, Username = "amir", PasswordHash = "", IsAdmin = true, CreatedAt = DateTime.UtcNow };
        var hasher = new PasswordHasher<User>();
        user.PasswordHash = hasher.HashPassword(user, "correct horse battery staple");

        var okResult = hasher.VerifyHashedPassword(user, user.PasswordHash, "correct horse battery staple");
        Assert(okResult == PasswordVerificationResult.Success, $"war {okResult}");

        var badResult = hasher.VerifyHashedPassword(user, user.PasswordHash, "wrong password");
        Assert(badResult == PasswordVerificationResult.Failed, $"war {badResult}");

        var principal = AuthExtensions.BuildPrincipal(user);
        Assert(principal.GetUserId() == 1, $"war {principal.GetUserId()}");
        Assert(principal.IsAdmin(), "admin-flag ging verloren");

        var nonAdmin = AuthExtensions.BuildPrincipal(new User { Id = 2, Username = "friend", PasswordHash = "", CreatedAt = DateTime.UtcNow });
        Assert(!nonAdmin.IsAdmin(), "nicht-admin wurde faelschlich als admin markiert");

        var provider = DataProtectionProvider.Create(new DirectoryInfo(Path.GetTempPath()));
        var protector = new SecretProtector(provider);
        var ciphertext = protector.Protect("-----BEGIN PRIVATE KEY-----abc-----END PRIVATE KEY-----");
        Assert(!ciphertext.Contains("BEGIN PRIVATE KEY"), "geheimnis wurde nicht verschluesselt");
        Assert(protector.Unprotect(ciphertext) == "-----BEGIN PRIVATE KEY-----abc-----END PRIVATE KEY-----", "roundtrip fehlgeschlagen");

        Console.WriteLine("Auth self-test: OK");
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition) throw new Exception($"Auth self-test FAILED: {message}");
    }
}
```

- [ ] **Step 4: Run it**

Run: `dotnet run --project backend -- --selftest-auth`
Expected: `Auth self-test: OK`.

- [ ] **Step 5: Commit**

```bash
git add backend/Auth.cs backend/AuthSelfTest.cs backend/Program.cs
git commit -m "Add cookie auth, password hashing, and secret encryption infrastructure"
```

---

### Task 4: Auth endpoints (register/login/logout/me)

**Files:**
- Create: `backend/AuthEndpoints.cs`
- Modify: `backend/Program.cs` (call `app.MapAuthEndpoints()`)

**Interfaces:**
- Consumes: `AuthExtensions.BuildPrincipal` (Task 3), `IPasswordHasher<User>` (Task 3), default-category names (currently inline at old `Program.cs:85-89`, moves here).
- Produces: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.

- [ ] **Step 1: Write `backend/AuthEndpoints.cs`**

```csharp
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace FinanceDuck.Api;

public static class AuthEndpoints
{
    // Gleiche Standardkategorien wie frueher die einmalige Global-Seed - jetzt pro
    // neu registriertem Nutzer statt einmal fuer die ganze (einzige) Installation.
    private static readonly string[] DefaultCategories =
        ["Lebensmittel & Haushalt", "Miete", "Freizeit & Sport", "Tankstelle", "Versicherung",
         "Gehalt", "Abo", "Gesundheit", "Sonstiges",
         "Fitness Studio", "Audi Leasing", "Online-Shop", "Restaurant & Lieferservice", "Möbel", "Kreditkarte",
         "Telefon & Internet", "Rundfunkbeitrag"];

    public static void MapAuthEndpoints(this WebApplication app)
    {
        app.MapPost("/api/auth/register", async (AuthRequest body, FinanceDbContext db, IPasswordHasher<User> hasher, HttpContext http) =>
        {
            var username = body.Username?.Trim();
            if (string.IsNullOrEmpty(username) || string.IsNullOrEmpty(body.Password))
                return Results.BadRequest("Benutzername und Passwort duerfen nicht leer sein.");
            if (await db.Users.AnyAsync(u => u.Username == username))
                return Results.Conflict("Benutzername existiert bereits.");

            var isFirstUser = !await db.Users.AnyAsync();
            var user = new User { Username = username, PasswordHash = "", IsAdmin = isFirstUser, CreatedAt = DateTime.UtcNow };
            user.PasswordHash = hasher.HashPassword(user, body.Password);
            db.Users.Add(user);
            db.Categories.AddRange(DefaultCategories.Select(name => new Category { Name = name, UserId = 0 }));
            // UserId erst nach dem ersten SaveChanges bekannt (Autoincrement) - Kategorien
            // haengen an derselben ChangeTracker-Instanz, also erst speichern, dann nachtragen.
            await db.SaveChangesAsync();
            foreach (var category in db.Categories.Local.Where(c => c.UserId == 0)) category.UserId = user.Id;
            await db.SaveChangesAsync();

            await http.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, AuthExtensions.BuildPrincipal(user));
            return Results.Ok(new { user.Username, user.IsAdmin });
        });

        app.MapPost("/api/auth/login", async (AuthRequest body, FinanceDbContext db, IPasswordHasher<User> hasher, HttpContext http) =>
        {
            var user = await db.Users.FirstOrDefaultAsync(u => u.Username == body.Username);
            if (user is null) return Results.Unauthorized();

            var result = hasher.VerifyHashedPassword(user, user.PasswordHash, body.Password ?? "");
            if (result == PasswordVerificationResult.Failed) return Results.Unauthorized();

            await http.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, AuthExtensions.BuildPrincipal(user));
            return Results.Ok(new { user.Username, user.IsAdmin });
        });

        app.MapPost("/api/auth/logout", async (HttpContext http) =>
        {
            await http.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.Ok();
        });

        app.MapGet("/api/auth/me", (HttpContext http) =>
        {
            if (http.User.Identity?.IsAuthenticated != true) return Results.Unauthorized();
            return Results.Ok(new { username = http.User.Identity.Name, isAdmin = http.User.IsAdmin() });
        });
    }
}

public record AuthRequest(string? Username, string? Password);
```

- [ ] **Step 2: Call it from `Program.cs`**

After `app.UseFinanceAuth();`, add:

```csharp
app.MapAuthEndpoints();
```

- [ ] **Step 3: Manual verification**

No HTTP test harness exists in this repo (see Global Constraints), so verify with `curl` against the running dev server (`dotnet run --project backend`, listening on `http://localhost:8081` per `docker-compose.yml`):

```bash
curl -i -c cookies.txt -X POST http://localhost:8081/api/auth/register -H "Content-Type: application/json" -d '{"username":"amir","password":"testpass123"}'
# Expected: 200 OK, body {"username":"amir","isAdmin":true} (first user = admin)

curl -i -b cookies.txt http://localhost:8081/api/auth/me
# Expected: 200 OK, {"username":"amir","isAdmin":true}

curl -i -X POST http://localhost:8081/api/auth/register -H "Content-Type: application/json" -d '{"username":"amir","password":"other"}'
# Expected: 409 Conflict

curl -i -c cookies2.txt -X POST http://localhost:8081/api/auth/login -H "Content-Type: application/json" -d '{"username":"amir","password":"wrong"}'
# Expected: 401 Unauthorized

curl -i -X POST http://localhost:8081/api/auth/logout -b cookies.txt
curl -i http://localhost:8081/api/auth/me -b cookies.txt
# Expected: 401 Unauthorized after logout
```

- [ ] **Step 4: Commit**

```bash
git add backend/AuthEndpoints.cs backend/Program.cs
git commit -m "Add register/login/logout/me endpoints"
```

---

### Task 5: Admin endpoints (user list + EnableBankingConfig upsert)

**Files:**
- Modify: `backend/AuthEndpoints.cs` (add `MapAdminEndpoints`)
- Modify: `backend/Program.cs` (call `app.MapAdminEndpoints()`)

**Interfaces:**
- Consumes: `SecretProtector` (Task 3), `"Admin"` authorization policy (Task 3).
- Produces: `GET /api/admin/users`, `PUT /api/admin/users/{id}/enablebanking-config`.

- [ ] **Step 1: Add the admin endpoints to `backend/AuthEndpoints.cs`**

Add a second public static method in the same file:

```csharp
    public static void MapAdminEndpoints(this WebApplication app)
    {
        var admin = app.MapGroup("/api/admin").RequireAuthorization("Admin");

        admin.MapGet("/users", async (FinanceDbContext db) =>
            Results.Ok(await db.Users
                .GroupJoin(db.EnableBankingConfigs, u => u.Id, c => c.UserId, (u, cs) => new { u, cs })
                .Select(x => new
                {
                    x.u.Id,
                    x.u.Username,
                    x.u.IsAdmin,
                    HasBankConfig = x.cs.Any(c => c.AccountIban != null)
                })
                .OrderBy(x => x.Username)
                .ToListAsync()));

        admin.MapPut("/users/{id:int}/enablebanking-config", async (int id, EnableBankingConfigRequest body, FinanceDbContext db, SecretProtector protector) =>
        {
            if (!await db.Users.AnyAsync(u => u.Id == id)) return Results.NotFound();

            var config = await db.EnableBankingConfigs.FindAsync(id) ?? new EnableBankingConfig { UserId = id };
            config.AppId = body.AppId;
            config.PrivateKeyPem = string.IsNullOrEmpty(body.PrivateKeyPem) ? config.PrivateKeyPem : protector.Protect(body.PrivateKeyPem);
            config.AspspName = body.AspspName;
            config.AspspCountry = body.AspspCountry;
            config.AccountIban = body.AccountIban;
            if (db.Entry(config).State == EntityState.Detached) db.EnableBankingConfigs.Add(config);

            await db.SaveChangesAsync();
            return Results.Ok();
        });
    }
```

Add the request DTO next to `AuthRequest`:

```csharp
public record EnableBankingConfigRequest(string? AppId, string? PrivateKeyPem, string? AspspName, string? AspspCountry, string? AccountIban);
```

`SessionId` is deliberately excluded from this DTO — it's set by the `/api/consent-callback` flow (Task 8), not typed in by the admin.

- [ ] **Step 2: Call it from `Program.cs`**

After `app.MapAuthEndpoints();`, add:

```csharp
app.MapAdminEndpoints();
```

- [ ] **Step 3: Manual verification**

```bash
# Using the "amir" admin session cookie from Task 4's cookies.txt:
curl -i -b cookies.txt http://localhost:8081/api/admin/users
# Expected: 200 OK, [{"id":1,"username":"amir","isAdmin":true,"hasBankConfig":false}]

curl -i -b cookies.txt -X PUT http://localhost:8081/api/admin/users/1/enablebanking-config \
  -H "Content-Type: application/json" \
  -d '{"appId":"test-app","privateKeyPem":"-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----","aspspName":"Test Bank","aspspCountry":"DE","accountIban":"DE00TEST"}'
# Expected: 200 OK

curl -i -b cookies2.txt http://localhost:8081/api/admin/users
# Expected: 403 Forbidden (a non-admin session, once one exists - register a second user without wiping cookies.txt first to get one)
```

- [ ] **Step 4: Commit**

```bash
git add backend/AuthEndpoints.cs backend/Program.cs
git commit -m "Add admin endpoints for user list and EnableBankingConfig"
```

---

### Task 6: Scope existing data endpoints to the logged-in user

**Files:**
- Modify: `backend/Program.cs` (all `/api/categories*`, `/api/rules*`, `/api/summary`, `/api/transactions*`, `/api/recategorize` endpoints)
- Modify: `backend/CategorizationService.cs`

**Interfaces:**
- Consumes: `ClaimsPrincipalExtensions.GetUserId` (Task 3).
- Produces: `CategorizationService.CategorizeAsync(int userId, string? counterpartyName, string purpose, decimal amount)` (signature change — was 3 params, now 4, `userId` first).

- [ ] **Step 1: Add `userId` to `CategorizationService.CategorizeAsync`**

In `backend/CategorizationService.cs`, change the signature and its two queries:

```csharp
    public async Task<string> CategorizeAsync(int userId, string? counterpartyName, string purpose, decimal amount)
    {
        var rules = await db.Rules.Where(r => r.UserId == userId)
            .Join(db.Categories.Where(c => c.UserId == userId), r => r.CategoryId, c => c.Id, (r, c) => new RuleMatch(r.Pattern, c.Name))
            .ToListAsync();
```

(rest of the method body is unchanged).

Update `CategorizationServiceSelfTest.Run()` — it calls `TryGetConfiguredCategory` directly (not `CategorizeAsync`), so it's unaffected. Update the two call sites in `Program.cs`'s `ImportTransactionsAsync` and `/api/recategorize` (next steps) to pass `userId`.

- [ ] **Step 2: Add `.RequireAuthorization()` and `UserId` filters to every data endpoint**

In `backend/Program.cs`, for each of the following, append `.RequireAuthorization()` to the `MapGet`/`MapPost`/`MapPut`/`MapDelete` chain, add an `HttpContext http` (or `ClaimsPrincipal user`) parameter, and add `var userId = http.User.GetUserId();` as the first line of the handler, then filter every `db.Transactions`/`db.Categories`/`db.Rules` query by `.Where(x => x.UserId == userId)` and stamp `UserId = userId` on every new entity:

- `app.MapPost("/api/refresh", ...)` — also thread `userId` into `ImportTransactionsAsync` (Step 3) and the `EnableBankingConfig` lookup (done in Task 8).
- `app.MapPost("/api/import/camt053", ...)` — same.
- `app.MapPost("/api/recategorize", ...)`:
  ```csharp
  app.MapPost("/api/recategorize", async (HttpContext http, CategorizationService categorizer, FinanceDbContext db) =>
  {
      var userId = http.User.GetUserId();
      var all = await db.Transactions.Where(t => t.UserId == userId).ToListAsync();
      var changed = 0;
      foreach (var tx in all)
      {
          var category = await categorizer.CategorizeAsync(userId, tx.CounterpartyName, tx.Purpose, tx.Amount);
          if (category != tx.Category) { tx.Category = category; changed++; }
      }
      await db.SaveChangesAsync();
      return Results.Ok(new { total = all.Count, changed });
  }).RequireAuthorization();
  ```
- `app.MapGet("/api/categories", ...)`: add `.Where(c => c.UserId == userId)` before `.OrderBy`.
- `app.MapPost("/api/categories", ...)`: `AnyAsync(c => c.Name == name)` becomes `AnyAsync(c => c.Name == name && c.UserId == userId)`; `new Category { Name = name, Color = color }` becomes `new Category { Name = name, Color = color, UserId = userId }`; the "pick unused color" query gets `.Where(c => c.UserId == userId)`.
- `app.MapPut("/api/categories/{id:int}", ...)`: `db.Categories.FindAsync(id)` becomes `db.Categories.FirstOrDefaultAsync(c => c.Id == id && c.UserId == userId)`; the rename-conflict `AnyAsync` and the `db.Transactions.Where(t => t.Category == oldName)` update both add `&& x.UserId == userId`.
- `app.MapDelete("/api/categories/{id:int}", ...)`: same `FindAsync` → `FirstOrDefaultAsync(... && UserId == userId)` swap; the transaction-reassign and rule-delete queries both add `&& x.UserId == userId`.
- `app.MapGet("/api/rules", ...)`: both `db.Rules` and `db.Categories` in the `Join` get `.Where(x => x.UserId == userId)`.
- `app.MapPost("/api/rules", ...)`: `db.Categories.FindAsync(body.CategoryId)` becomes `FirstOrDefaultAsync(c => c.Id == body.CategoryId && c.UserId == userId)`; the existing-pattern lookup and new `Rule` both add/get `UserId = userId`.
- `app.MapDelete("/api/rules/{id:int}", ...)`: `FindAsync(id)` becomes `FirstOrDefaultAsync(r => r.Id == id && r.UserId == userId)`.
- `app.MapGet("/api/summary", ...)`: add `&& t.UserId == userId` to the `Where`.
- `app.MapGet("/api/transactions", ...)`: add `.Where(t => t.UserId == userId)` to the base query.
- `app.MapDelete("/api/transactions", ...)`: add `&& t.UserId == userId` to the `Where`.
- `app.MapPut("/api/transactions/{id:int}/category", ...)`: `AnyAsync(c => c.Name == categoryName)` becomes `AnyAsync(c => c.Name == categoryName && c.UserId == userId)`; `db.Transactions.FindAsync(id)` becomes `FirstOrDefaultAsync(t => t.Id == id && t.UserId == userId)`.

- [ ] **Step 3: Thread `userId` through `ImportTransactionsAsync`**

Change its signature in `backend/Program.cs` from `ImportTransactionsAsync(List<BankTransaction> transactions, CategorizationService categorizer, FinanceDbContext db)` to take `int userId` as the first parameter; inside, both duplicate-lookup queries (`existingById`, `existingByContent`) add `&& t.UserId == userId`; the `categorizer.CategorizeAsync(...)` call becomes `categorizer.CategorizeAsync(userId, tx.CounterpartyName, tx.Purpose, tx.Amount)`; the `new StoredTransaction { ... }` gets `UserId = userId`. Update the two call sites (`/api/refresh`, `/api/import/camt053`) to pass `userId`.

Update `ImportDedupSelfTestAsync` in `Program.cs` — its calls to `ImportTransactionsAsync(...)` need a `userId` argument; use a constant `const int testUserId = 1;` at the top of the self-test and pass it through (no `User` row is needed since this self-test never queries `Categories`/`Rules` through `CategorizeAsync`'s user filter in a way that requires a real FK — Sqlite in this codebase doesn't enforce FK constraints by default, consistent with the existing "no EF Fremdschluessel auf Category" comment on `Rule`).

- [ ] **Step 4: Run the existing self-tests to confirm nothing broke**

Run: `dotnet run --project backend -- --selftest-import-dedup`
Expected: `Import-Dedup self-test: OK`.

Run: `dotnet run --project backend -- --selftest-categorization`
Expected: `CategorizationService self-test: OK` (unaffected — tests `TryGetConfiguredCategory` directly, not `CategorizeAsync`).

- [ ] **Step 5: Manual verification of scoping**

```bash
# amir (userId 1) creates a category:
curl -i -b cookies.txt -X POST http://localhost:8081/api/categories -H "Content-Type: application/json" -d '{"name":"Testkategorie"}'
# Expected: 200 OK

# A second registered user (different cookies.txt) does NOT see it:
curl -s -b cookies2.txt http://localhost:8081/api/categories
# Expected: does not include "Testkategorie" (only that user's own default categories)

# Unauthenticated request is rejected:
curl -i http://localhost:8081/api/categories
# Expected: 401 Unauthorized
```

- [ ] **Step 6: Commit**

```bash
git add backend/Program.cs backend/CategorizationService.cs
git commit -m "Scope categories/rules/transactions endpoints to the logged-in user"
```

---

### Task 7: One-off migration CLI for existing friends' data

**Files:**
- Create: `backend/UserMigration.cs`
- Modify: `backend/Program.cs` (new `--migrate-user` arg + `--selftest-migrate-user`)

**Interfaces:**
- Consumes: `User`, `EnableBankingConfig`, `SecretProtector`, `IPasswordHasher<User>` (Tasks 1, 3).
- Produces: `UserMigration.RunAsync(string oldDbPath, string oldEnvPath, string username, string password, FinanceDbContext targetDb, IPasswordHasher<User> hasher, SecretProtector protector)`.

- [ ] **Step 1: Write `backend/UserMigration.cs`**

```csharp
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace FinanceDuck.Api;

// Migriert die Standalone-Sqlite-Datenbank + .env eines Freundes (bisher: eigene
// Installation pro Person) in die neue gemeinsame Multi-User-Instanz. Einmalig pro
// Freund beim Umzug auf den Pi auszufuehren, danach kann die alte Installation
// stillgelegt werden. Kein EF-DbContext gegen die ALTE Datenbank - deren Schema hat
// noch keine UserId-Spalten, das wuerde EFs generiertes SELECT zum Absturz bringen.
public static class UserMigration
{
    public static async Task RunAsync(string oldDbPath, string oldEnvPath, string username, string password,
        FinanceDbContext targetDb, IPasswordHasher<User> hasher, SecretProtector protector)
    {
        var env = ParseEnvFile(oldEnvPath);

        var user = new User { Username = username, PasswordHash = "", CreatedAt = DateTime.UtcNow };
        user.PasswordHash = hasher.HashPassword(user, password);
        targetDb.Users.Add(user);
        await targetDb.SaveChangesAsync();

        var privateKeyPath = env.GetValueOrDefault("EnableBanking__PrivateKeyPath");
        targetDb.EnableBankingConfigs.Add(new EnableBankingConfig
        {
            UserId = user.Id,
            AppId = env.GetValueOrDefault("EnableBanking__AppId"),
            PrivateKeyPem = string.IsNullOrEmpty(privateKeyPath) ? null : protector.Protect(File.ReadAllText(privateKeyPath)),
            AspspName = env.GetValueOrDefault("EnableBanking__AspspName"),
            AspspCountry = env.GetValueOrDefault("EnableBanking__AspspCountry"),
            SessionId = env.TryGetValue("EnableBanking__SessionId", out var sid) && !string.IsNullOrEmpty(sid) ? protector.Protect(sid) : null,
            AccountIban = env.GetValueOrDefault("EnableBanking__AccountIban"),
        });
        await targetDb.SaveChangesAsync();

        using var oldConnection = new SqliteConnection($"Data Source={oldDbPath};Mode=ReadOnly");
        oldConnection.Open();

        var categoryIdMap = new Dictionary<int, int>();
        using (var cmd = oldConnection.CreateCommand())
        {
            cmd.CommandText = """SELECT "Id", "Name", "Color" FROM "Categories" """;
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                var oldId = reader.GetInt32(0);
                var category = new Category { Name = reader.GetString(1), Color = reader.IsDBNull(2) ? null : reader.GetString(2), UserId = user.Id };
                targetDb.Categories.Add(category);
                await targetDb.SaveChangesAsync();
                categoryIdMap[oldId] = category.Id;
            }
        }

        using (var cmd = oldConnection.CreateCommand())
        {
            cmd.CommandText = """SELECT "Pattern", "CategoryId" FROM "Rules" """;
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                var oldCategoryId = reader.GetInt32(1);
                if (!categoryIdMap.TryGetValue(oldCategoryId, out var newCategoryId)) continue;
                targetDb.Rules.Add(new Rule { Pattern = reader.GetString(0), CategoryId = newCategoryId, UserId = user.Id });
            }
        }
        await targetDb.SaveChangesAsync();

        var transactionCount = 0;
        using (var cmd = oldConnection.CreateCommand())
        {
            cmd.CommandText = """SELECT "ExternalId", "BookingDate", "Amount", "CounterpartyName", "Purpose", "Category" FROM "Transactions" """;
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                targetDb.Transactions.Add(new StoredTransaction
                {
                    ExternalId = reader.GetString(0),
                    BookingDate = DateOnly.Parse(reader.GetString(1)),
                    Amount = reader.GetDecimal(2),
                    CounterpartyName = reader.IsDBNull(3) ? null : reader.GetString(3),
                    Purpose = reader.GetString(4),
                    Category = reader.GetString(5),
                    UserId = user.Id,
                });
                transactionCount++;
            }
        }
        await targetDb.SaveChangesAsync();

        Console.WriteLine($"Migriert: Nutzer '{username}' (Id {user.Id}), {categoryIdMap.Count} Kategorien, {transactionCount} Buchungen.");
    }

    private static Dictionary<string, string> ParseEnvFile(string path)
    {
        var result = new Dictionary<string, string>();
        foreach (var line in File.ReadAllLines(path))
        {
            var trimmed = line.Trim();
            if (trimmed.Length == 0 || trimmed.StartsWith('#')) continue;
            var separatorIndex = trimmed.IndexOf('=');
            if (separatorIndex < 0) continue;
            result[trimmed[..separatorIndex].Trim()] = trimmed[(separatorIndex + 1)..].Trim();
        }
        return result;
    }
}
```

- [ ] **Step 2: Wire the CLI arg into `Program.cs`**

At the top of `backend/Program.cs`, alongside the other `--selftest-*` checks (before `Directory.CreateDirectory("data");`), add:

```csharp
if (args is ["--migrate-user", var oldDbPath, var oldEnvPath, var newUsername, var newPassword])
{
    var migrationServices = new ServiceCollection()
        .AddDbContext<FinanceDbContext>(o => o.UseSqlite("Data Source=data/finance.db"))
        .AddFinanceAuth()
        .BuildServiceProvider();
    using var migrationScope = migrationServices.CreateScope();
    await UserMigration.RunAsync(
        oldDbPath, oldEnvPath, newUsername, newPassword,
        migrationScope.ServiceProvider.GetRequiredService<FinanceDbContext>(),
        migrationScope.ServiceProvider.GetRequiredService<IPasswordHasher<User>>(),
        migrationScope.ServiceProvider.GetRequiredService<SecretProtector>());
    return;
}
```

This needs `using Microsoft.AspNetCore.Identity;` and `using Microsoft.Extensions.DependencyInjection;` added to the top of `Program.cs` if not already implicitly available (`ImplicitUsings` is enabled per the `.csproj`, so `Microsoft.Extensions.DependencyInjection` is already implicit for a Web SDK project; add the Identity `using` explicitly).

- [ ] **Step 3: Self-test with two temp sqlite files**

Add near the other `--selftest-*` args:

```csharp
if (args is ["--selftest-migrate-user"])
{
    await MigrationSelfTestAsync();
    return;
}
```

Add the self-test function (near `ImportDedupSelfTestAsync`):

```csharp
async Task MigrationSelfTestAsync()
{
    var oldDbPath = Path.Combine(Path.GetTempPath(), $"finance-migrate-old-{Guid.NewGuid():N}.db");
    var oldEnvPath = Path.Combine(Path.GetTempPath(), $"finance-migrate-{Guid.NewGuid():N}.env");
    try
    {
        using (var oldConnection = new SqliteConnection($"Data Source={oldDbPath}"))
        {
            oldConnection.Open();
            using var cmd = oldConnection.CreateCommand();
            cmd.CommandText = """
                CREATE TABLE "Categories" ("Id" INTEGER PRIMARY KEY, "Name" TEXT NOT NULL, "Color" TEXT);
                CREATE TABLE "Rules" ("Id" INTEGER PRIMARY KEY, "Pattern" TEXT NOT NULL, "CategoryId" INTEGER NOT NULL);
                CREATE TABLE "Transactions" ("Id" INTEGER PRIMARY KEY, "ExternalId" TEXT NOT NULL, "BookingDate" TEXT NOT NULL,
                    "Amount" TEXT NOT NULL, "CounterpartyName" TEXT, "Purpose" TEXT NOT NULL, "Category" TEXT NOT NULL);
                INSERT INTO "Categories" VALUES (5, 'Miete', NULL);
                INSERT INTO "Rules" VALUES (1, 'Hausverwaltung', 5);
                INSERT INTO "Transactions" VALUES (1, 'ext-1', '2025-01-01', -800.0, 'Hausverwaltung GmbH', 'Miete Januar', 'Miete');
                """;
            cmd.ExecuteNonQuery();
        }
        await File.WriteAllTextAsync(oldEnvPath, "EnableBanking__AspspName=Testbank\nEnableBanking__AccountIban=DE00OLD\n");

        using var connection = new SqliteConnection("Data Source=:memory:");
        connection.Open();
        var options = new DbContextOptionsBuilder<FinanceDbContext>().UseSqlite(connection).Options;
        using var targetDb = new FinanceDbContext(options);
        targetDb.Database.EnsureCreated();

        var hasher = new PasswordHasher<User>();
        var protector = new SecretProtector(DataProtectionProvider.Create(new DirectoryInfo(Path.GetTempPath())));
        await UserMigration.RunAsync(oldDbPath, oldEnvPath, "migrated-friend", "somepassword", targetDb, hasher, protector);

        var migratedUser = targetDb.Users.Single(u => u.Username == "migrated-friend");
        var config = targetDb.EnableBankingConfigs.Single(c => c.UserId == migratedUser.Id);
        SelfTestAssert(config.AccountIban == "DE00OLD", $"war {config.AccountIban}");

        var category = targetDb.Categories.Single(c => c.UserId == migratedUser.Id);
        SelfTestAssert(category.Name == "Miete", $"war {category.Name}");

        var rule = targetDb.Rules.Single(r => r.UserId == migratedUser.Id);
        SelfTestAssert(rule.CategoryId == category.Id, "Rule.CategoryId wurde nicht auf die neue Kategorie-Id remapped");

        var transaction = targetDb.Transactions.Single(t => t.UserId == migratedUser.Id);
        SelfTestAssert(transaction.Category == "Miete", $"war {transaction.Category}");

        Console.WriteLine("User migration self-test: OK");
    }
    finally
    {
        File.Delete(oldDbPath);
        File.Delete(oldEnvPath);
    }
}
```

(reuses the existing top-level `SelfTestAssert` helper already defined in `Program.cs`.)

- [ ] **Step 4: Run it**

Run: `dotnet run --project backend -- --selftest-migrate-user`
Expected: `User migration self-test: OK`.

- [ ] **Step 5: Commit**

```bash
git add backend/UserMigration.cs backend/Program.cs
git commit -m "Add one-off CLI to migrate a friend's standalone db into the shared instance"
```

---

### Task 8: Per-user EnableBanking credentials (`EnableBankingClient` refactor + consent/refresh endpoints)

**Files:**
- Modify: `backend/EnableBankingClient.cs`
- Modify: `backend/Program.cs` (`/api/institutions`, `/api/consent-link`, `/api/consent-callback`, `/api/refresh`)
- Modify: `.env.example`

**Interfaces:**
- Produces: `EnableBankingClient.StartAuthorizationAsync(string appId, string privateKeyPem, string aspspName, string aspspCountry)`, `.CreateSessionAsync(string appId, string privateKeyPem, string code)`, `.ListInstitutionsAsync(string appId, string privateKeyPem, string country)`, `.GetTransactionsAsync(string appId, string privateKeyPem, string sessionId, string targetIban, DateOnly from, DateOnly to)` — all four gain `appId`/`privateKeyPem` as their first two parameters; the constructor drops `IConfiguration cfg`.

- [ ] **Step 1: Refactor `EnableBankingClient.cs`**

Change the class declaration from `public sealed class EnableBankingClient(HttpClient http, IConfiguration cfg)` to `public sealed class EnableBankingClient(HttpClient http)`.

Change `BuildJwt()` and `AuthenticateRequest()`:

```csharp
    private void AuthenticateRequest(string appId, string privateKeyPem) =>
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", BuildJwt(appId, privateKeyPem));

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
```

Add `appId, privateKeyPem` as the first two parameters of `StartAuthorizationAsync`, `CreateSessionAsync`, `ListInstitutionsAsync`, and `GetTransactionsAsync`, and pass them into every `AuthenticateRequest(...)` call inside those methods (currently bare `AuthenticateRequest();` at lines 15, 32, 45, 53, 59, 94 — each becomes `AuthenticateRequest(appId, privateKeyPem);`).

- [ ] **Step 2: Update the four endpoints in `Program.cs`**

```csharp
app.MapGet("/api/institutions", async (HttpContext http, EnableBankingClient bank, FinanceDbContext db) =>
{
    var config = await RequireConfigAsync(http, db);
    return Results.Ok(await bank.ListInstitutionsAsync(config.AppId!, config.PrivateKeyPem!, config.AspspCountry ?? "DE"));
}).RequireAuthorization();

app.MapPost("/api/consent-link", async (HttpContext http, EnableBankingClient bank, FinanceDbContext db) =>
{
    var config = await RequireConfigAsync(http, db);
    if (string.IsNullOrEmpty(config.AspspName))
        throw new InvalidOperationException("AspspName fehlt - siehe GET /api/institutions.");
    var url = await bank.StartAuthorizationAsync(config.AppId!, config.PrivateKeyPem!, config.AspspName, config.AspspCountry ?? "DE");
    return Results.Ok(new { url });
}).RequireAuthorization();

app.MapGet("/api/consent-callback", async (string code, HttpContext http, EnableBankingClient bank, FinanceDbContext db, SecretProtector protector) =>
{
    var config = await RequireConfigAsync(http, db);
    var sessionId = await bank.CreateSessionAsync(config.AppId!, config.PrivateKeyPem!, code);
    config.SessionId = protector.Protect(sessionId);
    await db.SaveChangesAsync();
    return Results.Text("Session erstellt und gespeichert.");
}).RequireAuthorization();

app.MapPost("/api/refresh", async (HttpContext http, EnableBankingClient bank, CategorizationService categorizer, FinanceDbContext db, SecretProtector protector, DateOnly? from, DateOnly? to) =>
{
    var userId = http.User.GetUserId();
    var config = await RequireConfigAsync(http, db);
    if (string.IsNullOrEmpty(config.SessionId))
        return Results.BadRequest("Kein EnableBanking-Session vorhanden - erst /api/consent-link durchlaufen.");
    if (string.IsNullOrEmpty(config.AccountIban))
        return Results.BadRequest("AccountIban fehlt in der Konfiguration.");

    var rangeFrom = from ?? new DateOnly(DateTime.Today.Year, DateTime.Today.Month, 1);
    var rangeTo = to ?? DateOnly.FromDateTime(DateTime.Today);

    List<BankTransaction> transactions;
    try
    {
        transactions = await bank.GetTransactionsAsync(config.AppId!, config.PrivateKeyPem!, protector.Unprotect(config.SessionId), config.AccountIban, rangeFrom, rangeTo);
    }
    catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
    {
        return Results.Json(new { error = $"Zugriff blockiert: {ex.Message}" }, statusCode: 429);
    }

    var (imported, _) = await ImportTransactionsAsync(userId, transactions, categorizer, db);
    return Results.Ok(new { imported });
}).RequireAuthorization();

async Task<EnableBankingConfig> RequireConfigAsync(HttpContext http, FinanceDbContext db)
{
    var userId = http.User.GetUserId();
    var config = await db.EnableBankingConfigs.FindAsync(userId);
    if (config is null || string.IsNullOrEmpty(config.AppId) || string.IsNullOrEmpty(config.PrivateKeyPem))
        throw new InvalidOperationException("Kein EnableBanking-Config fuer diesen Nutzer hinterlegt - Admin muss ihn erst im Admin-Panel eintragen.");
    return config;
}
```

Also update the `.DisableAntiforgery()` comment on `/api/import/camt053` (`Program.cs:196`), which currently reads "Ein-Personen-Tool ohne Cookie-Auth - kein CSRF-Kontext, den es zu schuetzen gaebe":

```csharp
}).RequireAuthorization().DisableAntiforgery(); // Cookie ist SameSite=Strict (siehe Auth.cs) - das blockt
                                                  // bereits Cross-Site-Requests, ein zusaetzliches Antiforgery-Token waere doppelt gemoppelt.
```

- [ ] **Step 3: Update `.env.example`**

Replace its content (all six `EnableBanking__*` vars are now per-user, stored in the db, set via the admin panel — not read from `.env` anymore):

```
# EnableBanking-Zugangsdaten sind seit dem Multi-User-Umbau pro Nutzer in der DB
# hinterlegt (Admin-Panel), nicht mehr hier. Diese Datei bleibt nur als Platzhalter
# fuer docker-compose's env_file: .env - aktuell keine globalen Variablen noetig.
```

- [ ] **Step 4: Manual verification**

```bash
# Without a configured EnableBankingConfig, /api/refresh must fail clearly rather than crash:
curl -i -b cookies2.txt -X POST http://localhost:8081/api/refresh
# Expected: 500 with the "Kein EnableBanking-Config..." message (or adjust to a 400 if preferred - either is acceptable, just not an unhandled crash)

# After Task 5's admin PUT for user 1 (with fake AppId/PrivateKeyPem), consent-link will now
# reach EnableBankingClient with real values instead of throwing - full external-API success
# can't be verified without live EnableBanking credentials, so this step only confirms the
# 500 "Kein EnableBanking-Config" error disappears once a config exists:
curl -i -b cookies.txt -X POST http://localhost:8081/api/consent-link
# Expected: no longer the "Kein EnableBanking-Config" error (may fail downstream against the
# real EnableBanking API with fake test credentials - that's expected and fine here)
```

- [ ] **Step 5: Commit**

```bash
git add backend/EnableBankingClient.cs backend/Program.cs .env.example
git commit -m "Move EnableBanking credentials from global .env to per-user config"
```

---

### Task 9: Frontend login/register gate

**Files:**
- Create: `frontend/src/AuthGate.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/index.css` (append auth-screen styles)

**Interfaces:**
- Produces: `AuthGate` component with props `{ onAuthenticated: (user: { username: string; isAdmin: boolean }) => void }`.

- [ ] **Step 1: Write `frontend/src/AuthGate.tsx`**

```tsx
import { useState } from 'react'

type AuthUser = { username: string; isAdmin: boolean }

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const text = await res.text().catch(() => '')
  return text || fallback
}

export default function AuthGate({ onAuthenticated }: { onAuthenticated: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    if (!username.trim() || !password) {
      setError('Benutzername und Passwort duerfen nicht leer sein.')
      return
    }
    setSubmitting(true)
    setError(null)
    const res = await fetch(`/api/auth/${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.trim(), password }),
    })
    if (res.ok) {
      const user: AuthUser = await res.json()
      onAuthenticated(user)
    } else {
      setError(await errorMessage(res, mode === 'login' ? 'Login fehlgeschlagen.' : 'Registrierung fehlgeschlagen.'))
    }
    setSubmitting(false)
  }

  return (
    <div className="auth-shell">
      <form
        className="auth-card"
        onSubmit={e => { e.preventDefault(); submit() }}
      >
        <h1 className="auth-title">FinanceDuck</h1>
        <div className="auth-tabs">
          <button type="button" className={mode === 'login' ? 'is-active' : ''} onClick={() => { setMode('login'); setError(null) }}>Anmelden</button>
          <button type="button" className={mode === 'register' ? 'is-active' : ''} onClick={() => { setMode('register'); setError(null) }}>Registrieren</button>
        </div>
        <input type="text" placeholder="Benutzername" value={username} onChange={e => setUsername(e.target.value)} autoFocus />
        <input type="password" placeholder="Passwort" value={password} onChange={e => setPassword(e.target.value)} />
        {error && <p className="category-row-error">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Bitte warten...' : mode === 'login' ? 'Anmelden' : 'Registrieren'}
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Gate `App.tsx` behind it**

In `frontend/src/App.tsx`, add near the top of the file:

```tsx
import { useEffect, useState } from 'react'
import AuthGate from './AuthGate'
```

(merge with the existing `import { useRef, useState } from 'react'` into one `react` import line).

Inside `export default function App()`, before the existing state declarations, add:

```tsx
  const [user, setUser] = useState<{ username: string; isAdmin: boolean } | null | undefined>(undefined)

  useEffect(() => {
    fetch('/api/auth/me').then(res => (res.ok ? res.json() : null)).then(setUser)
  }, [])

  if (user === undefined) return null
  if (user === null) return <AuthGate onAuthenticated={setUser} />
```

Add a logout button to the existing `<nav className="app-nav" ...>` block, right after the CAMT.053 import `<input>`:

```tsx
            <button type="button" className="app-nav-action" onClick={() => fetch('/api/auth/logout', { method: 'POST' }).then(() => setUser(null))}>
              <span>{user.username} · Abmelden</span>
            </button>
```

Note: no `credentials: 'include'` changes are needed anywhere in the existing `fetch()` calls — the frontend only ever calls same-origin relative paths (`/api/...`, proxied by the nginx container per `docker-compose.yml`), and `fetch()`'s default credentials mode (`same-origin`) already sends cookies for same-origin requests. This corrects an inaccuracy in the design spec's Frontend section.

- [ ] **Step 3: Append auth-screen CSS to `frontend/src/index.css`**

```css
.auth-shell {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}
.auth-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 280px;
  padding: 24px;
  border-radius: 12px;
  border: 1px solid var(--border, #ddd);
  background: var(--surface, #fff);
}
.auth-title {
  margin: 0 0 8px;
  text-align: center;
}
.auth-tabs {
  display: flex;
  gap: 8px;
}
.auth-tabs button {
  flex: 1;
}
.auth-tabs button.is-active {
  font-weight: 600;
}
```

(if `--border`/`--surface` CSS variables don't already exist in `index.css`, use whatever the file's existing modal/card styling already relies on — check `.category-modal-inner` for the actual variable names in use and match them instead of introducing new ones.)

- [ ] **Step 4: Manual browser verification**

Run `docker compose up --build` (or `npm run dev` in `frontend/` against the dev backend), open the app in a browser:
1. Confirm the login/register screen shows when logged out.
2. Register a new user — confirm it lands directly on the dashboard (auto-login) and the dashboard's default categories appear.
3. Reload the page — confirm the session persists (no re-login needed, cookie survives).
4. Click "Abmelden" — confirm it returns to the login screen and a page reload doesn't restore the session.
5. Log back in with the same credentials — confirm it works.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/AuthGate.tsx frontend/src/App.tsx frontend/src/index.css
git commit -m "Add login/register gate to the frontend"
```

---

### Task 10: Frontend admin panel

**Files:**
- Create: `frontend/src/AdminPanel.tsx`
- Modify: `frontend/src/App.tsx` (nav button + modal, admin-only)

**Interfaces:**
- Produces: `AdminPanel` component with props `{ open: boolean; onClose: () => void }` (same shape as the existing `CategoryManager`/`RuleManager` modals it sits alongside).

- [ ] **Step 1: Write `frontend/src/AdminPanel.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'

type AdminUser = { id: number; username: string; isAdmin: boolean; hasBankConfig: boolean }
type ConfigForm = { appId: string; privateKeyPem: string; aspspName: string; aspspCountry: string; accountIban: string }

const emptyForm: ConfigForm = { appId: '', privateKeyPem: '', aspspName: '', aspspCountry: 'DE', accountIban: '' }

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const text = await res.text().catch(() => '')
  return text || fallback
}

export default function AdminPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<ConfigForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadUsers = () => {
    fetch('/api/admin/users').then(r => r.json()).then(setUsers)
  }

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      loadUsers()
      setEditingId(null)
      setError(null)
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  const save = async (userId: number) => {
    setSaving(true)
    setError(null)
    const res = await fetch(`/api/admin/users/${userId}/enablebanking-config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (res.ok) {
      setEditingId(null)
      setForm(emptyForm)
      loadUsers()
    } else {
      setError(await errorMessage(res, 'Fehler beim Speichern.'))
    }
    setSaving(false)
  }

  return (
    <dialog
      ref={dialogRef}
      className="category-modal"
      onClose={onClose}
      onClick={e => { if (e.target === dialogRef.current) dialogRef.current?.close() }}
    >
      <div className="category-modal-inner">
        <div className="category-modal-header">
          <h2 className="panel-title" style={{ margin: 0 }}>Nutzer verwalten</h2>
          <button type="button" className="icon-button" onClick={() => dialogRef.current?.close()} aria-label="Schließen">×</button>
        </div>

        <ul className="category-list">
          {users.map(u => (
            <li key={u.id} className="category-row">
              <div className="category-row-main">
                <span className="category-name">{u.username}{u.isAdmin ? ' (Admin)' : ''}</span>
                <span className="muted-text">{u.hasBankConfig ? 'Bank verbunden' : 'Keine Bank-Config'}</span>
                <button type="button" onClick={() => { setEditingId(u.id); setForm(emptyForm); setError(null) }}>
                  Bank-Config bearbeiten
                </button>
              </div>
              {editingId === u.id && (
                <div className="category-add">
                  <input placeholder="AppId" value={form.appId} onChange={e => setForm({ ...form, appId: e.target.value })} />
                  <textarea placeholder="Private Key (PEM)" value={form.privateKeyPem} onChange={e => setForm({ ...form, privateKeyPem: e.target.value })} rows={4} />
                  <input placeholder="Aspsp-Name" value={form.aspspName} onChange={e => setForm({ ...form, aspspName: e.target.value })} />
                  <input placeholder="Aspsp-Land (z.B. DE)" value={form.aspspCountry} onChange={e => setForm({ ...form, aspspCountry: e.target.value })} />
                  <input placeholder="Konto-IBAN" value={form.accountIban} onChange={e => setForm({ ...form, accountIban: e.target.value })} />
                  {error && <p className="category-row-error">{error}</p>}
                  <button type="button" onClick={() => save(u.id)} disabled={saving}>Speichern</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </dialog>
  )
}
```

- [ ] **Step 2: Wire it into `App.tsx`, admin-only**

Add the import and a state flag next to `categoryManagerOpen`:

```tsx
import AdminPanel from './AdminPanel'
```

```tsx
  const [adminPanelOpen, setAdminPanelOpen] = useState(false)
```

Add a nav button, rendered only when `user.isAdmin`, next to the "Kategorien verwalten" button:

```tsx
            {user.isAdmin && (
              <button type="button" className="app-nav-action" onClick={() => setAdminPanelOpen(true)}>
                <span>Nutzer verwalten</span>
              </button>
            )}
```

Add the modal render next to `<CategoryManager ... />`:

```tsx
      <AdminPanel open={adminPanelOpen} onClose={() => setAdminPanelOpen(false)} />
```

- [ ] **Step 3: Manual browser verification**

1. Log in as the admin (first-ever registered user). Confirm "Nutzer verwalten" appears in the nav.
2. Log in as a second (non-first) registered user in a private/incognito window. Confirm "Nutzer verwalten" does NOT appear.
3. As admin, open "Nutzer verwalten", see both users listed, edit the second user's bank config with placeholder values, save, reopen the panel — confirm "Bank verbunden" now shows for that user.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/AdminPanel.tsx frontend/src/App.tsx
git commit -m "Add admin panel for managing per-user EnableBanking config"
```
