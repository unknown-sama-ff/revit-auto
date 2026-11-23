using System.Text.Json;
using Autodesk.Revit.DB;

namespace RevitAutoV27;

// Controlled 2D TextNote and DetailCurve creation selectively adapted from bimwright/rvt-mcp
// commit b44ee0b8032f0603f8e52656bc05ab43aa599263 (CreateTextNoteHandler, CreateDetailLineHandler;
// Apache-2.0). Removes implicit ActiveView/default-type selection and independent transactions,
// enforces explicit view-plane tolerance, and repeats readback inside the shared transaction group.
internal sealed class AnnotationCreationService
{
    private sealed record Binding(
        long ElementId,
        string UniqueId,
        string Kind,
        string ViewUniqueId,
        string? TypeOrStyleUniqueId,
        AnnotationPointMm ProjectedPrimaryMm,
        AnnotationPointMm? ProjectedSecondaryMm,
        TextNoteInput? TextInput,
        DetailLineInput? LineInput);

    private readonly List<Binding> completed = [];
    private Document? capturedDocument;

    private static BridgeException Invalid(string message) => AnnotationCreationRules.Invalid(message);
    private static double Mm(double value) => UnitUtils.ConvertToInternalUnits(value, UnitTypeId.Millimeters);
    private static AnnotationPointMm PointMm(XYZ p) => new(JsonDefaults.InternalToMm(p.X), JsonDefaults.InternalToMm(p.Y), JsonDefaults.InternalToMm(p.Z));
    private static XYZ ToXyz(AnnotationPointMm p) => new(Mm(p.XMm), Mm(p.YMm), Mm(p.ZMm));

    public static void Validate(Document doc, JsonElement op)
    {
        if (!doc.IsValidObject || doc.IsFamilyDocument)
            throw Invalid("2D annotation creation requires a valid project document.");
        var kind = JsonDefaults.String(op, "operationType");
        if (kind == "create_text_note")
        {
            var input = AnnotationCreationRules.ValidateTextNote(op);
            var view = RequireHostView(doc, input.ViewId);
            var textType = RequireElement<TextNoteType>(doc, input.TextTypeId, "textTypeId");
            if (input.WidthMm is double widthMm)
            {
                var minMm = JsonDefaults.InternalToMm(TextElement.GetMinimumAllowedWidth(doc, textType.Id));
                var maxMm = JsonDefaults.InternalToMm(TextElement.GetMaximumAllowedWidth(doc, textType.Id));
                if (widthMm < minMm - 1e-6 || widthMm > maxMm + 1e-6)
                    throw Invalid($"widthMm ({widthMm}) is outside Revit's allowed range [{minMm}, {maxMm}] mm for this TextNoteType.");
            }
            _ = ProjectOntoViewPlane(view, input.Point, "point");
        }
        else if (kind == "create_detail_line")
        {
            var input = AnnotationCreationRules.ValidateDetailLine(op);
            var view = RequireHostView(doc, input.ViewId);
            if (input.LineStyleId is long styleId)
                _ = RequireLineStyle(doc, styleId);
            var start = ProjectOntoViewPlane(view, input.Start, "start");
            var end = ProjectOntoViewPlane(view, input.End, "end");
            if (start.DistanceTo(end) <= doc.Application.ShortCurveTolerance)
                throw Invalid("Projected detail line length is shorter than Revit's ShortCurveTolerance.");
        }
        else
        {
            throw Invalid("Expected create_text_note or create_detail_line.");
        }
    }

