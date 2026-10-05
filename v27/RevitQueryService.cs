using System.Text.Json;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Electrical;
using Autodesk.Revit.DB.Mechanical;
using Autodesk.Revit.DB.Plumbing;
using Autodesk.Revit.UI;

namespace RevitAutoV27;

internal static class RevitQueryService
{
    private static readonly BuiltInCategory[] CountCategories = [BuiltInCategory.OST_Levels, BuiltInCategory.OST_Grids, BuiltInCategory.OST_Walls, BuiltInCategory.OST_Doors, BuiltInCategory.OST_Windows, BuiltInCategory.OST_Floors, BuiltInCategory.OST_Rooms, BuiltInCategory.OST_LightingFixtures, BuiltInCategory.OST_LightingDevices, BuiltInCategory.OST_ElectricalEquipment, BuiltInCategory.OST_ElectricalCircuit, BuiltInCategory.OST_Wire, BuiltInCategory.OST_MechanicalEquipment, BuiltInCategory.OST_PipeCurves, BuiltInCategory.OST_DuctCurves, BuiltInCategory.OST_Sheets];
    public static object Context(UIApplication app)
    {
        if (app.ActiveUIDocument?.Document is not { } doc) return new { active = false, message = "Open a project in Revit first." };
        return new
        {
            active = true, revitVersion = app.Application.VersionNumber, revitBuild = app.Application.VersionBuild,
            document = new { title = doc.Title, path = doc.PathName, identity = RevitCommandRouter.Identity(doc), revision = RevitCommandRouter.Revision(doc), isWorkshared = doc.IsWorkshared, isReadOnly = doc.IsReadOnly, isModified = doc.IsModified, isFamilyDocument = doc.IsFamilyDocument },
            activeView = app.ActiveUIDocument.ActiveView is { } view ? new { id = view.Id.Value, name = view.Name, viewType = view.ViewType.ToString(), scale = view.Scale } : null,
            selectedElementIds = app.ActiveUIDocument.Selection.GetElementIds().Select(id => id.Value),
            units = new { coordinates = "mm", coordinateFrame = "Revit internal/project origin, absolute Z", parameterUnits = "Explicit value+unit required for doubles; BIP: names recommended" },
            levels = new FilteredElementCollector(doc).OfClass(typeof(Level)).Cast<Level>().OrderBy(l => l.Elevation).Select(l => new { id = l.Id.Value, name = l.Name, elevationMm = JsonDefaults.InternalToMm(l.Elevation) }).ToList(),
            familyTypes = new FilteredElementCollector(doc).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>().Take(400).Select(s => new { id = s.Id.Value, category = s.Category?.Name, categoryId = s.Category?.Id.Value, family = s.FamilyName, type = s.Name, placement = s.Family.FamilyPlacementType.ToString() }).ToList(),
            elementTypes = new FilteredElementCollector(doc).WhereElementIsElementType().Where(e => e is WallType or FloorType or PipeType or DuctType or PipingSystemType or MechanicalSystemType or WireType or ViewFamilyType or DistributionSysType).Take(400).Select(Summary).ToList(),
            counts = Counts(doc), pagination = "Use revit.search with types=true to read additional types and specific family names."
        };
    }
    public static object Search(UIApplication app, JsonElement p)
    {
        var doc = app.ActiveUIDocument?.Document ?? throw new BridgeException("no_active_document", "Open a project first.");
        var limit = (int)Math.Clamp(JsonDefaults.Int64(p, "limit") ?? 100, 1, 500);
        var offset = (int)Math.Clamp(JsonDefaults.Int64(p, "offset") ?? 0, 0, 100000);
        var collector = new FilteredElementCollector(doc);
        if (JsonDefaults.String(p, "category") is { } category)
        {
            if (Enum.TryParse<BuiltInCategory>(category, out var builtin) && Enum.IsDefined(builtin)) collector.OfCategory(builtin);
            else
            {
                var match = doc.Settings.Categories.Cast<Category>().SingleOrDefault(c => c.Name == category) ?? throw new BridgeException("category_not_found", $"Category '{category}' not found.");
                collector.OfCategoryId(match.Id);
            }
        }
        if (JsonDefaults.Bool(p, "types")) collector.WhereElementIsElementType(); else collector.WhereElementIsNotElementType();
        var matched = collector.Where(e =>
        {
            if (JsonDefaults.Int64(p, "levelId") is long levelId && e.LevelId.Value != levelId) return false;
            if (JsonDefaults.String(p, "query") is { } query && !($"{e.Id.Value} {Name(e)} {e.Category?.Name} {e.get_Parameter(BuiltInParameter.ALL_MODEL_MARK)?.AsString()} {(e is Autodesk.Revit.DB.Architecture.Room room ? room.Number : "")} {(e is FamilyInstance f ? f.Symbol.FamilyName : e is FamilySymbol s ? s.FamilyName : "")}").Contains(query, StringComparison.OrdinalIgnoreCase)) return false;
            if (JsonDefaults.String(p, "mark") is { } mark && e.get_Parameter(BuiltInParameter.ALL_MODEL_MARK)?.AsString() != mark) return false;
            if (JsonDefaults.String(p, "number") is { } number && (e is not Autodesk.Revit.DB.Architecture.Room targetRoom || targetRoom.Number != number)) return false;
            if (JsonDefaults.String(p, "family") is { } family && (e is FamilyInstance fi ? fi.Symbol.FamilyName : e is FamilySymbol fs ? fs.FamilyName : "") != family) return false;
            if (JsonDefaults.String(p, "type") is { } type && (e is FamilyInstance instance ? instance.Symbol.Name : Name(e)) != type) return false;
            return true;
        }).Skip(offset).Take(limit + 1).ToList();
        return new { items = matched.Take(limit).Select(Summary), offset, limit, hasMore = matched.Count > limit };
    }
    public static object Inspect(UIApplication app, JsonElement p)
    {
        var doc = app.ActiveUIDocument?.Document ?? throw new BridgeException("no_active_document", "Open a project first.");
        return new { items = JsonDefaults.Array(p, "elementIds").Take(100).Select(id =>
        {
            if (id.ValueKind != JsonValueKind.Number || !id.TryGetInt64(out var n)) throw new BridgeException("invalid_id", "elementIds must be integer ids.");
            var e = doc.GetElement(new ElementId(n));
            if (e is null) return (object)new { id = n, exists = false };
            return new
            {
                summary = Summary(e),
                parameters = Parameters(e),
                connectors = Connectors(e).ToList(),
                electrical = ElectricalRelations(e),
                piping = PipingCompatibilityService.Snapshot(e),
                drawing = DrawingRelations(e)
            };
        }).ToList() };
    }
    public static object Audit(UIApplication app)
    {
        var doc = app.ActiveUIDocument?.Document ?? throw new BridgeException("no_active_document", "Open a project first.");
        var instances = new FilteredElementCollector(doc).OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>().Where(f => f.Category?.Id.Value is (long)BuiltInCategory.OST_LightingFixtures or (long)BuiltInCategory.OST_LightingDevices or (long)BuiltInCategory.OST_ElectricalEquipment).ToList();
        var mechanicalPortRows = new FilteredElementCollector(doc).OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>()
            .Where(f => f.Category?.Id.Value == (long)BuiltInCategory.OST_MechanicalEquipment)
            .SelectMany(f => Connectors(f)).ToArray();
        var mechanicalPortSample = mechanicalPortRows.Take(300).ToArray();
        var unconnected = new List<object>();
        var connected = new List<object>();
        var unknown = new List<object>();
        foreach (var row in mechanicalPortSample)
        {
            switch (MechanicalPortState(row))
            {
                case MechanicalPortAuditState.Unconnected: unconnected.Add(row); break;
                case MechanicalPortAuditState.Connected: connected.Add(row); break;
                default: unknown.Add(row); break;
            }
        }
        return new
        {
            documentIdentity = RevitCommandRouter.Identity(doc), counts = Counts(doc),
            warnings = doc.GetWarnings().Take(200).Select(w => new { description = w.GetDescriptionText(), failingElementIds = w.GetFailingElements().Select(id => id.Value) }),
            warningCount = doc.GetWarnings().Count,
            unmarkedElectricalElementIds = instances.Where(f => string.IsNullOrEmpty(f.get_Parameter(BuiltInParameter.ALL_MODEL_MARK)?.AsString())).Select(f => f.Id.Value),
            duplicateMarks = instances.GroupBy(f => f.get_Parameter(BuiltInParameter.ALL_MODEL_MARK)?.AsString()).Where(g => !string.IsNullOrWhiteSpace(g.Key) && g.Count() > 1).Select(g => new { mark = g.Key, elementIds = g.Select(f => f.Id.Value) }),
            unconnectedMechanicalPorts = unconnected,
            connectedMechanicalPorts = connected,
            unknownMechanicalPorts = unknown,
            mechanicalPortAudit = new { totalCount = mechanicalPortRows.Length, scannedCount = mechanicalPortSample.Length, truncated = mechanicalPortRows.Length > mechanicalPortSample.Length, classification = "connected|unconnected|unknown" }
        };
    }
    private static MechanicalPortAuditState MechanicalPortState(object row)
    {
        var json = JsonSerializer.SerializeToElement(row);
        var supported = json.TryGetProperty("connectionStatusSupported", out var supportedValue) && supportedValue.ValueKind == JsonValueKind.True;
        bool? connected = null;
        if (json.TryGetProperty("connected", out var connectedValue) && (connectedValue.ValueKind == JsonValueKind.True || connectedValue.ValueKind == JsonValueKind.False))
            connected = connectedValue.GetBoolean();
        return MechanicalPortAuditClassification.Classify(supported, connected);
    }
    private static object? ElectricalRelations(Element element)
    {
        if (element is ElectricalSystem circuit)
            return new { memberIds = circuit.Elements.Cast<Element>().Select(e => e.Id.Value).Order().ToArray(), panelId = circuit.BaseEquipment?.Id.Value, circuitNumber = circuit.CircuitNumber, panelName = circuit.PanelName, loadName = circuit.get_Parameter(BuiltInParameter.RBS_ELEC_CIRCUIT_NAME)?.AsString() };
        if (element is Wire wire)
            return new { wireTypeId = wire.GetTypeId().Value, viewId = wire.OwnerViewId.Value, vertexCount = wire.NumberOfVertices,
                verticesComplete = wire.NumberOfVertices <= 256, vertices = Enumerable.Range(0, Math.Min(wire.NumberOfVertices, 256)).Select(index => Point(wire.GetVertex(index))).ToArray() };
        if (element is FamilyInstance instance && instance.MEPModel is not null)
            return new { systemIds = instance.MEPModel.GetElectricalSystems().Select(system => system.Id.Value).Order().ToArray() };
        return null;
    }
    private static object? DrawingRelations(Element element) => element switch
    {
        ViewPlan plan => ViewConfigurationService.Snapshot(plan),
        PanelScheduleView panelSchedule => new { panelId = panelSchedule.GetPanel().Value },
        ViewSchedule schedule => new { scheduleCategoryId = schedule.Definition.CategoryId.Value,
            fieldNames = schedule.Definition.GetFieldOrder().Select(id => schedule.Definition.GetField(id).GetName()).ToArray(),
            fieldParameterIds = schedule.Definition.GetFieldOrder().Select(id => schedule.Definition.GetField(id).ParameterId.Value).ToArray() },
        ViewSheet sheet => SheetRelations(sheet),
        Viewport viewport => ViewportRelations(viewport),
        PanelScheduleSheetInstance panelPlacement => new { sheetId = panelPlacement.OwnerViewId.Value, viewId = panelPlacement.ScheduleId.Value, position = Point(panelPlacement.Origin) },
        ScheduleSheetInstance schedulePlacement => new { sheetId = schedulePlacement.OwnerViewId.Value, viewId = schedulePlacement.ScheduleId.Value, position = Point(schedulePlacement.Point) },
        _ => null
    };
    private static object SheetRelations(ViewSheet sheet)
    {
        var outline=sheet.Outline;
        var titleBlocks=new FilteredElementCollector(sheet.Document,sheet.Id).OfCategory(BuiltInCategory.OST_TitleBlocks).WhereElementIsNotElementType().Select(block =>
        {
            var box=block.get_BoundingBox(sheet); return new { id=block.Id.Value, typeId=block.GetTypeId().Value, min=box is null?null:Point(box.Min), max=box is null?null:Point(box.Max) };
        }).ToArray();
        var viewports=new FilteredElementCollector(sheet.Document,sheet.Id).OfClass(typeof(Viewport)).Cast<Viewport>().Select(ViewportRelations).ToArray();
        return new { titleBlockTypeIds=titleBlocks.Select(block=>block.typeId).Distinct().Order().ToArray(), outlineMin=Uv(outline.Min), outlineMax=Uv(outline.Max), titleBlocks, viewports };
    }
    private static object Uv(UV value) => new { uMm=JsonDefaults.InternalToMm(value.U), vMm=JsonDefaults.InternalToMm(value.V) };
    private static object ViewportRelations(Viewport viewport)
    {
        var box=viewport.GetBoxOutline(); var label=viewport.GetLabelOutline(); var projection=viewport.GetProjectionToSheetTransform();
        return new { sheetId=viewport.SheetId.Value, viewId=viewport.ViewId.Value, position=Point(viewport.GetBoxCenter()),
            boxMin=Point(box.MinimumPoint), boxMax=Point(box.MaximumPoint), labelMin=Point(label.MinimumPoint), labelMax=Point(label.MaximumPoint),
            projectionOrigin=Point(projection.Origin), projectionBasisX=Point(projection.BasisX), projectionBasisY=Point(projection.BasisY), projectionBasisZ=Point(projection.BasisZ),
            anchor=viewport.get_Parameter(BuiltInParameter.VIEW_ANCHOR)?.AsInteger(), positionX=viewport.get_Parameter(BuiltInParameter.VIEW_POSITION_X)?.AsDouble(), positionY=viewport.get_Parameter(BuiltInParameter.VIEW_POSITION_Y)?.AsDouble() };
    }
    private static object Counts(Document doc) => CountCategories.ToDictionary(c => c.ToString(), c => new FilteredElementCollector(doc).OfCategory(c).WhereElementIsNotElementType().GetElementCount());
    private static string Name(Element e) { try { return e.Name; } catch { return e.GetType().Name; } }
    private static object Summary(Element e) => new { id = e.Id.Value, uniqueId = e.UniqueId, name = Name(e), category = e.Category?.Name, categoryId = e.Category?.Id.Value, className = e.GetType().Name, mark = e.get_Parameter(BuiltInParameter.ALL_MODEL_MARK)?.AsString(), number = e is Autodesk.Revit.DB.Architecture.Room r ? r.Number : null, viewFamily = e is ViewFamilyType vft ? vft.ViewFamily.ToString() : null, placement = e is FamilySymbol symbol ? symbol.Family.FamilyPlacementType.ToString() : null, levelId = e is ViewPlan levelView ? levelView.GenLevel?.Id.Value ?? e.LevelId.Value : e.LevelId.Value, typeId = e.GetTypeId().Value, ownerViewId = e.OwnerViewId.Value, hostId = e is FamilyInstance hosted ? (long?)hosted.Host?.Id.Value : null, sheetNumber = e is ViewSheet sheet ? sheet.SheetNumber : null, viewType = e is View drawingView ? drawingView.ViewType.ToString() : null, isViewTemplate = e is View templateView ? (bool?)templateView.IsTemplate : null, viewScale = e is ViewPlan planView ? (int?)planView.Scale : null, family = e is FamilyInstance f ? f.Symbol.FamilyName : e is FamilySymbol s ? s.FamilyName : null, type = e is FamilyInstance fi ? fi.Symbol.Name : null, location = Location(e) };
    private static object? Location(Element e) => e.Location switch
    {
        LocationPoint lp => new { kind = "point", xMm = JsonDefaults.InternalToMm(lp.Point.X), yMm = JsonDefaults.InternalToMm(lp.Point.Y), zMm = JsonDefaults.InternalToMm(lp.Point.Z) },
        LocationCurve lc when lc.Curve is { IsBound: true } curve => new { kind = "curve", curveType = curve.GetType().Name, start = Point(curve.GetEndPoint(0)), end = Point(curve.GetEndPoint(1)) },
        _ => null
    };
    private static object Point(XYZ point) => new { xMm = JsonDefaults.InternalToMm(point.X), yMm = JsonDefaults.InternalToMm(point.Y), zMm = JsonDefaults.InternalToMm(point.Z) };
    private static object[] Parameters(Element e)
    {
        var result = new List<object>();
        ParameterSet? parameterSet = null;
        try { parameterSet = e.Parameters; }
        catch (Exception exception)
        {
            return [new { parameterReadStatus = "failed", parameterReadError = exception.Message }];
        }
        try
        {
            foreach (Parameter parameter in parameterSet)
            {
                try
                {
                    var read = ParameterReadPolicy.Normalize(ParameterValue(parameter));
                    result.Add(new { name = parameter.Definition.Name, id = parameter.Id.Value, storageType = parameter.StorageType.ToString(), readOnly = parameter.IsReadOnly, hasValue = parameter.HasValue, value = read.Value, valueSupported = read.Supported, valueError = read.Error, formattedValue = parameter.AsValueString() });
                }
                catch (Exception exception)
                {
                    result.Add(new { parameterReadStatus = "partial", parameterReadError = exception.Message });
                }
            }
        }
        catch (Exception exception)
        {
            result.Add(new { parameterReadStatus = "enumeration-failed", parameterReadError = exception.Message });
        }
        return result.ToArray();
    }
    private static object? ParameterValue(Parameter p) => p.StorageType switch { StorageType.String => p.AsString(), StorageType.Integer => p.AsInteger(), StorageType.Double => p.AsDouble(), StorageType.ElementId => p.AsElementId().Value, _ => null };
    private static object[] Connectors(Element e)
    {
        var result = new List<object>();
        ConnectorSet? connectorSet = null;
        try
        {
            var manager = e is FamilyInstance f ? f.MEPModel?.ConnectorManager : e is MEPCurve curve ? curve.ConnectorManager : null;
            if (manager is null) return [];
            connectorSet = manager.Connectors;
        }
        catch (Exception exception)
        {
            // Some Revit MEPCurve connector managers can invalidate their wrapper while
            // the document regenerates. Preserve a read-only diagnostic instead of
            // terminating the bridge connection and losing the whole inspection result.
            result.Add(new { elementId = e.Id.Value, connectorsSupported = false, connectorsError = exception.Message, connectors = Array.Empty<object>() });
            return result.ToArray();
        }

