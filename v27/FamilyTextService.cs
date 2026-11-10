using System.Text.Json;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace RevitAutoV27;

// Reads only an already active titleblock family. No family editing/document lifecycle is initiated here.
internal static class FamilyTextService
{
    public static FamilyTextScopeEvidence Scope(Document doc)
    {
        var owner = doc.OwnerFamily;
        return new(owner is not null, doc.Title, owner?.Name, owner?.FamilyCategory?.Id.Value);
    }
    private static bool ReadFailure(Exception e) => e is System.InvalidOperationException or Autodesk.Revit.Exceptions.InvalidOperationException or
        Autodesk.Revit.Exceptions.ArgumentException or Autodesk.Revit.Exceptions.InvalidObjectException;
    private static bool Finite(XYZ p) => double.IsFinite(p.X) && double.IsFinite(p.Y) && double.IsFinite(p.Z);
    private static object Point(XYZ p)
    {
        var x = JsonDefaults.InternalToMm(p.X); var y = JsonDefaults.InternalToMm(p.Y); var z = JsonDefaults.InternalToMm(p.Z);
        if (!double.IsFinite(x) || !double.IsFinite(y) || !double.IsFinite(z))
            throw new System.InvalidOperationException("Native point is non-finite after conversion to mm.");
        return new { xMm = x, yMm = y, zMm = z };
    }
    private static object Vector(XYZ p)
    {
        if (!Finite(p)) throw new System.InvalidOperationException("Native basis is non-finite.");
        return new { x = p.X, y = p.Y, z = p.Z };
    }
    private static FamilyTextField Read(Func<object?> getter, Action check)
    {
        check();
        try
        {
            var value = getter();
            check();
            return value is null ? new(false, null, "native_value_unavailable") : new(true, value);
        }
        catch (Exception e) when (ReadFailure(e))
        { check(); return new(false, null, e.GetType().Name); }
    }
    private static object? Number(double value, bool positive = false) =>
        double.IsFinite(value) && (positive ? value > 0 : value >= 0) ? value : null;

    private static object? Bounds(TextNote note, View? view)
    {
        using var box = note.get_BoundingBox(view);
        if (box is null || !Finite(box.Min) || !Finite(box.Max) || box.Min.X > box.Max.X || box.Min.Y > box.Max.Y || box.Min.Z > box.Max.Z) return null;
        return new { min = Point(box.Min), max = Point(box.Max), origin = Point(box.Transform.Origin),
            basisX = Vector(box.Transform.BasisX), basisY = Vector(box.Transform.BasisY), basisZ = Vector(box.Transform.BasisZ) };
    }

