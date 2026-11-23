using System.Security.Cryptography;
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
            // Frisch registriert - es kann noch keine EnableBankingConfig fuer diesen Nutzer geben.
            return Results.Ok(new { user.Username, user.IsAdmin, bankConnected = false });
        });

        app.MapPost("/api/auth/login", async (AuthRequest body, FinanceDbContext db, IPasswordHasher<User> hasher, HttpContext http) =>
        {
            var user = await db.Users.FirstOrDefaultAsync(u => u.Username == body.Username);
            if (user is null) return Results.Unauthorized();

            var result = hasher.VerifyHashedPassword(user, user.PasswordHash, body.Password ?? "");
            if (result == PasswordVerificationResult.Failed) return Results.Unauthorized();

            await http.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, AuthExtensions.BuildPrincipal(user));
            var bankConnected = await db.EnableBankingConfigs.AnyAsync(c => c.UserId == user.Id && c.SessionId != null);
            return Results.Ok(new { user.Username, user.IsAdmin, bankConnected });
        });

        app.MapPost("/api/auth/logout", async (HttpContext http) =>
        {
            await http.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.Ok();
        });

        app.MapGet("/api/auth/me", async (HttpContext http, FinanceDbContext db) =>
        {
            if (http.User.Identity?.IsAuthenticated != true) return Results.Unauthorized();
            var userId = http.User.GetUserId();
            var bankConnected = await db.EnableBankingConfigs.AnyAsync(c => c.UserId == userId && c.SessionId != null);
            return Results.Ok(new { username = http.User.Identity.Name, isAdmin = http.User.IsAdmin(), bankConnected });
        });

        // Vom Reset-Link aufgerufen, bevor das Formular den Benutzernamen anzeigt - prueft
        // nur, ob der Token noch gueltig ist, setzt nichts.
        app.MapGet("/api/auth/reset-password/{token}", async (string token, FinanceDbContext db) =>
        {
            var entry = await db.PasswordResetTokens.FirstOrDefaultAsync(t => t.Token == token);
            if (entry is null || entry.ExpiresAt < DateTime.UtcNow) return Results.NotFound();
            var username = await db.Users.Where(u => u.Id == entry.UserId).Select(u => u.Username).FirstOrDefaultAsync();
            if (username is null) return Results.NotFound();
            return Results.Ok(new { username });
        });

        app.MapPost("/api/auth/reset-password", async (ResetPasswordRequest body, FinanceDbContext db, IPasswordHasher<User> hasher) =>
        {
            if (string.IsNullOrEmpty(body.Token) || string.IsNullOrEmpty(body.NewPassword))
                return Results.BadRequest("Token und neues Passwort duerfen nicht leer sein.");

            var entry = await db.PasswordResetTokens.FirstOrDefaultAsync(t => t.Token == body.Token);
            if (entry is null || entry.ExpiresAt < DateTime.UtcNow) return Results.BadRequest("Link ist ungueltig oder abgelaufen.");

            var user = await db.Users.FindAsync(entry.UserId);
            if (user is null) return Results.NotFound();

            user.PasswordHash = hasher.HashPassword(user, body.NewPassword);
            db.PasswordResetTokens.Remove(entry);
            await db.SaveChangesAsync();
            return Results.Ok();
        });
    }

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
                    HasBankConfig = x.cs.Any(c => c.AccountIban != null),
                    BankConnected = x.cs.Any(c => c.SessionId != null)
                })
                .OrderBy(x => x.Username)
                .ToListAsync()));

        admin.MapPut("/users/{id:int}/enablebanking-config", async (int id, EnableBankingConfigRequest body, FinanceDbContext db, SecretProtector protector) =>
        {
            if (!await db.Users.AnyAsync(u => u.Id == id)) return Results.NotFound();

            // Leere Felder behalten den bisherigen Wert statt ihn zu loeschen - das Admin-Panel
            // prefillt sein Formular nicht mit den gespeicherten Werten (siehe AdminPanel.tsx),
            // ein Admin der nur ein Feld korrigiert wuerde die uebrigen sonst stillschweigend nullen.
            var config = await db.EnableBankingConfigs.FindAsync(id) ?? new EnableBankingConfig { UserId = id };
            config.AppId = string.IsNullOrEmpty(body.AppId) ? config.AppId : body.AppId;
            config.PrivateKeyPem = string.IsNullOrEmpty(body.PrivateKeyPem) ? config.PrivateKeyPem : protector.Protect(body.PrivateKeyPem);
            config.AspspName = string.IsNullOrEmpty(body.AspspName) ? config.AspspName : body.AspspName;
            config.AspspCountry = string.IsNullOrEmpty(body.AspspCountry) ? config.AspspCountry : body.AspspCountry;
            config.AccountIban = string.IsNullOrEmpty(body.AccountIban) ? config.AccountIban : body.AccountIban;
            if (db.Entry(config).State == EntityState.Detached) db.EnableBankingConfigs.Add(config);

            await db.SaveChangesAsync();
            return Results.Ok();
        });

        // Setzt nur die SessionId zurueck (App-ID/Key/IBAN bleiben) - der Nutzer sieht
        // "Bank verbinden" wieder und kann den Consent-Flow erneut durchlaufen, z.B. nach
        // Ablauf der Bank-Session oder auf Wunsch, die Verbindung neu aufzusetzen.
        admin.MapPost("/users/{id:int}/reset-bank-connection", async (int id, FinanceDbContext db) =>
        {
            var config = await db.EnableBankingConfigs.FindAsync(id);
            if (config is null) return Results.NotFound();
            config.SessionId = null;
            await db.SaveChangesAsync();
            return Results.Ok();
        });

        // Erstellt einen Einmal-Link, den der Admin manuell an den Nutzer schickt (kein SMTP
        // in dieser App). Alte, noch nicht eingeloeste Links fuer denselben Nutzer werden
        // verworfen, damit immer nur der zuletzt verschickte Link funktioniert.
        admin.MapPost("/users/{id:int}/password-reset-link", async (int id, HttpContext http, FinanceDbContext db) =>
        {
            if (!await db.Users.AnyAsync(u => u.Id == id)) return Results.NotFound();

            await db.PasswordResetTokens.Where(t => t.UserId == id).ExecuteDeleteAsync();
            var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(24));
            db.PasswordResetTokens.Add(new PasswordResetToken { Token = token, UserId = id, ExpiresAt = DateTime.UtcNow.AddHours(24) });
            await db.SaveChangesAsync();

            // Request.Scheme zeigt hier "http" (interne Docker-Verbindung zum Backend ist
            // unverschluesselt) - X-Forwarded-Proto kommt von nginx' TLS-Terminierung (siehe
            // nginx.conf) und traegt das tatsaechliche Schema des Clients.
            var scheme = http.Request.Headers["X-Forwarded-Proto"].FirstOrDefault() ?? http.Request.Scheme;
            var baseUrl = $"{scheme}://{http.Request.Host}";
            return Results.Ok(new { url = $"{baseUrl}/?resetToken={token}" });
        });

        admin.MapDelete("/users/{id:int}", async (int id, HttpContext http, FinanceDbContext db) =>
        {
            // Sich selbst loeschen wuerde die eigene Session verwaisen lassen (Cookie zeigt auf
            // eine nicht mehr existierende UserId) - kein Recovery-Weg dafuer in dieser App.
            if (id == http.User.GetUserId()) return Results.BadRequest("Der eigene Account kann nicht geloescht werden.");

            var user = await db.Users.FindAsync(id);
            if (user is null) return Results.NotFound();

            // Keine EF-Fremdschluessel auf UserId (gleiches Muster wie ueberall sonst in dieser
            // App) - abhaengige Daten muessen explizit mitgeloescht werden, sonst blieben sie als
            // verwaiste Zeilen unter einer nicht mehr existierenden UserId liegen.
            await db.Transactions.Where(t => t.UserId == id).ExecuteDeleteAsync();
            await db.Rules.Where(r => r.UserId == id).ExecuteDeleteAsync();
            await db.Categories.Where(c => c.UserId == id).ExecuteDeleteAsync();
            await db.EnableBankingConfigs.Where(c => c.UserId == id).ExecuteDeleteAsync();
            db.Users.Remove(user);
            await db.SaveChangesAsync();
            return Results.Ok();
        });
    }
}

public record AuthRequest(string? Username, string? Password);
public record EnableBankingConfigRequest(string? AppId, string? PrivateKeyPem, string? AspspName, string? AspspCountry, string? AccountIban);
public record ResetPasswordRequest(string? Token, string? NewPassword);
