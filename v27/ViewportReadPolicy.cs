namespace RevitAutoV27;

internal sealed record ViewportReadResult<TGeometry, TProjection>(
    bool GeometrySupported, TGeometry? Geometry, string? GeometryError,
    bool ProjectionSupported, TProjection? Projection, string? ProjectionError)
    where TGeometry : class where TProjection : class;

internal static class ViewportReadPolicy
{
    public static ViewportReadResult<TGeometry, TProjection> Read<TGeometry, TProjection>(
        bool isOnSheet, Func<TGeometry> readGeometry, Func<bool> hasTransforms, Func<TProjection> readProjection)
        where TGeometry : class where TProjection : class
    {
        // Internal Viewports can have InvalidElementId for SheetId. Revit's sheet
        // geometry APIs throw for these, even though the element itself is valid.
        if (!isOnSheet)
            return new(false, null, "viewport_not_on_sheet", false, null, "viewport_not_on_sheet");

        var geometry = readGeometry();
        // Schedules and legends can be on a sheet without projection transforms.
        // Preserve their available geometry instead of failing the whole read.
        if (!hasTransforms())
            return new(true, geometry, null, false, null, "viewport_has_no_projection_transform");

        return new(true, geometry, null, true, readProjection(), null);
    }
}
