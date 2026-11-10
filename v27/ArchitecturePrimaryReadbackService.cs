using System.Text.Json;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;

namespace RevitAutoV27;

// Readback only: the existing executor and router own creation and transactions.
internal sealed class ArchitecturePrimaryReadbackService
{
    private sealed record Binding(long ElementId, JsonElement Reviewed, JsonElement Resolved, ArchitectureHostedReadback? Hosted);
    private readonly List<Binding> completed = [];
    private Document? capturedDocument;
    private static BridgeException Invalid(string message) => new("invalid_operation", message);
    internal static bool IsHostedArchitecture(FamilySymbol symbol) => symbol.Category?.Id.Value is
        (long)BuiltInCategory.OST_Doors or (long)BuiltInCategory.OST_Windows;

    // Wall.Create uses the explicit base level and offset for vertical placement.
    // Floor.Create projects the supplied profile onto its level with zero offset.
    // Keep the original operation separately, and disclose this resolved geometry.
    internal static JsonElement Resolve(JsonElement operation, long typeId, Level level, CurveLoop? floorLoop = null)
    {
        var fields = operation.EnumerateObject().ToDictionary(p => p.Name, p => p.Value.Clone(), StringComparer.Ordinal);
        var wall = JsonDefaults.String(operation, "operationType") == "create_wall";
        fields[wall ? "wallTypeId" : "floorTypeId"] = JsonSerializer.SerializeToElement(typeId);
        fields["levelId"] = JsonSerializer.SerializeToElement(level.Id.Value);
        var zMm = JsonDefaults.InternalToMm(level.ProjectElevation) + (wall ? JsonDefaults.Double(operation, "offsetMm") ?? 0 : 0);
        if (!double.IsFinite(zMm)) throw Invalid("Resolved architecture level elevation is non-finite.");
        object Project(JsonElement point) => new { xMm = PlanRules.Number(point,"xMm"), yMm = PlanRules.Number(point,"yMm"), zMm };
        if (wall)
        {
            fields["start"] = JsonSerializer.SerializeToElement(Project(JsonDefaults.Get(operation,"start")));
            fields["end"] = JsonSerializer.SerializeToElement(Project(JsonDefaults.Get(operation,"end")));
        }
        else
        {
            if (floorLoop is null) throw Invalid("The reviewed floor loop is unavailable.");
            fields["boundary"] = JsonSerializer.SerializeToElement(floorLoop.Select(curve =>
            {
                var point = curve.GetEndPoint(0);
                return new { xMm = JsonDefaults.InternalToMm(point.X), yMm = JsonDefaults.InternalToMm(point.Y), zMm };
            }).ToArray());
        }
        return JsonSerializer.SerializeToElement(fields, JsonDefaults.Options);
    }

    internal OperationReceipt Remember(Document doc, Element element, JsonElement reviewed, JsonElement resolved, ArchitectureHostedReadback? hosted = null)
    {
        if (capturedDocument is null) capturedDocument = doc;
        else if (!capturedDocument.IsValidObject || !capturedDocument.Equals(doc)) throw Invalid("Architecture readback belongs to a different native document.");
        if (hosted is { } expected)
        {
            var fields = resolved.EnumerateObject().ToDictionary(p => p.Name, p => p.Value.Clone(), StringComparer.Ordinal);
            fields["symbolId"] = JsonSerializer.SerializeToElement(expected.TypeId);
            fields["hostElementId"] = JsonSerializer.SerializeToElement(expected.HostId);
            fields["levelId"] = JsonSerializer.SerializeToElement(expected.LevelId);
            resolved = JsonSerializer.SerializeToElement(fields, JsonDefaults.Options);
        }
        var binding = new Binding(element.Id.Value, reviewed.Clone(), resolved.Clone(), hosted);
        doc.Regenerate();
        var evidence = Verify(doc, binding);
        completed.Add(binding);
        return new([element.Id.Value], []) { Evidence = evidence };
    }

    internal object VerifyCompleted(Document doc, string phase)
    {
        if (capturedDocument is not null && (!capturedDocument.IsValidObject || !capturedDocument.Equals(doc)))
            throw Invalid("Architecture readback belongs to a different native document.");
        var elements = completed.Select(binding => Verify(doc, binding)).ToArray();
        return new { phase, verifiedElementCount = elements.Length, nativeReadbackVerified = true, elements,
            sideEffectsVerified = false, persistenceVerified = false, visualVerified = false, engineeringComplianceVerified = false };
    }