        try
        {
            // ConnectorSet enumeration itself can throw for a partially regenerated
            // MEPCurve. Keep the enumerator inside the safety boundary as well as
            // each individual connector read.
            foreach (Connector c in connectorSet)
            {
                try
                {
                    if (c.ConnectorType == ConnectorType.Logical) continue;
                var unsupported = (Exception exception) => c.IsValidObject && exception is Autodesk.Revit.Exceptions.InvalidOperationException;
                var connection = ConnectorReadPolicy.ConnectionStatus(() => c.IsConnected, unsupported);
                var domain = ConnectorReadPolicy.TryRead(() => c.Domain.ToString(), unsupported);
                var shape = ConnectorReadPolicy.TryRead(() => c.Shape.ToString(), unsupported);
                var origin = ConnectorReadPolicy.TryRead(() =>
                {
                    var point = c.Origin;
                    return new ConnectorPoint(JsonDefaults.InternalToMm(point.X), JsonDefaults.InternalToMm(point.Y), JsonDefaults.InternalToMm(point.Z));
                }, unsupported);
                var peers = ConnectorReadPolicy.TryRead(() => c.AllRefs.Cast<Connector>()
                    .Where(peer => peer.ConnectorType != ConnectorType.Logical && peer.Owner.Id != e.Id)
                    .Select(peer => new { elementId = peer.Owner.Id.Value, connectorId = peer.Id })
                    .Distinct().OrderBy(peer => peer.elementId).ThenBy(peer => peer.connectorId).ToArray(), unsupported);
                result.Add(new
                {
                    elementId = e.Id.Value, connectorId = c.Id, connectorType = c.ConnectorType.ToString(),
                    domain = domain.Value, domainSupported = domain.Supported, domainError = domain.Error,
                    shape = shape.Value, shapeSupported = shape.Supported, shapeError = shape.Error,
                    connected = connection.Connected, connectionStatusSupported = connection.Supported,
                    connectionStatusError = connection.Error,
                    xMm = origin.Value?.XMm, yMm = origin.Value?.YMm, zMm = origin.Value?.ZMm,
                    originSupported = origin.Supported, originError = origin.Error,
                    peers = peers.Value, peerReferencesSupported = peers.Supported, peerReferencesError = peers.Error
                });
            }
            catch (Exception exception)
            {
                result.Add(new { elementId = e.Id.Value, connectorId = TryConnectorId(c), connectorsSupported = false, connectorsError = exception.Message, connectorReadStatus = "partial" });
                }
            }
        }
        catch (Exception exception)
        {
            result.Add(new { elementId = e.Id.Value, connectorsSupported = false, connectorsError = exception.Message, connectorReadStatus = "enumeration-failed" });
        }
        return result.ToArray();
    }
    private static long? TryConnectorId(Connector connector)
    {
        try { return connector.Id; } catch { return null; }
    }
}
