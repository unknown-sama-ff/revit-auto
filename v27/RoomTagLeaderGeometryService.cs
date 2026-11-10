using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;

namespace RevitAutoV27;

internal static class RoomTagLeaderGeometryService
{
    internal static object? Snapshot(Element element)
    {
        if (element is IndependentTag)
            return new { supported = false, scope = "room-tag-leader-geometry-observations",
                reason = "independent-tag-per-reference-leader-geometry-not-implemented" };
        if (element is not RoomTag room) return null;
        var values = RoomTagLeaderGeometryRules.Capture(() => room.HasLeader, () => room.HasElbow,
            () => Point(room.LeaderEnd), () => Point(room.LeaderElbow));
        return new
        {
            supported = true,
            scope = "room-tag-leader-geometry-observations",
            tagId = room.Id.Value,
            className = nameof(RoomTag),
            viewId = room.OwnerViewId.Value,
            units = "mm",
            coordinatePolicy = "native SpatialElementTag XYZ converted from feet; no projection, rounding or head/location fallback",
            hasLeader = values.HasLeader,
            hasElbow = values.HasElbow,
            end = values.End,
            elbow = values.Elbow,
            requestedGeometryVerified = false,
            endInsideRoomVerified = false,
            visualVerified = false
        };
    }

    private static TagPosition? Point(XYZ? point) => point is null ? null :
        new(JsonDefaults.InternalToMm(point.X), JsonDefaults.InternalToMm(point.Y), JsonDefaults.InternalToMm(point.Z));
}