    private static object Verify(Document doc, Binding binding)
    {
        var element = doc.GetElement(new ElementId(binding.ElementId)) ?? throw Invalid("A reviewed architecture element disappeared before final verification.");
        var kind = JsonDefaults.String(binding.Reviewed,"operationType");
        object native;
        switch (kind)
        {
            case "create_wall" when element is Wall wall:
                if (ReadParameter(wall,BuiltInParameter.WALL_HEIGHT_TYPE,StorageType.ElementId).AsElementId() != ElementId.InvalidElementId)
                    throw Invalid("The reviewed wall must retain its unconnected top constraint.");
                var wallState = ReadWall(wall);
                ArchitecturePrimaryReadbackRules.RequireWall(binding.Resolved, wallState);
                native = wallState;
                break;
            case "create_floor" when element is Floor floor:
                var floorState = ReadFloor(floor);
                ArchitecturePrimaryReadbackRules.RequireFloor(binding.Resolved, floorState);
                native = floorState;
                break;
            case "create_family_instance" when element is FamilyInstance instance && binding.Hosted is { } expected:
                var actual = ReadHosted(instance);
                ArchitecturePrimaryReadbackRules.RequireHosted(expected, actual);
                native = actual;
                break;
            case "create_room" when element is Room room:
                var roomState = ReadRoom(room);
                RoomCreationReadbackRules.Require(binding.Resolved, roomState);
                native = roomState;
                break;
            default: throw Invalid("Native architecture element class differs from the reviewed operation.");
        }
        return new { elementId = binding.ElementId, operationType = kind, coordinateFrame = "Revit internal/project origin, millimeters",
            reviewedOperation = binding.Reviewed, resolvedOperation = binding.Resolved,
            expectedHosted = binding.Hosted,
            elevationPolicy = kind == "create_wall" ? "project-level-plus-base-offset" : kind == "create_floor" ? "native-profile-projected-to-project-level-zero-offset" : kind == "create_room" ? "native-level-and-UV; Z-derived-from-project-level" : "explicit-absolute-XYZ-and-relative-rotation",
            boundaryEvidenceScope = kind == "create_room" ? "finish-boundary-segment-samples-and-lengths" : null,
            native, nativeReadbackVerified = true, sideEffectsVerified = false, persistenceVerified = false, visualVerified = false, engineeringComplianceVerified = false };
    }

    internal static object? Snapshot(Element element)
    {
        if (element is not (Wall or Floor or Room) && (element is not FamilyInstance family || !IsHostedArchitecture(family.Symbol))) return null;
        try
        {
            object native = element switch { Wall wall => ReadWall(wall), Floor floor => ReadFloor(floor), Room room => ReadRoom(room), FamilyInstance instance => ReadHosted(instance), _ => throw Invalid("Unsupported architecture class.") };
            return NativeReadSnapshot.Freeze(new { supported = true, coordinateFrame = "Revit internal/project origin, millimeters", native,
                topConstraintId = element is Wall w ? (long?)ReadParameter(w,BuiltInParameter.WALL_HEIGHT_TYPE,StorageType.ElementId).AsElementId().Value : null,
                sketchId = element is Floor f ? (long?)f.SketchId.Value : null,
                boundaryEvidenceScope = element is Room ? "finish-boundary-segment-samples-and-lengths" : null, sideEffectsVerified = false });
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception error) { return new { supported = false, errorType = error.GetType().Name, error = error.Message, sideEffectsVerified = false }; }
    }

