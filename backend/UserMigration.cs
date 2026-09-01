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
