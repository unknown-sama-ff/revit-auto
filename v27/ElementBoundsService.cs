using Autodesk.Revit.DB;

namespace RevitAutoV27;

internal static class ElementBoundsService
{
    private const string Scope = "Conservative native bounding box; may include symbolic, reference and control geometry. Not exact solid, glyph, clearance or engineering-compliance evidence.";

    public static View? ResolveView(Document doc, ElementBoundsInput input)
    {
        if (input.BoundsViewId is not { } id) return null;
        var view = doc.GetElement(new ElementId(id)) as View;
        if (view is null) throw new BridgeException("element_bounds_view_not_found", "boundsViewId must identify an existing view in the active document.", new { boundsViewId = id });
        if (view.IsTemplate) throw new BridgeException("element_bounds_template_view", "A template cannot be used for bounds evidence.", new { boundsViewId = id });
        return view;
    }

    // Called only by Inspect on Revit's UI thread. Only materialized managed
    // values leave this method; no transaction, activation or regeneration.
    public static object Snapshot(Element element, View? view)
    {
        var context = new { kind = view is null ? "model" : "view", viewId = view?.Id.Value };
        object Unknown(string reason) => new { status = "unknown", context, scope = Scope, reason };
        try
        {
            using var box = element.get_BoundingBox(view);
            if (box is null) return Unknown("native_bounding_box_unavailable");
            if (!box.Enabled) return Unknown("native_bounding_box_disabled");
            for (var dimension = 0; dimension < 3; dimension++)
                for (var bound = 0; bound < 2; bound++)
                    if (!box.get_BoundEnabled(bound: bound, dim: dimension)) return Unknown("native_bounding_box_bound_disabled");
            using var transform = box.Transform;
            var origin = PointMm(transform.Origin);
            var basisX = Vector(transform.BasisX); var basisY = Vector(transform.BasisY); var basisZ = Vector(transform.BasisZ);
            var determinant = transform.Determinant;
            if (!origin.Finite || !Finite(basisX) || !Finite(basisY) || !Finite(basisZ) || !double.IsFinite(determinant) || determinant == 0)
                return Unknown("native_transform_invalid_or_nonfinite");
            var min = PointMm(box.Min); var max = PointMm(box.Max);
            var geometry = ElementBoundsRules.FromCorners(min, max, corner =>
            {
                var local = new XYZ(corner.XMm / 304.8, corner.YMm / 304.8, corner.ZMm / 304.8);
                var project = transform.OfPoint(local);
                return PointMm(project);
            });
            if (geometry is null) return Unknown("native_bounding_box_invalid_or_nonfinite");
            // A failed LocationPoint read does not invalidate known box evidence.
            var location = Location(element, geometry.Center);
            return new { status = "known", context, scope = Scope, min = geometry.Min, max = geometry.Max,
                center = geometry.Center, size = geometry.Size, location,
                nativeTransform = new { originMm = origin, basisX, basisY, basisZ, determinant },
                nativeLocalBounds = new { min, max } };
        }
        catch (Exception error) { return Unknown("native_bounds_read_failed:" + error.GetType().Name); }
    }

    private static object Location(Element element, ElementBoundsPoint center)
    {
        object Unknown(string reason) => new { status = "unknown", reason };
        try
        {
            using var native = element.Location;
            if (native is not LocationPoint location) return Unknown("native_location_point_unavailable");
            var point = location.Point;
            var insertionPoint = PointMm(point);
            if (!insertionPoint.Finite) return Unknown("native_location_point_nonfinite");
            var offset = ElementBoundsRules.Offset(center, insertionPoint);
            if (offset is null) return Unknown("native_location_offset_nonfinite");
            return new { status = "known", insertionPoint, insertionToBoundsCenter = offset };
        }
        catch (Exception error) { return Unknown("native_location_point_read_failed:" + error.GetType().Name); }
    }

    private static ElementBoundsPoint PointMm(XYZ point) => new(point.X * 304.8, point.Y * 304.8, point.Z * 304.8);
    private static double[] Vector(XYZ vector) => [vector.X, vector.Y, vector.Z];
    private static bool Finite(double[] values) => values.All(double.IsFinite);
}
