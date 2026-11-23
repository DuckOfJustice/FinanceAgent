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
