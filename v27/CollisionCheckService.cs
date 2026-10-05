using System.Diagnostics;
using System.Text.Json;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace RevitAutoV27;

// In-memory geometry only. The service never opens a transaction, changes the view, or saves.
internal static class CollisionCheckService
{
    private static readonly Dictionary<string, BuiltInCategory> NativeCategories = new(StringComparer.Ordinal)
    {
        ["OST_MechanicalEquipment"] = BuiltInCategory.OST_MechanicalEquipment,
        ["OST_PipeCurves"] = BuiltInCategory.OST_PipeCurves,
        ["OST_PipeFitting"] = BuiltInCategory.OST_PipeFitting,
        ["OST_DuctCurves"] = BuiltInCategory.OST_DuctCurves,
        ["OST_DuctFitting"] = BuiltInCategory.OST_DuctFitting,
        ["OST_Walls"] = BuiltInCategory.OST_Walls,
        ["OST_Floors"] = BuiltInCategory.OST_Floors,
        ["OST_StructuralColumns"] = BuiltInCategory.OST_StructuralColumns,
        ["OST_StructuralFraming"] = BuiltInCategory.OST_StructuralFraming,
        ["OST_StructuralFoundation"] = BuiltInCategory.OST_StructuralFoundation,
        ["OST_Columns"] = BuiltInCategory.OST_Columns,
        ["OST_Ceilings"] = BuiltInCategory.OST_Ceilings,
        ["OST_Roofs"] = BuiltInCategory.OST_Roofs
    };
    private const int MaxInventoryElements = 20000;
    private const int MaxUnknownBounds = 100;
    private const int MaxGeometryObjects = 4096;
    private const int MaxTargetCandidatePairs = 5000;
    private sealed record NativeSolid(Solid Solid, CollisionBounds Bounds);
    private sealed class GeometrySnapshot : IDisposable
    {
        public List<NativeSolid> Solids { get; } = [];
        public bool Complete => Error is null && Solids.Count > 0;
        public string? Error { get; set; }
        public int ObjectCount { get; set; }
        public void Dispose() { foreach (var solid in Solids) solid.Solid.Dispose(); }
    }
    private sealed record Pair(Element Target, Element Candidate);

