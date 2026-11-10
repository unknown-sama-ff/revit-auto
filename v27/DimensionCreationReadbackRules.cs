using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Serialization;

namespace RevitAutoV27;

internal readonly record struct DimensionPoint(
    [property: JsonPropertyName("xMm")] double Xmm,
    [property: JsonPropertyName("yMm")] double Ymm,
    [property: JsonPropertyName("zMm")] double Zmm);
internal readonly record struct DimensionVector(double X, double Y, double Z);
internal readonly record struct DimensionAxis(DimensionPoint Origin, DimensionVector Direction);
internal readonly record struct DimensionReferenceReadback(string StableReference, long ElementId, long LinkedElementId, string ReferenceType);
internal sealed record DimensionCreationReadback(long DimensionId, string UniqueId, string ClassName, long ViewId, long TypeId,
    bool AreReferencesAvailable, DimensionAxis Axis, IReadOnlyList<DimensionReferenceReadback> References, bool IsBound);

internal static class DimensionCreationReadbackRules
{
    public const int MaxReferences = 128, MaxStableReferenceLength = 4096;
    public const double AxisToleranceMm = 0.01, DirectionCrossTolerance = 1e-8;
    private const long MaxSafeId = 9007199254740991;
    private static BridgeException Invalid(string message) => new("invalid_dimension_readback", message);
    private static bool Id(long value) => value > 0 && value <= MaxSafeId;
    private static bool Finite(DimensionPoint p) => double.IsFinite(p.Xmm) && double.IsFinite(p.Ymm) && double.IsFinite(p.Zmm);
    private static double Length(DimensionVector v) => Math.Sqrt(v.X * v.X + v.Y * v.Y + v.Z * v.Z);
    private static DimensionVector Unit(DimensionVector v)
    {
        var length = Length(v);
        if (!double.IsFinite(length) || length <= 1e-12) throw Invalid("Native dimension axis direction is missing or non-finite.");
        return new(v.X / length, v.Y / length, v.Z / length);
    }
    private static DimensionVector Cross(DimensionVector a, DimensionVector b) =>
        new(a.Y * b.Z - a.Z * b.Y, a.Z * b.X - a.X * b.Z, a.X * b.Y - a.Y * b.X);
    private static string Sha256(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
    private static object ReferenceDiagnostic(DimensionReferenceReadback reference) => new
    {
        elementId = reference.ElementId,
        linkedElementId = reference.LinkedElementId,
        referenceType = reference.ReferenceType,
        stableReferenceLength = reference.StableReference.Length,
        stableReferenceSha256 = Sha256(reference.StableReference)
    };
    private static object[] ReferenceDiagnostics(IReadOnlyList<DimensionReferenceReadback> references) => references
        .OrderBy(reference => reference.StableReference, StringComparer.Ordinal)
        .Select(ReferenceDiagnostic)
        .ToArray();
    private static object IdentityDiagnostic(DimensionCreationReadback dimension) => new
    {
        dimensionId = dimension.DimensionId,
        uniqueIdLength = dimension.UniqueId.Length,
        uniqueIdSha256 = Sha256(dimension.UniqueId),
        className = dimension.ClassName,
        viewId = dimension.ViewId,
        typeId = dimension.TypeId,
        areReferencesAvailable = dimension.AreReferencesAvailable,
        references = ReferenceDiagnostics(dimension.References)
    };

    public static void RequireReferences(IReadOnlyList<DimensionReferenceReadback>? references)
    {
        if (references is null || references.Count < 2 || references.Count > MaxReferences ||
            references.Any(r => string.IsNullOrWhiteSpace(r.StableReference) || r.StableReference.Length > MaxStableReferenceLength ||
                !Id(r.ElementId) || !(r.LinkedElementId == -1 || Id(r.LinkedElementId)) || string.IsNullOrWhiteSpace(r.ReferenceType)) ||
            references.Select(r => r.StableReference).Distinct(StringComparer.Ordinal).Count() != references.Count)
            throw Invalid("Dimension references must be complete, bounded, distinct native stable references with valid target IDs.");
    }

    public static void RequireStructure(DimensionCreationReadback value)
    {
        if (!Id(value.DimensionId) || !Id(value.ViewId) || !Id(value.TypeId) || value.ClassName is not ("Dimension" or "LinearDimension") ||
            string.IsNullOrWhiteSpace(value.UniqueId) || !Finite(value.Axis.Origin))
            throw Invalid("Native dimension identity, type, view or linear axis is missing.");
        Unit(value.Axis.Direction);
        RequireReferences(value.References);
    }

    public static void Require(DimensionCreationReadback expected, DimensionCreationReadback actual)
    {
        RequireStructure(expected); RequireStructure(actual);
        var expectedReferences = expected.References.OrderBy(reference => reference.StableReference, StringComparer.Ordinal).ToArray();
        var actualReferences = actual.References.OrderBy(reference => reference.StableReference, StringComparer.Ordinal).ToArray();
        var mismatches = new List<string>();
        if (actual.DimensionId != expected.DimensionId) mismatches.Add("dimensionId");
        if (actual.UniqueId != expected.UniqueId) mismatches.Add("uniqueId");
        if (actual.ClassName != expected.ClassName) mismatches.Add("className");
        if (actual.ViewId != expected.ViewId) mismatches.Add("viewId");
        if (actual.TypeId != expected.TypeId) mismatches.Add("typeId");
        if (!expected.AreReferencesAvailable || !actual.AreReferencesAvailable) mismatches.Add("areReferencesAvailable");
        if (!expectedReferences.SequenceEqual(actualReferences)) mismatches.Add("referenceMembership");
        if (mismatches.Count > 0)
            throw new BridgeException("invalid_dimension_readback",
                $"Created dimension readback differs in {string.Join(", ", mismatches)}; roll back.",
                new
                {
                    mismatchFields = mismatches,
                    expected = IdentityDiagnostic(expected),
                    actual = IdentityDiagnostic(actual)
                });
        var requestedDirection = Unit(expected.Axis.Direction);
        var directionError = Length(Cross(requestedDirection, Unit(actual.Axis.Direction)));
        var displacement = new DimensionVector(actual.Axis.Origin.Xmm - expected.Axis.Origin.Xmm,
            actual.Axis.Origin.Ymm - expected.Axis.Origin.Ymm, actual.Axis.Origin.Zmm - expected.Axis.Origin.Zmm);
        var offset = Length(Cross(displacement, requestedDirection));
        if (!double.IsFinite(directionError) || directionError > DirectionCrossTolerance || !double.IsFinite(offset) || offset > AxisToleranceMm)
            throw Invalid("Created dimension supporting line differs from the requested axis; roll back.");
    }

    public static object Receipt(DimensionCreationReadback expected, DimensionCreationReadback actual, string phase)
    {
        Require(expected, actual);
        return new { phase, dimensionId = actual.DimensionId, actual.UniqueId, className = actual.ClassName,
            viewId = actual.ViewId, typeId = actual.TypeId, actual.AreReferencesAvailable,
            actualReferences = actual.References, referenceCount = actual.References.Count,
            referenceMembershipVerified = true, referenceOrderMatches = expected.References.SequenceEqual(actual.References), referenceOrderRequired = false,
            requestedAxis = expected.Axis, actualAxis = actual.Axis, actual.IsBound,
            axisToleranceMm = AxisToleranceMm, supportingLineVerified = true, lineExtentsVerified = false,
            measurementVerified = false, nativeReadbackVerified = true, sideEffectsVerified = false, persistenceVerified = false, visualVerified = false };
    }
}
