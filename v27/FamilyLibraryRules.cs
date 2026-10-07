using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace RevitAutoV27;

internal sealed record FamilyAsset(string FamilyKey, string RelativePath, string Sha256, string ExpectedFamilyName,
    long ExpectedCategoryId, string[] RequiredTypes);
internal sealed record FamilyLoadInput(string FamilyKey, string Sha256, string ExpectedFamilyName,
    long ExpectedCategoryId, string[] RequiredTypes, string ConflictPolicy, bool OverwriteTypeParameters, string CatalogSha256);

internal static class FamilyLibraryRules
{
    internal const long MaxFileBytes = 100 * 1024 * 1024;
    private static BridgeException Invalid(string message) => new("invalid_family_library", message);
    private static string Text(JsonElement input, string field, int max = 200)
    {
        if (!input.TryGetProperty(field, out var value) || value.ValueKind != JsonValueKind.String
            || string.IsNullOrWhiteSpace(value.GetString()) || value.GetString()!.Length > max)
            throw Invalid($"{field} must be a nonblank string of at most {max} characters.");
        return value.GetString()!;
    }
    private static void ExactFields(JsonElement input, params string[] fields)
    {
        if (input.ValueKind != JsonValueKind.Object) throw Invalid("Expected a catalog object.");
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var field in input.EnumerateObject())
            if (!fields.Contains(field.Name, StringComparer.Ordinal) || !seen.Add(field.Name)) throw Invalid($"Unknown or repeated catalog field '{field.Name}'.");
    }
    internal static void Key(string key)
    {
        if (!Regex.IsMatch(key, "^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$", RegexOptions.CultureInvariant)) throw Invalid("familyKey must be a registered ASCII asset key, not a path.");
    }
    internal static void Hash(string hash)
    {
        if (!Regex.IsMatch(hash, "^[0-9a-fA-F]{64}$", RegexOptions.CultureInvariant)) throw Invalid("SHA-256 must contain 64 hexadecimal characters.");
    }
    private static long Category(JsonElement input)
    {
        if (!input.TryGetProperty("expectedCategoryId", out var value) || value.ValueKind != JsonValueKind.Number
            || !value.TryGetInt64(out var id) || id >= 0 || id < -10000000) throw Invalid("expectedCategoryId must be an explicit built-in family category ID.");
        return id;
    }
    private static string[] Types(JsonElement input)
    {
        if (!input.TryGetProperty("requiredTypes", out var value) || value.ValueKind != JsonValueKind.Array || value.GetArrayLength() is < 1 or > 200)
            throw Invalid("Specify 1–200 reviewed required type names.");
        var names = value.EnumerateArray().Select(v => v.ValueKind == JsonValueKind.String ? v.GetString() : null).ToArray();
        if (names.Any(n => string.IsNullOrWhiteSpace(n) || n!.Length > 200) || names.Distinct(StringComparer.Ordinal).Count() != names.Length)
            throw Invalid("Required types must be distinct exact nonblank names.");
        return names.Select(n => n!).ToArray();
    }
    internal static List<FamilyAsset> Catalog(JsonElement input)
    {
        ExactFields(input, "schemaVersion", "assets");
        if (!input.TryGetProperty("schemaVersion", out var version) || version.ValueKind != JsonValueKind.Number || !version.TryGetInt32(out var v) || v != 1
            || !input.TryGetProperty("assets", out var assets) || assets.ValueKind != JsonValueKind.Array || assets.GetArrayLength() > 1000)
            throw Invalid("Catalog requires schemaVersion=1 and at most 1000 assets.");
        var result = new List<FamilyAsset>();
        foreach (var row in assets.EnumerateArray())
        {
            ExactFields(row, "familyKey", "relativePath", "sha256", "expectedFamilyName", "expectedCategoryId", "requiredTypes");
            var key = Text(row, "familyKey", 80); Key(key);
            var relative = Text(row, "relativePath", 500); Relative(relative);
            var hash = Text(row, "sha256", 64); Hash(hash);
            result.Add(new(key, relative, hash.ToLowerInvariant(), Text(row, "expectedFamilyName"), Category(row), Types(row)));
        }
        if (result.Select(a => a.FamilyKey).Distinct(StringComparer.Ordinal).Count() != result.Count) throw Invalid("Duplicate familyKey in trusted catalog.");
        return result;
    }
    internal static FamilyLoadInput Operation(JsonElement op)
    {
        ExactFields(op, "operationType", "familyKey", "sha256", "expectedFamilyName", "expectedCategoryId", "requiredTypes", "conflictPolicy", "overwriteTypeParameters", "catalogSha256");
        if (Text(op, "operationType") != "load_family") throw Invalid("Expected load_family operation.");
        var key = Text(op, "familyKey", 80); Key(key);
        var hash = Text(op, "sha256", 64); Hash(hash);
        var catalogHash = Text(op, "catalogSha256", 64); Hash(catalogHash);
        var policy = Text(op, "conflictPolicy");
        if (policy is not ("reject" or "keep_existing" or "replace")) throw Invalid("Explicit conflictPolicy must be reject, keep_existing or replace.");
        if (!op.TryGetProperty("overwriteTypeParameters", out var overwrite) || overwrite.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
            throw Invalid("overwriteTypeParameters must be explicitly true or false.");
        if (overwrite.GetBoolean() && policy != "replace") throw Invalid("Only replace can overwrite existing type parameters.");
        return new(key, hash.ToLowerInvariant(), Text(op, "expectedFamilyName"), Category(op), Types(op), policy, overwrite.GetBoolean(), catalogHash.ToLowerInvariant());
    }
    internal static void Match(FamilyAsset catalog, FamilyLoadInput op)
    {
        if (catalog.FamilyKey != op.FamilyKey || catalog.Sha256 != op.Sha256 || catalog.ExpectedFamilyName != op.ExpectedFamilyName
            || catalog.ExpectedCategoryId != op.ExpectedCategoryId || !catalog.RequiredTypes.SequenceEqual(op.RequiredTypes))
            throw new BridgeException("family_asset_changed", "Family asset metadata changed after review. Obtain a new catalog and preview; no file is loaded.");
    }
    internal static void MatchCatalogHash(string current, string reviewed)
    {
        Hash(current); Hash(reviewed);
        if (!string.Equals(current, reviewed, StringComparison.OrdinalIgnoreCase))
            throw new BridgeException("family_catalog_changed", "The approved family catalog changed after preview. Read the catalog and review a new plan; no RFA is loaded.");
    }
    internal static void Relative(string relative)
    {
        var parts = relative.Split(['/', '\\']);
        if (Path.IsPathRooted(relative) || relative.Contains(':') || relative.Contains('*') || relative.Contains('?')
            || parts.Any(p => p.Length == 0 || p is "." or ".." || p.EndsWith(' ') || p.EndsWith('.'))
            || !string.Equals(Path.GetExtension(relative), ".rfa", StringComparison.OrdinalIgnoreCase))
            throw Invalid("Registered relativePath must stay inside the local family library and end in .rfa.");
    }
    internal static string Resolve(string root, string relative)
    {
        Relative(relative);
        var fullRoot = Path.GetFullPath(root);
        var path = Path.GetFullPath(Path.Combine(fullRoot, relative));
        if (!path.StartsWith(fullRoot.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw Invalid("Family path escapes the approved library.");
        EnsurePlainPath(path);
        return path;
    }
    internal static void EnsurePlainPath(string path)
    {
        var full = Path.GetFullPath(path);
        var current = Path.GetPathRoot(full)!;
        foreach (var part in full[current.Length..].Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, part);
            if (File.Exists(current) || Directory.Exists(current))
                if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw Invalid("Junctions/symbolic links are not allowed in approved library paths.");
        }
    }
    internal static FileStream OpenVerified(string root, FamilyAsset asset)
    {
        var path = Resolve(root, asset.RelativePath);
        if (!File.Exists(path)) throw new BridgeException("family_asset_missing", "Registered RFA is missing from the local family library.");
        FileStream? stream = null;
        try
        {
            stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
            if (stream.Length is <= 0 or > MaxFileBytes) throw Invalid("Approved RFA must be nonempty and at most 100 MB.");
            var hash = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
            if (hash != asset.Sha256) throw new BridgeException("family_asset_changed", "Registered RFA bytes no longer match the reviewed SHA-256.");
            stream.Position = 0;
            return stream;
        }
        catch { stream?.Dispose(); throw; }
    }
}