    private static ArchitectureWallReadback ReadWall(Wall wall)
    {
        if (wall.Location is not LocationCurve location || location.Curve is not Line line || !line.IsBound)
            throw Invalid("Native wall location is not a bounded straight line.");
        return new(wall.GetTypeId().Value, ReadParameter(wall,BuiltInParameter.WALL_BASE_CONSTRAINT,StorageType.ElementId).AsElementId().Value,
            ReadMm(wall,BuiltInParameter.WALL_USER_HEIGHT_PARAM), ReadMm(wall,BuiltInParameter.WALL_BASE_OFFSET), wall.Flipped,
            ReadFlag(wall,BuiltInParameter.WALL_STRUCTURAL_SIGNIFICANT), Edge(line));
    }
    private static ArchitectureFloorReadback ReadFloor(Floor floor)
    {
        var sketch = floor.Document.GetElement(floor.SketchId) as Sketch ?? throw Invalid("Native floor sketch is unavailable.");
        var profile = sketch.Profile;
        if (sketch.OwnerId != floor.Id || profile is null || profile.Size != 1)
            throw Invalid("Native floor sketch owner or single boundary loop is unsupported.");
        var curves = profile.get_Item(0).Cast<Curve>().ToArray();
        if (curves.Any(curve => curve is not Line || !curve.IsBound)) throw Invalid("Native floor boundary contains unsupported or unbounded curves.");
        return new(floor.GetTypeId().Value, floor.LevelId.Value, curves.Select(Edge).ToArray(), ReadMm(floor,BuiltInParameter.FLOOR_HEIGHTABOVELEVEL_PARAM), ReadFlag(floor,BuiltInParameter.FLOOR_PARAM_IS_STRUCTURAL));
    }
    private static ArchitectureHostedReadback ReadHosted(FamilyInstance instance)
    {
        if (instance.Location is not LocationPoint point || instance.Host is not Wall)
            throw Invalid("Native door/window wall host or point evidence is missing.");
        return new(instance.GetTypeId().Value, instance.Host.Id.Value, instance.LevelId.Value, instance.Category?.Id.Value ?? 0,
            new(JsonDefaults.InternalToMm(point.Point.X), JsonDefaults.InternalToMm(point.Point.Y), JsonDefaults.InternalToMm(point.Point.Z),point.Rotation));
    }

    private static RoomCreationReadback ReadRoom(Room room)
    {
        if (room.Location is not LocationPoint point) throw Invalid("Native room placement point is unavailable.");
        using var options = new SpatialElementBoundaryOptions { SpatialElementBoundaryLocation = SpatialElementBoundaryLocation.Finish };
        var loops = room.GetBoundarySegments(options);
        if (loops is null || loops.Count == 0 || loops.Any(loop => loop is null || loop.Count == 0) ||
            loops.Sum(loop => (long)loop.Count) > RoomCreationReadbackRules.MaxBoundarySegments)
            throw Invalid("Complete room boundaries are missing or exceed the bounded evidence budget.");
        RoomPointReadback Point(XYZ value) => new(JsonDefaults.InternalToMm(value.X), JsonDefaults.InternalToMm(value.Y), JsonDefaults.InternalToMm(value.Z));
        var boundaries = loops.Select(loop => loop.Select(segment =>
        {
            using var curve = segment.GetCurve() ?? throw Invalid("A native room boundary curve is unavailable.");
            if (!curve.IsBound) throw Invalid("An unbounded room boundary cannot provide finite readback evidence.");
            return new RoomBoundarySegmentReadback(curve.GetType().Name, Point(curve.GetEndPoint(0)), Point(curve.Evaluate(0.5, true)),
                Point(curve.GetEndPoint(1)), JsonDefaults.InternalToMm(curve.Length));
        }).ToArray()).ToArray();
        var actual = new RoomCreationReadback(room.LevelId.Value, ReadParameter(room, BuiltInParameter.ROOM_NAME, StorageType.String).AsString(),
            room.Number, Point(point.Point), JsonDefaults.SquareMeters(room.Area), boundaries);
        RoomCreationReadbackRules.RequireNative(actual);
        return actual;
    }

    private static Parameter ReadParameter(Element element, BuiltInParameter key, StorageType storage)
    {
        var parameter = element.get_Parameter(key);
        return parameter is not null && parameter.HasValue && parameter.StorageType == storage ? parameter :
            throw Invalid($"Native architecture {key} is missing, unknown or has the wrong storage type.");
    }
    private static double ReadMm(Element element, BuiltInParameter key)
    {
        var value = JsonDefaults.InternalToMm(ReadParameter(element,key,StorageType.Double).AsDouble());
        return double.IsFinite(value) ? value : throw Invalid($"Native architecture {key} is non-finite.");
    }
    private static bool ReadFlag(Element element, BuiltInParameter key) => ReadParameter(element,key,StorageType.Integer).AsInteger() switch
    { 0 => false, 1 => true, _ => throw Invalid($"Native architecture {key} is not a known Boolean flag.") };
    private static ArchitectureEdgeReadback Edge(Curve curve)
    {
        var start = curve.GetEndPoint(0); var end = curve.GetEndPoint(1);
        return new(JsonDefaults.InternalToMm(start.X),JsonDefaults.InternalToMm(start.Y),JsonDefaults.InternalToMm(start.Z),
            JsonDefaults.InternalToMm(end.X),JsonDefaults.InternalToMm(end.Y),JsonDefaults.InternalToMm(end.Z));
    }
}
