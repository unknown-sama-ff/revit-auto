using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Electrical;
using Autodesk.Revit.UI;
using System.Text;
using System.Text.Json;

namespace RevitAutoV27;

internal static class SheetLayoutService
{
    private sealed record Point2(double XMm, double YMm);
    private sealed record BoundsEvidence(string Status, Point2? Min, Point2? Max, string? Error);

    private static object Uv(UV value) => new { xMm = JsonDefaults.InternalToMm(value.U), yMm = JsonDefaults.InternalToMm(value.V) };
    private static string ErrorText(Exception exception)
    {
        var message = exception.Message;
        return string.IsNullOrWhiteSpace(message) ? exception.GetType().Name : message.Length <= 512 ? message : message[..512];
    }

    private static BoundsEvidence GeometryFromBox(BoundingBoxXYZ? box, string? error = null)
    {
        if (box is null) return new("unknown", null, null, error ?? "bounding-box-unavailable");
        try
        {
            if (!box.Enabled) return new("unknown", null, null, "bounding-box-disabled");
            var corners = new List<XYZ>(8);
            foreach (var x in new[] { box.Min.X, box.Max.X })
                foreach (var y in new[] { box.Min.Y, box.Max.Y })
                    foreach (var z in new[] { box.Min.Z, box.Max.Z })
                        corners.Add(box.Transform.OfPoint(new XYZ(x, y, z)));
            return Geometry(corners);
        }
        catch (Exception exception) { return new("unknown", null, null, ErrorText(exception)); }
    }

    private static BoundsEvidence GeometryFromOutline(Outline? outline, string? error = null)
        => outline is null ? new("unknown", null, null, error ?? "outline-unavailable") : Geometry([outline.MinimumPoint, outline.MaximumPoint]);

    private static BoundsEvidence Geometry(IEnumerable<XYZ> source)
    {
        var points = source.ToArray();
        if (points.Length == 0 || points.Any(point => !double.IsFinite(point.X) || !double.IsFinite(point.Y)))
            return new("unknown", null, null, "bounding-box-non-finite");
        var minX = JsonDefaults.InternalToMm(points.Min(point => point.X));
        var minY = JsonDefaults.InternalToMm(points.Min(point => point.Y));
        var maxX = JsonDefaults.InternalToMm(points.Max(point => point.X));
        var maxY = JsonDefaults.InternalToMm(points.Max(point => point.Y));
        if (!double.IsFinite(minX) || !double.IsFinite(minY) || !double.IsFinite(maxX) || !double.IsFinite(maxY) || minX > maxX || minY > maxY)
            return new("unknown", null, null, "bounding-box-invalid");
        return new("known", new(minX, minY), new(maxX, maxY), null);
    }

    private static BoundsEvidence ReadGeometry(Func<BoundingBoxXYZ?> read)
    {
        try { return GeometryFromBox(read()); }
        catch (Exception exception) { return GeometryFromBox(null, ErrorText(exception)); }
    }

    private static BoundsEvidence ReadOutline(Func<Outline> read)
    {
        try { return GeometryFromOutline(read()); }
        catch (Exception exception) { return GeometryFromOutline(null, ErrorText(exception)); }
    }

    public static object Get(UIApplication app, JsonElement parameters, CancellationToken cancellation)
    {
        var request = SheetLayoutRules.Parse(parameters);
        cancellation.ThrowIfCancellationRequested();
        var doc = app.ActiveUIDocument?.Document ?? throw new BridgeException("no_active_document", "Open the reviewed project first.");
        if (doc.IsFamilyDocument) throw new BridgeException("project_required", "Sheet layout diagnostics require an active project document.");
        var identity = RevitCommandRouter.Identity(doc);
        var revision = RevitCommandRouter.Revision(doc);
        if (request.DocumentIdentity != identity) throw new BridgeException("document_changed", "The active project differs from the reviewed sheet layout document.");
        if (request.ExpectedRevision != revision) throw new BridgeException("document_revision_changed", "The project changed since the reviewed sheet layout context.");
        if (doc.IsModifiable) throw new BridgeException("document_busy", "The project has an active native transaction; sheet layout evidence requires a stable read context.");
        var path = doc.PathName;
        var modified = doc.IsModified;
        var readOnly = doc.IsReadOnly;
        var started = System.Diagnostics.Stopwatch.StartNew();
        void Check()
        {
            cancellation.ThrowIfCancellationRequested();
            if (started.Elapsed > TimeSpan.FromSeconds(20))
                throw new BridgeException("sheet_layout_timeout", "Sheet layout inspection exceeded its read-only time budget; no model change was requested.");
            if (!doc.IsValidObject || app.ActiveUIDocument?.Document is not { } active || !active.Equals(doc) ||
                !active.IsValidObject || RevitCommandRouter.Identity(active) != identity ||
                !string.Equals(doc.PathName, path, StringComparison.Ordinal) ||
                RevitCommandRouter.Revision(doc) != revision || doc.IsModified != modified ||
                doc.IsReadOnly != readOnly || doc.IsModifiable)
                throw new BridgeException("sheet_layout_state_changed", "The reviewed document changed during sheet layout inspection; discard this report.");
        }

