using System.Text.Json;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace RevitAutoV27;

internal static class ViewEvidenceService
{
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
