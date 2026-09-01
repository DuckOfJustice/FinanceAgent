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