    public static object Check(UIApplication app, JsonElement parameters, CancellationToken cancellation)
    {
        var input = CollisionCheckRules.Parse(parameters);
        var doc = app.ActiveUIDocument?.Document ?? throw new BridgeException("no_active_document", "Open a project first.");
        var identity = RevitCommandRouter.Identity(doc);
        var revision = RevitCommandRouter.Revision(doc);
        if (identity != input.DocumentIdentity) throw new BridgeException("document_changed", "Read the active document before collision inspection.");
        if (input.ExpectedRevision is long expected && expected != revision) throw new BridgeException("document_revision_changed", "The project changed before collision inspection.");
        if (doc.IsFamilyDocument) throw new BridgeException("project_required", "Collision inspection requires a project document.");
        var wasModified = doc.IsModified;
        var viewId = app.ActiveUIDocument.ActiveView.Id;
        var selection = app.ActiveUIDocument.Selection.GetElementIds().Select(id => id.Value).Order().ToArray();
        var targets = input.TargetElementIds.Select(id => ModelElement(doc, id)).ToArray();
        foreach (var id in input.ExcludeElementIds) ModelElement(doc, id);
        var excluded = input.TargetElementIds.Concat(input.ExcludeElementIds).ToHashSet();
        var clock = Stopwatch.StartNew();
        var unknown = new List<object>();
        var collisions = new List<object>();
        var clearanceCandidates = new List<object>();
        var boxes = new Dictionary<long, CollisionBounds>();
        var snapshots = new Dictionary<long, GeometrySnapshot>();
        var categories = input.CandidateCategories.Select(name => NativeCategories[name]).ToArray();
        using var categoryFilter = new ElementMulticategoryFilter(categories);
        var missingBoundsCount = 0;
        var inventoryCount = 0;
        var inventoryTruncated = false;
        var inventorySeen = new HashSet<long>();
        var nearby = new Dictionary<long, Element>();
        var pairs = new List<Pair>();
        try
        {
            foreach (var target in targets)
            {
                CheckBudget(clock, cancellation);
                var bounds = ReadBounds(target);
                if (bounds is null) unknown.Add(Unknown(target.Id.Value, null, "target", "bounding-box-unavailable"));
                else boxes[target.Id.Value] = bounds;
                var snapshot = ReadGeometry(target, clock, cancellation);
                snapshots[target.Id.Value] = snapshot;
                if (!snapshot.Complete) unknown.Add(Unknown(target.Id.Value, null, "target", snapshot.Error ?? "no-solid-geometry"));
            }
            // Bounds-only inventory: locate unsupported envelopes instead of silently claiming completeness.
            // No geometry is read for spatially distant elements. Cap and disclose this broad-stage work.
            using (var inventory = new FilteredElementCollector(doc).WherePasses(categoryFilter).WhereElementIsNotElementType())
            {
                foreach (var element in inventory)
                {
                    CheckBudget(clock, cancellation);
                    if (excluded.Contains(element.Id.Value) || element.ViewSpecific) continue;
                    if (++inventoryCount > MaxInventoryElements) { inventoryTruncated = true; break; }
                    inventorySeen.Add(element.Id.Value);
                    var bounds = ReadBounds(element);
                    if (bounds is null)
                    {
                        missingBoundsCount++;
                        if (missingBoundsCount <= MaxUnknownBounds)
                            unknown.Add(Unknown(null, element.Id.Value, "candidate", "bounding-box-unavailable; proximity-unknown"));
                    }
                    else boxes[element.Id.Value] = bounds;
                }
            }
            foreach (var target in targets)
            {
                CheckBudget(clock, cancellation);
                if (!boxes.TryGetValue(target.Id.Value, out var targetBox)) continue;
                var expand = input.ClearanceMm + input.ToleranceMm;
                using var outline = new Outline(ToXyz(targetBox.MinX - expand, targetBox.MinY - expand, targetBox.MinZ - expand),
                    ToXyz(targetBox.MaxX + expand, targetBox.MaxY + expand, targetBox.MaxZ + expand));
                using var boundsFilter = new BoundingBoxIntersectsFilter(outline);
                using var collector = new FilteredElementCollector(doc).WherePasses(categoryFilter).WherePasses(boundsFilter).WhereElementIsNotElementType();
                foreach (var candidate in collector)
                {
                    CheckBudget(clock, cancellation);
                    if (excluded.Contains(candidate.Id.Value) || candidate.ViewSpecific) continue;
                    if (!boxes.TryGetValue(candidate.Id.Value, out var candidateBox))
                    {
                        // Unvisited entries beyond the inventory cap are not silently scanned or cleared.
                        if (!inventorySeen.Contains(candidate.Id.Value)) inventoryTruncated = true;
                        continue;
                    }
                    if (!targetBox.Intersects(candidateBox, expand)) continue;
                    nearby[candidate.Id.Value] = candidate;
                    pairs.Add(new(target, candidate));
                }
            }
            var selectedCandidates = nearby.Keys.Order().Take(input.MaxCandidates).ToHashSet();
            var selectedPairs = pairs.Where(pair => selectedCandidates.Contains(pair.Candidate.Id.Value))
                .OrderBy(pair => pair.Target.Id.Value).ThenBy(pair => pair.Candidate.Id.Value).ToArray();
            var pairTruncated = selectedPairs.Length > MaxTargetCandidatePairs;
            var pairsToScan = selectedPairs.Take(MaxTargetCandidatePairs).ToArray();
            var workTruncated = false;
            var solidPairCount = 0;
            var scannedPairCount = 0;
            var clearedPairCount = 0;
            foreach (var pair in pairsToScan)
            {
                CheckBudget(clock, cancellation);
                if (!snapshots.TryGetValue(pair.Candidate.Id.Value, out var candidateGeometry))
                {
                    candidateGeometry = ReadGeometry(pair.Candidate, clock, cancellation);
                    snapshots[pair.Candidate.Id.Value] = candidateGeometry;
                }
                var targetGeometry = snapshots[pair.Target.Id.Value];
                scannedPairCount++;
                if (!targetGeometry.Complete || !candidateGeometry.Complete)
                {
                    unknown.Add(Unknown(pair.Target.Id.Value, pair.Candidate.Id.Value, "pair",
                        targetGeometry.Error ?? candidateGeometry.Error ?? "no-solid-geometry"));
                    continue;
                }
                var maxVolume = 0d;
                XYZ? collisionPoint = null;
                var booleanComplete = true;
                string? booleanError = null;
                foreach (var first in targetGeometry.Solids)
                {
                    foreach (var second in candidateGeometry.Solids)
                    {
                        CheckBudget(clock, cancellation);
                        if (!first.Bounds.Intersects(second.Bounds)) continue;
                        if (++solidPairCount > CollisionCheckRules.MaxSolidPairs)
                        {
                            booleanComplete = false; booleanError = "solid-pair-limit"; workTruncated = true; break;
                        }
                        try
                        {
                            using var intersection = BooleanOperationsUtils.ExecuteBooleanOperation(first.Solid, second.Solid, BooleanOperationsType.Intersect);
                            if (intersection is null) throw new InvalidOperationException("No intersection geometry returned.");
                            var volume = intersection.Volume * Math.Pow(304.8, 3);
                            if (!double.IsFinite(volume) || volume < 0) throw new InvalidOperationException("Nonfinite or negative intersection volume.");
                            if (volume > maxVolume)
                            {
                                maxVolume = volume;
                                try { var point = intersection.ComputeCentroid(); if (Finite(point)) collisionPoint = point; } catch { }
                            }
                        }
                        catch (Exception error) when (error is not OperationCanceledException)
                        {
                            booleanComplete = false; booleanError = "boolean-intersection-unavailable:" + error.GetType().Name; break;
                        }
                    }
                    if (!booleanComplete) break;
                }
                var state = CollisionCheckRules.Classify(true, booleanComplete, maxVolume, input.ToleranceMm, input.ClearanceMm);
                var pairInfo = new { target = Describe(pair.Target), candidate = Describe(pair.Candidate) };
                switch (state)
                {
                    case CollisionPairState.Collision:
                        collisions.Add(new { targetElementId = pair.Target.Id.Value, candidateElementId = pair.Candidate.Id.Value,
                            evidence = "exact-solid-intersection", intersectionVolumeMm3 = maxVolume,
                            intersectionVolumeAggregation = "maximum-solid-pair-not-union", minimumVolumeMm3 = CollisionCheckRules.VolumeThreshold(input.ToleranceMm),
                            point = collisionPoint is null ? null : Point(collisionPoint), pointEvidence = "approximate-intersection-centroid",
                            targetGeometryStatus = "complete", candidateGeometryStatus = "complete", elements = pairInfo });
                        break;
                    case CollisionPairState.ClearanceCandidate:
                        clearanceCandidates.Add(new { targetElementId = pair.Target.Id.Value, candidateElementId = pair.Candidate.Id.Value,
                            evidence = "expanded-bounding-box-candidate", clearanceMm = input.ClearanceMm,
                            elements = pairInfo, note = "保守包围盒候选，不是精确净距或工程合规证明。" });
                        break;
                    case CollisionPairState.Unknown:
                        unknown.Add(Unknown(pair.Target.Id.Value, pair.Candidate.Id.Value, "pair", booleanError ?? "intersection-unknown"));
                        break;
                    default: clearedPairCount++; break;
                }
                if (workTruncated) break;
            }
            var truncated = inventoryTruncated || missingBoundsCount > MaxUnknownBounds || nearby.Count > selectedCandidates.Count || pairTruncated || workTruncated;
            if (RevitCommandRouter.Identity(doc) != identity || RevitCommandRouter.Revision(doc) != revision
                || app.ActiveUIDocument?.Document is not { } current || !current.Equals(doc))
                throw new BridgeException("document_revision_changed", "Document changed during inspection; discard this report.");
            if (doc.IsModified != wasModified || app.ActiveUIDocument.ActiveView.Id != viewId
                || !selection.SequenceEqual(app.ActiveUIDocument.Selection.GetElementIds().Select(id => id.Value).Order()))
                throw new BridgeException("collision_state_changed", "Read-only inspection state changed; discard this report.");
            return new { documentIdentity = identity, documentRevision = revision,
                scope = new { targetElementIds = input.TargetElementIds, excludeElementIds = input.ExcludeElementIds,
                    candidateCategories = input.CandidateCategories, clearanceMm = input.ClearanceMm, toleranceMm = input.ToleranceMm,
                    maxCandidates = input.MaxCandidates, targetGroupExcludedFromExternalCandidates = true,
                    includesLinkedModels = false, includesInsulationOrFabricationParts = false, truncated },
                collisions, clearanceCandidates, unknown,
                diagnostics = new { candidateCount = nearby.Count, scannedCandidateCount = snapshots.Keys.Count(id => !input.TargetElementIds.Contains(id)),
                    candidatePairCount = pairs.Count, scannedPairCount, geometryReadCount = snapshots.Count, solidPairCount,
                    exactIntersectionCount = collisions.Count, clearanceCandidateCount = clearanceCandidates.Count,
                    noIntersectionAboveTolerancePairCount = clearedPairCount, unknownCount = unknown.Count,
                    missingBoundsCount, inventoryCount = Math.Min(inventoryCount, MaxInventoryElements), inventoryTruncated,
                    pairTruncated, workTruncated, truncated, complete = !truncated && unknown.Count == 0 },
                note = "结果仅适用于指定本机模型范围和体积阈值，不检查目标组内元素，不证明精确净距、水力计算或工程合规。" };
        }
        finally { foreach (var snapshot in snapshots.Values) snapshot.Dispose(); }
    }
    private static Element ModelElement(Document doc, long id)
    {
        var element = doc.GetElement(new ElementId(id)) ?? throw new BridgeException("element_not_found", $"Element {id} is missing in the current project.");
        if (element is ElementType || element.ViewSpecific) throw new BridgeException("invalid_collision_request", "Collision scope requires model instances, not types or view-specific elements.");
        return element;
    }
    private static CollisionBounds? ReadBounds(Element element)
    {
        try { using var box = element.get_BoundingBox(null); return box is null ? null : Box(box); }
        catch { return null; }
    }
    private static CollisionBounds? Box(BoundingBoxXYZ box)
    {
        if (!box.Enabled || !Finite(box.Min) || !Finite(box.Max)) return null;
        var corners = new List<XYZ>();
        foreach (var x in new[] { box.Min.X, box.Max.X })
            foreach (var y in new[] { box.Min.Y, box.Max.Y })
                foreach (var z in new[] { box.Min.Z, box.Max.Z }) corners.Add(box.Transform.OfPoint(new XYZ(x, y, z)));
        if (corners.Any(p => !Finite(p))) return null;
        var bounds = new CollisionBounds(corners.Min(p => p.X) * 304.8, corners.Min(p => p.Y) * 304.8, corners.Min(p => p.Z) * 304.8,
            corners.Max(p => p.X) * 304.8, corners.Max(p => p.Y) * 304.8, corners.Max(p => p.Z) * 304.8);
        return bounds.Valid ? bounds : null;
    }
    private static GeometrySnapshot ReadGeometry(Element element, Stopwatch clock, CancellationToken cancellation)
    {
        var result = new GeometrySnapshot();
        try
        {
            using var options = new Options { DetailLevel = ViewDetailLevel.Fine, ComputeReferences = false, IncludeNonVisibleObjects = false };
            using var geometry = element.get_Geometry(options);
            if (geometry is null) result.Error = "geometry-unavailable";
            else Collect(geometry, Transform.Identity, result, 0, clock, cancellation);
            if (result.Solids.Count == 0) result.Error ??= "no-solid-geometry";
            return result;
        }
        catch (OperationCanceledException) { result.Dispose(); throw; }
        catch (BridgeException) { result.Dispose(); throw; }
        catch (Exception error) { result.Error = "geometry-read-failed:" + error.GetType().Name; return result; }
    }
    private static void Collect(GeometryElement geometry, Transform transform, GeometrySnapshot result, int depth, Stopwatch clock, CancellationToken cancellation)
    {
        if (depth > CollisionCheckRules.MaxGeometryDepth) { result.Error = "geometry-depth-limit"; return; }
        foreach (var item in geometry)
        {
            CheckBudget(clock, cancellation);
            if (++result.ObjectCount > MaxGeometryObjects) { result.Error = "geometry-object-limit"; return; }
            switch (item)
            {
                case Solid original:
                    var volume = original.Volume;
                    if (!double.IsFinite(volume) || volume < 0) { result.Error = "nonfinite-or-invalid-solid"; return; }
                    if (original.Faces.Size == 0 && volume == 0) break;
                    if (original.Faces.Size == 0 || volume == 0) { result.Error = "degenerate-solid-geometry"; return; }
                    if (result.Solids.Count >= CollisionCheckRules.MaxSolidsPerElement) { result.Error = "solid-count-limit"; return; }
                    var copy = SolidUtils.CreateTransformed(original, transform);
                    try
                    {
                        var copiedVolume = copy.Volume;
                        if (!double.IsFinite(copiedVolume) || copiedVolume <= 0) { result.Error = "invalid-transformed-solid"; return; }
                        using var box = copy.GetBoundingBox();
                        var bounds = Box(box);
                        if (bounds is null) { result.Error = "solid-bounds-unavailable"; return; }
                        result.Solids.Add(new(copy, bounds));
                        copy = null!; // The snapshot now owns this copied in-memory geometry.
                    }
                    finally { copy?.Dispose(); }
                    break;
                case GeometryInstance instance:
                    using (var symbolGeometry = instance.GetSymbolGeometry())
                    using (var combined = transform.Multiply(instance.Transform))
                    {
                        if (symbolGeometry is null) { result.Error = "instance-geometry-unavailable"; return; }
                        Collect(symbolGeometry, combined, result, depth + 1, clock, cancellation);
                    }
                    break;
                case GeometryElement nested:
                    Collect(nested, transform, result, depth + 1, clock, cancellation); break;
                case Mesh mesh when mesh.NumTriangles > 0:
                    result.Error = "mesh-geometry-not-certified-as-solid"; return;
            }
            if (result.Error is not null) return;
        }
    }
    private static bool Finite(XYZ point) => double.IsFinite(point.X) && double.IsFinite(point.Y) && double.IsFinite(point.Z);
    private static XYZ ToXyz(double xMm, double yMm, double zMm) => new(xMm / 304.8, yMm / 304.8, zMm / 304.8);
    private static object Point(XYZ point) => new { xMm = point.X * 304.8, yMm = point.Y * 304.8, zMm = point.Z * 304.8 };
    private static object Describe(Element element) => new { id = element.Id.Value, category = element.Category?.Name,
        categoryId = element.Category?.Id.Value, className = element.GetType().Name };
    private static object Unknown(long? target, long? candidate, string role, string reason)
        => new { targetElementId = target, candidateElementId = candidate, role, reason };
    private static void CheckBudget(Stopwatch clock, CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (clock.Elapsed.TotalSeconds > CollisionCheckRules.MaxAnalysisSeconds)
            throw new BridgeException("collision_analysis_timeout", "Inspection exceeded the read-only time budget; narrow the scope. No clearance conclusion is available.");
    }
}
