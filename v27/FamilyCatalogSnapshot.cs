using System.Security.Cryptography;
using System.Text.Json;

namespace RevitAutoV27;

// Holds a deny-write/delete lock on the exact manifest bytes parsed and hashed for this call.
// The input plan hashes the entire manifest, including reviewed paths, not just RFA content.
internal sealed class FamilyCatalogSnapshot : IDisposable
{
    private readonly FileStream stream;
    public string Sha256 { get; }
    public IReadOnlyList<FamilyAsset> Assets { get; }
    private FamilyCatalogSnapshot(FileStream stream, byte[] bytes, List<FamilyAsset> assets)
    {
        this.stream = stream;
        Sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        Assets = assets.AsReadOnly();
    }
    internal static FamilyCatalogSnapshot Open(string path)
    {
        FileStream? stream = null;
        try
        {
            FamilyLibraryRules.EnsurePlainPath(path);
            stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
            FamilyLibraryRules.EnsurePlainPath(path);
            if (stream.Length is <= 0 or > 2 * 1024 * 1024)
                throw new BridgeException("invalid_family_library", "Local manifest must be nonempty and at most 2 MB.");
            var bytes = new byte[(int)stream.Length];
            stream.ReadExactly(bytes);
            var offset = bytes.Length >= 3 && bytes[0] == 0xef && bytes[1] == 0xbb && bytes[2] == 0xbf ? 3 : 0;
            using var json = JsonDocument.Parse(bytes.AsMemory(offset));
            var assets = FamilyLibraryRules.Catalog(json.RootElement);
            return new FamilyCatalogSnapshot(stream, bytes, assets);
        }
        catch (Exception ex)
        {
            stream?.Dispose();
            if (ex is JsonException) throw new BridgeException("invalid_family_library", "Local manifest JSON is invalid. Repair the reviewed catalog before planning.");
            if (ex is IOException or UnauthorizedAccessException)
                throw new BridgeException("family_catalog_unavailable", "The local approved catalog is missing, locked or inaccessible. No RFA was loaded.");
            throw;
        }
    }
    public void Dispose() => stream.Dispose();
}
