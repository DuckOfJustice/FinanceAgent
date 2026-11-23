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
    private sealed record OldCategory(int OldId, string Name, string? Color);
    private sealed record OldRule(string Pattern, int OldCategoryId);
    private sealed record OldTransaction(string ExternalId, DateOnly BookingDate, decimal Amount, string? CounterpartyName, string Purpose, string Category);

    public static async Task RunAsync(string oldDbPath, string oldEnvPath, string username, string password,
        FinanceDbContext targetDb, IPasswordHasher<User> hasher, SecretProtector protector)
    {
        // EnsureCreated ist idempotent (kein Absturz, wenn das Schema schon existiert) - noetig,
        // damit dieses CLI auch gegen eine komplett frische data/finance.db laeuft, die die
        // Web-App noch nie gestartet hat (--migrate-user laesst die Web-App-Startup-Logik aus,
        // die das Schema sonst anlegt).
        targetDb.Database.EnsureCreated();

        // Alles, was fehlschlagen kann, VOR dem ersten Schreibzugriff lesen/validieren - sonst
        // steht bei einem falschen PrivateKeyPath oder oldDbPath bereits ein halb angelegter User
        // in der DB, und ein erneuter Versuch scheitert am Unique-Index auf Username.
        var env = ParseEnvFile(oldEnvPath);
        var privateKeyPath = env.GetValueOrDefault("EnableBanking__PrivateKeyPath");
        var privateKeyPem = string.IsNullOrEmpty(privateKeyPath) ? null : File.ReadAllText(privateKeyPath);

        using var oldConnection = new SqliteConnection($"Data Source={oldDbPath};Mode=ReadOnly");
        oldConnection.Open();

        var oldCategories = new List<OldCategory>();
        using (var cmd = oldConnection.CreateCommand())
        {
            cmd.CommandText = """SELECT "Id", "Name", "Color" FROM "Categories" """;
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
                oldCategories.Add(new OldCategory(reader.GetInt32(0), reader.GetString(1), reader.IsDBNull(2) ? null : reader.GetString(2)));
        }

        var oldRules = new List<OldRule>();
        using (var cmd = oldConnection.CreateCommand())
        {
            cmd.CommandText = """SELECT "Pattern", "CategoryId" FROM "Rules" """;
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
                oldRules.Add(new OldRule(reader.GetString(0), reader.GetInt32(1)));
        }

        var oldTransactions = new List<OldTransaction>();
        using (var cmd = oldConnection.CreateCommand())
        {
            cmd.CommandText = """SELECT "ExternalId", "BookingDate", "Amount", "CounterpartyName", "Purpose", "Category" FROM "Transactions" """;
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
                oldTransactions.Add(new OldTransaction(
                    reader.GetString(0),
                    DateOnly.Parse(reader.GetString(1)),
                    reader.GetDecimal(2),
                    reader.IsDBNull(3) ? null : reader.GetString(3),
                    reader.GetString(4),
                    reader.GetString(5)));
        }

        // Ab hier nur noch Schreiben - alles was schiefgehen konnte, ist bereits oben passiert.
        // Eine Transaktion um den gesamten Kopiervorgang, damit ein Fehler mittendrin keinen
        // halb migrierten Nutzer in der DB zuruecklaesst.
        await using var transaction = await targetDb.Database.BeginTransactionAsync();

        var user = new User { Username = username, PasswordHash = "", CreatedAt = DateTime.UtcNow };
        user.PasswordHash = hasher.HashPassword(user, password);
        targetDb.Users.Add(user);
        await targetDb.SaveChangesAsync();

        targetDb.EnableBankingConfigs.Add(new EnableBankingConfig
        {
            UserId = user.Id,
            AppId = env.GetValueOrDefault("EnableBanking__AppId"),
            PrivateKeyPem = privateKeyPem is null ? null : protector.Protect(privateKeyPem),
            AspspName = env.GetValueOrDefault("EnableBanking__AspspName"),
            AspspCountry = env.GetValueOrDefault("EnableBanking__AspspCountry"),
            SessionId = env.TryGetValue("EnableBanking__SessionId", out var sid) && !string.IsNullOrEmpty(sid) ? protector.Protect(sid) : null,
            AccountIban = env.GetValueOrDefault("EnableBanking__AccountIban"),
        });
        await targetDb.SaveChangesAsync();

        var categoryIdMap = new Dictionary<int, int>();
        foreach (var oldCategory in oldCategories)
        {
            var category = new Category { Name = oldCategory.Name, Color = oldCategory.Color, UserId = user.Id };
            targetDb.Categories.Add(category);
            // Sofort speichern statt am Ende (weiterhin innerhalb derselben Transaktion) - die neue
            // Id wird fuer das Rule.CategoryId-Remapping unten gebraucht.
            await targetDb.SaveChangesAsync();
            categoryIdMap[oldCategory.OldId] = category.Id;
        }

        foreach (var oldRule in oldRules)
        {
            if (!categoryIdMap.TryGetValue(oldRule.OldCategoryId, out var newCategoryId)) continue;
            targetDb.Rules.Add(new Rule { Pattern = oldRule.Pattern, CategoryId = newCategoryId, UserId = user.Id });
        }
        await targetDb.SaveChangesAsync();

        foreach (var oldTransaction in oldTransactions)
        {
            targetDb.Transactions.Add(new StoredTransaction
            {
                ExternalId = oldTransaction.ExternalId,
                BookingDate = oldTransaction.BookingDate,
                Amount = oldTransaction.Amount,
                CounterpartyName = oldTransaction.CounterpartyName,
                Purpose = oldTransaction.Purpose,
                Category = oldTransaction.Category,
                UserId = user.Id,
            });
        }
        await targetDb.SaveChangesAsync();

        await transaction.CommitAsync();

        Console.WriteLine($"Migriert: Nutzer '{username}' (Id {user.Id}), {categoryIdMap.Count} Kategorien, {oldTransactions.Count} Buchungen.");
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
