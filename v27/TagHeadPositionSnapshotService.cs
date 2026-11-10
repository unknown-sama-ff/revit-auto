using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;

namespace RevitAutoV27;

// Read-only observations: never substitute Element.Location for TagHeadPosition.
// Getter selection adapted from rvt-mcp TagElementsHandler; see THIRD_PARTY_NOTICES.
internal static class TagHeadPositionSnapshotService
{
    internal static object? Snapshot(Element element)
    {
        TagPositionSnapshot values;
        string property;
        switch (element)
        {
            case RoomTag room:
                values = TagPositionSnapshotRules.Capture(() => Point(room.TagHeadPosition),
                    () => GenericPoint(element), () => room.HasLeader);
                property = "SpatialElementTag.TagHeadPosition";
                break;
            case IndependentTag independent:
                values = TagPositionSnapshotRules.Capture(() => Point(independent.TagHeadPosition),
                    () => GenericPoint(element), () => independent.HasLeader);
                property = "IndependentTag.TagHeadPosition";
                break;
            default:
                return null;
        }
        return new
        {
            supported = true,
            scope = "tag-head-position-observations",
            tagId = element.Id.Value,
            className = element.GetType().Name,
            viewId = element.OwnerViewId.Value,
            nativeHeadProperty = property,
            units = "mm",
            coordinatePolicy = "native API XYZ converted from feet; no rounding, projection or coordinate substitution",
            headPosition = values.HeadPosition,
            genericLocationPoint = values.GenericLocationPoint,
            hasLeader = values.HasLeader,
            requestedPositionVerified = false,
            leaderEndpointsVerified = false
        };
    }

    private static TagPosition? GenericPoint(Element element) =>
        element.Location is LocationPoint point ? Point(point.Point) : null;

    private static TagPosition? Point(XYZ? point) => point is null ? null :
        new TagPosition(JsonDefaults.InternalToMm(point.X), JsonDefaults.InternalToMm(point.Y), JsonDefaults.InternalToMm(point.Z));
}