    public static object Preview(Document doc, JsonElement op)
    {
        Validate(doc, op);
        var kind = JsonDefaults.String(op, "operationType")!;
        if (kind == "create_text_note")
        {
            var input = AnnotationCreationRules.ValidateTextNote(op);
            var view = RequireHostView(doc, input.ViewId);
            var textType = RequireElement<TextNoteType>(doc, input.TextTypeId, "textTypeId");
            var projected = ProjectOntoViewPlane(view, input.Point, "point");
            return new
            {
                operationType = kind,
                viewId = view.Id.Value,
                viewName = view.Name,
                viewType = view.ViewType.ToString(),
                textTypeId = textType.Id.Value,
                textTypeName = textType.Name,
                projectedPointMm = PointMm(projected),
                widthMm = input.WidthMm,
                rotationDegrees = input.RotationDegrees,
                coordinateFrame = "Revit internal/project origin (or sheet/drafting XY), millimeters",
                nativeAcceptance = false,
                visualLayoutVerified = false,
                allModelSideEffectsVerified = false
            };
        }
        var lineInput = AnnotationCreationRules.ValidateDetailLine(op);
        var lineView = RequireHostView(doc, lineInput.ViewId);
        var style = lineInput.LineStyleId is long id ? RequireLineStyle(doc, id) : null;
        var projectedStart = ProjectOntoViewPlane(lineView, lineInput.Start, "start");
        var projectedEnd = ProjectOntoViewPlane(lineView, lineInput.End, "end");
        return new
        {
            operationType = kind,
            viewId = lineView.Id.Value,
            viewName = lineView.Name,
            viewType = lineView.ViewType.ToString(),
            lineStyleId = style?.Id.Value,
            lineStyleName = style?.Name,
            projectedStartMm = PointMm(projectedStart),
            projectedEndMm = PointMm(projectedEnd),
            coordinateFrame = "Revit internal/project origin (or sheet/drafting XY), millimeters",
            nativeAcceptance = false,
            visualLayoutVerified = false,
            allModelSideEffectsVerified = false
        };
    }

    internal OperationReceipt Create(Document doc, JsonElement op)
    {
        Validate(doc, op);
        if (!doc.IsModifiable)
            throw Invalid("The plan executor must own an active native transaction.");
        RequireDocument(doc, capture: true);
        var kind = JsonDefaults.String(op, "operationType")!;

        Binding binding;
        if (kind == "create_text_note")
        {
            var input = AnnotationCreationRules.ValidateTextNote(op);
            var view = RequireHostView(doc, input.ViewId);
            var textType = RequireElement<TextNoteType>(doc, input.TextTypeId, "textTypeId");
            var pos = ProjectOntoViewPlane(view, input.Point, "point");
            var note = input.WidthMm is double widthMm
                ? TextNote.Create(doc, view.Id, pos, Mm(widthMm), input.Text, textType.Id)
                : TextNote.Create(doc, view.Id, pos, input.Text, textType.Id);
            if (note is null || !note.IsValidObject)
                throw Invalid("Revit did not create a TextNote.");
            if (Math.Abs(input.RotationDegrees) > 1e-6)
            {
                var axisDir = (view is ViewSheet or ViewDrafting || view.ViewDirection.GetLength() < 1e-6)
                    ? XYZ.BasisZ
                    : view.ViewDirection.Normalize();
                using var axis = Line.CreateBound(pos, pos + axisDir);
                ElementTransformUtils.RotateElement(doc, note.Id, axis, input.RotationDegrees * Math.PI / 180.0);
            }
            doc.Regenerate();
            binding = new(note.Id.Value, note.UniqueId, kind, view.UniqueId, textType.UniqueId,
                PointMm(pos), null, input, null);
        }
        else
        {
            var input = AnnotationCreationRules.ValidateDetailLine(op);
            var view = RequireHostView(doc, input.ViewId);
            var style = input.LineStyleId is long styleId ? RequireLineStyle(doc, styleId) : null;
            var start = ProjectOntoViewPlane(view, input.Start, "start");
            var end = ProjectOntoViewPlane(view, input.End, "end");
            using var line = Line.CreateBound(start, end);
            var detailCurve = doc.Create.NewDetailCurve(view, line)
                ?? throw Invalid("Revit did not create a DetailCurve.");
            if (style is not null)
                detailCurve.LineStyle = style;
            doc.Regenerate();
            binding = new(detailCurve.Id.Value, detailCurve.UniqueId, kind, view.UniqueId, style?.UniqueId,
                PointMm(start), PointMm(end), null, input);
        }

        var evidence = Verify(doc, binding, "immediate-after-creation");
        completed.Add(binding);
        return OperationReceipt.New(binding.ElementId) with { Evidence = evidence };
    }

