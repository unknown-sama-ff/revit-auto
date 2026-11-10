using RevitAutoV27;

internal static class ViewportReadPolicyTests
{
    public static void Run(Action<string, Action> test)
    {
        test("internal unplaced viewport preserves association without invoking sheet APIs", () =>
        {
            var reads = 0;
            object Read() { reads++; throw new InvalidOperationException("The viewport is not on a sheet."); }
            var result = ViewportReadPolicy.Read(false, Read, () => { reads++; return true; }, Read);
            if (reads != 0 || result.GeometrySupported || result.ProjectionSupported ||
                result.Geometry is not null || result.Projection is not null ||
                result.GeometryError != "viewport_not_on_sheet" || result.ProjectionError != "viewport_not_on_sheet")
                throw new Exception("Unplaced viewport requested unsupported sheet geometry or guessed coordinates.");
        });

        test("placed viewport without transforms retains geometry and reports projection unavailable", () =>
        {
            var geometry = new object();
            var projectionReads = 0;
            var result = ViewportReadPolicy.Read<object, object>(true, () => geometry, () => false,
                () => { projectionReads++; throw new InvalidOperationException("The viewport does not have transforms."); });
            if (!result.GeometrySupported || result.Geometry != geometry || result.GeometryError is not null ||
                result.ProjectionSupported || result.Projection is not null || projectionReads != 0 ||
                result.ProjectionError != "viewport_has_no_projection_transform")
                throw new Exception("Unsupported transform discarded available sheet geometry.");
        });

        test("ordinary placed viewport retains both native geometry and projection", () =>
        {
            var geometry = new object();
            var projection = new object();
            var result = ViewportReadPolicy.Read(true, () => geometry, () => true, () => projection);
            if (!result.GeometrySupported || !result.ProjectionSupported || result.Geometry != geometry ||
                result.Projection != projection || result.GeometryError is not null || result.ProjectionError is not null)
                throw new Exception("Readable viewport data changed.");
        });

        test("unexpected native viewport read failures remain visible", () =>
        {
            var failure = new InvalidOperationException("Unexpected geometry failure.");
            try { ViewportReadPolicy.Read<object, object>(true, () => throw failure, () => true, () => new object()); }
            catch (InvalidOperationException error) when (ReferenceEquals(error, failure)) { return; }
            throw new Exception("Unexpected viewport error was suppressed.");
        });
    }
}
