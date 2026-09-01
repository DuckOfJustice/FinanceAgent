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
