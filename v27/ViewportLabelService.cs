using System.Text.Json;
using Autodesk.Revit.DB;

namespace RevitAutoV27;

internal sealed record ViewportLabelReadEvidence(bool Supported, object? Offset, double? LineLengthMm,
    string? Rotation, bool? Pinned, bool? IsReadOnly, string? Error);

// Uses only the router's approved outer transaction. This service changes a
// viewport label offset and, when explicitly requested, its line length. It
// never moves the content box, creates a transaction, or saves the document.
internal sealed class ViewportLabelService
{
    internal const string OffsetFrame = "offset-from-unrotated-viewport-bottom-left-mm";
    private const double OffsetToleranceMm = 0.01;
    private const double PreservedGeometryToleranceMm = 0.001;
    private sealed record Bounds(XYZ Min, XYZ Max);
    private sealed record State(Viewport Viewport, ViewSheet Sheet, View View, XYZ BeforeOffset, XYZ RequestedOffset,
        XYZ BoxCenter, Bounds Box, Bounds Label, double LineLength, double RequestedLineLength, bool LineLengthSpecified,
        long TypeId, ViewportRotation Rotation, bool OffsetWriteNeeded, bool LineLengthWriteNeeded)
    {
        public bool NoOp => !OffsetWriteNeeded && !LineLengthWriteNeeded;
    }
    private sealed record CompletedLabel(Viewport Viewport, State State);
    private readonly List<CompletedLabel> completed = [];
    private Document? capturedDocument;

    private static BridgeException Invalid(string message, object? details = null) => new("invalid_viewport_label", message, details);
    private static double Mm(double value) => UnitUtils.ConvertToInternalUnits(value, UnitTypeId.Millimeters);
    private static bool Finite(XYZ? value) => value is not null && double.IsFinite(value.X) && double.IsFinite(value.Y) && double.IsFinite(value.Z);
    private static XYZ Copy(XYZ value) => new(value.X, value.Y, value.Z);
    private static object Point(XYZ value)
    {
        var xMm = JsonDefaults.InternalToMm(value.X); var yMm = JsonDefaults.InternalToMm(value.Y); var zMm = JsonDefaults.InternalToMm(value.Z);
        if (!double.IsFinite(xMm) || !double.IsFinite(yMm) || !double.IsFinite(zMm)) throw Invalid("Native viewport label point cannot be represented by finite millimeter values.");
        return new { xMm, yMm, zMm };
    }
    private static object OutlineEvidence(Bounds value) => new { min = Point(value.Min), max = Point(value.Max) };
    private static double OffsetDistance(XYZ first, XYZ second) => Math.Sqrt(Math.Pow(first.X - second.X, 2) + Math.Pow(first.Y - second.Y, 2));
    private static bool SamePoint(XYZ first, XYZ second) => Finite(second) && first.DistanceTo(second) <= Mm(PreservedGeometryToleranceMm);
    private static Bounds ReadBounds(Outline? outline, string description, bool requirePositiveArea = false)
    {
        if (outline is null || outline.IsEmpty) throw Invalid(description + " is absent or empty.");
        var min = outline.MinimumPoint; var max = outline.MaximumPoint;
        if (!Finite(min) || !Finite(max) || min.X > max.X || min.Y > max.Y || min.Z > max.Z ||
            requirePositiveArea && (min.X >= max.X || min.Y >= max.Y))
            throw Invalid(description + " is unknown, non-finite, inverted or empty.");
        return new(Copy(min), Copy(max));
    }

    private void BindDocument(Document doc)
    {
        if (capturedDocument is null) capturedDocument = doc;
        else if (!capturedDocument.IsValidObject || !capturedDocument.Equals(doc))
            throw Invalid("Viewport label evidence belongs to a different native document.");
    }

    // Read-only evidence is explicit. Missing/empty labels and unsupported
    // native geometry remain unsupported instead of being converted to zeroes.
    public static ViewportLabelReadEvidence Inspect(Viewport viewport)
    {
        bool? pinned = null; bool? readOnly = null; string? rotation = null;
        try
        {
            pinned = viewport.Pinned; readOnly = viewport.Document.IsReadOnly;
            if (viewport.SheetId == ElementId.InvalidElementId)
                return new(false, null, null, null, pinned, readOnly, "viewport_not_on_sheet");
            rotation = viewport.Rotation.ToString();
            if (!Enum.IsDefined(viewport.Rotation)) throw Invalid("Viewport rotation is unknown.");
            _ = ReadBounds(viewport.GetLabelOutline(), "Native viewport label outline", true);
            var offset = viewport.LabelOffset; var lineLength = viewport.LabelLineLength;
            if (!Finite(offset) || !double.IsFinite(lineLength)) throw Invalid("Native viewport label offset or line length is non-finite.");
            var lengthMm = JsonDefaults.InternalToMm(lineLength);
            if (!double.IsFinite(lengthMm)) throw Invalid("Native viewport label line length in millimeters is non-finite.");
            return new(true, Point(offset), lengthMm, rotation, pinned, readOnly, null);
        }
        catch (BridgeException error) when (error.Code == "invalid_viewport_label")
        { return new(false, null, null, rotation, pinned, readOnly, error.Message); }
        catch (Exception error) when (error is Autodesk.Revit.Exceptions.InvalidOperationException or
            Autodesk.Revit.Exceptions.ArgumentException or Autodesk.Revit.Exceptions.InvalidObjectException)
        { return new(false, null, null, rotation, pinned, readOnly, error.Message); }
    }

