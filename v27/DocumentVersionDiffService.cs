using System.Text.Json;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace RevitAutoV27;

internal static class DocumentVersionDiffService
{
    public static object Get(UIApplication app, JsonElement parameters, CancellationToken cancellation)
    {
        var input = DocumentVersionDiffRules.Parse(parameters);
        cancellation.ThrowIfCancellationRequested();
        var doc = app.ActiveUIDocument?.Document ?? throw new BridgeException("no_active_document", "Open the reviewed project first.");
        if (!doc.IsValidObject || doc.IsFamilyDocument) throw new BridgeException("project_required", "Document version differences require an active project document.");
        var identity = RevitCommandRouter.Identity(doc);
        var revision = RevitCommandRouter.Revision(doc);
        if (input.DocumentIdentity != identity) throw new BridgeException("document_changed", "The active project differs from the reviewed version-diff request.");
        if (input.ExpectedRevision != revision) throw new BridgeException("document_revision_changed", "The active document revision differs from the reviewed version-diff request.");
        if (doc.IsModifiable) throw new BridgeException("document_busy", "Document version differences require a stable context outside native transactions.");
        var path = doc.PathName; var modified = doc.IsModified; var readOnly = doc.IsReadOnly;
        var started = System.Diagnostics.Stopwatch.StartNew();
        void Check()
        {
            cancellation.ThrowIfCancellationRequested();
            if (started.Elapsed > TimeSpan.FromSeconds(20)) throw new BridgeException("document_version_diff_timeout", "Document version difference exceeded its read-only time budget.");
            var active = app.ActiveUIDocument?.Document;
            if (!doc.IsValidObject || active is null || !active.IsValidObject || !active.Equals(doc) ||
                RevitCommandRouter.Identity(active) != identity || RevitCommandRouter.Revision(active) != revision ||
                !string.Equals(active.PathName, path, StringComparison.Ordinal) || active.IsModified != modified || active.IsReadOnly != readOnly || active.IsModifiable)
                throw new BridgeException("document_state_changed", "The pinned document changed during version difference inspection; discard this evidence.");
        }
        Check();
        DocumentDifference difference;
        try { difference = doc.GetChangedElements(input.BaseVersionGuid); }
        catch (Autodesk.Revit.Exceptions.ArgumentException error)
        {
            throw new BridgeException("document_version_guid_not_found", "The supplied base version GUID is not a version of the active document.", new { baseVersionGuid = input.BaseVersionGuid, cause = error.Message });
        }
        using (difference)
        {
            if (!difference.IsValidObject) throw new BridgeException("document_version_diff_invalid_native_evidence", "Revit returned an invalid document difference object.");
            var created = DocumentVersionDiffRules.NormalizeIds(difference.GetCreatedElementIds()?.Select(id => id.Value), DocumentVersionDiffRules.MaxIdsPerSet, "created");
            Check();
            var modifiedIds = DocumentVersionDiffRules.NormalizeIds(difference.GetModifiedElementIds()?.Select(id => id.Value), DocumentVersionDiffRules.MaxIdsPerSet, "modified");
            Check();
            var deletedAvailable = difference.AreDeletedElementIdsAvailable;
            var deleted = DocumentVersionDiffRules.DeletedIds(deletedAvailable, difference.GetDeletedElementIds()?.Select(id => id.Value));
            var total = (long)created.Length + modifiedIds.Length + deleted.Ids.Length;
            if (total > DocumentVersionDiffRules.MaxIdsPerSet * 2L)
                throw new BridgeException("document_version_diff_limit_exceeded", "Combined native version difference exceeds the bounded ID budget; evidence was not truncated.");
            var current = Document.GetDocumentVersion(doc);
            if (current is null || !current.IsValidObject) throw new BridgeException("document_version_diff_invalid_native_evidence", "The current document version is unavailable.");
            Check();
            var result = NativeReadSnapshot.Freeze(new
            {
                documentIdentity = identity, documentRevision = revision,
                baseVersionGuid = input.BaseVersionGuid, currentVersionGuid = current.VersionGUID,
                baseSaveCount = (int?)null, currentSaveCount = current.NumberOfSaves,
                modelKind = doc.IsWorkshared ? "workshared" : "non_workshared",
                createdIds = created, modifiedIds, deletedIds = deleted.Ids, deletedIdsAvailable = deleted.Available,
                complete = true, truncated = false, modelWritesRequested = false, automaticSave = false,
                allModelSideEffectsVerified = false,
                scopeNote = "Revit Document.GetChangedElements returns ID differences only; it does not expose property-level before/after values or prove causality. Non-workshared documents do not track deleted IDs."
            });
            DocumentVersionDiffRules.RequireResponseBudget(CommandResult.Success(result).Serialize());
            Check();
            return result;
        }
    }
}
