using Microsoft.EntityFrameworkCore;

namespace FinanceDuck.Api;

public sealed class FinanceDbContext(DbContextOptions<FinanceDbContext> options) : DbContext(options)
{
    public DbSet<StoredTransaction> Transactions => Set<StoredTransaction>();
    public DbSet<Category> Categories => Set<Category>();
    public DbSet<Rule> Rules => Set<Rule>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<StoredTransaction>().HasIndex(t => t.ExternalId).IsUnique();
        modelBuilder.Entity<Category>().HasIndex(c => c.Name).IsUnique();
    }
}

public sealed class Category
{
    public int Id { get; set; }
    public required string Name { get; set; }
}

// Kein EF-Fremdschluessel auf Category - Loeschen einer Kategorie raeumt zugehoerige
// Regeln explizit im Endpoint auf, statt sich auf DB-seitige Kaskaden zu verlassen.
public sealed class Rule
{
    public int Id { get; set; }
    public required string Pattern { get; set; }
    public int CategoryId { get; set; }
}

public sealed class StoredTransaction
{
    public int Id { get; set; }
    public required string ExternalId { get; set; }
    public DateOnly BookingDate { get; set; }
    public decimal Amount { get; set; }
    public string? CounterpartyName { get; set; }
    public required string Purpose { get; set; }
    public required string Category { get; set; }
}
