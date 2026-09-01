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
        db.ChangeTracker.Clear();

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
        db.ChangeTracker.Clear();

        Console.WriteLine("User schema self-test: OK");
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition) throw new Exception($"User schema self-test FAILED: {message}");
    }
}