    private static State Capture(Document doc, JsonElement operation)
    {
        var input = ViewportLabelRules.Parse(operation);
        var viewport = doc.GetElement(new ElementId(input.ViewportId)) as Viewport ?? throw Invalid("viewportId must identify an existing Viewport.");
        var sheet = doc.GetElement(new ElementId(input.SheetId)) as ViewSheet ?? throw Invalid("sheetId must identify an existing ViewSheet.");
        var view = doc.GetElement(new ElementId(input.ViewId)) as View ?? throw Invalid("viewId must identify an existing ordinary view.");
        if (viewport.SheetId == ElementId.InvalidElementId || viewport.SheetId != sheet.Id || viewport.OwnerViewId != sheet.Id || viewport.ViewId != view.Id)
            throw Invalid("The native viewport owner sheet or source view differs from the explicitly reviewed scope.");
        if (view.IsTemplate || view is ViewSheet or ViewSchedule)
            throw Invalid("Viewport label movement requires an ordinary placed non-template view.");
        if (viewport.Pinned || doc.IsReadOnly) throw Invalid("Pinned or read-only viewports cannot change label offset.");
        if (viewport.Rotation != ViewportRotation.None)
            throw Invalid("Only Rotation=None viewports are supported; label offsets use the unrotated viewport frame.");
        var center = viewport.GetBoxCenter(); var offset = viewport.LabelOffset; var lineLength = viewport.LabelLineLength;
        if (!Finite(center) || !Finite(offset) || !double.IsFinite(lineLength))
            throw Invalid("Native viewport box center, label offset or line length is unknown or non-finite.");
        var box = ReadBounds(viewport.GetBoxOutline(), "Native viewport content outline", true);
        var label = ReadBounds(viewport.GetLabelOutline(), "Native viewport label outline", true);
        var typeId = viewport.GetTypeId().Value;
        if (typeId is <= 0 or > 9007199254740991) throw Invalid("Native viewport type ID is unavailable.");
        var requested = new XYZ(Mm(input.OffsetXMm), Mm(input.OffsetYMm), 0);
        var requestedLineLength = input.LineLengthMm is double lengthMm ? Mm(lengthMm) : lineLength;
        return new(viewport, sheet, view, Copy(offset), requested, Copy(center), box, label, lineLength,
            requestedLineLength, input.LineLengthMm is not null, typeId, viewport.Rotation,
            OffsetDistance(offset, requested) > 1e-9, Math.Abs(lineLength - requestedLineLength) > 1e-9);
    }

    public static void Validate(Document doc, JsonElement operation) => _ = Capture(doc, operation);

    public static object Preview(Document doc, JsonElement operation)
    {
        var state = Capture(doc, operation);
        return new
        {
            viewportId = state.Viewport.Id.Value, sheetId = state.Sheet.Id.Value, viewId = state.View.Id.Value,
            coordinateFrame = OffsetFrame, offsetZIgnoredByRevit = true,
            oldLabelOffset = Point(state.BeforeOffset), newLabelOffset = Point(state.RequestedOffset),
            oldLabelLineLengthMm = JsonDefaults.InternalToMm(state.LineLength),
            requestedLabelLineLengthMm = JsonDefaults.InternalToMm(state.RequestedLineLength),
            boxCenter = Point(state.BoxCenter), box = OutlineEvidence(state.Box), label = OutlineEvidence(state.Label),
            typeId = state.TypeId, rotation = state.Rotation.ToString(), state.NoOp,
            toleranceMm = OffsetToleranceMm, preservedGeometryToleranceMm = PreservedGeometryToleranceMm,
            requestedLabelBoundsKnown = false, labelOffsetWriteNeeded = state.OffsetWriteNeeded,
            labelLineLengthWriteRequested = state.LineLengthSpecified, labelLineLengthWriteNeeded = state.LineLengthWriteNeeded,
            boxMoveRequested = false, nativeReadbackVerified = false, sideEffectsVerified = false, automaticSave = false
        };
    }

