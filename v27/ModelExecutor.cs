using System.Text.Json;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using Autodesk.Revit.DB.Electrical;
using Autodesk.Revit.DB.Mechanical;
using Autodesk.Revit.DB.Plumbing;
using Autodesk.Revit.DB.Structure;
using Autodesk.Revit.UI;

namespace RevitAutoV27;

internal sealed class ModelExecutor(UIApplication app, Dictionary<string, ElementId> references)
{
    private Document Doc => app.ActiveUIDocument!.Document;
    private readonly Dictionary<string, Type> predicted = new(StringComparer.Ordinal);
    private readonly Dictionary<string, JsonElement> predictedOperations = new(StringComparer.Ordinal);
    private readonly Dictionary<long, JsonElement> materializedOperations = new();
    private readonly ArchitectureTypeCopyService architectureCopies = new();
    private readonly ViewportLabelService viewportLabels = new();
    private readonly ArchitecturePrimaryReadbackService primaryReadback = new();
    private readonly List<(long ElementId, JsonElement Operation)> gridCreations = new();
    private Document? gridCreationDocument;
    private readonly List<(long ElementId, JsonElement Operation, OpeningHostSurfaceBinding? HostSurface)> openingCreations = new();
    private Document? openingCreationDocument;
    private readonly List<(long InstanceId, long TypeId, JsonElement Operation, bool WasActive, double? ExpectedRotationRadians)> architecturePlacements = new();
    private readonly List<(JsonElement Operation, bool WritePerformed)> documentationPlacements = new();
    private readonly List<(JsonElement Operation, bool WritePerformed)> documentationMetadata = new();
    private readonly List<(TitleBlockChangeService.ReadbackBinding Binding, bool WritePerformed)> documentationTitleBlocks = new();
    private readonly DocumentationCreationReadbackService documentationCreations = new();
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
        if (JsonDefaults.Has(op, "symbolId"))
        {
            var symbol = Check<FamilySymbol>(op, "symbolId");
            return symbol ?? PredictedSymbol(JsonDefaults.Get(op, "symbolId"), new HashSet<string>(StringComparer.Ordinal));
        }
        var family = JsonDefaults.String(op, "family"); var name = JsonDefaults.String(op, "type");
        var matches = new FilteredElementCollector(Doc).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>().Where(s => s.FamilyName == family && s.Name == name).ToList();
        return matches.Count == 1 ? matches[0] : throw Invalid($"Family/type '{family}/{name}' was not found uniquely. Load the correct family manually and re-preview.");
    }
    private FamilySymbol PredictedSymbol(JsonElement value, HashSet<string> visited)
    {
        if (!Deferred(value) || references.ContainsKey(value.GetString()![1..]))
            return Doc.GetElement(Id(value)) as FamilySymbol ?? throw Invalid("The referenced source must be a native FamilySymbol.");
        var key = value.GetString()![1..];
        if (!visited.Add(key) || !predictedOperations.TryGetValue(key, out var source) ||
            JsonDefaults.String(source, "operationType") is not ("duplicate_type" or "duplicate_architecture_type"))
            throw Invalid("A predicted family symbol requires an earlier reviewed type-copy operation.");
        return PredictedSymbol(JsonDefaults.Get(source, "sourceTypeId"), visited);
    }
    private JsonElement? ArchitectureCopyForPlacement(JsonElement op)
    {
        var value = JsonDefaults.Get(op, "symbolId");
        if (!Deferred(value)) return null;
        if (!predictedOperations.TryGetValue(value.GetString()![1..], out var copy))
            throw Invalid("Placement references an unavailable earlier type operation.");
        return JsonDefaults.String(copy, "operationType") == "duplicate_architecture_type" ? copy : null;
    }
    private JsonElement MaterializeArchitectureColumn(JsonElement op)
    {
        var value = JsonDefaults.Get(op, "symbolId");
        if (!Deferred(value)) return op;
        var copy = ArchitectureCopyForPlacement(op) ?? throw Invalid("A column type reference requires a dedicated architecture copy.");
        if (JsonDefaults.String(copy, "category") != "OST_StructuralColumns") throw Invalid("A column type reference has the wrong reviewed category.");
        var symbol = Symbol(op)!;
        var fields = op.EnumerateObject().ToDictionary(property => property.Name, property => property.Value.Clone(), StringComparer.Ordinal);
        fields["symbolId"] = JsonSerializer.SerializeToElement(symbol.Id.Value);
        return JsonSerializer.SerializeToElement(fields, JsonDefaults.Options);
    }
    private void ValidateFamilyTypeReference(JsonElement op, FamilySymbol symbol)
    {
        var copy = ArchitectureCopyForPlacement(op);
        var category = symbol.Category?.Id.Value;
        if (copy is not null)
        {
            var explicitCategory = JsonDefaults.String(op, "category");
            if (explicitCategory is not ("OST_Doors" or "OST_Windows") || explicitCategory != JsonDefaults.String(copy.Value, "category"))
                throw Invalid("A dedicated architecture copy requires its explicit matching door/window placement category.");
            if (JsonDefaults.Has(op, "rotationDegrees")) _ = PlanRules.Number(op, "rotationDegrees");
        }
        if (Deferred(JsonDefaults.Get(op, "symbolId")) && copy is null &&
            category is (long)BuiltInCategory.OST_Doors or (long)BuiltInCategory.OST_Windows or (long)BuiltInCategory.OST_StructuralColumns)
            throw Invalid("Architecture placements cannot use a generic duplicated-type reference; use the controlled architecture copy.");
        if (JsonDefaults.String(op, "category") is "OST_Doors" or "OST_Windows" or "OST_StructuralColumns")
        {
            var requested = Enum.Parse<BuiltInCategory>(JsonDefaults.String(op, "category")!);
            if (category != (long)requested) throw Invalid("Native placement category differs from the explicit architecture category.");
        }
        if (category is (long)BuiltInCategory.OST_Doors or (long)BuiltInCategory.OST_Windows)
        {
            if (symbol.Family.FamilyPlacementType != FamilyPlacementType.OneLevelBasedHosted || Check<Element>(op, "hostElementId") is not Wall)
                throw Invalid("Controlled door/window point placement requires an existing wall host and OneLevelBasedHosted family.");
        }
    }
    internal void ValidateArchitectureCopyPlan(IReadOnlyList<JsonElement> operations)
    {
        ArchitectureTypeCopyService.ValidatePlanEvidenceBudget(Doc, operations);
        var names = new HashSet<(long FamilyId, string Name)>();
        foreach (var op in operations.Where(op => JsonDefaults.String(op, "operationType") == "duplicate_architecture_type"))
        {
            var source = Required<FamilySymbol>(op, "sourceTypeId");
            if (!names.Add((source.Family.Id.Value, JsonDefaults.String(op, "name")!)))
                throw Invalid("Architecture copy names must be unique within each native family, including different source types.");
        }
        ArchitectureTypeCopyRules.ValidateResolvedPlacementTypes(operations, op => Symbol(op)!.Id.Value);
    }
    internal void CaptureArchitectureCopySources(IReadOnlyList<JsonElement> operations) => architectureCopies.CaptureSources(Doc, operations);
    internal object PreviewArchitectureColumn(JsonElement op)
    {
        var native = ArchitectureService.PreviewColumn(Doc, MaterializeArchitectureColumn(op));
        var copy = ArchitectureCopyForPlacement(op);
        if (copy is null) return native;
        return new { nativeSourceValidation = native, symbolReference = JsonDefaults.String(op, "symbolId"),
            requestedTypeName = JsonDefaults.String(copy.Value, "name"), requestedDimensions = JsonDefaults.Get(copy.Value, "dimensions"),
            previewUsesExistingSource = true, newTypeIdKnown = false, activationScope = "the new copied type only" };
    }
    private void AllowArchitecturePlacementActivation(JsonElement op, FamilySymbol symbol)
    {
        if (ArchitectureCopyForPlacement(op) is null) return;
        // During execution this must resolve through the receipt reference map,
        // never through the source-symbol surrogate used for native preview.
        if (Id(op, "symbolId") != symbol.Id) throw Invalid("Copied placement did not resolve to its materialized native type.");
        architectureCopies.AllowPlacementActivation(symbol.Id.Value);
    }
    internal object VerifyArchitectureCopiesBeforeCommit()
    {
        var copiedTypes = architectureCopies.VerifyCompletedCopies(Doc);
        foreach (var binding in architecturePlacements)
        {
            var instance = Doc.GetElement(new ElementId(binding.InstanceId)) as FamilyInstance ?? throw Invalid("A reviewed architecture placement is missing before commit.");
            if (instance.Symbol.Id.Value != binding.TypeId) throw Invalid("A placed instance no longer uses the materialized reviewed type; roll back.");
            if (JsonDefaults.String(binding.Operation, "operationType") == "create_structural_column")
                _ = ArchitectureService.ColumnReceipt(instance, binding.Operation, binding.WasActive);
            else VerifyArchitectureFamilyPlacement(instance, binding.Operation, binding.TypeId,
                binding.ExpectedRotationRadians ?? throw Invalid("Copied door/window initial native rotation evidence is missing; roll back."));
        }
        return new { copiedTypes, copiedPlacementCount = architecturePlacements.Count, actualPlacedTypesVerifiedBeforeCommit = true };
    }
    internal object VerifyViewportLabels(string phase) => viewportLabels.VerifyCompleted(Doc, phase);
    internal object PreviewRoomCreation(JsonElement op)
    {
        var level = Level(op);
        return new
        {
            reviewedOperation = op,
            nativeLevelKnownAtPreview = level is not null,
            resolvedOperation = level is null ? (JsonElement?)null : RoomCreationReadbackRules.Resolve(op, level.Id.Value, JsonDefaults.InternalToMm(level.ProjectElevation)),
            elevationPolicy = "native-level-and-UV; Z-derived-from-project-level; input-Z-not-used",
            boundaryKnownAtPreview = false,
            boundaryPolicy = "derive-from-native-enclosure; verify-after-creation-and-commit"
        };
    }
    internal object VerifyArchitecturePrimary(string phase) => primaryReadback.VerifyCompleted(Doc, phase);
    internal object VerifyOpeningCreations(string phase)
    {
        var document = Doc;
        if (openingCreationDocument is not null && (!openingCreationDocument.IsValidObject || !openingCreationDocument.Equals(document)))
            throw new BridgeException("invalid_opening", "Opening creation readback belongs to a different native document; roll back.");
        var elements = openingCreations.Select(binding =>
        {
            var opening = document.GetElement(new ElementId(binding.ElementId)) as Opening ??
                throw new BridgeException("invalid_opening", "A reviewed opening disappeared or changed native class before final verification; roll back.");
            return OpeningService.Verify(document, opening, binding.Operation, phase, binding.HostSurface).Evidence ??
                throw new BridgeException("invalid_opening", "Final opening readback evidence is unavailable; roll back.");
        }).ToArray();
        return new { verificationPhase = phase, verifiedElementCount = elements.Length, elements, nativeReadbackVerified = true,
            sideEffectsVerified = false, persistenceVerified = false, visualVerified = false, engineeringComplianceVerified = false };
    }
    private OperationReceipt RememberOpeningCreation(Opening opening, JsonElement operation, OpeningHostSurfaceBinding? hostSurface)
    {
        var document = opening.Document;
        if (openingCreationDocument is null) openingCreationDocument = document;
        else if (!openingCreationDocument.IsValidObject || !openingCreationDocument.Equals(document))
            throw new BridgeException("invalid_opening", "Opening creation cannot cross native documents; roll back.");
        var reviewed = operation.Clone();
        document.Regenerate();
        var receipt = OpeningService.Verify(document, opening, reviewed, surfaceBinding: hostSurface);
        openingCreations.Add((opening.Id.Value, reviewed, hostSurface));
        return receipt;
    }
    internal object VerifyGridCreations(string phase)
    {
        var document = Doc;
        if (gridCreationDocument is not null && (!gridCreationDocument.IsValidObject || !gridCreationDocument.Equals(document)))
            throw Invalid("Grid creation readback belongs to a different native document.");
        var elements = gridCreations.Select(binding =>
        {
            var grid = document.GetElement(new ElementId(binding.ElementId)) as Grid ??
                throw new BridgeException("invalid_grid", "A reviewed grid disappeared or changed native class before final verification; roll back.");
            return ArchitectureService.VerifyGrid(grid, binding.Operation, phase);
        }).ToArray();
        return new { verificationPhase = phase, verifiedElementCount = elements.Length, elements, nativeReadbackVerified = true,
            sideEffectsVerified = false, persistenceVerified = false, visualVerified = false, engineeringComplianceVerified = false };
    }
    private OperationReceipt RememberGridCreation(Grid grid, JsonElement operation)
    {
        var document = grid.Document;
        if (gridCreationDocument is null) gridCreationDocument = document;
        else if (!gridCreationDocument.IsValidObject || !gridCreationDocument.Equals(document))
            throw Invalid("Grid creation readback belongs to a different native document.");
        var reviewed = operation.Clone();
        var evidence = ArchitectureService.VerifyGrid(grid, reviewed, "after-creation");
        gridCreations.Add((grid.Id.Value, reviewed));
        return new([grid.Id.Value], []) { Evidence = evidence };
    }
    internal object VerifyDocumentationPlacements(string phase)
    {
        var checks = documentationPlacements
            .Select(binding => DrawingPlacementService.VerifyReadback(Doc, binding.Operation, phase, binding.WritePerformed))
            .ToArray();
        return new
        {
            completedPlacementCount = documentationPlacements.Count,
            reviewedPlacementsComplete = true,
            checks,
            nativeReadbackVerified = true,
            sideEffectsVerified = false,
            persistenceVerified = false,
            visualVerified = false,
            verificationPhase = phase
        };
    }
    internal object VerifyDocumentationMetadata(string phase)
    {
        var checks = documentationMetadata.Select(binding => VerifyDocumentationMetadataItem(binding.Operation, binding.WritePerformed, phase)).ToArray();
        return new { phase, completedMetadataCount = checks.Length, checks,
            nativeReadbackVerified = true, sideEffectsVerified = false, persistenceVerified = false, visualVerified = false };
    }
    internal object VerifyDocumentationTitleBlocks(string phase)
    {
        var checks=documentationTitleBlocks.Select(binding=>TitleBlockChangeService.VerifyReadback(Doc,binding.Binding,phase,binding.WritePerformed)).ToArray();
        return new { phase, completedTitleBlockCount=checks.Length, checks,nativeReadbackVerified=true,sideEffectsVerified=false,persistenceVerified=false,visualVerified=false };
    }
    internal object VerifyDocumentationCreations(string phase) => documentationCreations.VerifyCompleted(Doc, phase);
    private object VerifyDocumentationMetadataItem(JsonElement op, bool writePerformed, string phase)
    {
        var target = Required<Element>(op, "elementId");
        var parameterName = JsonDefaults.String(op, "parameter") ?? throw Invalid("Documentation metadata parameter is required.");
        if (!parameterName.StartsWith("BIP:SHEET_", StringComparison.Ordinal) && !parameterName.StartsWith("BIP:VIEW_", StringComparison.Ordinal))
            throw Invalid("Only reviewed documentation metadata parameters are verified by the documentation readback gate.");
        var parameter = Parameter(target, parameterName);
        object actual = parameter.StorageType switch
        {
            StorageType.String => parameter.AsString() ?? "",
            StorageType.Integer => parameter.AsInteger(),
            _ => throw Invalid("Documentation metadata parameter has an unsupported storage type.")
        };
        var expected = ConvertValue(parameter, JsonDefaults.Get(op, "value"));
        var expectedValue = expected is ElementId id ? id.Value : expected;
        DocumentationMetadataReadbackRules.Require(
            new(target.Id.Value, target.GetType().Name, parameterName, expectedValue, expectedValue),
            new(target.Id.Value, target.GetType().Name, parameterName, expectedValue, actual));
        return new { phase, elementId = target.Id.Value, elementClass = target.GetType().Name, parameter = parameterName,
            expected = expectedValue, actual, writePerformed, nativeReadbackVerified = true,
            sideEffectsVerified = false, persistenceVerified = false, visualVerified = false };
    }
    private void VerifyArchitectureFamilyPlacement(FamilyInstance instance, JsonElement op, long typeId, double expectedRotationRadians)
    {
        if (instance.Symbol.Id.Value != typeId || instance.Host?.Id != Id(op, "hostElementId") || instance.LevelId != Level(op)!.Id ||
            instance.Category?.Id.Value != (long)Enum.Parse<BuiltInCategory>(JsonDefaults.String(op, "category")!) ||
            instance.Location is not LocationPoint location)
            throw Invalid("Native copied door/window type, wall host, level or point differs from the reviewed placement; roll back.");
        var expected = Point(op);
        var actual = location.Point;
        ArchitecturePlacementReadbackRules.Require(
            new(JsonDefaults.InternalToMm(expected.X), JsonDefaults.InternalToMm(expected.Y), JsonDefaults.InternalToMm(expected.Z), expectedRotationRadians),
            new(JsonDefaults.InternalToMm(actual.X), JsonDefaults.InternalToMm(actual.Y), JsonDefaults.InternalToMm(actual.Z), location.Rotation));
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
    private void ValidateStair(JsonElement op)=>StairGeometryService.Validate(Doc,op);
    public void Validate(JsonElement op)
    {
        var kind = JsonDefaults.String(op, "operationType")!;
        switch (kind)
        {
            case "load_family": FamilyLibraryService.Validate(Doc, op); break;
            case "create_family_instance":
                var symbol = Symbol(op); Level(op); var host = Check<Element>(op, "hostElementId", false);
                if (symbol is not null) ValidateFamilyTypeReference(op, symbol);
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
            case "duplicate_architecture_type": ArchitectureTypeCopyService.Validate(Doc, op); break;
            case "create_wall": Check<WallType>(op, "wallTypeId"); Level(op); Line(op); break;
            case "create_structural_column": ArchitectureService.ValidateColumn(Doc, MaterializeArchitectureColumn(op)); break;
            case "create_floor": Check<FloorType>(op, "floorTypeId"); Level(op); FloorLoop(op); break;
            case "create_opening": ValidateOpening(op); break;
            case "create_grid": ArchitectureService.ValidateGrid(Doc, op); break;
            case "create_room": Level(op); break;
            case "create_stair": ValidateStair(op); break;
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
                DimensionNativeEvidence.Resolve(Doc, op);
                break;
            case "place_viewport": Check<ViewSheet>(op, "sheetId"); Check<View>(op, "viewId"); break;
            case "move_drawing_placement": DrawingPlacementService.Validate(Doc, op); break;
            case "move_viewport_label": ViewportLabelService.Validate(Doc, op); break;
            case "change_titleblock_type": TitleBlockChangeService.Validate(Doc, op); break;
            case "create_pipe": Check<PipeType>(op, "pipeTypeId"); Check<PipingSystemType>(op, "systemTypeId"); Level(op); Line(op); break;
            case "create_duct": Check<DuctType>(op, "ductTypeId"); Check<MechanicalSystemType>(op, "systemTypeId"); Level(op); Line(op);
                if (!JsonDefaults.Has(op, "diameterMm") && (!JsonDefaults.Has(op, "widthMm") || !JsonDefaults.Has(op, "heightMm"))) throw Invalid("Duct requires diameterMm or widthMm + heightMm."); break;
            case "connect_elements": case "create_fitting":
                ConnectorSelectionRules.ValidateSelection(op,"first"); ConnectorSelectionRules.ValidateSelection(op,"second");
                var firstClass=ValidateConnectorSelection(op,"first"); var secondClass=ValidateConnectorSelection(op,"second");
                if(firstClass is not null && secondClass is not null)PipingCompatibilityRules.RequireCompatible(firstClass,secondClass);
                break;
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
                "load_family" => typeof(Family),
                "create_family_instance" or "create_fitting" or "create_structural_column" => typeof(FamilyInstance),
                "duplicate_type" => Check<ElementType>(op, "sourceTypeId")?.GetType() ?? typeof(ElementType),
                "duplicate_architecture_type" => typeof(FamilySymbol),
                "create_level" => typeof(Level), "create_grid" => typeof(Grid), "create_wall" => typeof(Wall), "create_floor" => typeof(Floor),
                "create_opening" => typeof(Opening), "create_room" => typeof(Autodesk.Revit.DB.Architecture.Room), "create_circuit" => typeof(ElectricalSystem), "create_wire" => typeof(Wire),
                "create_view_plan" => typeof(ViewPlan), "create_sheet" => typeof(ViewSheet), "create_schedule" => typeof(ViewSchedule), "create_panel_schedule" => typeof(PanelScheduleView),
                "place_viewport" => typeof(Element), "create_pipe" => typeof(Pipe), "create_duct" => typeof(Duct), _ => typeof(Element)
            };
            predicted[key] = resultType;
            predictedOperations[key] = op.Clone();
        }
    }
    internal OperationReceipt ExecuteStair(JsonElement op, CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        ValidateStair(op);
        var baseLevel = Required<Level>(op, "baseLevelId");
        var topLevel = Required<Level>(op, "topLevelId");
        using var scope = new StairsEditScope(Doc, "AI 受控楼梯");
        var stairId = ElementId.InvalidElementId;
        var runIds = new List<ElementId>();
        var landingIds = new List<long>();
        var failureCapture = new StairFailures();
        var cleanup = new StairExecutionCleanup();
        try
        {
            cancellation.ThrowIfCancellationRequested();
            cleanup.StartingScope();
            stairId = scope.Start(baseLevel.Id, topLevel.Id);
            cleanup.ScopeStarted();
            using (var transaction = new Transaction(Doc, "AI 楼梯梯段与平台"))
            {
                if (transaction.Start() != TransactionStatus.Started) throw Invalid("Unable to start stair transaction.");
                transaction.SetFailureHandlingOptions(transaction.GetFailureHandlingOptions().SetFailuresPreprocessor(failureCapture).SetClearAfterRollback(true).SetForcedModalHandling(true));
                StairGeometryService.Configure(Doc,stairId,op);
                foreach (var run in JsonDefaults.Array(op, "runs"))
                {
                    cancellation.ThrowIfCancellationRequested();
                    var line = Autodesk.Revit.DB.Line.CreateBound(Point(JsonDefaults.Get(run, "start")), Point(JsonDefaults.Get(run, "end")));
                    var stairRun = StairsRun.CreateStraightRun(Doc, stairId, line, StairsRunJustification.Center);
                    stairRun.ActualRunWidth = Mm(PlanRules.Number(run, "widthMm"));
                    runIds.Add(stairRun.Id);
                }
                if (JsonDefaults.String(op, "landingMode") == "automaticBetweenRuns")
                {
                    for (var index = 0; index < runIds.Count - 1; index++)
                    {
                        cleanup.Phase = StairExecutionPhase.BuildingLandings;
                        cancellation.ThrowIfCancellationRequested();
                        if (!StairsLanding.CanCreateAutomaticLanding(Doc, runIds[index], runIds[index + 1]))
                            throw Invalid($"Revit cannot create an automatic landing between runs {index + 1} and {index + 2}.");
                        var createdLandings=StairsLanding.CreateAutomaticLanding(Doc, runIds[index], runIds[index + 1]);
                        if(createdLandings.Count==0)throw Invalid("Native automatic landing returned no component IDs.");
                        landingIds.AddRange(createdLandings.Select(id=>id.Value));
                    }
                }
                if(JsonDefaults.String(op,"landingMode")=="sketched")
                {
                    cleanup.Phase=StairExecutionPhase.BuildingLandings;
                    cancellation.ThrowIfCancellationRequested();
                    landingIds.AddRange(StairGeometryService.CreateSketchedLandings(Doc,stairId,op,cancellation));
                }
                Doc.Regenerate();
                StairGeometryService.Verify(Doc,(Stairs)Doc.GetElement(stairId),op,runIds.Select(id=>id.Value).ToArray(),landingIds.ToArray());
                cleanup.Phase = StairExecutionPhase.CommittingTransaction;
                cancellation.ThrowIfCancellationRequested();
                if (transaction.Commit() != TransactionStatus.Committed) throw Invalid("Revit rejected the stair transaction.");
            }
            cleanup.Phase = StairExecutionPhase.CommittingScope;
            cancellation.ThrowIfCancellationRequested();
            scope.Commit(failureCapture);
            // Do not throw cancellation after a potentially committed scope; return/read its exact receipt.
            cleanup.ScopeCommitReturned();
            var stair = Doc.GetElement(stairId) as Stairs ?? throw Invalid("Revit did not return the created stair.");
            StairGeometryService.Verify(Doc,stair,op,runIds.Select(id=>id.Value).ToArray(),landingIds.ToArray());
            var created = new List<long> { stair.Id.Value };
            created.AddRange(stair.GetStairsRuns().Select(id => id.Value));
            created.AddRange(stair.GetStairsLandings().Select(id => id.Value));
            created.AddRange(stair.GetStairsSupports().Select(id=>id.Value));
            created.AddRange(stair.GetAssociatedRailings().Select(id=>id.Value));
            return new(created.Distinct().ToList(), [])
            {
                Evidence = new { stairId = stair.Id.Value, runIds = stair.GetStairsRuns().Select(id => id.Value).ToArray(), landingIds = stair.GetStairsLandings().Select(id => id.Value).ToArray(), landingMode = JsonDefaults.String(op, "landingMode"),native=StairGeometryService.Snapshot(Doc,stair),reviewedTypeAndGeometryVerified=true,completeStairConnectionsVerified=false,engineeringComplianceVerified=false, warnings = failureCapture.Messages.ToArray(), note = "Native StairsEditScope result; no automatic save." }
            };
        }
        catch (Exception ex)
        {
            var evidence = cleanup.AfterFailure(() => scope.Cancel());
            throw new StairExecutionFailure(ex, evidence, failureCapture.Messages);
        }
    }
    private sealed class StairFailures : IFailuresPreprocessor
    {
        public List<string> Messages { get; } = [];
        public FailureProcessingResult PreprocessFailures(FailuresAccessor accessor)
        {
            var failures = accessor.GetFailureMessages();
            Messages.AddRange(failures.Select(f => f.GetDescriptionText()));
            if (failures.Any(f => f.GetSeverity() == FailureSeverity.Error || f.GetSeverity() == FailureSeverity.DocumentCorruption)) return FailureProcessingResult.ProceedWithRollBack;
            foreach (var failure in failures.Where(f => f.GetSeverity() == FailureSeverity.Warning)) accessor.DeleteWarning(failure);
            return FailureProcessingResult.Continue;
        }
    }
    public OperationReceipt Execute(JsonElement op)
    {
        var kind = JsonDefaults.String(op, "operationType")!;
        Element? created = null;
        OpeningHostSurfaceBinding? openingHostSurface = null;
        bool? columnSymbolWasActive = null;
        JsonElement? materializedColumn = null;
        double? familyExpectedRotationRadians = null;
        JsonElement? resolvedPrimary = null;
        ArchitectureHostedReadback? hostedExpected = null;
        TagTargetReadback? tagExpected = null;
        DimensionCreationReadback? dimensionExpected = null;
        switch (kind)
        {
            case "load_family": return FamilyLibraryService.Load(Doc, op);
            case "change_titleblock_type":
                var titleBlockReceipt=TitleBlockChangeService.Apply(Doc,op);
                if (titleBlockReceipt.ReadbackBinding is not TitleBlockChangeService.ReadbackBinding titleBlockBinding)
                    throw Invalid("Titleblock execution did not return a native readback binding.");
                documentationTitleBlocks.Add((titleBlockBinding,titleBlockReceipt.Changed.Count>0));
                return titleBlockReceipt;
            case "create_family_instance":
                var symbol = Symbol(op)!; var level = Level(op)!; var point = Point(op);
                ValidateFamilyTypeReference(op, symbol);
                AllowArchitecturePlacementActivation(op, symbol);
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
                if (ArchitecturePrimaryReadbackService.IsHostedArchitecture(symbol))
                {
                    Doc.Regenerate();
                    if (created.Location is not LocationPoint initialLocation) throw Invalid("Door/window has no native point and rotation evidence; roll back.");
                    familyExpectedRotationRadians = ArchitecturePlacementReadbackRules.ExpectedRotation(initialLocation.Rotation,
                        JsonDefaults.Has(op, "rotationDegrees") ? PlanRules.Number(op, "rotationDegrees") : 0);
                    hostedExpected = new(symbol.Id.Value, Id(op,"hostElementId").Value, level.Id.Value, symbol.Category!.Id.Value,
                        new(JsonDefaults.InternalToMm(point.X), JsonDefaults.InternalToMm(point.Y), JsonDefaults.InternalToMm(point.Z), familyExpectedRotationRadians.Value));
                }
                if (JsonDefaults.Double(op, "rotationDegrees") is double rotation && rotation != 0)
                    ElementTransformUtils.RotateElement(Doc, created.Id, Autodesk.Revit.DB.Line.CreateBound(point, point + XYZ.BasisZ), rotation * Math.PI / 180);
                break;
            case "duplicate_type": created = Required<ElementType>(op, "sourceTypeId").Duplicate(JsonDefaults.String(op, "name")!); break;
            case "duplicate_architecture_type": return architectureCopies.Apply(Doc, op);
            case "set_parameter":
                var target = Required<Element>(op, "elementId");
                var parameterName = JsonDefaults.String(op, "parameter")!;
                var wroteParameter = SetParameter(target, parameterName, JsonDefaults.Get(op, "value"));
                if (parameterName is "BIP:SHEET_NUMBER" or "BIP:SHEET_NAME" or "BIP:VIEW_NAME" or "BIP:VIEW_SCALE_PULLDOWN_METRIC")
                    documentationMetadata.Add((op.Clone(), wroteParameter));
                return OperationReceipt.ForParameter(target.Id.Value, parameterName, wroteParameter);
            case "delete_element": return new([], Doc.Delete(Id(op, "elementId")).Select(id => id.Value).ToList());
            case "create_level": created = Autodesk.Revit.DB.Level.Create(Doc, Mm(PlanRules.Number(op, "elevationMm"))); created.Name = JsonDefaults.String(op, "name")!; break;
            case "create_grid": created = ArchitectureService.CreateGrid(Doc, op); break;
            case "create_structural_column":
                materializedColumn = MaterializeArchitectureColumn(op);
                var columnSymbol = Required<FamilySymbol>(materializedColumn.Value, "symbolId");
                AllowArchitecturePlacementActivation(op, columnSymbol);
                columnSymbolWasActive = columnSymbol.IsActive;
                created = ArchitectureService.CreateColumn(Doc, materializedColumn.Value); break;
            case "create_wall":
                var wallTypeId = Id(op,"wallTypeId"); var wallLevel = Level(op)!;
                resolvedPrimary = ArchitecturePrimaryReadbackService.Resolve(op,wallTypeId.Value,wallLevel);
                created = Wall.Create(Doc, Line(op), wallTypeId, wallLevel.Id, Mm(PlanRules.Number(op, "heightMm")), Mm(JsonDefaults.Double(op, "offsetMm") ?? 0), JsonDefaults.Bool(op, "flip"), JsonDefaults.Bool(op, "structural")); break;
            case "create_floor":
                var floorTypeId = Id(op,"floorTypeId"); var floorLevel = Level(op)!; var floorLoop = FloorLoop(op);
                resolvedPrimary = ArchitecturePrimaryReadbackService.Resolve(op,floorTypeId.Value,floorLevel,floorLoop);
                created = Floor.Create(Doc, [floorLoop], floorTypeId, floorLevel.Id); break;
            case "create_opening": created = CreateOpening(op, out openingHostSurface); break;
            case "create_room":
                var roomLevel = Level(op)!; var roomPoint = Point(op);
                resolvedPrimary = RoomCreationReadbackRules.Resolve(op, roomLevel.Id.Value, JsonDefaults.InternalToMm(roomLevel.ProjectElevation));
                var room = Doc.Create.NewRoom(roomLevel, new UV(roomPoint.X, roomPoint.Y)) ?? throw Invalid("Revit did not return the reviewed room.");
                room.Name = JsonDefaults.String(op, "name")!;
                room.Number = JsonDefaults.String(op, "number")!;
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
            case "move_drawing_placement":
                var placementReceipt = DrawingPlacementService.Apply(Doc, op);
                documentationPlacements.Add((op.Clone(), placementReceipt.Changed.Count > 0));
                return placementReceipt;
            case "move_viewport_label": return viewportLabels.Apply(Doc, op);
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
                    if (TagLeaderRules.Requested(op) is bool roomLeader) roomTag.HasLeader = roomLeader;
                    created = roomTag;
                }
                else if (JsonDefaults.Has(op, "tagTypeId")) created = IndependentTag.Create(Doc, Id(op, "tagTypeId"), tagView.Id, new Reference(tagElement), JsonDefaults.Bool(op, "leader"), TagOrientation.Horizontal, tagPoint);
                else created = IndependentTag.Create(Doc, tagView.Id, new Reference(tagElement), JsonDefaults.Bool(op, "leader"), TagMode.TM_ADDBY_CATEGORY, TagOrientation.Horizontal, tagPoint);
                if (created is null) throw Invalid("Revit did not return a created tag.");
                // Capture the request and chosen type before generic parameter writes can change them.
                tagExpected = new(created.Id.Value, tagElement is Autodesk.Revit.DB.Architecture.Room ? "RoomTag" : "IndependentTag",
                    tagView.Id.Value, JsonDefaults.Has(op, "tagTypeId") ? Id(op, "tagTypeId").Value : created.GetTypeId().Value,
                    false, new[] { new TagTargetReference(tagElement.Id.Value, -1, -1) });
                break;
            case "create_dimension":
            {
                var dimensionView = Required<View>(op, "viewId");
                var dimensionLine = Line(op);
                var requestedDimensionAxis = DimensionNativeEvidence.Axis(dimensionLine);
                var resolvedDimensionReferences = DimensionNativeEvidence.Resolve(Doc, op);
                using var dimensionReferences = new ReferenceArray();
                foreach (var reference in resolvedDimensionReferences.Native) dimensionReferences.Append(reference);
                var dimensionType = JsonDefaults.Has(op, "dimensionTypeId") ? Required<DimensionType>(op, "dimensionTypeId") : null;
                var dimension = dimensionType is not null ? Doc.Create.NewDimension(dimensionView, dimensionLine, dimensionReferences, dimensionType)
                    : Doc.Create.NewDimension(dimensionView, dimensionLine, dimensionReferences);
                if (dimension is null) throw Invalid("Revit did not return a created dimension.");
                created = dimension;
                // Freeze requested axis/references and chosen type before generic parameters or later operations.
                dimensionExpected = new(dimension.Id.Value, dimension.UniqueId, dimension.GetType().Name, dimensionView.Id.Value,
                    dimensionType?.Id.Value ?? dimension.GetTypeId().Value, true, requestedDimensionAxis, resolvedDimensionReferences.Evidence, true);
                break;
            }
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
                Doc.Regenerate(); var a = SelectConnector(Required<Element>(op, "firstElementId"), op, "first"); var b = SelectConnector(Required<Element>(op, "secondElementId"), op, "second");
                if (a.Domain != b.Domain || a.Owner.Id == b.Owner.Id) throw Invalid("Connectors are incompatible or belong to the same element.");
                if (kind == "connect_elements")
                {
                    if (a.Origin.DistanceTo(b.Origin) > Mm(JsonDefaults.Double(op, "toleranceMm") ?? 1)) throw Invalid("Direct connectors must be coincident. Create a pipe or fitting explicitly.");
                    if(a.Shape!=b.Shape)throw Invalid("Direct connector shapes differ; create an explicit transition.");
                    if(a.Domain==Domain.DomainPiping)PipingCompatibilityRules.RequireCompatible(EvidenceForSelection(a,op,"first"),EvidenceForSelection(b,op,"second"));
                    if(a.Shape==ConnectorProfileType.Round && Math.Abs(a.Radius-b.Radius)>Mm(0.01))throw Invalid("Direct connector diameters differ; preview a transition fitting.");
                    if(a.CoordinateSystem.BasisZ.DotProduct(b.CoordinateSystem.BasisZ)>-0.9999)throw Invalid("Direct connector axes must oppose; preview a fitting or correctly aligned pipe.");
                    if((a.IsConnected && !a.IsConnectedTo(b)) || (b.IsConnected && !b.IsConnectedTo(a)))throw Invalid("A selected connector is already occupied.");
                    if (!a.IsConnectedTo(b)) a.ConnectTo(b);
                    Doc.Regenerate(); if(!a.IsConnectedTo(b))throw Invalid("Revit did not connect the reviewed pair; the whole plan rolls back.");
                    return new([], [a.Owner.Id.Value, b.Owner.Id.Value]);
                }
                if(a.Domain==Domain.DomainPiping)PipingCompatibilityRules.RequireCompatible(EvidenceForSelection(a,op,"first"),EvidenceForSelection(b,op,"second"));
                if(a.IsConnected || b.IsConnected)throw Invalid("A fitting endpoint is already occupied.");
                created = JsonDefaults.StringOr(op, "fittingType", "elbow") switch
                {
                    "elbow" => Doc.Create.NewElbowFitting(a, b), "union" => Doc.Create.NewUnionFitting(a, b), "transition" => Doc.Create.NewTransitionFitting(a, b), _ => throw Invalid("Supported fittings: elbow, union, transition.")
                }; break;
            default: throw Invalid($"Unsupported operation '{kind}'.");
        }
        if (created is null) throw Invalid("Revit did not return a created element.");
        if (kind == "create_sheet")
            documentationCreations.RememberSheet(Doc, (ViewSheet)created, op, true);
        if (kind == "place_viewport")
        {
            var ownerSheet = Required<ViewSheet>(op, "sheetId");
            var sourceView = Required<View>(op, "viewId");
            documentationCreations.RememberViewport(ownerSheet, sourceView, created, op, true);
        }
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
        materializedOperations[created.Id.Value] = op.Clone();
        if (kind == "create_family_instance" && ArchitectureCopyForPlacement(op) is not null)
        {
            var placed = (FamilyInstance)created;
            Doc.Regenerate();
            VerifyArchitectureFamilyPlacement(placed, op, Id(op, "symbolId").Value, familyExpectedRotationRadians!.Value);
            architecturePlacements.Add((created.Id.Value, Id(op, "symbolId").Value, op.Clone(), true, familyExpectedRotationRadians));
        }
        if(kind=="create_opening")return RememberOpeningCreation((Opening)created, op, openingHostSurface);
        if (kind == "create_grid") return RememberGridCreation((Grid)created, op);
        if(kind=="create_structural_column")
        {
            architecturePlacements.Add((created.Id.Value, ((FamilyInstance)created).Symbol.Id.Value, materializedColumn!.Value.Clone(), columnSymbolWasActive!.Value, null));
            return ArchitectureService.ColumnReceipt((FamilyInstance)created,materializedColumn.Value,columnSymbolWasActive.Value);
        }
        if (resolvedPrimary is { } primaryOperation) return primaryReadback.Remember(Doc,created,op,primaryOperation);
        if (hostedExpected is { } hosted) return primaryReadback.Remember(Doc,created,op,op,hosted);
        if (tagExpected is { } expectedTag)
            return documentationCreations.RememberTagCreation(Doc, created, expectedTag, op);
        if (dimensionExpected is { } expectedDimension)
            return documentationCreations.RememberDimensionCreation(Doc, (Dimension)created, expectedDimension);
        return OperationReceipt.New(created.Id.Value);
    }
    private void ValidateOpening(JsonElement op)=>OpeningService.Validate(Doc,op);
    private Opening CreateOpening(JsonElement op, out OpeningHostSurfaceBinding? hostSurface)
    {
        var document = Doc;
        if (openingCreationDocument is null) openingCreationDocument = document;
        else if (!openingCreationDocument.IsValidObject || !openingCreationDocument.Equals(document))
            throw new BridgeException("invalid_opening", "Opening prewrite surface belongs to another native document.");
        var reviewed = op.Clone();
        hostSurface = OpeningHostSurfaceReadbackService.CaptureBeforeCreation(document, reviewed);
        return OpeningService.Create(document, reviewed);
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
    private Connector SelectConnector(Element element,JsonElement op,string prefix)
    {
        return op.TryGetProperty(prefix+"Connector",out var criteria)
            ? ConnectorResolutionService.ResolveForExecution(element,criteria)
            : ConnectorResolutionService.ById(element,JsonDefaults.Int64(op,prefix+"ConnectorId")??throw Invalid("Connector ID is missing."));
    }
    private PipingClassEvidence EvidenceForSelection(Connector connector,JsonElement op,string prefix)
    {
        return PipingCompatibilityService.Evidence(connector,ExpectedSystemTypeId(op,prefix));
    }
    private long? ExpectedSystemTypeId(JsonElement op,string prefix)
    {
        var value=JsonDefaults.Get(op,prefix+"ElementId");
        if(!Deferred(value) && value.ValueKind==JsonValueKind.Number && value.TryGetInt64(out var materializedId) && materializedOperations.TryGetValue(materializedId,out var materializedOwner) && JsonDefaults.String(materializedOwner,"operationType")=="create_pipe") return JsonDefaults.Int64(materializedOwner,"systemTypeId");
        if(!Deferred(value))return null;
        var reference=value.GetString()![1..];
        if(predictedOperations.TryGetValue(reference,out var owner)&&JsonDefaults.String(owner,"operationType")=="create_pipe")return JsonDefaults.Int64(owner,"systemTypeId");
        return null;
    }
    private PipingClassEvidence? ValidateConnectorSelection(JsonElement op,string prefix)
    {
        var existing=Check<Element>(op,prefix+"ElementId");
        if(existing is not null)
        {
            var connector=SelectConnector(existing,op,prefix);

            return connector.Domain==Domain.DomainPiping?PipingCompatibilityService.Evidence(connector,ExpectedSystemTypeId(op,prefix)):null;
        }
        var reference=JsonDefaults.String(op,prefix+"ElementId")![1..];
        if(!op.TryGetProperty(prefix+"Connector",out var criteria))throw Invalid("New elements require connector criteria, not predicted connector IDs.");
        var owner=predictedOperations[reference];
        if(JsonDefaults.String(owner,"operationType") is not ("create_pipe" or "create_duct"))throw Invalid("Deferred connector criteria support explicitly created straight pipes/ducts only.");
        var endpoint=ConnectionPortReservationRules.NewCurveEndpoint(owner,criteria);

        if(JsonDefaults.String(owner,"operationType")!="create_pipe")return null;
        var system=Check<PipingSystemType>(owner,"systemTypeId")??throw Invalid("New pipe must use an inspected native system type.");
        return new PipingClassEvidence(-1,-1,null,system.Id.Value,system.SystemClassification.ToString());
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
    private bool SetParameter(Element e, string name, JsonElement value)
    {
        var p = Parameter(e, name); var converted = ConvertValue(p, value);
        var same = converted switch { string s => p.AsString() == s, int i => p.AsInteger() == i, double d => Math.Abs(p.AsDouble() - d) <= 1e-10 * Math.Max(1, Math.Abs(d)), ElementId id => p.AsElementId() == id, _ => false };
        if (same) return false;
        var changed = converted switch { string s => p.Set(s), int i => p.Set(i), double d => p.Set(d), ElementId id => p.Set(id), _ => false };
        if (!changed) throw Invalid($"Revit refused parameter {name} on {e.Id.Value}.");
        return true;
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
