using System.Text.Json;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using Autodesk.Revit.UI;

namespace RevitAutoV27;

internal static class RoomService
{
    public static object Get(UIApplication app, JsonElement parameters)
    {
        var doc = app.ActiveUIDocument?.Document ?? throw new BridgeException("no_active_document", "Open a project first.");
        var id = JsonDefaults.Int64(parameters, "roomId") ?? throw new BridgeException("missing_room_id", "roomId is required.");
        var room = doc.GetElement(new ElementId(id)) as Room ?? throw new BridgeException("room_not_found", $"Room {id} was not found.");
        if (room.Area <= 0) throw new BridgeException("room_not_enclosed", $"Room {id} is unplaced or not enclosed.");
        var level = doc.GetElement(room.LevelId) as Level ?? throw new BridgeException("room_level_not_found", $"Room {id} has no valid level.");
        using var options = new SpatialElementBoundaryOptions { SpatialElementBoundaryLocation = SpatialElementBoundaryLocation.Finish };
        var loops = room.GetBoundarySegments(options);
        if (loops is null || loops.Count == 0) throw new BridgeException("room_boundary_missing", $"Room {id} has no usable boundary.");
        if (loops.Sum(loop => loop.Count) > 1000) throw new BridgeException("room_boundary_too_large", "Narrow the room boundary before layout planning.");
        var curves = loops.Select(loop => loop.Select(segment => segment.GetCurve()).ToArray()).ToArray();
        var eligible = curves.All(loop => loop.Length >= 3 && loop.All(curve => curve is Line));
        foreach (var loop in curves)
            for (int i = 0; i < loop.Length; i++)
                if (loop[i].GetEndPoint(1).DistanceTo(loop[(i + 1) % loop.Length].GetEndPoint(0)) > UnitUtils.ConvertToInternalUnits(1, UnitTypeId.Millimeters)) eligible = false;
        return new
        {
            documentIdentity = RevitCommandRouter.Identity(doc), documentRevision = RevitCommandRouter.Revision(doc),
            id = room.Id.Value, uniqueId = room.UniqueId, name = room.Name, number = room.Number,
            areaM2 = JsonDefaults.SquareMeters(room.Area), levelId = level.Id.Value, levelName = level.Name,
            levelElevationMm = JsonDefaults.InternalToMm(level.Elevation),
            layoutEligible = eligible, boundaryLocation = "Finish",
            boundaryLoops = curves.Select(loop => loop.Select(curve => Point(curve.GetEndPoint(0))).ToArray()).ToArray(),
            boundaryCurveTypes = curves.Select(loop => loop.Select(curve => curve.GetType().Name).ToArray()).ToArray(),
            layoutLimitations = eligible ? Array.Empty<string>() : new[] { "Room grid accepts only closed straight-segment boundaries; curved or disconnected boundaries require explicit reviewed points." }
        };
    }
    private static object Point(XYZ point) => new { xMm = JsonDefaults.InternalToMm(point.X), yMm = JsonDefaults.InternalToMm(point.Y), zMm = JsonDefaults.InternalToMm(point.Z) };
}
