using Microsoft.EntityFrameworkCore;

namespace FinanceDuck.Api;

public sealed class FinanceDbContext(DbContextOptions<FinanceDbContext> options) : DbContext(options)
{
    public DbSet<StoredTransaction> Transactions => Set<StoredTransaction>();
    public DbSet<Category> Categories => Set<Category>();
    public DbSet<Rule> Rules => Set<Rule>();
    public DbSet<User> Users => Set<User>();
    public DbSet<EnableBankingConfig> EnableBankingConfigs => Set<EnableBankingConfig>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // Nicht eindeutig (siehe Migration in Program.cs): manche Zahlungsdienstleister
        // vergeben dieselbe ExternalId (AcctSvcrRef/EndToEndId) fuer mehrere echte Buchungen
        // wieder (z.B. wiederkehrende Lohn-/Gehaltslaeufe) - die eigentliche Duplikat-Erkennung
        // laeuft in ImportTransactionsAsync ueber ExternalId+Datum+Betrag bzw. Inhalt, nicht ueber
        // eine DB-Constraint. Index bleibt fuer die Lookup-Performance dort erhalten.
        modelBuilder.Entity<StoredTransaction>().HasIndex(t => t.ExternalId);
        modelBuilder.Entity<Category>().HasIndex(c => c.Name).IsUnique();
        modelBuilder.Entity<User>().HasIndex(u => u.Username).IsUnique();
        modelBuilder.Entity<EnableBankingConfig>().HasKey(c => c.UserId);
    }
}

public sealed class Category
{
    public int Id { get; set; }
    public required string Name { get; set; }
    // Slot-Key aus der Frontend-Farbpalette (z.B. "miete"), keine CSS-Var/Hexfarbe -
    // Server validiert nur gegen CategoryColors.Palette. Null = alte Kategorie, Frontend
    // faellt dann auf den bisherigen Hash-basierten Fallback zurueck.
    public string? Color { get; set; }
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