    internal object? VerifyCompleted(Document doc, string phase)
    {
        if (completed.Count == 0) return null;
        RequireDocument(doc, capture: true);
        var elements = completed.Select(b => Verify(doc, b, phase)).ToArray();
        return new
        {
            phase,
            verifiedElementCount = elements.Length,
            nativeReadbackVerified = true,
            visualLayoutVerified = false,
            allModelSideEffectsVerified = false,
            elements
        };
    }

    internal static object? Inspect(Element element)
    {
        if (element is TextNote note)
        {
            try
            {
                var actual = ReadTextNote(note);
                return NativeReadSnapshot.Freeze(new
                {
                    supported = true,
                    kind = "create_text_note",
                    native = actual,
                    visualLayoutVerified = false,
                    allModelSideEffectsVerified = false
                });
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex) { return new { supported = false, reason = ex.Message }; }
        }
        if (element is DetailCurve curve)
        {
            try
            {
                var actual = ReadDetailLine(curve);
                return NativeReadSnapshot.Freeze(new
                {
                    supported = true,
                    kind = "create_detail_line",
                    native = actual,
                    visualLayoutVerified = false,
                    allModelSideEffectsVerified = false
                });
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex) { return new { supported = false, reason = ex.Message }; }
        }
        return null;
    }

    private static object Verify(Document doc, Binding binding, string phase)
    {
        if (binding.Kind == "create_text_note")
        {
            var input = binding.TextInput!;
            var view = RequireHostView(doc, input.ViewId);
            var textType = RequireElement<TextNoteType>(doc, input.TextTypeId, "textTypeId");
            if (view.UniqueId != binding.ViewUniqueId || textType.UniqueId != binding.TypeOrStyleUniqueId)
                throw Invalid("Target view or text type identity changed before annotation verification.");
            if (doc.GetElement(new ElementId(binding.ElementId)) is not TextNote { IsValidObject: true } note)
                throw Invalid("Created TextNote disappeared or became invalid before verification.");
            var actual = ReadTextNote(note);
            AnnotationCreationRules.RequireTextNote(input, binding.ProjectedPrimaryMm, binding.UniqueId, actual);
            return NativeReadSnapshot.Freeze(new
            {
                phase,
                elementId = actual.ElementId,
                uniqueId = actual.UniqueId,
                kind = binding.Kind,
                native = actual,
                nativeReadbackVerified = true,
                visualLayoutVerified = false,
                allModelSideEffectsVerified = false
            });
        }
        else
        {
            var input = binding.LineInput!;
            var view = RequireHostView(doc, input.ViewId);
            if (view.UniqueId != binding.ViewUniqueId)
                throw Invalid("Target view identity changed before detail line verification.");
            if (input.LineStyleId is long styleId)
            {
                var style = RequireLineStyle(doc, styleId);
                if (style.UniqueId != binding.TypeOrStyleUniqueId)
                    throw Invalid("Line style identity changed before detail line verification.");
            }
            if (doc.GetElement(new ElementId(binding.ElementId)) is not DetailCurve { IsValidObject: true } curve)
                throw Invalid("Created DetailCurve disappeared or became invalid before verification.");
            var actual = ReadDetailLine(curve);
            AnnotationCreationRules.RequireDetailLine(input, binding.ProjectedPrimaryMm, binding.ProjectedSecondaryMm!.Value, binding.UniqueId, actual);
            return NativeReadSnapshot.Freeze(new
            {
                phase,
                elementId = actual.ElementId,
                uniqueId = actual.UniqueId,
                kind = binding.Kind,
                native = actual,
                nativeReadbackVerified = true,
                visualLayoutVerified = false,
                allModelSideEffectsVerified = false
            });
        }
    }

    private static TextNoteReadback ReadTextNote(TextNote note)
    {
        if (!note.IsValidObject) throw Invalid("TextNote is invalid.");
        return new(
            note.Id.Value,
            note.UniqueId,
            note.OwnerViewId.Value,
            note.GetTypeId().Value,
            note.Text ?? string.Empty,
            PointMm(note.Coord),
            JsonDefaults.InternalToMm(note.Width));
    }