    public OperationReceipt Apply(Document doc, JsonElement operation)
    {
        BindDocument(doc);
        var state = Capture(doc, operation);
        if (completed.Any(item => item.Viewport.Id.Value == state.Viewport.Id.Value))
            throw Invalid("A viewport label operation may execute only once in one approved plan.");
        if (state.OffsetWriteNeeded) state.Viewport.LabelOffset = state.RequestedOffset;
        if (state.LineLengthWriteNeeded) state.Viewport.LabelLineLength = state.RequestedLineLength;
        if (!state.NoOp) doc.Regenerate();
        var after = VerifyState(doc, state);
        completed.Add(new(state.Viewport, state));
        return new([], state.NoOp ? [] : [state.Viewport.Id.Value])
        {
            Evidence = new
            {
                viewportId = state.Viewport.Id.Value, sheetId = state.Sheet.Id.Value, viewId = state.View.Id.Value,
                coordinateFrame = OffsetFrame, offsetZIgnoredByRevit = true,
                oldLabelOffset = Point(state.BeforeOffset), requestedLabelOffset = Point(state.RequestedOffset), newLabelOffset = Point(after.Offset),
                beforeBoxCenter = Point(state.BoxCenter), afterBoxCenter = Point(after.BoxCenter), beforeBox = OutlineEvidence(state.Box), afterBox = OutlineEvidence(after.Box),
                beforeLabel = OutlineEvidence(state.Label), afterLabel = OutlineEvidence(after.Label),
                beforeLabelLineLengthMm = JsonDefaults.InternalToMm(state.LineLength), requestedLabelLineLengthMm = JsonDefaults.InternalToMm(state.RequestedLineLength),
                afterLabelLineLengthMm = JsonDefaults.InternalToMm(after.LineLength), labelLineLengthSpecified = state.LineLengthSpecified,
                typeId = state.TypeId, rotation = state.Rotation.ToString(), noOp = state.NoOp,
                labelOffsetWritePerformed = state.OffsetWriteNeeded, labelLineLengthWritePerformed = state.LineLengthWriteNeeded,
                outcome = state.NoOp ? "no_change" : "write_performed", toleranceMm = OffsetToleranceMm,
                preservedGeometryToleranceMm = PreservedGeometryToleranceMm, boxPlacementPreserved = true,
                labelLineLengthPreserved = Math.Abs(after.LineLength - state.LineLength) <= Mm(OffsetToleranceMm),
                typeRotationAndRelationshipsPreserved = true, nativeReadbackVerified = true, sideEffectsVerified = false, automaticSave = false
            }
        };
    }

    public object VerifyCompleted(Document doc, string phase)
    {
        if (phase is not ("before-transaction-commit" or "after-transaction-commit")) throw Invalid("Unknown viewport label verification phase.");
        BindDocument(doc);
        var checks = completed.Select(item => new { item.State, Actual = VerifyState(doc, item.State) }).ToArray();
        return new
        {
            completedViewportLabelCount = completed.Count,
            completedCount = completed.Count,
            reviewedLabelsComplete = true,
            checks = checks.Select(check => new
            {
                viewportId = check.State.Viewport.Id.Value, sheetId = check.State.Sheet.Id.Value, viewId = check.State.View.Id.Value,
                labelOffset = Point(check.Actual.Offset), labelLineLengthMm = JsonDefaults.InternalToMm(check.Actual.LineLength),
                boxCenter = Point(check.Actual.BoxCenter), box = OutlineEvidence(check.Actual.Box), label = OutlineEvidence(check.Actual.Label),
                offsetVerified = true, lineLengthVerified = true,
                boxPlacementPreserved = true, typeRotationAndRelationshipsPreserved = true, labelBoundsKnown = true
            }).ToArray(),
            verificationPhase = phase,
            sideEffectsVerified = false
        };
    }

    private sealed record Verification(XYZ Offset, double LineLength, XYZ BoxCenter, Bounds Box, Bounds Label);
    private static Verification VerifyState(Document doc, State state)
    {
        var viewport = state.Viewport;
        var actualOffset = viewport.LabelOffset; var actualCenter = viewport.GetBoxCenter();
        var actualBox = ReadBounds(viewport.GetBoxOutline(), "Post-move viewport content outline", true);
        var actualLabel = ReadBounds(viewport.GetLabelOutline(), "Post-move viewport label outline", true);
        var actualLineLength = viewport.LabelLineLength;
        if (!Finite(actualOffset) || OffsetDistance(actualOffset, state.RequestedOffset) > Mm(OffsetToleranceMm))
            throw Invalid("Native viewport label offset differs from the reviewed XY by more than 0.01 mm; roll back.");
        if (!double.IsFinite(actualLineLength) || Math.Abs(actualLineLength - state.RequestedLineLength) > Mm(OffsetToleranceMm))
            throw Invalid("Native viewport label line length differs from the explicit target or preserved baseline; roll back.");
        if (viewport.SheetId != state.Sheet.Id || viewport.OwnerViewId != state.Sheet.Id || viewport.ViewId != state.View.Id ||
            viewport.GetTypeId().Value != state.TypeId || viewport.Rotation != state.Rotation || viewport.Pinned || doc.IsReadOnly ||
            !SamePoint(state.BoxCenter, actualCenter) || !SamePoint(state.Box.Min, actualBox.Min) || !SamePoint(state.Box.Max, actualBox.Max))
            throw Invalid("Native viewport placement, box, type, rotation or relationship changed without approval; roll back.");
        return new(actualOffset, actualLineLength, actualCenter, actualBox, actualLabel);
    }
}
