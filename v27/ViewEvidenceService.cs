using System.Text.Json;
using System.Buffers.Binary;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace RevitAutoV27;

internal static class ViewEvidenceService
{
    public static object ExportImages(UIApplication app, JsonElement parameters, CancellationToken cancellation)
    {
        var request = ViewExportRules.Parse(parameters);
        var doc = app.ActiveUIDocument?.Document ?? throw new BridgeException("no_active_document", "Open a project first.");
        if (doc.IsFamilyDocument) throw new BridgeException("project_required", "Batch image export requires a project document.");
        var modified = doc.IsModified;
        var path = doc.PathName;
        AssertExportState(app, doc, request, modified, path);
        var views = request.ViewIds.Select(id =>
        {
            var view = doc.GetElement(new ElementId(id)) as View ?? throw new BridgeException("view_not_found", "A requested view is missing.", new { viewId = id });
            if (view.IsTemplate || view.ViewType is not (ViewType.FloorPlan or ViewType.CeilingPlan or ViewType.EngineeringPlan or ViewType.AreaPlan or ViewType.ThreeD or ViewType.Section or ViewType.Elevation or ViewType.Detail or ViewType.DraftingView or ViewType.Legend or ViewType.DrawingSheet))
                throw new BridgeException("view_not_exportable", "Select model/drafting views or sheets, not templates, browsers, schedules or reports.", new { viewId = id, viewType = view.ViewType.ToString() });
            return view;
        }).ToArray();
        cancellation.ThrowIfCancellationRequested();
        var folder = Path.Combine(RuntimeFiles.Root, "exports", Guid.NewGuid().ToString("N"));
        var exported = new List<object>();
        try
        {
            Directory.CreateDirectory(folder);
            foreach (var view in views)
            {
                cancellation.ThrowIfCancellationRequested();
                AssertExportState(app, doc, request, modified, path);
                // Isolated native exports preserve an exact view/file association even when view names collide.
                var viewFolder = Path.Combine(folder, "view-" + view.Id.Value);
                Directory.CreateDirectory(viewFolder);
                using var options = new ImageExportOptions
                {
                    ExportRange = ExportRange.SetOfViews, FilePath = Path.Combine(viewFolder, "view"),
                    HLRandWFViewsFileType = ImageFileType.PNG, ShadowViewsFileType = ImageFileType.PNG,
                    PixelSize = request.PixelSize, ZoomType = ZoomFitType.FitToPage,
                    ImageResolution = request.ResolutionDpi switch { 72 => ImageResolution.DPI_72, 150 => ImageResolution.DPI_150, 300 => ImageResolution.DPI_300, _ => ImageResolution.DPI_600 }
                };
                options.SetViewsAndSheets([view.Id]);
                doc.ExportImage(options);
                var files = Directory.GetFiles(viewFolder, "*.png").Order().ToArray();
                if (files.Length != 1) throw new BridgeException("export_failed", "Native image export did not produce exactly one PNG for the selected view.", new { viewId = view.Id.Value, files });
                using var stream = File.OpenRead(files[0]);
                var header = new byte[24];
                stream.ReadExactly(header);
                if (!header.AsSpan(0,8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }) || !header.AsSpan(12,4).SequenceEqual("IHDR"u8))
                    throw new BridgeException("export_failed", "The exported file is not a PNG with a readable image header.", new { viewId = view.Id.Value, files });
                var width = BinaryPrimitives.ReadUInt32BigEndian(header[16..20]);
                var height = BinaryPrimitives.ReadUInt32BigEndian(header[20..24]);
                if (width == 0 || height == 0) throw new BridgeException("export_failed", "The exported PNG has no image pixels.");
                exported.Add(new { viewId = view.Id.Value, viewName = view.Name, sheetNumber = view is ViewSheet sheet ? sheet.SheetNumber : null, file = files[0], widthPixels = width, heightPixels = height, fileBytes = stream.Length });
                AssertExportState(app, doc, request, modified, path);
            }
            cancellation.ThrowIfCancellationRequested();
            AssertExportState(app, doc, request, modified, path);
        }
        catch (Exception error)
        {
            throw new BridgeException(error is BridgeException bridge ? bridge.Code : error is OperationCanceledException ? "export_cancelled" : "export_failed", error.Message,
                new { outputDirectory = folder, completedExports = exported, requestedViewIds = request.ViewIds, partialFilesMayExist = true, savedModel = false, retryAutomatically = false, nativeErrorDetails = (error as BridgeException)?.Details });
        }
        return new { documentIdentity = request.DocumentIdentity, documentRevision = request.ExpectedRevision, requestedPixelSize = request.PixelSize, requestedResolutionDpi = request.ResolutionDpi,
            outputDirectory = folder, exports = exported, savedModel = false, modelRevisionUnchanged = true, savedStateUnchanged = true,
            note = "PNG dimensions are read from the exported files. Visual layout and nonblank content still require independent inspection; no model transaction or RVT save was requested." };
    }

    private static void AssertExportState(UIApplication app, Document doc, ViewExportRequest request, bool modified, string path)
    {
        if (app.ActiveUIDocument?.Document is not { } active || !active.Equals(doc))
            throw new BridgeException("document_changed", "The active project changed during image export.");
        ViewExportRules.AssertState(request, RevitCommandRouter.Identity(doc), RevitCommandRouter.Revision(doc));
        ViewExportRules.AssertUnchanged(modified, doc.IsModified, path, doc.PathName);
    }

    public static object ExportImage(UIApplication app,JsonElement parameters)
    {
        var doc=app.ActiveUIDocument?.Document??throw new BridgeException("no_active_document","Open a project first.");
        var id=JsonDefaults.Int64(parameters,"viewId")??throw new BridgeException("missing_view","Specify a model view or sheet id.");
        var view=doc.GetElement(new ElementId(id)) as View??throw new BridgeException("view_not_found","The requested view is missing.");
        if(view.IsTemplate||view.ViewType is ViewType.ProjectBrowser or ViewType.SystemBrowser or ViewType.Schedule)
            throw new BridgeException("view_not_exportable","Choose a model/drafting view or sheet, not a template/browser/schedule.");
        var folder=Path.Combine(RuntimeFiles.Root,"exports",Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        using var options=new ImageExportOptions
        {
            ExportRange=ExportRange.SetOfViews,FilePath=Path.Combine(folder,"view"),
            HLRandWFViewsFileType=ImageFileType.PNG,ShadowViewsFileType=ImageFileType.PNG,
            PixelSize=(int)Math.Clamp(JsonDefaults.Int64(parameters,"pixelSize")??1600,600,2560),ZoomType=ZoomFitType.FitToPage
        };
        options.SetViewsAndSheets([view.Id]);
        var revision=RevitCommandRouter.Revision(doc);
        doc.ExportImage(options);
        var files=Directory.GetFiles(folder,"*.png").Order().ToArray();
        if(files.Length==0)throw new BridgeException("export_failed","Revit did not produce a PNG image.");
        return new {documentIdentity=RevitCommandRouter.Identity(doc),documentRevision=revision,viewId=view.Id.Value,viewName=view.Name,files,savedModel=false,modelRevisionUnchanged=revision==RevitCommandRouter.Revision(doc),note="Image export writes a local evidence file only; no RVT save or model transaction is requested."};
    }
}
