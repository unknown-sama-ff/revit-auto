using System.Text.Json;

namespace RevitAutoV27;

internal sealed record OpeningHostVector(double X, double Y, double Z);
internal sealed record OpeningHostPlane(OpeningPoint OriginMm, OpeningHostVector Normal);
internal sealed record OpeningHostEdge(OpeningPoint Start, OpeningPoint End);
internal sealed record OpeningHostLoop(bool IsOuter, bool AllBoundLines, int NativeCurveCount, OpeningHostEdge[] Edges, bool Complete = true);
internal sealed record OpeningHostFace(string StableReference, OpeningHostPlane Plane, OpeningHostLoop[] Loops, bool? InputSamplesInside, bool Complete = true);
internal sealed record OpeningHostSurfaceBinding(long HostId, string ReviewedOperationJson, OpeningPoint[] ReviewedVertices,
    double ToleranceMm, OpeningHostPlane Plane, string SourceFaceReference);
internal sealed record OpeningHostSurfaceMatch(string SurfaceReference, OpeningHostPlane Plane, OpeningHostEdge[] CutBoundary,
    string BoundarySource = "native-host-input-top-face-inner-loop", bool PreExistingMatchingBoundaryAbsent = true);

internal static class OpeningHostSurfaceRules
{
    internal const int MaxFacesAndLoops = 256;
    internal const int MaxCurves = 8192;
    private static BridgeException Invalid(string message) => new("invalid_opening", message);
    private static bool Finite(OpeningPoint p) => double.IsFinite(p.X) && double.IsFinite(p.Y) && double.IsFinite(p.Z);
    private static void RequirePlane(OpeningHostPlane plane)
    {
        var n = plane.Normal;
        if (!Finite(plane.OriginMm) || !double.IsFinite(n.X) || !double.IsFinite(n.Y) || !double.IsFinite(n.Z) ||
            Math.Abs(n.X * n.X + n.Y * n.Y + n.Z * n.Z - 1) > 1e-8)
            throw Invalid("Native host plane must have finite coordinates and a known unit normal.");
    }
    private static double Distance(OpeningHostPlane plane, OpeningPoint p) => Math.Abs(
        (p.X - plane.OriginMm.X) * plane.Normal.X + (p.Y - plane.OriginMm.Y) * plane.Normal.Y + (p.Z - plane.OriginMm.Z) * plane.Normal.Z);
    internal static bool Contains(OpeningHostPlane plane, OpeningPoint[] points, double toleranceMm)
    {
        RequirePlane(plane);
        return points.All(p => Finite(p) && Distance(plane, p) <= toleranceMm);
    }
    internal static bool SamePlane(OpeningHostPlane before, OpeningHostPlane after, double toleranceMm)
    {
        RequirePlane(before); RequirePlane(after);
        var dot = before.Normal.X * after.Normal.X + before.Normal.Y * after.Normal.Y + before.Normal.Z * after.Normal.Z;
        return dot >= 1 - 1e-8 && Distance(before, after.OriginMm) <= toleranceMm && Distance(after, before.OriginMm) <= toleranceMm;
    }
    private static void RequireComplete(OpeningHostFace[] faces)
    {
        if (faces.Length > MaxFacesAndLoops || faces.Sum(f => (long)f.Loops.Length) + faces.Length > MaxFacesAndLoops ||
            faces.SelectMany(f => f.Loops).Sum(l => (long)l.NativeCurveCount) > MaxCurves)
            throw Invalid("Native host surface evidence exceeds its complete face/loop/curve budget.");
        foreach (var face in faces)
        {
            RequirePlane(face.Plane);
            if (!face.Complete || string.IsNullOrWhiteSpace(face.StableReference) || face.Loops.Length == 0 || face.Loops.Count(l => l.IsOuter) != 1)
                throw Invalid("Native host face/outer-loop classification is missing, incomplete or ambiguous.");
            foreach (var loop in face.Loops)
            {
                if (!loop.Complete || loop.NativeCurveCount <= 0 || loop.Edges.Length > loop.NativeCurveCount ||
                    loop.AllBoundLines && loop.Edges.Length != loop.NativeCurveCount ||
                    loop.Edges.Any(e => !Finite(e.Start) || !Finite(e.End)))
                    throw Invalid("Native host cut-loop geometry is incomplete, inconsistent or nonfinite.");
            }
        }
    }
    private static bool Matches(OpeningPoint[] reviewed, OpeningHostLoop loop, double toleranceMm) =>
        !loop.IsOuter && loop.AllBoundLines && OpeningRules.EdgesMatch(reviewed, loop.Edges.Select(e => (e.Start, e.End)).ToArray(), toleranceMm);
    internal static OpeningHostSurfaceBinding Capture(JsonElement operation, OpeningHostFace[] faces)
    {
        OpeningRules.Validate(operation);
        if (JsonDefaults.String(operation, "openingKind") != "floor_profile") throw Invalid("Only floor_profile uses host-surface cut readback.");
        RequireComplete(faces);
        var points = JsonDefaults.Array(operation, "boundary").Select(OpeningRules.Point).ToArray();
        var tolerance = PlanRules.Number(operation, "hostToleranceMm");
        var admitted = faces.Where(f => f.InputSamplesInside == true && Contains(f.Plane, points, tolerance)).ToArray();
        if (admitted.Length != 1) throw Invalid("Reviewed input must identify one complete native host top surface before creation.");
        var face = admitted[0];
        if (face.Loops.Any(l => Matches(points, l, tolerance))) throw Invalid("The reviewed host cut boundary already exists before creation; cannot certify a new cut.");
        return new(JsonDefaults.Int64(operation, "hostElementId")!.Value, operation.GetRawText(), points.ToArray(), tolerance, face.Plane, face.StableReference);
    }
    internal static OpeningHostSurfaceMatch Verify(OpeningHostSurfaceBinding binding, JsonElement originalOperation, OpeningHostFace[] faces)
    {
        OpeningRules.Validate(originalOperation);
        if (binding.ReviewedOperationJson != originalOperation.GetRawText() || binding.HostId != JsonDefaults.Int64(originalOperation, "hostElementId") ||
            binding.ToleranceMm != PlanRules.Number(originalOperation, "hostToleranceMm") ||
            !binding.ReviewedVertices.SequenceEqual(JsonDefaults.Array(originalOperation, "boundary").Select(OpeningRules.Point)))
            throw Invalid("Original host surface/operation binding changed; do not reset expectations from postwrite geometry.");
        RequireComplete(faces);
        RequirePlane(binding.Plane);
        var matches = faces.Where(f => SamePlane(binding.Plane, f.Plane, binding.ToleranceMm) && Contains(f.Plane, binding.ReviewedVertices, binding.ToleranceMm))
            .SelectMany(f => f.Loops.Where(l => Matches(binding.ReviewedVertices, l, binding.ToleranceMm)).Select(l => (Face: f, Loop: l))).ToArray();
        if (matches.Length != 1) throw new BridgeException("invalid_opening", "Actual host input-surface cut boundary must match uniquely in full XYZ; missing, moved or ambiguous inner loops require rollback.",
            new { boundarySource="native-host-input-top-face-inner-loop", reviewedPlane=binding.Plane,
                reviewedVertices=binding.ReviewedVertices, actualHostFaces=faces, matchingInnerLoopCount=matches.Length, coordinatesNormalized=false });
        var matched = matches[0];
        return new(matched.Face.StableReference, matched.Face.Plane, matched.Loop.Edges.ToArray());
    }
}
