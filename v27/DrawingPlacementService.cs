using System.Text.Json;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Electrical;

namespace RevitAutoV27;

// One existing placement moves in sheet XY. Referenced sheets/views, scale,
// labels, title blocks and schedule definitions are never modified here.
internal static class DrawingPlacementService
{
    private const double PositionToleranceMm = 1.0;
    private sealed record PlacementState(Element Placement, ViewSheet Sheet, View View, XYZ Before, XYZ Requested, bool NoOp);

    private static BridgeException Invalid(string message, object? details = null) =>
        new("invalid_drawing_placement", message, details);
    private static double Mm(double value) => UnitUtils.ConvertToInternalUnits(value, UnitTypeId.Millimeters);
    private static object Point(XYZ point) => new
    {
        xMm = JsonDefaults.InternalToMm(point.X),
        yMm = JsonDefaults.InternalToMm(point.Y),
        zMm = JsonDefaults.InternalToMm(point.Z)
    };
    private static double PaperDistance(XYZ first, XYZ second) =>
        Math.Sqrt(Math.Pow(first.X - second.X, 2) + Math.Pow(first.Y - second.Y, 2));

    private static long Id(JsonElement op, string field)
        => DrawingPlacementRules.ExistingId(op, field);
    private static Element Required(Document doc, JsonElement op, string field) =>
        doc.GetElement(new ElementId(Id(op, field))) ?? throw Invalid(field + " does not identify an existing element.");
    private static XYZ CurrentPoint(Element placement) => placement switch
    {
        Viewport viewport => viewport.GetBoxCenter(),
        PanelScheduleSheetInstance panel => panel.Origin,
        ScheduleSheetInstance schedule => schedule.Point,
        _ => throw Invalid("placementId must identify Viewport, PanelScheduleSheetInstance, or ScheduleSheetInstance.")
    };
    private static (long SheetId, long ViewId) Relationship(Element placement) => placement switch
    {
        Viewport viewport => (viewport.SheetId.Value, viewport.ViewId.Value),
        PanelScheduleSheetInstance panel => (panel.OwnerViewId.Value, panel.ScheduleId.Value),
        ScheduleSheetInstance schedule => (schedule.OwnerViewId.Value, schedule.ScheduleId.Value),
        _ => throw Invalid("Unknown drawing placement class; movement is refused.")
    };

    private static PlacementState Capture(Document doc, JsonElement op)
    {
        DrawingPlacementRules.Validate(op);
        var requested = new XYZ(Mm(PlanRules.Number(op, "xMm")), Mm(PlanRules.Number(op, "yMm")), 0);
        var placement = Required(doc, op, "placementId");
        var sheet = Required(doc, op, "sheetId") as ViewSheet ?? throw Invalid("sheetId must identify an existing ViewSheet.");
        var view = Required(doc, op, "viewId") as View ?? throw Invalid("viewId must identify an existing view.");
        var relationship = Relationship(placement);
        if (relationship.SheetId != sheet.Id.Value || placement.OwnerViewId != sheet.Id)
            throw Invalid("The placement does not belong to the explicitly reviewed sheet.", new { placementId = placement.Id.Value, expectedSheetId = sheet.Id.Value, actualSheetId = relationship.SheetId });
        if (relationship.ViewId != view.Id.Value)
            throw Invalid("The placement does not display the explicitly reviewed view.", new { placementId = placement.Id.Value, expectedViewId = view.Id.Value, actualViewId = relationship.ViewId });
        if (view.IsTemplate) throw Invalid("A placement move cannot target a view template.");
        if (placement is PanelScheduleSheetInstance && view is not PanelScheduleView ||
            placement is ScheduleSheetInstance && view is not ViewSchedule)
            throw Invalid("The placement class and referenced view class are incompatible.");
        if (placement is Viewport && view is ViewSheet or ViewSchedule or PanelScheduleView)
            throw Invalid("A viewport must display an ordinary placeable view, not a sheet or schedule.");
        if (placement is ScheduleSheetInstance revisionSchedule && revisionSchedule.IsTitleblockRevisionSchedule)
            throw Invalid("Title-block revision schedule placements cannot be moved.");
        if (placement.Pinned) throw Invalid("The placement is pinned; movement will not unpin it.");
        var before = CurrentPoint(placement);
        if (!double.IsFinite(before.X) || !double.IsFinite(before.Y) || !double.IsFinite(before.Z))
            throw Invalid("Native placement position is unknown or non-finite.");
        // Native viewport depth is evidence, not a paper Z offset. No-op uses XY.
        return new(placement, sheet, view, before, requested, PaperDistance(before, requested) <= 1e-9);
    }

    public static object Preview(Document doc, JsonElement op)
    {
        var state = Capture(doc, op);
        return new
        {
            placementId = state.Placement.Id.Value,
            className = state.Placement.GetType().Name,
            sheetId = state.Sheet.Id.Value,
            viewId = state.View.Id.Value,
            oldPosition = Point(state.Before),
            newPosition = Point(state.Requested),
            state.NoOp,
            toleranceMm = PositionToleranceMm,
            nativeReadbackVerified = false,
            sideEffectsVerified = false
        };
    }
    public static void Validate(Document doc, JsonElement op) => _ = Capture(doc, op);

