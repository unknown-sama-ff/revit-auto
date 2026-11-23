using System.Text.Json;
using CurveEvidence = RevitAutoV27.RebarCurveEvidence;
using static RevitAutoV27.RebarCreationRules;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;

namespace RevitAutoV27;

// Selective Apache-2.0 adaptation: bimwright/rvt-mcp, fixed commit
// b44ee0b8032f0603f8e52656bc05ab43aa599263, CreateRebarSetHandler.cs and
// CreateRebarStirrupHandler.cs. Native factories/layout calls only; the shared
// executor owns transactions, rollback and event receipts. Never saves.
internal sealed class RebarCreationService
{
    private const int MaxCurves = 64;
    private sealed record ShapeParameter(long ParameterId, double DefaultValue, string Formula);
    private sealed record ShapeSource(long ShapeId, string UniqueId, string Style, int SegmentCount, int HookAngleAtStartDeg, int HookAngleAtEndDeg,
        RebarPoint[]? DefaultDrivingPolygon, ShapeParameter[] Parameters, CurveEvidence[] BrowserCurves);
    private sealed record PositionEvidence(int Index, bool Included, RebarPoint TranslationMm, RebarVector BasisX, RebarVector BasisY, RebarVector BasisZ);
    private sealed record NativeSnapshot(long ElementId, string UniqueId, long HostElementId, string HostUniqueId, long BarTypeId, string BarTypeUniqueId,
        long ShapeId, string ShapeUniqueId, string Style, string LayoutRule, int NumberOfBarPositions, int Quantity, double? ArrayLengthMm, double? MaximumSpacingMm,
        bool? BarsOnNormalSide, bool? IncludeFirstBar, bool? IncludeLastBar, RebarVector Normal, CurveEvidence[] DrivingCurves,
        int CenterlineSourceIndex, CurveEvidence[] BaseCenterlineCurves, CurveEvidence? DistributionPath, PositionEvidence[] Positions);
    private sealed record Binding(long ElementId, string UniqueId, string HostUniqueId, string BarTypeUniqueId, string ShapeUniqueId,
        JsonElement Reviewed, ShapeSource? Source, CurveEvidence[] ImmediateCenterline);
    private readonly List<Binding> completed = [];
    private Document? capturedDocument;
    private static BridgeException Invalid(string message) => RebarCreationRules.Invalid(message);
    private static double Mm(double value) => UnitUtils.ConvertToInternalUnits(value, UnitTypeId.Millimeters);
    private static double ToMm(double value) => UnitUtils.ConvertFromInternalUnits(value, UnitTypeId.Millimeters);
    private static XYZ Native(RebarPoint point) => new(Mm(point.XMm), Mm(point.YMm), Mm(point.ZMm));
    private static XYZ Native(RebarVector vector) => new(vector.X, vector.Y, vector.Z);
    private static RebarPoint Point(XYZ value)
    {
        var point = new RebarPoint(ToMm(value.X), ToMm(value.Y), ToMm(value.Z));
        if (!double.IsFinite(point.XMm) || !double.IsFinite(point.YMm) || !double.IsFinite(point.ZMm) ||
            Math.Max(Math.Abs(point.XMm), Math.Max(Math.Abs(point.YMm), Math.Abs(point.ZMm))) > 1e8) throw Invalid("Native rebar point exceeds the finite absolute XYZ evidence bound.");
        return point;
    }
    private static RebarVector Vector(XYZ value)
    {
        var vector = new RebarVector(value.X, value.Y, value.Z);
        if (!double.IsFinite(RebarCreationRules.Length(vector))) throw Invalid("Native rebar direction is non-finite.");
        return vector;
    }
    private static T Existing<T>(Document doc, long id, string field) where T : Element =>
        doc.GetElement(new ElementId(id)) as T ?? throw Invalid(field + " does not resolve to an existing " + typeof(T).Name + " in this document.");
    private static Element Host(Document doc, RebarCreationInput input)
    {
        var host = Existing<Element>(doc, input.HostElementId, "hostElementId");
        if (host is ElementType || !RebarHostData.IsValidHost(host)) throw Invalid("The explicit host is not currently a valid native rebar host; host properties are never changed.");
        return host;
    }
    public static void Validate(Document doc, JsonElement op)
    {
        var input = RebarCreationRules.Validate(op);
        if (doc.IsFamilyDocument || doc.IsReadOnly) throw Invalid("Rebar creation requires a writable project document.");
        _ = Host(doc, input);
        var type = Existing<RebarBarType>(doc, input.BarTypeId, "barTypeId");
        if (input.OperationType == "create_rebar_set")
        {
            if (Native(input.Start!).DistanceTo(Native(input.End!)) <= doc.Application.ShortCurveTolerance)
                throw Invalid("Straight rebar length does not exceed Revit's current short-curve tolerance.");
        }
        else _ = Source(doc, input, type);
    }
    public static object Preview(Document doc, JsonElement op)
    {
        Validate(doc, op); var input = RebarCreationRules.Validate(op); var host = Host(doc, input);
        var type = Existing<RebarBarType>(doc, input.BarTypeId, "barTypeId");
        return new { operationType = input.OperationType, reviewedInput = op, hostElementId = host.Id.Value, hostUniqueId = host.UniqueId,
            barTypeId = type.Id.Value, barTypeUniqueId = type.UniqueId, barTypeName = type.Name,
            shapeSource = input.ShapeId.HasValue ? Source(doc, input, type) : null,
            coordinateFrame = "Revit internal origin; absolute XYZ millimeters; directions dimensionless",
            input.Layout, normal = RebarCreationRules.ExpectedNormal(input),
            quantitySemantics = "FixedNumber.quantity means potential positions; endpoint exclusions reduce actual Quantity",
            shapeMutationRequested = false, allowNewShape = input.AllowNewShape, createNewShape = input.AllowNewShape,
            possibleAdditionalCreatedElement = input.AllowNewShape ? "RebarShape; separately recorded by the native change receipt" : null,
            nativeReadbackVerified = false, nativeAcceptance = false,
            sideEffectsVerified = false, persistenceVerified = false, engineeringComplianceVerified = false, automaticSave = false };
    }
    public OperationReceipt Create(Document doc, JsonElement op)
    {
        BindDocument(doc); Validate(doc, op);
        if (!doc.IsModifiable) throw Invalid("Rebar creation requires the executor's active transaction.");
        var input = RebarCreationRules.Validate(op); var host = Host(doc, input);
        var type = Existing<RebarBarType>(doc, input.BarTypeId, "barTypeId");
        var source = input.ShapeId.HasValue ? Source(doc, input, type) : null;
        Rebar rebar;
        if (source is null)
        {
            using var terms = new BarTerminationsData(doc);
            // Explicitly preserve the controlled no-hook/no-crank/no-treatment intent.
            terms.HookTypeIdAtStart = ElementId.InvalidElementId; terms.HookTypeIdAtEnd = ElementId.InvalidElementId;
            terms.CrankTypeIdAtStart = ElementId.InvalidElementId; terms.CrankTypeIdAtEnd = ElementId.InvalidElementId;
            terms.EndTreatmentTypeIdAtStart = ElementId.InvalidElementId; terms.EndTreatmentTypeIdAtEnd = ElementId.InvalidElementId;
            using var line = Line.CreateBound(Native(input.Start!), Native(input.End!));
            // A new project-wide shape is allowed only by the explicit opt-in.
            // Its native ID is read back below and type creation is independently
            // captured by the executor's native change receipt.
            rebar = Rebar.CreateFromCurves(doc, RebarStyle.Standard, type, host, Native(input.Normal!), [line], terms,
                useExistingShapeIfPossible: true, createNewShape: input.AllowNewShape) ?? throw Invalid("No compatible straight rebar shape was available under the reviewed allowNewShape policy.");
        }
        else
        {
            var shape = Existing<RebarShape>(doc, source.ShapeId, "shapeId");
            rebar = Rebar.CreateFromRebarShape(doc, shape, type, host, Native(input.Origin!), Native(input.XDirection!), Native(input.YDirection!))
                ?? throw Invalid("Revit returned no shape-driven stirrup.");
        }
        using (var accessor = rebar.GetShapeDrivenAccessor())
        {
            var layout = input.Layout;
            switch (layout.Rule)
            {
                case "Single": accessor.SetLayoutAsSingle(); break;
                case "FixedNumber": accessor.SetLayoutAsFixedNumber(layout.Positions, Mm(layout.ArrayLengthMm!.Value), layout.BarsOnNormalSide!.Value, layout.IncludeFirstBar!.Value, layout.IncludeLastBar!.Value); break;
                case "MaximumSpacing": accessor.SetLayoutAsMaximumSpacing(Mm(layout.SpacingMm!.Value), Mm(layout.ArrayLengthMm!.Value), layout.BarsOnNormalSide!.Value, layout.IncludeFirstBar!.Value, layout.IncludeLastBar!.Value); break;
                default: throw Invalid("Unsupported reviewed layout.");
            }
        }
        doc.Regenerate();
        if (source is not null)
        {
            var expectedNormal = RebarCreationRules.ExpectedNormal(input);
            using var alignAccessor = rebar.GetShapeDrivenAccessor();
            var initialDriving = Curves(alignAccessor.ComputeDrivingCurves());
            var planeOffsetMm = RebarCreationRules.CoplanarPlaneOffsetMm(input.Origin!, expectedNormal, initialDriving, "native stirrup driving curves");
            if (Math.Abs(planeOffsetMm) > RebarCreationRules.PositionToleranceMm)
            {
                var translation = new XYZ(Mm(-expectedNormal.X * planeOffsetMm), Mm(-expectedNormal.Y * planeOffsetMm), Mm(-expectedNormal.Z * planeOffsetMm));
                ElementTransformUtils.MoveElement(doc, rebar.Id, translation);
                doc.Regenerate();
            }
        }
        var read = Read(rebar);
        if (read.ElementId <= 0 || string.IsNullOrWhiteSpace(read.UniqueId) || completed.Any(item => item.ElementId == read.ElementId)) throw Invalid("Creation did not return a distinct native identity.");
        var binding = new Binding(read.ElementId, read.UniqueId, host.UniqueId, type.UniqueId, read.ShapeUniqueId, op.Clone(), source, read.BaseCenterlineCurves);
        // Verify against input/source first. The immediate curve snapshot is only
        // an additional between-phase invariant, never the original geometry proof.
        var evidence = Verify(doc, binding); completed.Add(binding);
        return new([rebar.Id.Value], []) { Evidence = evidence, ReadbackBinding = new { elementId = rebar.Id.Value, uniqueId = rebar.UniqueId, operationType = input.OperationType } };
    }
    public object VerifyCompleted(Document doc, string phase)
    {
        BindDocument(doc);
        if (string.IsNullOrWhiteSpace(phase)) throw Invalid("Readback phase must be explicit.");
        var evidence = completed.Select(binding => Verify(doc, binding)).ToArray();
        return new { phase, verifiedElementCount = evidence.Length, nativeReadbackVerified = true, elements = evidence,
            sideEffectsVerified = false, persistenceVerified = false, visualVerified = false, engineeringComplianceVerified = false };
    }
    private void BindDocument(Document doc)
    {
        if (capturedDocument is null) capturedDocument = doc;
        else if (!capturedDocument.IsValidObject || !capturedDocument.Equals(doc)) throw Invalid("Rebar readback belongs to a different native document.");
    }
    private static object Verify(Document doc, Binding binding)
    {
        var input = RebarCreationRules.Validate(binding.Reviewed);
        var rebar = Existing<Rebar>(doc, binding.ElementId, "created rebar"); var native = Read(rebar);
        if (!rebar.Document.Equals(doc) || native.UniqueId != binding.UniqueId || native.HostElementId != input.HostElementId || native.HostUniqueId != binding.HostUniqueId ||
            native.BarTypeId != input.BarTypeId || native.BarTypeUniqueId != binding.BarTypeUniqueId || native.ShapeUniqueId != binding.ShapeUniqueId ||
            native.LayoutRule != input.Layout.Rule || native.NumberOfBarPositions != input.Layout.Positions || native.Quantity != input.Layout.Quantity ||
            native.Style != (input.ShapeId.HasValue ? RebarStyle.StirrupTie.ToString() : RebarStyle.Standard.ToString()) ||
            input.ShapeId.HasValue && native.ShapeId != input.ShapeId.Value) throw Invalid("Native rebar identity, host, bar type, shape, style, layout or quantity differs from the reviewed operation.");
        _ = Host(doc, input);
        if (binding.Source is null) RequireNoTerminations(rebar); else RequireStirrupTerminations(rebar, binding.Source);
        RebarCreationRules.RequireVector(RebarCreationRules.ExpectedNormal(input), native.Normal, "native shape plane normal");
        if (input.Layout.Rule != "Single")
        {
            RebarCreationRules.RequireLength(input.Layout.ArrayLengthMm!.Value, native.ArrayLengthMm ?? double.NaN, "native array length");
            if (native.BarsOnNormalSide != input.Layout.BarsOnNormalSide || native.IncludeFirstBar != input.Layout.IncludeFirstBar || native.IncludeLastBar != input.Layout.IncludeLastBar)
                throw Invalid("Native layout side or endpoint inclusion differs from the explicit reviewed booleans.");
            if (input.Layout.SpacingMm.HasValue) RebarCreationRules.RequireLength(input.Layout.SpacingMm.Value, native.MaximumSpacingMm ?? double.NaN, "native maximum spacing");
            if (native.DistributionPath is not { Kind: "Line" } path) throw Invalid("The native distribution path is not a bounded line.");
            RebarCreationRules.RequirePoint(new(0,0,0), path.Start, "distribution path start");
            RebarCreationRules.RequirePoint(RebarCreationRules.Add(new(0,0,0), RebarCreationRules.ExpectedOffset(input, input.Layout.Positions-1)), path.End, "distribution path end");
        }
        if (binding.Source is null)
        {
            if (native.DrivingCurves.Length != 1 || native.DrivingCurves[0].Kind != "Line") throw Invalid("Native straight rebar driving geometry is not exactly one bounded line.");
            RequireLine(input.Start!, input.End!, native.DrivingCurves[0], "straight rebar driving line");
            if (native.BaseCenterlineCurves.Length != 1 || native.BaseCenterlineCurves[0].Kind != "Line") throw Invalid("No-termination straight rebar has unexpected centerline segments.");
            RequireLine(input.Start!, input.End!, native.BaseCenterlineCurves[0], "straight rebar centerline");
        }
        else
        {
            var source = Source(doc, input, Existing<RebarBarType>(doc, input.BarTypeId, "barTypeId"));
            RequireSource(binding.Source, source); RequireShapeParameters(rebar, source);
            var expectedNormal = RebarCreationRules.ExpectedNormal(input);
            if (binding.Source.DefaultDrivingPolygon is not null)
            {
                var polygon = binding.Source.DefaultDrivingPolygon.Select(point => MapDefaultPoint(input, point)).ToArray();
                if (native.DrivingCurves.Length != polygon.Length) throw Invalid("Native stirrup driving topology differs from the loaded shape's default polygon.");
                RequirePolygon(polygon, native.DrivingCurves);
                RequireClosed(native.BaseCenterlineCurves, "native stirrup centerline");
                RebarCreationRules.RequirePlanarInShapePlane(input.Origin!, expectedNormal, native.BaseCenterlineCurves, "native physical centerline");
            }
            else
            {
                if (native.DrivingCurves.Length != binding.Source.SegmentCount || native.DrivingCurves.Any(curve => curve.Kind != "Line"))
                    throw Invalid("Native hooked stirrup driving topology differs from the loaded shape segment count.");
                RebarCreationRules.RequirePlanarInShapePlane(input.Origin!, expectedNormal, native.DrivingCurves, "native hooked stirrup driving curves");
                RebarCreationRules.RequirePlanarInShapePlane(input.Origin!, expectedNormal, native.BaseCenterlineCurves, "native hooked stirrup centerline");
                var suppressedHookCenterline = Curves(rebar.GetCenterlineCurves(false, true, false, MultiplanarOption.IncludeAllMultiplanarCurves, native.CenterlineSourceIndex));
                RebarCreationRules.RequirePlanarInShapePlane(input.Origin!, expectedNormal, suppressedHookCenterline, "native hooked stirrup suppressed-hook centerline");
            }
        }
        RequireCurves(binding.ImmediateCenterline, native.BaseCenterlineCurves, new(0,0,0), "between-phase base centerline");
        foreach (var position in native.Positions)
        {
            if (position.Included != RebarCreationRules.Included(input.Layout, position.Index)) throw Invalid("A native individual bar inclusion differs from the reviewed layout.");
            var offset = RebarCreationRules.ExpectedOffset(input, position.Index);
            RebarCreationRules.RequirePoint(RebarCreationRules.Add(new(0,0,0), offset), position.TranslationMm, "native bar position transform");
            RebarCreationRules.RequireVector(new(1,0,0), position.BasisX, "bar transform BasisX");
            RebarCreationRules.RequireVector(new(0,1,0), position.BasisY, "bar transform BasisY");
            RebarCreationRules.RequireVector(new(0,0,1), position.BasisZ, "bar transform BasisZ");
            if (!position.Included) continue;
            // Unlike GetCenterlineCurves, this API includes both distribution and
            // individual moved-bar transforms. It detects moved/varying bars too.
            var final = Curves(rebar.GetTransformedCenterlineCurves(false, false, false, MultiplanarOption.IncludeAllMultiplanarCurves, position.Index));
            RequireCurves(native.BaseCenterlineCurves, final, offset, "final-position native centerline");
        }
        return new { elementId = binding.ElementId, reviewedOperation = binding.Reviewed, native, sourceShape = binding.Source,
            geometryVerifiedAgainst = binding.Source is null ? "explicit complete XYZ endpoints and plane normal" : "loaded shape default polygon and parameters mapped by explicit origin/X/Y",
            nativeReadbackVerified = true, allIncludedFinalCenterlinesVerified = true, sideEffectsVerified = false, persistenceVerified = false, visualVerified = false, engineeringComplianceVerified = false };
    }
    public static object? Inspect(Element element)
    {
        if (element is not Rebar rebar) return null;
        try { return NativeReadSnapshot.Freeze(new { supported = true, native = Read(rebar), reviewedInputVerified = false, nativeAcceptance = false, sideEffectsVerified = false }); }
        catch (OperationCanceledException) { throw; }
        catch (Exception error) { return new { supported = false, errorType = error.GetType().Name, error = error.Message, reviewedInputVerified = false, sideEffectsVerified = false }; }
    }
    private static NativeSnapshot Read(Rebar rebar)
    {
        if (!rebar.IsRebarShapeDriven()) throw Invalid("Free-form rebar is outside controlled shape-driven readback.");
        var doc = rebar.Document; var host = Existing<Element>(doc, rebar.GetHostId().Value, "native host");
        var type = Existing<RebarBarType>(doc, rebar.GetTypeId().Value, "native bar type");
        var shape = Existing<RebarShape>(doc, rebar.GetShapeId().Value, "native shape");
        var count = rebar.NumberOfBarPositions;
        if (count < 1 || count > RebarCreationRules.MaximumPositions || rebar.Quantity < 1 || rebar.Quantity > count) throw Invalid("Native rebar positions exceed the bounded evidence contract.");
        using var accessor = rebar.GetShapeDrivenAccessor();
        var single = rebar.LayoutRule == RebarLayoutRule.Single;
        var positions = new List<PositionEvidence>();
        for (var index = 0; index < count; index++)
        {
            using var transform = accessor.GetBarPositionTransform(index);
            positions.Add(new(index, rebar.DoesBarExistAtPosition(index), Point(transform.Origin), Vector(transform.BasisX), Vector(transform.BasisY), Vector(transform.BasisZ)));
        }
        var included = positions.FindIndex(position => position.Included);
        if (included < 0 || positions.Count(position => position.Included) != rebar.Quantity) throw Invalid("Native bar inclusion and Quantity disagree.");
        var driving = Curves(accessor.ComputeDrivingCurves());
        var centerline = Curves(rebar.GetCenterlineCurves(false, false, false, MultiplanarOption.IncludeAllMultiplanarCurves, included));
        CurveEvidence? path = null;
        if (!single) { using var distribution = accessor.GetDistributionPath(); path = Curve(distribution); }
        return new(rebar.Id.Value, rebar.UniqueId, host.Id.Value, host.UniqueId, type.Id.Value, type.UniqueId, shape.Id.Value, shape.UniqueId, shape.RebarStyle.ToString(),
            rebar.LayoutRule.ToString(), count, rebar.Quantity, single ? null : ToMm(accessor.ArrayLength),
            rebar.LayoutRule == RebarLayoutRule.MaximumSpacing ? ToMm(rebar.MaxSpacing) : null, single ? null : accessor.BarsOnNormalSide,
            single ? null : rebar.IncludeFirstBar, single ? null : rebar.IncludeLastBar, Vector(accessor.Normal), driving, included, centerline, path, positions.ToArray());
    }
    private static ShapeSource Source(Document doc, RebarCreationInput input, RebarBarType type)
    {
        var shape = Existing<RebarShape>(doc, input.ShapeId!.Value, "shapeId");
        if (shape.RebarStyle != RebarStyle.StirrupTie || !shape.GetAllowed(type)) throw Invalid("Stirrup requires an existing allowed StirrupTie shape for the exact bar type.");
        using var multiplanar = shape.GetMultiplanarDefinition();
        if (multiplanar is not null) throw Invalid("Multiplanar shape placement cannot yet prove the requested origin/X/Y and is refused.");
        using var terminations = shape.GetTerminationsData();
        if (terminations.HasCrankAtStart || terminations.HasCrankAtEnd ||
            terminations.EndTreatmentTypeIdAtStart != ElementId.InvalidElementId || terminations.EndTreatmentTypeIdAtEnd != ElementId.InvalidElementId || shape.HasEndTreatment())
            throw Invalid("This controlled stirrup input does not permit cranks or end treatments; shapes with cranks or end treatments are refused.");
        var startHookAngle = terminations.HookAngleAtStart;
        var endHookAngle = terminations.HookAngleAtEnd;
        using var definition = shape.GetRebarShapeDefinition();
        if (definition is not RebarShapeDefinitionBySegments segments || segments.NumberOfSegments < 3 || segments.NumberOfSegments > 32)
            throw Invalid("Currently supported stirrups require a planar closed segmented shape with 3 through 32 straight driving segments; driving arcs/spirals are not yet adapted.");
        var parameterIds = definition.GetParameters().ToArray();
        if (parameterIds.Length > 128 || parameterIds.Select(id => id.Value).Distinct().Count() != parameterIds.Length) throw Invalid("Shape default parameters exceed the complete evidence bound.");
        var parameters = parameterIds.Select(id =>
        {
            var value = definition.GetParameterDefaultValue(id); var formula = definition.GetParameterFormula(id) ?? "";
            if (!double.IsFinite(value) || formula.Length > 4096) throw Invalid("Shape parameter defaults/formulas are not finite and bounded.");
            return new ShapeParameter(id.Value, value, formula);
        }).OrderBy(value => value.ParameterId).ToArray();
        var browser = Curves(shape.GetCurvesForBrowser());
        RebarPoint[]? polygon = null;
        if (startHookAngle == 0 && endHookAngle == 0)
            polygon = DefaultPolygon(browser, segments.NumberOfSegments);
        else
        {
            if (browser.Length < segments.NumberOfSegments)
                throw Invalid("Hooked stirrup browser curves have fewer segments than the shape definition.");
            RebarCreationRules.RequirePlanarInShapePlane(new(0, 0, 0), new(0, 0, 1), browser, "source hooked stirrup browser geometry");
        }
        return new(shape.Id.Value, shape.UniqueId, shape.RebarStyle.ToString(), segments.NumberOfSegments, startHookAngle, endHookAngle, polygon, parameters, browser);
    }
    private static void RequireNoTerminations(Rebar rebar)
    {
        for (var end = 0; end < 2; end++)
            if (rebar.GetHookTypeId(end) != ElementId.InvalidElementId || rebar.GetCrankTypeId(end) != ElementId.InvalidElementId || rebar.GetEndTreatmentTypeId(end) != ElementId.InvalidElementId)
                throw Invalid("Native rebar acquired an unreviewed hook, crank or end treatment.");
    }
    private static void RequireStirrupTerminations(Rebar rebar, ShapeSource source)
    {
        var doc = rebar.Document;
        for (var end = 0; end < 2; end++)
        {
            if (rebar.GetCrankTypeId(end) != ElementId.InvalidElementId || rebar.GetEndTreatmentTypeId(end) != ElementId.InvalidElementId)
                throw Invalid("Native stirrup acquired an unreviewed crank or end treatment.");
            var hookId = rebar.GetHookTypeId(end);
            var hookAngle = hookId != ElementId.InvalidElementId ? (doc.GetElement(hookId) as RebarHookType)?.HookAngle : null;
            RebarCreationRules.RequireHookMatch(end == 0 ? source.HookAngleAtStartDeg : source.HookAngleAtEndDeg, hookId.Value, hookAngle, end == 0 ? "start" : "end");
        }
    }
    private static void RequireShapeParameters(Rebar rebar, ShapeSource source)
    {
        foreach (var expected in source.Parameters)
        {
            var definition = (rebar.Document.GetElement(new ElementId(expected.ParameterId)) as ParameterElement)?.GetDefinition()
                ?? throw Invalid("A native shape parameter definition cannot be resolved completely.");
            var parameter = rebar.get_Parameter(definition);
            if (parameter is null || parameter.StorageType != StorageType.Double || !parameter.HasValue || !double.IsFinite(parameter.AsDouble()))
                throw Invalid($"Native stirrup parameter '{definition.Name}' is missing or non-finite.");
            if (!parameter.IsReadOnly && string.IsNullOrWhiteSpace(expected.Formula) && Math.Abs(parameter.AsDouble() - expected.DefaultValue) > 1e-8)
                throw Invalid($"Native stirrup dimension '{definition.Name}' differs from the loaded shape's default value (expected {expected.DefaultValue}, actual {parameter.AsDouble()}). No dimensions are silently resized.");
        }
    }
    private static void RequireSource(ShapeSource expected, ShapeSource actual)
    {
        if (expected.ShapeId != actual.ShapeId || expected.UniqueId != actual.UniqueId || expected.Style != actual.Style ||
            expected.SegmentCount != actual.SegmentCount ||
            expected.HookAngleAtStartDeg != actual.HookAngleAtStartDeg ||
            expected.HookAngleAtEndDeg != actual.HookAngleAtEndDeg ||
            expected.Parameters.Length != actual.Parameters.Length ||
            (expected.DefaultDrivingPolygon is null) != (actual.DefaultDrivingPolygon is null) ||
            (expected.DefaultDrivingPolygon is not null && expected.DefaultDrivingPolygon.Length != actual.DefaultDrivingPolygon!.Length))
            throw Invalid("Reviewed source shape identity, terminations or default parameter schema changed.");
        for (var i=0;i<expected.Parameters.Length;i++) if (expected.Parameters[i] != actual.Parameters[i]) throw Invalid("Reviewed source shape defaults or formulas changed.");
        if (expected.DefaultDrivingPolygon is not null)
            for (var i=0;i<expected.DefaultDrivingPolygon.Length;i++) RebarCreationRules.RequirePoint(expected.DefaultDrivingPolygon[i], actual.DefaultDrivingPolygon![i], "source shape default polygon");
        RequireCurves(expected.BrowserCurves, actual.BrowserCurves, new(0,0,0), "source shape browser geometry");
    }
    private static CurveEvidence Curve(Curve curve)
    {
        if (curve is null || !curve.IsBound || curve is not (Line or Arc)) throw Invalid("Native geometry requires a bounded line or circular arc; unknown curves are never serialized as lines or zero lengths.");
        var length = ToMm(curve.Length);
        if (!double.IsFinite(length) || length <= 0 || length > 1e8) throw Invalid("Native curve length is not positive, finite and bounded.");
        if (curve is Arc arc)
        {
            var radius = ToMm(arc.Radius); var sweep = Math.Abs(arc.GetEndParameter(1)-arc.GetEndParameter(0));
            if (!double.IsFinite(radius) || radius <= 0 || radius > 1e8 || !double.IsFinite(sweep) || sweep <= 0 || sweep >= 2*Math.PI) throw Invalid("Unbounded/full-circle or invalid native arcs cannot be proved by this adapter.");
            return new("Arc", Point(arc.GetEndPoint(0)), Point(arc.GetEndPoint(1)), Point(arc.Evaluate(0.5,true)), length, Point(arc.Center), radius, Vector(arc.Normal), sweep);
        }
        return new("Line", Point(curve.GetEndPoint(0)), Point(curve.GetEndPoint(1)), Point(curve.Evaluate(0.5,true)), length);
    }
    private static CurveEvidence[] Curves(IList<Curve> curves)
    {
        try
        {
            if (curves is null || curves.Count < 1 || curves.Count > MaxCurves) throw Invalid("Native curve evidence is empty or exceeds 64 segments; truncation is forbidden.");
            return curves.Select(Curve).ToArray();
        }
        finally { if (curves is not null) foreach (var curve in curves) curve?.Dispose(); }
    }
}