    public static object Get(UIApplication app, JsonElement request, CancellationToken cancellation)
    {
        var input = FamilyTextRules.Parse(request);
        var doc = app.ActiveUIDocument?.Document ?? throw new BridgeException("no_active_document", "Open the reviewed titleblock family first.");
        if (!doc.IsValidObject || !doc.IsFamilyDocument)
            throw new BridgeException("family_document_required", "Manually open the titleblock in the family editor first; no document was opened by this query.");
        DocumentReadPinRules.Validate(request, RevitCommandRouter.Identity(doc), RevitCommandRouter.Revision(doc));
        var family = doc.OwnerFamily;
        FamilyTextRules.RequireScope(input, Scope(doc));
        if (family is null) throw new BridgeException("family_text_scope_mismatch", "The family owner became unavailable.");
        var identity = RevitCommandRouter.Identity(doc); var revision = RevitCommandRouter.Revision(doc);
        var path = doc.PathName; var title = doc.Title; var modified = doc.IsModified; var readOnly = doc.IsReadOnly;
        var timer = System.Diagnostics.Stopwatch.StartNew();
        void Check()
        {
            cancellation.ThrowIfCancellationRequested();
            if (timer.Elapsed > TimeSpan.FromSeconds(20)) throw new BridgeException("family_text_timeout", "Family text read exceeded its time budget.");
            if (!doc.IsValidObject || app.ActiveUIDocument?.Document is not { } active || !active.Equals(doc) ||
                !doc.IsFamilyDocument || RevitCommandRouter.Identity(doc) != identity || RevitCommandRouter.Revision(doc) != revision ||
                doc.PathName != path || doc.Title != title || doc.IsModified != modified || doc.IsReadOnly != readOnly || doc.IsModifiable)
                throw new BridgeException("family_text_document_changed", "Family document or transaction state changed during the read.");
        }
        Check();
        View? boundsView = null;
        if (input.BoundsViewId is long viewId)
        {
            boundsView = doc.GetElement(new ElementId(viewId)) as View;
            if (boundsView is null || boundsView.IsTemplate)
                throw new BridgeException("invalid_family_text_view", "boundsViewId must identify an existing non-template view in the active family document.");
        }
        using var collector = new FilteredElementCollector(doc).OfClass(typeof(TextNote)).WhereElementIsNotElementType();
        var totalCount = collector.GetElementCount();
        Check();
        var page = input.AfterNoteId is long cursor
            ? FamilyTextRules.SelectPage(collector.ToElementIds().Select(id => id.Value), cursor, input.MaxNotes) : null;
        Check();
        var notes = page is null ? collector.Cast<TextNote>().Take(input.MaxNotes).OrderBy(n => n.Id.Value).ToArray()
            : page.Ids.Select(id => doc.GetElement(new ElementId(id)) as TextNote ??
                throw new BridgeException("family_text_document_changed", "A selected native note became unavailable.")).ToArray();
        var rows = new List<object>(); var textUsed = 0;
        foreach (var note in notes)
        {
            Check();
            FamilyTextContent content;
            try { content = FamilyTextRules.Text(note.Text, ref textUsed); }
            catch (Exception e) when (ReadFailure(e)) { content = new(false, false, null, null, false, e.GetType().Name); }
            var type = doc.GetElement(note.GetTypeId()) as TextNoteType;
            rows.Add(new
            {
                id = note.Id.Value, uniqueId = note.UniqueId, ownerViewId = note.OwnerViewId.Value, typeId = note.GetTypeId().Value,
                text = content,
                coord = Read(() => Point(note.Coord), Check),
                widthMm = Read(() => Number(JsonDefaults.InternalToMm(note.Width)), Check),
                heightMm = Read(() => Number(JsonDefaults.InternalToMm(note.Height)), Check),
                bounds = Read(() => Bounds(note, null), Check),
                viewBounds = boundsView is null ? null : note.OwnerViewId == boundsView.Id
                    ? Read(() => Bounds(note, boundsView), Check)
                    : new FamilyTextField(false, null, "note_not_owned_by_bounds_view"),
                typeFont = Read(() =>
                {
                    var p = type?.get_Parameter(BuiltInParameter.TEXT_FONT);
                    var value = p is { StorageType: StorageType.String, HasValue: true } ? p.AsString() : null;
                    return !string.IsNullOrWhiteSpace(value) && value.Length <= 200 ? value : null;
                }, Check),
                typeTextSizeMm = Read(() =>
                {
                    var p = type?.get_Parameter(BuiltInParameter.TEXT_SIZE);
                    return p is { StorageType: StorageType.Double, HasValue: true } ? Number(JsonDefaults.InternalToMm(p.AsDouble()), true) : null;
                }, Check),
                typeWidthFactor = Read(() =>
                {
                    var p = type?.get_Parameter(BuiltInParameter.TEXT_WIDTH_SCALE);
                    return p is { StorageType: StorageType.Double, HasValue: true } ? Number(p.AsDouble(), true) : null;
                }, Check)
            });
        }
        Check();
        var snapshot = NativeReadSnapshot.Freeze(new
        {
            documentIdentity = identity, documentRevision = revision,
            document = new { title, path, identity, revision, isModified = modified, isReadOnly = readOnly, isFamilyDocument = true },
            family = new { name = family.Name, uniqueId = family.UniqueId, categoryId = family.FamilyCategory!.Id.Value },
            notes = rows, totalCount, returnedCount = rows.Count, truncated = totalCount > rows.Count,
            complete = totalCount == rows.Count, textCharacterBudgetUsed = textUsed,
            page = page is null ? null : new FamilyTextPageEvidence(input.AfterNoteId!.Value, page.SkippedCount, page.RemainingCount, page.NextAfterNoteId),
            boundsView = boundsView is null ? null : new { id = boundsView.Id.Value, uniqueId = boundsView.UniqueId, name = boundsView.Name, viewType = boundsView.ViewType.ToString() },
            selectionOrder = page is null ? "native collector order; returned subset sorted by native ID" : "all native TextNote IDs sorted ascending, strictly after afterNoteId",
            coordinateUnits = "coord/bounds: family-document mm; width/height/type text size: sheet mm; width factor: dimensionless",
            fontScope = "TextNoteType defaults only; rich-text overrides, installed-font availability and rendered fallback are not inspected",
            coverage = "TextNote only; family labels, nested families and rendered glyph bounds are not certified",
            readOnly = true, planCreated = false, modelWritesRequested = false, automaticSave = false,
            documentOpened = false, documentClosed = false, familyLoaded = false, projectAssociationVerified = false,
            visualAccepted = false, allModelSideEffectsVerified = false
        });
        FamilyTextRules.RequireResponseBudget(CommandResult.Success(snapshot).Serialize());
        Check(); return snapshot;
    }
}
