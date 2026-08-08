using Microsoft.EntityFrameworkCore;

namespace FinanceAgent.Api;

public sealed class FinanceDbContext(DbContextOptions<FinanceDbContext> options) : DbContext(options)
{
    public DbSet<StoredTransaction> Transactions => Set<StoredTransaction>();

    protected override void OnModelCreating(ModelBuilder modelBuilder) =>
        modelBuilder.Entity<StoredTransaction>().HasIndex(t => t.ExternalId).IsUnique();
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
