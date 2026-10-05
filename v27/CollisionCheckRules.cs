using System.Text.Json;

namespace RevitAutoV27;

internal sealed record CollisionCheckInput(string DocumentIdentity, long? ExpectedRevision,
    long[] TargetElementIds, long[] ExcludeElementIds, string[] CandidateCategories,
    double ClearanceMm, double ToleranceMm, int MaxCandidates);
internal sealed record CollisionBounds(double MinX, double MinY, double MinZ, double MaxX, double MaxY, double MaxZ)
{
    public bool Valid => new[] { MinX, MinY, MinZ, MaxX, MaxY, MaxZ }.All(double.IsFinite)
        && MinX <= MaxX && MinY <= MaxY && MinZ <= MaxZ;
    public bool Intersects(CollisionBounds other, double expansionMm = 0) => Valid && other.Valid
        && double.IsFinite(expansionMm) && expansionMm >= 0
        && MaxX + expansionMm >= other.MinX && MinX - expansionMm <= other.MaxX
        && MaxY + expansionMm >= other.MinY && MinY - expansionMm <= other.MaxY
        && MaxZ + expansionMm >= other.MinZ && MinZ - expansionMm <= other.MaxZ;
}
internal enum CollisionPairState { Collision, ClearanceCandidate, NoIntersectionAboveTolerance, Unknown }
internal static class CollisionCheckRules
{
    public const int MaxTargets = 50;
    public const int MaxExcluded = 500;
    public const int MaxCandidateLimit = 1000;
    public const int MaxSolidPairs = 10000;
    public const int MaxSolidsPerElement = 128;
    public const int MaxGeometryDepth = 16;
    public const int MaxAnalysisSeconds = 20;
    public static readonly string[] Categories = ["OST_MechanicalEquipment", "OST_PipeCurves", "OST_PipeFitting",
        "OST_DuctCurves", "OST_DuctFitting", "OST_Walls", "OST_Floors", "OST_StructuralColumns",
        "OST_StructuralFraming", "OST_StructuralFoundation", "OST_Columns", "OST_Ceilings", "OST_Roofs"];
    private static readonly HashSet<string> Fields = new(StringComparer.Ordinal)
        { "documentIdentity", "expectedRevision", "targetElementIds", "excludeElementIds", "candidateCategories", "clearanceMm", "toleranceMm", "maxCandidates" };
    private static BridgeException Invalid(string message) => new("invalid_collision_request", message);
    public static CollisionCheckInput Parse(JsonElement request)
    {
        if (request.ValueKind != JsonValueKind.Object) throw Invalid("Collision request must be an object.");
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var field in request.EnumerateObject())
            if (!Fields.Contains(field.Name) || !seen.Add(field.Name)) throw Invalid($"Unknown or duplicate field '{field.Name}'.");
        if (!request.TryGetProperty("documentIdentity", out var identity) || identity.ValueKind != JsonValueKind.String
            || string.IsNullOrWhiteSpace(identity.GetString()) || identity.GetString()!.Length > 200)
            throw Invalid("Read the current documentIdentity before checking collisions.");
        long? revision = null;
        if (request.TryGetProperty("expectedRevision", out var r))
        {
            if (r.ValueKind != JsonValueKind.Number || !r.TryGetInt64(out var value) || value < 0 || value > 9007199254740991) throw Invalid("expectedRevision must be a nonnegative safe integer.");
            revision = value;
        }
        var targets = Ids(request, "targetElementIds", MaxTargets, required: true);
        var exclusions = Ids(request, "excludeElementIds", MaxExcluded, required: false);
        if (targets.Intersect(exclusions).Any()) throw Invalid("A target cannot also be excluded.");
        string[] categories = [.. Categories];
        if (request.TryGetProperty("candidateCategories", out var c))
        {
            if (c.ValueKind != JsonValueKind.Array || c.GetArrayLength() > Categories.Length) throw Invalid("candidateCategories must be a bounded category array.");
            if (c.GetArrayLength() > 0)
            {
                if (c.EnumerateArray().Any(v => v.ValueKind != JsonValueKind.String)) throw Invalid("Categories must be exact OST_... strings.");
                categories = c.EnumerateArray().Select(v => v.GetString()!).ToArray();
                if (categories.Distinct().Count() != categories.Length || categories.Any(v => !Categories.Contains(v, StringComparer.Ordinal)))
                    throw Invalid("Unsupported or duplicate collision candidate category.");
            }
        }
        var clearance = Number(request, "clearanceMm", 0, 0, 10000, inclusiveMin: true);
        var tolerance = Number(request, "toleranceMm", 0.1, 0, 10, inclusiveMin: false);
        var maxCandidates = 500;
        if (request.TryGetProperty("maxCandidates", out var m))
        {
            if (m.ValueKind != JsonValueKind.Number || !m.TryGetInt32(out maxCandidates) || maxCandidates < 1 || maxCandidates > MaxCandidateLimit)
                throw Invalid($"maxCandidates must be an integer in [1,{MaxCandidateLimit}].");
        }
        return new(identity.GetString()!, revision, targets, exclusions, categories, clearance, tolerance, maxCandidates);
    }
    private static long[] Ids(JsonElement request, string name, int limit, bool required)
    {
        if (!request.TryGetProperty(name, out var ids))
        {
            if (required) throw Invalid($"{name} is required.");
            return [];
        }
        if (ids.ValueKind != JsonValueKind.Array || ids.GetArrayLength() > limit || required && ids.GetArrayLength() == 0)
            throw Invalid($"{name} must be an array of at most {limit} current element IDs.");
        var values = new List<long>();
        foreach (var id in ids.EnumerateArray())
        {
            if (id.ValueKind != JsonValueKind.Number || !id.TryGetInt64(out var value) || value < 1 || value > 9007199254740991)
                throw Invalid("Element IDs must be positive safe integers, not predicted references.");
            values.Add(value);
        }
        if (values.Distinct().Count() != values.Count) throw Invalid($"{name} contains duplicate IDs.");
        return [.. values];
    }
    private static double Number(JsonElement request, string name, double fallback, double min, double max, bool inclusiveMin)
    {
        if (!request.TryGetProperty(name, out var number)) return fallback;
        if (number.ValueKind != JsonValueKind.Number || !number.TryGetDouble(out var value) || !double.IsFinite(value)
            || (inclusiveMin ? value < min : value <= min) || value > max) throw Invalid($"{name} must be finite in {(inclusiveMin ? "[" : "(")}{min},{max}] mm.");
        return value;
    }
    public static double VolumeThreshold(double toleranceMm) => Math.Max(1, Math.Pow(toleranceMm, 3));
    public static CollisionPairState Classify(bool geometryComplete, bool booleanComplete, double maxIntersectionMm3,
        double toleranceMm, double clearanceMm)
    {
        if (!geometryComplete || !booleanComplete || !double.IsFinite(maxIntersectionMm3) || maxIntersectionMm3 < 0)
            return CollisionPairState.Unknown;
        if (maxIntersectionMm3 > VolumeThreshold(toleranceMm)) return CollisionPairState.Collision;
        return clearanceMm > 0 ? CollisionPairState.ClearanceCandidate : CollisionPairState.NoIntersectionAboveTolerance;
    }
}