        Check();
        var sheet = doc.GetElement(new ElementId(request.SheetId)) as ViewSheet
            ?? throw new BridgeException("sheet_not_found", "sheetId must identify an existing ViewSheet.");
        var outline = sheet.Outline;
        var titleBlocks = new FilteredElementCollector(doc, sheet.Id)
            .OfCategory(BuiltInCategory.OST_TitleBlocks).WhereElementIsNotElementType()
            .Select(block =>
            {
                Check();
                return new
                {
                    id = block.Id.Value,
                    className = block.GetType().Name,
                    ownerViewId = block.OwnerViewId.Value,
                    typeId = block.GetTypeId().Value,
                    geometry = ReadGeometry(() => block.get_BoundingBox(sheet))
                };
            }).Take(1001).ToArray();
        if (titleBlocks.Length > 1000)
            throw new BridgeException("sheet_layout_scope_too_large", "The complete sheet layout exceeds 1000 native placements; no geometry was omitted.");
        Check();
        var viewports = new FilteredElementCollector(doc, sheet.Id).OfClass(typeof(Viewport)).Cast<Viewport>()
            .Select(viewport =>
            {
                Check();
                return new
                {
                    id = viewport.Id.Value,
                    className = viewport.GetType().Name,
                    ownerViewId = viewport.OwnerViewId.Value,
                    viewId = viewport.ViewId.Value,
                    content = ReadOutline(viewport.GetBoxOutline),
                    label = ReadOutline(viewport.GetLabelOutline)
                };
            }).Take(1001).ToArray();
        if (titleBlocks.Length + viewports.Length > 1000)
            throw new BridgeException("sheet_layout_scope_too_large", "The complete sheet layout exceeds 1000 native placements; no geometry was omitted.");
        Check();
        var regularSchedules = new FilteredElementCollector(doc).OfClass(typeof(ScheduleSheetInstance)).Cast<ScheduleSheetInstance>()
            .Where(element => element.OwnerViewId == sheet.Id).Cast<Element>();
        var panelSchedules = new FilteredElementCollector(doc).OfClass(typeof(PanelScheduleSheetInstance)).Cast<PanelScheduleSheetInstance>()
            .Where(element => element.OwnerViewId == sheet.Id).Cast<Element>();
        var schedules = regularSchedules.Concat(panelSchedules).DistinctBy(element => element.Id).Take(1001)
            .Select(element =>
            {
                Check();
                return new
                {
                    id = element.Id.Value,
                    className = element.GetType().Name,
                    ownerViewId = element.OwnerViewId.Value,
                    viewId = element is ScheduleSheetInstance schedule ? schedule.ScheduleId.Value : ((PanelScheduleSheetInstance)element).ScheduleId.Value,
                    geometry = ReadGeometry(() => element.get_BoundingBox(sheet))
                };
            }).ToArray();
        Check();
        var textNotes = new FilteredElementCollector(doc)
            .WherePasses(new ElementOwnerViewFilter(sheet.Id))
            .OfClass(typeof(TextNote)).WhereElementIsNotElementType().Cast<Element>();
        var independentTags = new FilteredElementCollector(doc)
            .WherePasses(new ElementOwnerViewFilter(sheet.Id))
            .OfClass(typeof(IndependentTag)).WhereElementIsNotElementType().Cast<Element>();
        var annotationPlacements = textNotes.Concat(independentTags)
            .DistinctBy(element => element.Id.Value).Take(1001)
            .Select(element =>
            {
                Check();
                return new
                {
                    id = element.Id.Value,
                    className = element.GetType().Name,
                    kind = SheetLayoutRules.AnnotationKind(element.GetType().Name),
                    ownerViewId = element.OwnerViewId.Value,
                    geometry = ReadGeometry(() => element.get_BoundingBox(sheet))
                };
            }).ToArray();
        Check();
        if (titleBlocks.Length + viewports.Length + schedules.Length + annotationPlacements.Length > 1000)
            throw new BridgeException("sheet_layout_scope_too_large", "The complete sheet layout exceeds 1000 native placements; no geometry was omitted.");

        var result = NativeReadSnapshot.Freeze(new
        {
            documentIdentity = identity,
            documentRevision = revision,
            sheetId = sheet.Id.Value,
            sheetNumber = sheet.SheetNumber,
            sheetName = sheet.Name,
            outline = new { min = Uv(outline.Min), max = Uv(outline.Max) },
            titleBlocks,
            viewports,
            schedulePlacements = schedules,
            annotationPlacements,
            modelWritesRequested = false,
            automaticSave = false,
            allModelSideEffectsVerified = false,
            note = "Native sheet bounds only; text, axis-grid labels and PNG visual overlap require independent visual review."
        });
        Check();
        if (Encoding.UTF8.GetByteCount(CommandResult.Success(result).Serialize()) + 2 > 2 * 1024 * 1024)
            throw new BridgeException("sheet_layout_response_too_large", "Complete sheet layout evidence exceeds the 2 MiB read budget; no geometry was omitted.");
        Check();
        return result;
    }
}
