using System.Text.Json;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Electrical;
using Autodesk.Revit.DB.Mechanical;
using Autodesk.Revit.DB.Plumbing;
using Autodesk.Revit.DB.Structure;
using Autodesk.Revit.UI;

namespace RevitAutoV27;

internal sealed record OperationReceipt(List<long> Created, List<long> Changed)
{
    public static OperationReceipt New(Element e) => new([e.Id.Value], []);
    public static OperationReceipt Modified(Element e) => new([], [e.Id.Value]);
}
internal sealed class ModelExecutor(UIApplication app, Dictionary<string, ElementId> references)
{
    private Document Doc => app.ActiveUIDocument!.Document;
    private readonly Dictionary<string, Type> predicted = new(StringComparer.Ordinal);
    private static BridgeException Invalid(string message) => new("invalid_operation", message);
    private static bool Deferred(JsonElement value) => value.ValueKind == JsonValueKind.String && value.GetString()!.StartsWith('@');
    private ElementId Id(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var n) && n > 0) return new ElementId(n);
        if (Deferred(value) && references.TryGetValue(value.GetString()![1..], out var id)) return id;
        throw Invalid("Invalid or unresolved element id/reference.");
    }
    private ElementId Id(JsonElement op, string name) => Id(JsonDefaults.Get(op, name));
    private T? Check<T>(JsonElement op, string name, bool required = true) where T : Element
    {
        var value = JsonDefaults.Get(op, name);
        if (value.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null)
        { if (required) throw Invalid($"{name} is required."); return null; }
        if (Deferred(value) && !references.ContainsKey(value.GetString()![1..]))
        {
            if (!predicted.TryGetValue(value.GetString()![1..], out var type) || !typeof(T).IsAssignableFrom(type)) throw Invalid($"{name} references an incompatible earlier operation.");
            return null;
        }
        return Doc.GetElement(Id(value)) as T ?? throw Invalid($"{name} is not an existing {typeof(T).Name}.");
    }
    private T Required<T>(JsonElement op, string name) where T : Element => Check<T>(op, name) ?? throw Invalid($"Unresolved {name}.");
    private Level? Level(JsonElement op)
    {
        if (JsonDefaults.Has(op, "levelId")) return Check<Level>(op, "levelId");
        var name = JsonDefaults.String(op, "level");
        if (name is null) throw Invalid("Specify levelId or an exact level name; levels are never selected silently.");
        var matches = new FilteredElementCollector(Doc).OfClass(typeof(Level)).Cast<Level>().Where(l => l.Name == name).ToList();
        return matches.Count == 1 ? matches[0] : throw Invalid($"Level '{name}' was not found uniquely.");
    }
    private FamilySymbol? Symbol(JsonElement op)
    {
        if (JsonDefaults.Has(op, "symbolId")) return Check<FamilySymbol>(op, "symbolId");
        var family = JsonDefaults.String(op, "family"); var name = JsonDefaults.String(op, "type");
        var matches = new FilteredElementCollector(Doc).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>().Where(s => s.FamilyName == family && s.Name == name).ToList();
        return matches.Count == 1 ? matches[0] : throw Invalid($"Family/type '{family}/{name}' was not found uniquely. Load the correct family manually and re-preview.");
    }
    private static double Mm(double value) => UnitUtils.ConvertToInternalUnits(value, UnitTypeId.Millimeters);
    private static XYZ Point(JsonElement payload)
    {
        var p = JsonDefaults.Has(payload, "point") ? JsonDefaults.Get(payload, "point") : payload;
        PlanRules.Point(p);
        return new XYZ(Mm(PlanRules.Number(p, "xMm")), Mm(PlanRules.Number(p, "yMm")), Mm(JsonDefaults.Double(p, "zMm") ?? 0));
    }
    private Line Line(JsonElement op)
    {
        var start = Point(JsonDefaults.Get(op, "start")); var end = Point(JsonDefaults.Get(op, "end"));
        if (start.DistanceTo(end) < Doc.Application.ShortCurveTolerance) throw Invalid("The line is shorter than Revit's ShortCurveTolerance.");
        return Autodesk.Revit.DB.Line.CreateBound(start, end);
    }
    public void Validate(JsonElement op)
    {
        var kind = JsonDefaults.String(op, "operationType")!;
        switch (kind)
        {
            case "create_family_instance":
                var symbol = Symbol(op); Level(op); var host = Check<Element>(op, "hostElementId", false);
                if (JsonDefaults.String(op, "mark") is { } proposedMark && new FilteredElementCollector(Doc).OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>().Any(f => f.get_Parameter(BuiltInParameter.ALL_MODEL_MARK)?.AsString() == proposedMark)) throw Invalid($"Mark {proposedMark} already exists; choose a distinct mark or modify the existing element.");
                if (JsonDefaults.Has(op, "clearanceMm") && PlanRules.Number(op, "clearanceMm") < 0) throw Invalid("clearanceMm cannot be negative.");
                if (JsonDefaults.String(op, "placementMode") == "legacyPoint" && symbol is not null &&
                    (symbol.Family.FamilyPlacementType != FamilyPlacementType.WorkPlaneBased || symbol.Category?.Id.Value != (long)BuiltInCategory.OST_LightingFixtures))
                    throw Invalid("legacyPoint is reserved for the inspected WorkPlaneBased lighting-fixture workflow. Other hosted families require explicit hosts.");
                if (symbol is not null)
                {
                    var placement = symbol.Family.FamilyPlacementType;
                    if (placement is not (FamilyPlacementType.OneLevelBased or FamilyPlacementType.OneLevelBasedHosted or FamilyPlacementType.WorkPlaneBased))
                        throw Invalid($"Family placement {placement} is not supported by point placement.");
                    if (placement is FamilyPlacementType.OneLevelBasedHosted or FamilyPlacementType.WorkPlaneBased)
                    {
                        var legacyPoint = placement == FamilyPlacementType.WorkPlaneBased && JsonDefaults.String(op, "placementMode") == "legacyPoint";
                        if (!JsonDefaults.Has(op, "hostElementId") && !legacyPoint) throw Invalid("Hosted/work-plane family requires hostElementId, or an explicit placementMode=legacyPoint for the preserved point-only workflow.");
                        if (placement == FamilyPlacementType.WorkPlaneBased && host is not null && host is not Wall) throw Invalid("Face-based placement currently requires a wall host.");
                    }
                }
                break;
            case "duplicate_type":
                var originalType = Check<ElementType>(op, "sourceTypeId");
                if (originalType is not null && new FilteredElementCollector(Doc).WhereElementIsElementType().Any(e => e.GetType() == originalType.GetType() && e.Name == JsonDefaults.String(op, "name"))) throw Invalid("Duplicate type name already exists.");
                break;
            case "create_wall": Check<WallType>(op, "wallTypeId"); Level(op); Line(op); break;
            case "create_floor": Check<FloorType>(op, "floorTypeId"); Level(op); FloorLoop(op); break;
            case "create_grid": Line(op); break;
            case "create_room": Level(op); break;
            case "create_level":
                if (new FilteredElementCollector(Doc).OfClass(typeof(Level)).Cast<Level>().Any(l => l.Name == JsonDefaults.String(op, "name"))) throw Invalid("Level name already exists.");
                break;
            case "set_parameter":
                var element = Check<Element>(op, "elementId");
                if (element is not null) ValidateParameter(element, JsonDefaults.String(op, "parameter")!, JsonDefaults.Get(op, "value"));
                break;
            case "delete_element":
                if (Deferred(JsonDefaults.Get(op, "elementId"))) throw Invalid("Delete must refer to an existing element, not a newly created reference.");
                Check<Element>(op, "elementId"); break;
            case "create_circuit":
                foreach (var id in JsonDefaults.Array(op, "elementIds"))
                {
                    using var tmp = JsonDocument.Parse(JsonSerializer.Serialize(new { elementId = id }));
                    var load = Check<FamilyInstance>(tmp.RootElement, "elementId");
                    if (load is not null) Electrical(load, null);
                }
                Check<FamilyInstance>(op, "panelId");
                foreach (var id in JsonDefaults.Array(op, "switchIds"))
                {
                    using var tmp = JsonDocument.Parse(JsonSerializer.Serialize(new { elementId = id })); Check<FamilyInstance>(tmp.RootElement, "elementId");
                }
                break;
            case "create_wire":
                Check<WireType>(op, "wireTypeId"); var v = Check<ViewPlan>(op, "viewId");
                if (v?.IsTemplate == true) throw Invalid("Cannot create wires in a view template.");
                var first = Check<FamilyInstance>(op, "firstElementId"); var second = Check<FamilyInstance>(op, "secondElementId");
                if (first is not null) Electrical(first, JsonDefaults.Int64(op, "firstConnectorId"));
                if (second is not null) Electrical(second, JsonDefaults.Int64(op, "secondConnectorId"));
                break;
            case "create_view_plan": Check<ViewFamilyType>(op, "viewFamilyTypeId"); Level(op); break;
            case "configure_view": ViewConfigurationService.Validate(Check<ViewPlan>(op,"viewId"),Check<ViewPlan>(op,"referenceViewId"),Check<Viewport>(op,"viewportId",false),op); break;
            case "create_sheet":
                Check<FamilySymbol>(op, "titleBlockId", false);
                if (new FilteredElementCollector(Doc).OfClass(typeof(ViewSheet)).Cast<ViewSheet>().Any(s => s.SheetNumber == JsonDefaults.String(op, "number"))) throw Invalid("Sheet number already exists."); break;
            case "create_schedule":
                CategoryId(op);
                if (!JsonDefaults.Array(op, "fields").Any()) throw Invalid("Schedule needs explicit fields."); break;
            case "create_panel_schedule": Check<FamilyInstance>(op, "panelId"); break;
            case "create_tag": Check<View>(op, "viewId"); Check<Element>(op, "elementId"); Check<FamilySymbol>(op, "tagTypeId", false); break;
            case "create_dimension": Check<View>(op, "viewId"); Check<DimensionType>(op, "dimensionTypeId", false); Line(op);
                if (JsonDefaults.Array(op, "references").Count() < 2) throw Invalid("A dimension needs at least two stable Revit geometry references.");
                foreach (var reference in JsonDefaults.Array(op, "references")) Reference.ParseFromStableRepresentation(Doc, reference.GetString()!);
                break;
            case "place_viewport": Check<ViewSheet>(op, "sheetId"); Check<View>(op, "viewId"); break;
            case "create_pipe": Check<PipeType>(op, "pipeTypeId"); Check<PipingSystemType>(op, "systemTypeId"); Level(op); Line(op); break;
            case "create_duct": Check<DuctType>(op, "ductTypeId"); Check<MechanicalSystemType>(op, "systemTypeId"); Level(op); Line(op);
                if (!JsonDefaults.Has(op, "diameterMm") && (!JsonDefaults.Has(op, "widthMm") || !JsonDefaults.Has(op, "heightMm"))) throw Invalid("Duct requires diameterMm or widthMm + heightMm."); break;
            case "connect_elements": case "create_fitting": Check<Element>(op, "firstElementId"); Check<Element>(op, "secondElementId"); break;
        }
        if (JsonDefaults.Has(op, "parameters"))
        {
            var target = kind == "set_parameter" ? Check<Element>(op, "elementId") : kind == "duplicate_type" ? Check<ElementType>(op, "sourceTypeId") : null;
            if (target is not null) foreach (var property in JsonDefaults.Get(op, "parameters").EnumerateObject()) ValidateParameter(target, property.Name, property.Value);
        }
        if (JsonDefaults.String(op, "id") is { } key)
        {
            var resultType = kind switch
            {
                "create_family_instance" or "create_fitting" => typeof(FamilyInstance),
                "duplicate_type" => Check<ElementType>(op, "sourceTypeId")?.GetType() ?? typeof(ElementType),
                "create_level" => typeof(Level), "create_grid" => typeof(Grid), "create_wall" => typeof(Wall), "create_floor" => typeof(Floor),
                "create_room" => typeof(Autodesk.Revit.DB.Architecture.Room), "create_circuit" => typeof(ElectricalSystem), "create_wire" => typeof(Wire),
                "create_view_plan" => typeof(ViewPlan), "create_sheet" => typeof(ViewSheet), "create_schedule" => typeof(ViewSchedule), "create_panel_schedule" => typeof(PanelScheduleView),
                "place_viewport" => typeof(Element), "create_pipe" => typeof(Pipe), "create_duct" => typeof(Duct), _ => typeof(Element)
            };
            predicted[key] = resultType;
        }
    }
    public OperationReceipt Execute(JsonElement op)
    {
        var kind = JsonDefaults.String(op, "operationType")!;
        Element? created = null;
        switch (kind)
        {
            case "create_family_instance":
                var symbol = Symbol(op)!; var level = Level(op)!; var point = Point(op);
                if (!symbol.IsActive) { symbol.Activate(); Doc.Regenerate(); }
                var placement = symbol.Family.FamilyPlacementType;
                if (placement == FamilyPlacementType.WorkPlaneBased && JsonDefaults.String(op, "placementMode") == "legacyPoint")
                {
                    // Preserve place-lighting.csx exactly: this overload intentionally does not attach a level or host.
                    created = Doc.Create.NewFamilyInstance(point, symbol, StructuralType.NonStructural);
                    Doc.Regenerate();
                    if (created.Location is not LocationPoint legacyLocation || legacyLocation.Point.DistanceTo(point) > Mm(1))
                        throw Invalid("The legacy fixture placement did not preserve the reviewed XYZ coordinate within 1 mm. The whole plan will roll back.");
                }
                else if (placement == FamilyPlacementType.WorkPlaneBased)
                {
                    var host = Required<Wall>(op, "hostElementId");
                    var side = JsonDefaults.StringOr(op, "hostSide", "interior") == "exterior" ? ShellLayerType.Exterior : ShellLayerType.Interior;
                    var candidates = HostObjectUtils.GetSideFaces(host, side).Select(r => (Reference: r, Face: host.GetGeometryObjectFromReference(r) as Face)).Where(x => x.Face is not null).Select(x => (x.Reference, Face: x.Face!, Projection: x.Face!.Project(point))).Where(x => x.Projection is not null).OrderBy(x => x.Projection!.Distance).ToList();
                    var face = candidates.FirstOrDefault();
                    if (face.Projection is null || face.Projection.Distance > Mm(JsonDefaults.Double(op, "hostToleranceMm") ?? 500)) throw Invalid("The placement point is not within tolerance of the requested wall face.");
                    created = Doc.Create.NewFamilyInstance(face.Reference, face.Projection.XYZPoint, XYZ.BasisZ, symbol);
                }
                else if (placement == FamilyPlacementType.OneLevelBasedHosted)
                    created = Doc.Create.NewFamilyInstance(point, symbol, Required<Element>(op, "hostElementId"), level, StructuralType.NonStructural);
                else created = Doc.Create.NewFamilyInstance(point, symbol, level, StructuralType.NonStructural);
                if (JsonDefaults.Double(op, "rotationDegrees") is double rotation && rotation != 0)
                    ElementTransformUtils.RotateElement(Doc, created.Id, Autodesk.Revit.DB.Line.CreateBound(point, point + XYZ.BasisZ), rotation * Math.PI / 180);
                break;
            case "duplicate_type": created = Required<ElementType>(op, "sourceTypeId").Duplicate(JsonDefaults.String(op, "name")!); break;
            case "set_parameter":
                var target = Required<Element>(op, "elementId"); SetParameter(target, JsonDefaults.String(op, "parameter")!, JsonDefaults.Get(op, "value")); return OperationReceipt.Modified(target);
            case "delete_element": return new([], Doc.Delete(Id(op, "elementId")).Select(id => id.Value).ToList());
            case "create_level": created = Autodesk.Revit.DB.Level.Create(Doc, Mm(PlanRules.Number(op, "elevationMm"))); created.Name = JsonDefaults.String(op, "name")!; break;
            case "create_grid": created = Grid.Create(Doc, Line(op)); if (JsonDefaults.String(op, "name") is { } gridName) created.Name = gridName; break;
            case "create_wall": created = Wall.Create(Doc, Line(op), Id(op, "wallTypeId"), Level(op)!.Id, Mm(PlanRules.Number(op, "heightMm")), Mm(JsonDefaults.Double(op, "offsetMm") ?? 0), JsonDefaults.Bool(op, "flip"), JsonDefaults.Bool(op, "structural")); break;
            case "create_floor": created = Floor.Create(Doc, [FloorLoop(op)], Id(op, "floorTypeId"), Level(op)!.Id); break;
            case "create_room":
                var roomPoint = Point(op); var room = Doc.Create.NewRoom(Level(op)!, new UV(roomPoint.X, roomPoint.Y));
                if (JsonDefaults.String(op, "name") is { } roomName) room.Name = roomName;
                if (JsonDefaults.String(op, "number") is { } number) room.Number = number;
                Doc.Regenerate(); if (room.Area <= 0) throw Invalid("The requested room is not enclosed."); created = room; break;
            case "create_circuit":
                Doc.Regenerate(); var loads = JsonDefaults.Array(op, "elementIds").Select(Id).ToList();
                foreach (var id in loads) Electrical((FamilyInstance)Doc.GetElement(id), null);
                var circuit = ElectricalSystem.Create(Doc, loads, ElectricalSystemType.PowerCircuit) ?? throw Invalid("Cannot create power circuit.");
                var controls = new ElementSet(); foreach (var s in JsonDefaults.Array(op, "switchIds")) controls.Insert(Doc.GetElement(Id(s)) ?? throw Invalid("Switch missing."));
                if (controls.Size > 0 && !circuit.AddToCircuit(controls)) throw Invalid("Switch could not be added to circuit.");
                circuit.SelectPanel(Required<FamilyInstance>(op, "panelId"));
                if (JsonDefaults.String(op, "name") is { } loadName) SetBuiltIn(circuit, BuiltInParameter.RBS_ELEC_CIRCUIT_NAME, loadName);
                created = circuit; break;
            case "create_wire":
                Doc.Regenerate(); var c1 = Electrical(Required<FamilyInstance>(op, "firstElementId"), JsonDefaults.Int64(op, "firstConnectorId"));
                var c2 = Electrical(Required<FamilyInstance>(op, "secondElementId"), JsonDefaults.Int64(op, "secondConnectorId"));
                var vertices = new List<XYZ> { c1.Origin };
                vertices.AddRange(JsonDefaults.Array(op, "bends").Select(Point).Select(p => new XYZ(p.X, p.Y, c2.Origin.Z))); vertices.Add(c2.Origin);
                if (!Wire.AreVertexPointsValid(vertices, c1, c2)) throw Invalid("Wire vertices are invalid for the inspected endpoint connectors. Review the route; no partial result will be committed.");
                created = Wire.Create(Doc, Id(op, "wireTypeId"), Id(op, "viewId"), WiringType.Chamfer, vertices, c1, c2); break;
            case "create_view_plan":
                var view = ViewPlan.Create(Doc, Id(op, "viewFamilyTypeId"), Level(op)!.Id);
                if (JsonDefaults.String(op, "name") is { } viewName) view.Name = viewName;
                if (JsonDefaults.Int64(op, "scale") is long scale && scale > 0) view.Scale = (int)scale;
                created = view; break;
            case "configure_view": return ViewConfigurationService.Apply(Required<ViewPlan>(op,"viewId"),Required<ViewPlan>(op,"referenceViewId"),Check<Viewport>(op,"viewportId",false),op);
            case "create_sheet":
                var sheet = ViewSheet.Create(Doc, JsonDefaults.Has(op, "titleBlockId") ? Id(op, "titleBlockId") : ElementId.InvalidElementId);
                sheet.SheetNumber = JsonDefaults.String(op, "number")!; sheet.Name = JsonDefaults.String(op, "name")!; created = sheet; break;
            case "create_schedule":
                var schedule = ViewSchedule.CreateSchedule(Doc, CategoryId(op));
                if (JsonDefaults.String(op, "name") is { } scheduleName) schedule.Name = scheduleName;
                foreach (var field in JsonDefaults.Array(op, "fields"))
                {
                    var match = schedule.Definition.GetSchedulableFields().Where(f => field.ValueKind == JsonValueKind.String ? f.GetName(Doc) == field.GetString() : f.ParameterId.Value == field.GetInt64()).ToList();
                    if (match.Count != 1) throw Invalid($"Schedule field {field} could not be resolved uniquely.");
                    schedule.Definition.AddField(match[0]);
                }
                created = schedule; break;
            case "create_panel_schedule":
                var panelSchedule = PanelScheduleView.CreateInstanceView(Doc, Id(op, "panelId")) ?? throw Invalid("Cannot create a schedule for the requested panel.");
                if (JsonDefaults.String(op, "name") is { } panelScheduleName) panelSchedule.Name = panelScheduleName;
                created = panelSchedule; break;
            case "create_tag":
                var tagElement = Required<Element>(op, "elementId"); var tagView = Required<View>(op, "viewId"); var tagPoint = Point(op);
                if (tagElement is Autodesk.Revit.DB.Architecture.Room taggedRoom)
                {
                    var roomTag = Doc.Create.NewRoomTag(new LinkElementId(taggedRoom.Id), new UV(tagPoint.X, tagPoint.Y), tagView.Id);
                    if (JsonDefaults.Has(op, "tagTypeId")) roomTag.ChangeTypeId(Id(op, "tagTypeId"));
                    created = roomTag;
                }
                else if (JsonDefaults.Has(op, "tagTypeId")) created = IndependentTag.Create(Doc, Id(op, "tagTypeId"), tagView.Id, new Reference(tagElement), JsonDefaults.Bool(op, "leader"), TagOrientation.Horizontal, tagPoint);
                else created = IndependentTag.Create(Doc, tagView.Id, new Reference(tagElement), JsonDefaults.Bool(op, "leader"), TagMode.TM_ADDBY_CATEGORY, TagOrientation.Horizontal, tagPoint);
                break;
            case "create_dimension":
                var dimensionReferences = new ReferenceArray();
                foreach (var reference in JsonDefaults.Array(op, "references")) dimensionReferences.Append(Reference.ParseFromStableRepresentation(Doc, reference.GetString()!));
                created = JsonDefaults.Has(op, "dimensionTypeId") ? Doc.Create.NewDimension(Required<View>(op, "viewId"), Line(op), dimensionReferences, Required<DimensionType>(op, "dimensionTypeId")) : Doc.Create.NewDimension(Required<View>(op, "viewId"), Line(op), dimensionReferences);
                break;
            case "place_viewport":
                var placeView = Required<View>(op, "viewId"); var position = Point(op);
                if (placeView is PanelScheduleView) created = PanelScheduleSheetInstance.Create(Doc, placeView.Id, Required<ViewSheet>(op, "sheetId"));
                else if (placeView is ViewSchedule) created = ScheduleSheetInstance.Create(Doc, Id(op, "sheetId"), placeView.Id, position);
                else created = Viewport.Create(Doc, Id(op, "sheetId"), placeView.Id, position);
                if (created is PanelScheduleSheetInstance panelInstance) panelInstance.Origin = position;
                if (created is Viewport placedViewport) { Doc.Regenerate(); placedViewport.SetBoxCenter(position); }
                break;
            case "create_pipe":
                var line = Line(op); var pipe = Pipe.Create(Doc, Id(op, "systemTypeId"), Id(op, "pipeTypeId"), Level(op)!.Id, line.GetEndPoint(0), line.GetEndPoint(1));
                SetBuiltIn(pipe, BuiltInParameter.RBS_PIPE_DIAMETER_PARAM, Mm(PlanRules.Number(op, "diameterMm"))); created = pipe; break;
            case "create_duct":
                var ductLine = Line(op); var duct = Duct.Create(Doc, Id(op, "systemTypeId"), Id(op, "ductTypeId"), Level(op)!.Id, ductLine.GetEndPoint(0), ductLine.GetEndPoint(1));
                if (JsonDefaults.Double(op, "diameterMm") is double diameter) SetBuiltIn(duct, BuiltInParameter.RBS_CURVE_DIAMETER_PARAM, Mm(diameter));
                else { SetBuiltIn(duct, BuiltInParameter.RBS_CURVE_WIDTH_PARAM, Mm(PlanRules.Number(op, "widthMm"))); SetBuiltIn(duct, BuiltInParameter.RBS_CURVE_HEIGHT_PARAM, Mm(PlanRules.Number(op, "heightMm"))); }
                created = duct; break;
            case "connect_elements": case "create_fitting":
                Doc.Regenerate(); var a = Connector(Required<Element>(op, "firstElementId"), JsonDefaults.Int64(op, "firstConnectorId")); var b = Connector(Required<Element>(op, "secondElementId"), JsonDefaults.Int64(op, "secondConnectorId"));
                if (a.Domain != b.Domain || a.Owner.Id == b.Owner.Id) throw Invalid("Connectors are incompatible or belong to the same element.");
                if (kind == "connect_elements")
                {
                    if (a.Origin.DistanceTo(b.Origin) > Mm(JsonDefaults.Double(op, "toleranceMm") ?? 1)) throw Invalid("Direct connectors must be coincident. Create a pipe or fitting explicitly.");
                    if (!a.IsConnectedTo(b)) a.ConnectTo(b); return new([], [a.Owner.Id.Value, b.Owner.Id.Value]);
                }
                created = JsonDefaults.StringOr(op, "fittingType", "elbow") switch
                {
                    "elbow" => Doc.Create.NewElbowFitting(a, b), "union" => Doc.Create.NewUnionFitting(a, b), "transition" => Doc.Create.NewTransitionFitting(a, b), _ => throw Invalid("Supported fittings: elbow, union, transition.")
                }; break;
            default: throw Invalid($"Unsupported operation '{kind}'.");
        }
        if (created is null) throw Invalid("Revit did not return a created element.");
        foreach (var property in JsonDefaults.ObjectOrEmpty(op, "parameters").EnumerateObject()) SetParameter(created, property.Name, property.Value);
        if (JsonDefaults.String(op, "mark") is { } mark) SetParameter(created, "BIP:ALL_MODEL_MARK", JsonSerializer.SerializeToElement(mark));
        if (JsonDefaults.Double(op, "clearanceMm") is double gap && created.Category?.Id.Value == (long)BuiltInCategory.OST_MechanicalEquipment)
        {
            Doc.Regenerate(); var bounds = created.get_BoundingBox(null) ?? throw Invalid("Equipment has no model bounding box for clearance check.");
            var delta = new XYZ(Mm(gap), Mm(gap), Mm(gap));
            var filter = new BoundingBoxIntersectsFilter(new Outline(bounds.Min - delta, bounds.Max + delta));
            var clashes = new FilteredElementCollector(Doc).OfCategory(BuiltInCategory.OST_MechanicalEquipment).WhereElementIsNotElementType().WherePasses(filter).Where(e => e.Id != created.Id).Select(e => e.Id.Value).ToArray();
            if (clashes.Length > 0) throw Invalid($"Equipment clearance/bounding-box overlap with {string.Join(",", clashes)}; adjust the layout.");
        }
        return OperationReceipt.New(created);
    }
    private CurveLoop FloorLoop(JsonElement op)
    {
        var points = JsonDefaults.Array(op, "boundary").Select(Point).ToList();
        if (points.Count > 3 && points[0].IsAlmostEqualTo(points[^1])) points.RemoveAt(points.Count - 1);
        var loop = new CurveLoop();
        for (var i = 0; i < points.Count; i++)
        {
            var next = points[(i + 1) % points.Count];
            if (points[i].DistanceTo(next) < Doc.Application.ShortCurveTolerance) throw Invalid("Floor has a short boundary segment.");
            loop.Append(Autodesk.Revit.DB.Line.CreateBound(points[i], next));
        }
        if (!loop.HasPlane() || !loop.GetPlane().Normal.IsAlmostEqualTo(XYZ.BasisZ) && !loop.GetPlane().Normal.IsAlmostEqualTo(-XYZ.BasisZ)) throw Invalid("Floor boundary must be horizontal and coplanar.");
        if (!BoundaryValidation.IsValidHorizontalBoundary([loop])) throw Invalid("Invalid or self-intersecting floor boundary.");
        return loop;
    }
    private ElementId CategoryId(JsonElement op)
    {
        var name = JsonDefaults.String(op, "category") ?? throw Invalid("Category must be OST_... or an exact category name.");
        if (Enum.TryParse<BuiltInCategory>(name, out var builtin) && Enum.IsDefined(builtin)) return new ElementId((long)builtin);
        var matches = Doc.Settings.Categories.Cast<Category>().Where(c => c.Name == name).ToList();
        return matches.Count == 1 ? matches[0].Id : throw Invalid($"Category '{name}' not found uniquely.");
    }
    private static ConnectorManager Manager(Element e) => e switch
    {
        FamilyInstance f => f.MEPModel?.ConnectorManager ?? throw Invalid($"Element {e.Id.Value} has no MEP connector manager."),
        MEPCurve curve => curve.ConnectorManager, _ => throw Invalid($"Element {e.Id.Value} does not expose connectors.")
    };
    private static Connector Connector(Element e, long? connectorId)
    {
        var connectors = Manager(e).Connectors.Cast<Connector>().Where(c => c.ConnectorType != ConnectorType.Logical).ToList();
        if (connectorId is long id) return connectors.SingleOrDefault(c => c.Id == id) ?? throw Invalid($"Connector {id} is missing on element {e.Id.Value}.");
        var free = connectors.Where(c => !c.IsConnected).ToList();
        return free.Count == 1 ? free[0] : throw Invalid($"Element {e.Id.Value} has {free.Count} free connectors; specify connectorId from revit.inspect.");
    }
    private static Connector Electrical(FamilyInstance instance, long? id)
    {
        var connectors = Manager(instance).Connectors.Cast<Connector>().Where(c => c.Domain == Domain.DomainElectrical && c.ElectricalSystemType == ElectricalSystemType.PowerCircuit).ToList();
        if (id is long n) return connectors.SingleOrDefault(c => c.Id == n) ?? throw Invalid($"Electrical connector {n} not found.");
        return connectors.Count == 1 ? connectors[0] : throw Invalid($"Element {instance.Id.Value} has {connectors.Count} power connectors; specify connector id.");
    }
    private static Parameter Parameter(Element element, string name)
    {
        Parameter? p;
        if (name.StartsWith("BIP:") && Enum.TryParse<BuiltInParameter>(name[4..], out var builtin) && Enum.IsDefined(builtin)) p = element.get_Parameter(builtin);
        else
        {
            var matches = element.GetParameters(name);
            p = matches.Count == 1 ? matches[0] : null;
        }
        if (p is null || p.IsReadOnly) throw Invalid($"Parameter '{name}' is missing, ambiguous or read-only on element {element.Id.Value}.");
        return p;
    }
    private void ValidateParameter(Element e, string name, JsonElement value) => ConvertValue(Parameter(e, name), value);
    private object ConvertValue(Parameter p, JsonElement value)
    {
        if (p.StorageType == StorageType.ElementId) return Id(value);
        if (p.StorageType == StorageType.String && value.ValueKind == JsonValueKind.String) return value.GetString()!;
        if (p.StorageType == StorageType.Integer && value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var n)) return n;
        if (p.StorageType == StorageType.Double && value.ValueKind == JsonValueKind.Object)
        {
            var unit = JsonDefaults.String(value, "unit") switch
            {
                "mm" => UnitTypeId.Millimeters, "m" => UnitTypeId.Meters, "V" => UnitTypeId.Volts, "A" => UnitTypeId.Amperes,
                "W" => UnitTypeId.Watts, "m2" => UnitTypeId.SquareMeters, "deg" => UnitTypeId.Degrees, _ => throw Invalid("Double parameters require {value:number,unit:mm|m|V|A|W|m2|deg}; raw internal units are not accepted.")
            };
            if (!UnitUtils.IsValidUnit(p.Definition.GetDataType(), unit)) throw Invalid($"Unit does not match parameter {p.Definition.Name}.");
            return UnitUtils.ConvertToInternalUnits(PlanRules.Number(value, "value"), unit);
        }
        throw Invalid($"Value has wrong type for {p.Definition.Name} ({p.StorageType}).");
    }
    private void SetParameter(Element e, string name, JsonElement value)
    {
        var p = Parameter(e, name); var converted = ConvertValue(p, value);
        var same = converted switch { string s => p.AsString() == s, int i => p.AsInteger() == i, double d => Math.Abs(p.AsDouble() - d) <= 1e-10 * Math.Max(1, Math.Abs(d)), ElementId id => p.AsElementId() == id, _ => false };
        if (same) return;
        var changed = converted switch { string s => p.Set(s), int i => p.Set(i), double d => p.Set(d), ElementId id => p.Set(id), _ => false };
        if (!changed) throw Invalid($"Revit refused parameter {name} on {e.Id.Value}.");
    }
    private static void SetBuiltIn(Element e, BuiltInParameter name, string value)
    {
        var p = e.get_Parameter(name) ?? throw Invalid($"Parameter {name} is missing.");
        if (p.IsReadOnly || !p.Set(value)) throw Invalid($"Revit refused parameter {name}.");
    }
    private static void SetBuiltIn(Element e, BuiltInParameter name, double value)
    {
        var p = e.get_Parameter(name) ?? throw Invalid($"Parameter {name} is missing.");
        if (p.IsReadOnly || !p.Set(value)) throw Invalid($"Revit refused parameter {name}.");
    }
}


