using System.Security.Cryptography;
using System.Text.Json;
using Autodesk.Revit.DB;

namespace RevitAutoV27;

// Controlled IFC delivery exporter. Runs Document.Export inside an explicitly rolled-back
// transaction so the active Revit document remains unmodified and never auto-saves.
internal static class IfcExportService
{
    public static object Export(Document doc, JsonElement request, CancellationToken cancellation)
    {
        var input = IfcExportRules.Parse(request);
        if (doc.IsModifiable)
            throw new BridgeException("document_busy", "Revit has another open transaction; cannot run IFC export.");

        if (input.FilterViewId is long viewId)
        {
            if (doc.GetElement(new ElementId(viewId)) is not View view || !view.IsValidObject || view.IsTemplate)
                throw IfcExportRules.Invalid($"filterViewId {viewId} is not an exportable non-template View.");
        }

        Directory.CreateDirectory(input.OutputDirectory);
        var fullPath = Path.Combine(input.OutputDirectory, input.FileName);
        var version = input.IfcVersion switch
        {
            "IFC2x3CV2" => IFCVersion.IFC2x3CV2,
            "IFC4" => IFCVersion.IFC4,
            "IFC4RV" => IFCVersion.IFC4RV,
            "IFC4DTV" => IFCVersion.IFC4DTV,
            _ => throw IfcExportRules.Invalid($"Unsupported IFC version '{input.IfcVersion}'.")
        };

        var options = new IFCExportOptions
        {
            FileVersion = version,
            ExportBaseQuantities = input.ExportBaseQuantities,
            SpaceBoundaryLevel = input.SpaceBoundaryLevel
        };
        if (input.FilterViewId is long filterId)
            options.FilterViewId = new ElementId(filterId);

        cancellation.ThrowIfCancellationRequested();
        var modifiedBefore = doc.IsModified;
        bool exported;
        using (var tx = new Transaction(doc, "AI Controlled IFC Export (Rollback-Safe)"))
        {
            if (tx.Start() != TransactionStatus.Started)
                throw new BridgeException("ifc_export_failed", "Could not start Revit transaction for IFC export.");
            try
            {
                exported = doc.Export(input.OutputDirectory, input.FileName, options);
            }
            finally
            {
                if (tx.GetStatus() == TransactionStatus.Started)
                    tx.RollBack();
            }
        }

        if (!exported || !File.Exists(fullPath))
            throw new BridgeException("ifc_export_failed", $"Revit IFC export did not produce '{fullPath}'.");

        var info = new FileInfo(fullPath);
        string sha256;
        using (var stream = File.OpenRead(fullPath))
            sha256 = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();

        return NativeReadSnapshot.Freeze(new
        {
            documentIdentity = RevitCommandRouter.Identity(doc),
            documentRevision = RevitCommandRouter.Revision(doc),
            exported = true,
            outputPath = fullPath,
            bytes = info.Length,
            sha256,
            ifcVersion = input.IfcVersion,
            exportBaseQuantities = input.ExportBaseQuantities,
            spaceBoundaryLevel = input.SpaceBoundaryLevel,
            filterViewId = input.FilterViewId,
            documentModifiedBefore = modifiedBefore,
            documentModifiedAfter = doc.IsModified,
            saved = false
        });
    }
}
