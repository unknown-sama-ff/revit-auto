using System.Text.Json;
using Autodesk.Revit.DB;

namespace RevitAutoV27;

internal static class OpeningHostSurfaceReadbackService
{
    private static BridgeException Invalid(string message) => new("invalid_opening", message);
    private static OpeningPoint Point(XYZ p) => new(JsonDefaults.InternalToMm(p.X), JsonDefaults.InternalToMm(p.Y), JsonDefaults.InternalToMm(p.Z));
    private static OpeningHostPlane Plane(PlanarFace face) => new(Point(face.Origin), new(face.FaceNormal.X, face.FaceNormal.Y, face.FaceNormal.Z));
    private static OpeningHostFace[] Read(Document doc, Element host, JsonElement operation, OpeningHostSurfaceBinding? binding)
    {
        try { return ReadCore(doc, host, operation, binding); }
        catch (BridgeException) { throw; }
        catch (Exception error)
        {
            var message = error.GetType().Name + ": " + error.Message;
            throw Invalid("Native host-surface evidence is unavailable: " + (message.Length <= 512 ? message : message[..512] + " [truncated]"));
        }
    }
    private static OpeningHostFace[] ReadCore(Document doc, Element host, JsonElement operation, OpeningHostSurfaceBinding? binding)
    {
        if (!host.IsValidObject || !host.Document.Equals(doc) || host is not HostObject shell || host is not (Floor or Ceiling or RoofBase))
            throw Invalid("Host-surface readback requires the same valid native floor/ceiling/roof document and host.");
        var refs = HostObjectUtils.GetTopFaces(shell);
        if (refs.Count > OpeningHostSurfaceRules.MaxFacesAndLoops) throw Invalid("Native host top-face inventory exceeds its evidence budget.");
        var vertices = JsonDefaults.Array(operation, "boundary").Select(p => new XYZ(
            UnitUtils.ConvertToInternalUnits(OpeningRules.Point(p).X, UnitTypeId.Millimeters),
            UnitUtils.ConvertToInternalUnits(OpeningRules.Point(p).Y, UnitTypeId.Millimeters),
            UnitUtils.ConvertToInternalUnits(OpeningRules.Point(p).Z, UnitTypeId.Millimeters))).ToArray();
        var reviewed = vertices.Select(Point).ToArray();
        var toleranceMm = PlanRules.Number(operation, "hostToleranceMm");
        var tolerance = UnitUtils.ConvertToInternalUnits(toleranceMm, UnitTypeId.Millimeters);
        var samples = vertices.Concat(vertices.Select((p, i) => (p + vertices[(i + 1) % vertices.Length]) * .5)).ToArray();
        var faces = new List<OpeningHostFace>(); var loopCount = 0; var curveCount = 0;
        var watch = System.Diagnostics.Stopwatch.StartNew();
        void Check() { if (watch.Elapsed > TimeSpan.FromSeconds(20)) throw Invalid("Native host-surface readback exceeded its bounded read budget."); }
        foreach (var reference in refs)
        {
            Check();
            using var face = host.GetGeometryObjectFromReference(reference) as PlanarFace;
            if (face is null) continue;
            var plane = Plane(face);
            if (!OpeningHostSurfaceRules.Contains(plane, reviewed, toleranceMm) ||
                binding is not null && !OpeningHostSurfaceRules.SamePlane(binding.Plane, plane, toleranceMm)) continue;
            bool? admitted = null;
            if (binding is null)
            {
                admitted = samples.All(p => { var projection = face.Project(p); return projection is not null && projection.Distance <= tolerance && face.IsInside(projection.UVPoint); });
                if (admitted != true) continue;
            }
            var nativeLoops = face.GetEdgesAsCurveLoops();
            if (refs.Count + loopCount + nativeLoops.Count > OpeningHostSurfaceRules.MaxFacesAndLoops)
                throw Invalid("Native host face/loop inventory exceeds its complete evidence budget.");
            var loops = new List<OpeningHostLoop>();
            foreach (var loop in nativeLoops)
            {
                using (loop)
                {
                    Check(); loopCount++;
                    if (loop.IsOpen()) throw Invalid("Native host boundary loop is not known closed.");
                    var curves = loop.ToArray(); curveCount += curves.Length;
                    if (curveCount > OpeningHostSurfaceRules.MaxCurves) throw Invalid("Native host curve inventory exceeds its complete evidence budget.");
                    var allLines = curves.All(c => c is Line && c.IsBound);
                    var edges = curves.OfType<Line>().Where(c => c.IsBound).Select(c => new OpeningHostEdge(Point(c.GetEndPoint(0)), Point(c.GetEndPoint(1)))).ToArray();
                    // Native face loop orientation is relative to FaceNormal: the
                    // material outer boundary is CCW, hole boundaries are CW.
                    var outer = loop.IsCounterclockwise(face.FaceNormal);
                    loops.Add(new(outer, allLines, curves.Length, edges));
                }
            }
            faces.Add(new(reference.ConvertToStableRepresentation(doc), plane, loops.ToArray(), admitted));
        }
        Check(); return faces.ToArray();
    }
    internal static OpeningHostSurfaceBinding? CaptureBeforeCreation(Document doc, JsonElement operation)
    {
        if (JsonDefaults.String(operation, "openingKind") != "floor_profile") return null;
        OpeningService.Validate(doc, operation);
        var host = doc.GetElement(new ElementId(JsonDefaults.Int64(operation, "hostElementId")!.Value)) ?? throw Invalid("Reviewed opening host is missing.");
        return OpeningHostSurfaceRules.Capture(operation, Read(doc, host, operation, null));
    }
    internal static JsonElement Verify(Document doc, Opening opening, JsonElement operation, OpeningHostSurfaceBinding binding)
    {
        if (!opening.IsValidObject || !opening.Document.Equals(doc) || opening.Host is not { } host || host.Id.Value != binding.HostId)
            throw Invalid("Host-surface cut evidence belongs to another native document or host.");
        var match = OpeningHostSurfaceRules.Verify(binding, operation, Read(doc, host, operation, binding));
        return NativeReadSnapshot.Freeze(new
        {
            boundarySource = match.BoundarySource, hostId = binding.HostId,
            reviewedInputPlane = binding.Plane, prewriteSurfaceReference = binding.SourceFaceReference,
            actualSurfaceReference = match.SurfaceReference, actualHostCutBoundary = match.CutBoundary,
            preExistingMatchingBoundaryAbsent = match.PreExistingMatchingBoundaryAbsent,
            coordinateUnits = "Revit internal/project-origin millimeters; native plane normal is dimensionless; no output projection or Z translation",
            fullXYZBoundaryVerified = true, reviewedToleranceMm = binding.ToleranceMm,
            exactCutImpactVerified = false, cutDirectionIndependentlyVerified = false,
            sideEffectsVerified = false, persistenceVerified = false, visualVerified = false, engineeringComplianceVerified = false
        });
    }
}
