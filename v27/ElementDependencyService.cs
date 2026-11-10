using System.Text.Json;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace RevitAutoV27;

internal static class ElementDependencyService
{
    public static object Get(UIApplication app, JsonElement parameters, CancellationToken cancellation)
    {
        var input = ElementDependencyRules.Parse(parameters);
        cancellation.ThrowIfCancellationRequested();
        var doc = app.ActiveUIDocument?.Document ?? throw new BridgeException("no_active_document", "Open the reviewed project first.");
        if (!doc.IsValidObject) throw new BridgeException("document_changed", "The native document is no longer valid.");
        if (doc.IsFamilyDocument) throw new BridgeException("project_required", "Element dependencies require an active project document.");
        var identity = RevitCommandRouter.Identity(doc);
        var revision = RevitCommandRouter.Revision(doc);
        if (input.DocumentIdentity != identity) throw new BridgeException("document_changed", "The active project differs from the requested dependency document.");
        if (input.ExpectedRevision != revision) throw new BridgeException("document_revision_changed", "The document revision differs from the requested dependency revision.");
        var path = doc.PathName;
        var modified = doc.IsModified;
        var readOnly = doc.IsReadOnly;
        if (doc.IsModifiable) throw new BridgeException("document_busy", "The project has an active native transaction; dependency evidence requires a stable read context.");
        var started = System.Diagnostics.Stopwatch.StartNew();
        void Check()
        {
            cancellation.ThrowIfCancellationRequested();
            if (started.Elapsed > TimeSpan.FromSeconds(20))
                throw new BridgeException("element_dependencies_timeout", "Dependency evidence exceeded its read-only time budget; narrow the explicit root IDs.");
            if (!doc.IsValidObject || app.ActiveUIDocument?.Document is not { } active || !active.Equals(doc) ||
                !active.IsValidObject || RevitCommandRouter.Identity(active) != identity || doc.IsFamilyDocument ||
                !string.Equals(doc.PathName, path, StringComparison.Ordinal))
                throw new BridgeException("document_changed", "The pinned native dependency document changed during the read.");
            if (RevitCommandRouter.Revision(doc) != revision)
                throw new BridgeException("document_revision_changed", "The pinned native dependency revision changed during the read.");
            if (doc.IsModified != modified || doc.IsReadOnly != readOnly || doc.IsModifiable)
                throw new BridgeException("document_state_changed", "The pinned document's modified/read-only/transaction state changed during the read.");
        }
        Check();
        var items = new List<ElementDependencyItem>();
        var totalIds = 0;
        foreach (var elementId in input.ElementIds)
        {
            Check();
            var element = doc.GetElement(new ElementId(elementId));
            if (element is null)
            {
                var missing = ElementDependencySetEvidence.Unknown("element_not_found");
                items.Add(new(elementId, false, null, missing, ElementFamilySymbolsEvidence.From(false, missing)));
                continue;
            }
            if (!element.IsValidObject || element.Id.Value != elementId)
                throw new BridgeException("element_dependencies_invalid_native_evidence", "A requested native element became invalid or resolved to another ID.");
            var category = element.Category;
            var summary = new ElementDependencySummary(
                elementId, ElementDependencyRules.RequireNativeText(element.UniqueId, "uniqueId"),
                ElementDependencyRules.RequireNativeText(element.Name, "name", allowEmpty: true),
                ElementDependencyRules.RequireNativeText(element.GetType().Name, "className"),
                category?.Name, category is null ? null : ElementDependencyRules.RequireSignedSafeId(category.Id.Value),
                ElementDependencyRules.RequireSignedSafeId(element.GetTypeId().Value),
                ElementDependencyRules.RequireSignedSafeId(element.OwnerViewId.Value),
                ElementDependencyRules.RequireSignedSafeId(element.LevelId.Value));
            Check();
            var dependencies = ElementDependencyRules.ReadIds(() => element.GetDependentElements(null)?.Select(id => id.Value), Check, ref totalIds);
            var familySymbols = element is Family family
                ? ElementFamilySymbolsEvidence.From(true, ElementDependencyRules.ReadIds(() => family.GetFamilySymbolIds()?.Select(id => id.Value), Check, ref totalIds))
                : ElementFamilySymbolsEvidence.From(false, ElementDependencySetEvidence.Unknown("not_family"));
            items.Add(new(elementId, true, summary, dependencies, familySymbols));
            Check();
        }
        Check();
        var snapshot = NativeReadSnapshot.Freeze(new
        {
            documentIdentity = identity,
            documentRevision = revision,
            items,
            modelWritesRequested = false,
            automaticSave = false,
            relationshipScope = "native-logical-dependents-and-family-symbol-membership",
            allModelSideEffectsVerified = false
        });
        ElementDependencyRules.RequireResponseBudget(CommandResult.Success(snapshot).Serialize());
        // Native values are frozen, and the document pin is checked again after
        // JSON materialization and wire-budget work, still on the UI thread.
        Check();
        return snapshot;
    }
}