    private static DetailLineReadback ReadDetailLine(DetailCurve curve)
    {
        if (!curve.IsValidObject) throw Invalid("DetailCurve is invalid.");
        if (curve.GeometryCurve is not Line { IsBound: true } line)
            throw Invalid("DetailCurve geometry is not a bounded line.");
        return new(
            curve.Id.Value,
            curve.UniqueId,
            curve.OwnerViewId.Value,
            curve.LineStyle?.Id.Value ?? -1,
            PointMm(line.GetEndPoint(0)),
            PointMm(line.GetEndPoint(1)),
            JsonDefaults.InternalToMm(line.Length));
    }

    private static View RequireHostView(Document doc, long viewId)
    {
        var view = RequireElement<View>(doc, viewId, "viewId");
        if (view.IsTemplate)
            throw Invalid("Cannot place 2D annotations on a view template.");
        if (view is View3D or ViewSchedule ||
            view.ViewType is ViewType.ThreeD or ViewType.Schedule or ViewType.PanelSchedule or ViewType.ColumnSchedule
                or ViewType.ProjectBrowser or ViewType.SystemBrowser or ViewType.Legend or ViewType.Internal
                or ViewType.Undefined or ViewType.Rendering or ViewType.Walkthrough or ViewType.Report
                or ViewType.CostReport or ViewType.LoadsReport or ViewType.PressureLossReport or ViewType.SystemsAnalysisReport)
            throw Invalid($"View type '{view.ViewType}' does not support controlled 2D annotations.");
        return view;
    }

    private static GraphicsStyle RequireLineStyle(Document doc, long styleId)
    {
        var style = RequireElement<GraphicsStyle>(doc, styleId, "lineStyleId");
        if (style.GraphicsStyleType != GraphicsStyleType.Projection)
            throw Invalid("lineStyleId must reference a Projection GraphicsStyle.");
        var category = style.GraphicsStyleCategory;
        var isLinesCategory = category is not null &&
            (category.Id.Value == (long)BuiltInCategory.OST_Lines ||
             category.Parent?.Id.Value == (long)BuiltInCategory.OST_Lines);
        if (!isLinesCategory)
            throw Invalid("lineStyleId must belong to the Revit Lines (OST_Lines) category.");
        return style;
    }

    private static T RequireElement<T>(Document doc, long id, string field) where T : Element =>
        doc.GetElement(new ElementId(id)) is T { IsValidObject: true } item && item.Document.Equals(doc)
            ? item
            : throw Invalid($"{field} ({id}) does not resolve to an existing {typeof(T).Name} in the active document.");

    private static XYZ ProjectOntoViewPlane(View view, AnnotationPointMm pointMm, string field)
    {
        var raw = ToXyz(pointMm);
        if (view is ViewSheet || view.ViewType is ViewType.DrawingSheet or ViewType.DraftingView)
        {
            if (Math.Abs(pointMm.ZMm) > AnnotationCreationRules.ToleranceMm)
                throw Invalid($"{field}.zMm ({pointMm.ZMm} mm) must be within 1 mm of 0 for sheet or drafting views.");
            return new XYZ(raw.X, raw.Y, 0);
        }

        var dir = view.ViewDirection;
        if (dir is null || dir.GetLength() < 1e-6)
            throw Invalid($"Target view {view.Id.Value} has no valid ViewDirection.");
        var normal = dir.Normalize();
        var signedFeet = (raw - view.Origin).DotProduct(normal);
        var distanceMm = Math.Abs(JsonDefaults.InternalToMm(signedFeet));
        if (!double.IsFinite(distanceMm) || distanceMm > AnnotationCreationRules.ToleranceMm)
            throw Invalid($"{field} lies {distanceMm:F3} mm from the target view plane (limit 1 mm).");
        return raw - signedFeet * normal;
    }

    private void RequireDocument(Document doc, bool capture)
    {
        if (capturedDocument is null && capture) capturedDocument = doc;
        if (!doc.IsValidObject || (capturedDocument is not null && (!capturedDocument.IsValidObject || !capturedDocument.Equals(doc))))
            throw Invalid("2D annotation evidence belongs to an invalid or different native document.");
    }
}