    internal static object Verify(Document doc, JsonElement op, string phase)
    {
        var state = Capture(doc, op);
        var relationship = Relationship(state.Placement);
        var actual = CurrentPoint(state.Placement);
        var expected = new DocumentationPlacementReadback(state.Placement.Id.Value, state.Placement.GetType().Name,
            state.Sheet.Id.Value, state.View.Id.Value, JsonDefaults.InternalToMm(state.Requested.X), JsonDefaults.InternalToMm(state.Requested.Y), 0);
        var native = new DocumentationPlacementReadback(state.Placement.Id.Value, state.Placement.GetType().Name,
            relationship.SheetId, relationship.ViewId, JsonDefaults.InternalToMm(actual.X), JsonDefaults.InternalToMm(actual.Y), JsonDefaults.InternalToMm(actual.Z));
        DocumentationReadbackRules.RequirePlacement(expected, native);
        return new { phase, placementId = native.PlacementId, className = native.ClassName, sheetId = native.SheetId, viewId = native.ViewId,
            expectedPosition = new { xMm = expected.Xmm, yMm = expected.Ymm, zMm = expected.Zmm },
            actualPosition = new { xMm = native.Xmm, yMm = native.Ymm, zMm = native.Zmm },
            nativeReadbackVerified = true, sideEffectsVerified = false, persistenceVerified = false, visualVerified = false };
    }

    internal static object VerifyReadback(Document doc, JsonElement op, string phase, bool writePerformed)
    {
        if (phase is not ("before-transaction-commit" or "after-transaction-commit"))
            throw Invalid("Unknown drawing placement verification phase.");
        var state = Capture(doc, op);
        var actual = CurrentPoint(state.Placement);
        var relationship = Relationship(state.Placement);
        var expectedEvidence = new DocumentationPlacementReadback(
            state.Placement.Id.Value,
            state.Placement.GetType().Name,
            state.Sheet.Id.Value,
            state.View.Id.Value,
            JsonDefaults.InternalToMm(state.Requested.X),
            JsonDefaults.InternalToMm(state.Requested.Y),
            JsonDefaults.InternalToMm(state.Requested.Z));
        var actualEvidence = new DocumentationPlacementReadback(
            state.Placement.Id.Value,
            state.Placement.GetType().Name,
            relationship.SheetId,
            relationship.ViewId,
            JsonDefaults.InternalToMm(actual.X),
            JsonDefaults.InternalToMm(actual.Y),
            JsonDefaults.InternalToMm(actual.Z));
        DocumentationReadbackRules.RequirePlacement(expectedEvidence, actualEvidence);
        return new
        {
            placementId = state.Placement.Id.Value,
            className = state.Placement.GetType().Name,
            sheetId = state.Sheet.Id.Value,
            viewId = state.View.Id.Value,
            requestedPosition = Point(state.Requested),
            actualPosition = Point(actual),
            noOp = !writePerformed,
            placementWritePerformed = writePerformed,
            outcome = writePerformed ? "write_performed" : "no_change",
            toleranceMm = 1.0,
            nativeReadbackVerified = true,
            sideEffectsVerified = false,
            persistenceVerified = false,
            visualVerified = false,
            verificationPhase = phase
        };
    }

    // Called inside the existing approved write transaction. Capture repeats the
    // native type/owner/view checks immediately before the one permitted setter.
    public static OperationReceipt Apply(Document doc, JsonElement op)
    {
        var state = Capture(doc, op);
        if (!state.NoOp)
        {
            switch (state.Placement)
            {
                case Viewport viewport: viewport.SetBoxCenter(state.Requested); break;
                case PanelScheduleSheetInstance panel: panel.Origin = state.Requested; break;
                case ScheduleSheetInstance schedule: schedule.Point = state.Requested; break;
                default: throw Invalid("Unknown drawing placement class; movement is refused.");
            }
            doc.Regenerate();
        }
        var actual = CurrentPoint(state.Placement);
        var relationship = Relationship(state.Placement);
        if (!double.IsFinite(actual.X) || !double.IsFinite(actual.Y) || !double.IsFinite(actual.Z) ||
            PaperDistance(actual, state.Requested) > Mm(PositionToleranceMm) ||
            relationship.SheetId != state.Sheet.Id.Value || relationship.ViewId != state.View.Id.Value)
            throw Invalid("Native placement readback differs from the reviewed relationship or paper XY by more than 1 mm; the plan must roll back.");
        return new([], state.NoOp ? [] : [state.Placement.Id.Value])
        {
            Evidence = new
            {
                placementId = state.Placement.Id.Value,
                className = state.Placement.GetType().Name,
                sheetId = state.Sheet.Id.Value,
                viewId = state.View.Id.Value,
                oldPosition = Point(state.Before),
                requestedPosition = Point(state.Requested),
                newPosition = Point(actual),
                noOp = state.NoOp,
                placementWritePerformed = !state.NoOp,
                outcome = state.NoOp ? "no_change" : "write_performed",
                toleranceMm = PositionToleranceMm,
                nativeReadbackVerified = true,
                sideEffectsVerified = false
            }
        };
    }
}
