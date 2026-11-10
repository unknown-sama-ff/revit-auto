using System.Text.Json;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;

namespace RevitAutoV27;

internal static class ArchitectureService
{
    private static BridgeException Invalid(string message) => new("invalid_structural_column", message);
    private static double Mm(double value) => UnitUtils.ConvertToInternalUnits(value, UnitTypeId.Millimeters);
    private static T Existing<T>(Document doc, JsonElement op, string field) where T : Element =>
        doc.GetElement(new ElementId(JsonDefaults.Int64(op, field) ?? throw Invalid($"Explicit {field} is required."))) as T ??
        throw Invalid($"{field} is not an existing {typeof(T).Name} in the current document.");

    public static void ValidateColumn(Document doc, JsonElement op)
    {
        ArchitectureRules.StructuralColumn(op);
        var symbol = Existing<FamilySymbol>(doc, op, "symbolId");
        if (symbol.Category?.Id.Value != (long)BuiltInCategory.OST_StructuralColumns || symbol.Family.FamilyPlacementType != FamilyPlacementType.TwoLevelsBased)
            throw Invalid("Select an existing OST_StructuralColumns family type with TwoLevelsBased placement; other family placements need a separate adapter.");
        var bottom = Existing<Level>(doc, op, "baseLevelId"); var top = Existing<Level>(doc, op, "topLevelId");
        ArchitectureRules.RequireVerticalExtent(JsonDefaults.InternalToMm(bottom.Elevation), JsonDefaults.InternalToMm(top.Elevation),
            PlanRules.Number(op, "baseOffsetMm"), PlanRules.Number(op, "topOffsetMm"));
    }

    public static FamilyInstance CreateColumn(Document doc, JsonElement op)
    {
        ValidateColumn(doc, op);
        var symbol = Existing<FamilySymbol>(doc, op, "symbolId"); var bottom = Existing<Level>(doc, op, "baseLevelId"); var top = Existing<Level>(doc, op, "topLevelId");
        var coordinates = JsonDefaults.Get(op, "point");
        var point = new XYZ(Mm(PlanRules.Number(coordinates, "xMm")), Mm(PlanRules.Number(coordinates, "yMm")), bottom.Elevation + Mm(PlanRules.Number(op, "baseOffsetMm")));
        if (!symbol.IsActive) { symbol.Activate(); doc.Regenerate(); }
        var column = doc.Create.NewFamilyInstance(point, symbol, bottom, StructuralType.Column) ?? throw Invalid("Revit did not return a structural column.");
        SetLevel(column, BuiltInParameter.FAMILY_BASE_LEVEL_PARAM, bottom.Id);
        SetLevel(column, BuiltInParameter.FAMILY_TOP_LEVEL_PARAM, top.Id);
        SetOffset(column, BuiltInParameter.FAMILY_BASE_LEVEL_OFFSET_PARAM, Mm(PlanRules.Number(op, "baseOffsetMm")));
        SetOffset(column, BuiltInParameter.FAMILY_TOP_LEVEL_OFFSET_PARAM, Mm(PlanRules.Number(op, "topOffsetMm")));
        var rotation = JsonDefaults.Double(op, "rotationDegrees") ?? 0;
        if (rotation != 0) ElementTransformUtils.RotateElement(doc, column.Id, Line.CreateBound(point, point + XYZ.BasisZ), rotation * Math.PI / 180);
        doc.Regenerate();
        VerifyColumn(column, op, bottom);
        return column;
    }

    public static object PreviewColumn(Document doc, JsonElement op)
    {
        ValidateColumn(doc, op);
        var symbol = Existing<FamilySymbol>(doc, op, "symbolId"); var bottom = Existing<Level>(doc, op, "baseLevelId"); var top = Existing<Level>(doc, op, "topLevelId");
        var baseOffset = PlanRules.Number(op, "baseOffsetMm"); var topOffset = PlanRules.Number(op, "topOffsetMm");
        var baseZ = JsonDefaults.InternalToMm(bottom.Elevation) + baseOffset; var topZ = JsonDefaults.InternalToMm(top.Elevation) + topOffset;
        var point = JsonDefaults.Get(op, "point");
        return new { symbolId = symbol.Id.Value, family = symbol.FamilyName, type = symbol.Name, categoryId = symbol.Category?.Id.Value,
            baseLevelId = bottom.Id.Value, baseLevelName = bottom.Name, baseElevationMm = JsonDefaults.InternalToMm(bottom.Elevation), baseOffsetMm = baseOffset,
            topLevelId = top.Id.Value, topLevelName = top.Name, topElevationMm = JsonDefaults.InternalToMm(top.Elevation), topOffsetMm = topOffset,
            baseZMm = baseZ, topZMm = topZ, heightMm = topZ - baseZ,
            position = new { xMm = PlanRules.Number(point, "xMm"), yMm = PlanRules.Number(point, "yMm"), zMm = baseZ },
            rotationDegrees = JsonDefaults.Double(op, "rotationDegrees") ?? 0, symbolIsActive = symbol.IsActive, activationRequired = !symbol.IsActive,
            activationScope = new { symbolId = symbol.Id.Value, familyId = symbol.Family.Id.Value }, typeMutationRequested = false, engineeringComplianceVerified = false };
    }

    public static OperationReceipt ColumnReceipt(FamilyInstance column, JsonElement op, bool symbolWasActive)
    {
        VerifyColumn(column, op, Existing<Level>(column.Document, op, "baseLevelId"));
        var symbol = column.Symbol;
        return new([column.Id.Value], symbolWasActive ? [] : [symbol.Id.Value])
        {
            Evidence = new { native = ColumnSnapshot(column), symbolActivation = new { symbolId = symbol.Id.Value, familyId = symbol.Family.Id.Value, beforeActive = symbolWasActive, afterActive = symbol.IsActive, activationPerformed = !symbolWasActive },
                reviewedTypeAndConstraintsVerified = true, engineeringComplianceVerified = false }
        };
    }

    private static void VerifyColumn(FamilyInstance column, JsonElement op, Level bottom)
    {
        var point = JsonDefaults.Get(op, "point");
        var expected = new XYZ(Mm(PlanRules.Number(point, "xMm")), Mm(PlanRules.Number(point, "yMm")), bottom.Elevation + Mm(PlanRules.Number(op, "baseOffsetMm")));
        var expectedRotation = (JsonDefaults.Double(op, "rotationDegrees") ?? 0) * Math.PI / 180;
        if (column.Category?.Id.Value != (long)BuiltInCategory.OST_StructuralColumns || column.StructuralType != StructuralType.Column ||
            column.Symbol.Id.Value != JsonDefaults.Int64(op, "symbolId") ||
            ReadLevel(column, BuiltInParameter.FAMILY_BASE_LEVEL_PARAM) != JsonDefaults.Int64(op, "baseLevelId") ||
            ReadLevel(column, BuiltInParameter.FAMILY_TOP_LEVEL_PARAM) != JsonDefaults.Int64(op, "topLevelId") ||
            Math.Abs(ReadOffset(column, BuiltInParameter.FAMILY_BASE_LEVEL_OFFSET_PARAM) - PlanRules.Number(op, "baseOffsetMm")) > 0.01 ||
            Math.Abs(ReadOffset(column, BuiltInParameter.FAMILY_TOP_LEVEL_OFFSET_PARAM) - PlanRules.Number(op, "topOffsetMm")) > 0.01 ||
            column.Location is not LocationPoint location || !FinitePoint(location.Point) || !double.IsFinite(location.Rotation) || location.Point.DistanceTo(expected) > Mm(1) ||
            Math.Abs(Math.Atan2(Math.Sin(location.Rotation - expectedRotation), Math.Cos(location.Rotation - expectedRotation))) > 1e-6)
            throw Invalid("Native structural column type, constraints, offsets, point or rotation differ from the reviewed inputs; the entire plan must roll back.");
    }

    private static Parameter Parameter(Element element, BuiltInParameter key, StorageType storage)
    {
        var value = element.get_Parameter(key);
        return value is not null && value.StorageType == storage ? value : throw Invalid($"Native {key} parameter is unavailable or has an unexpected storage type.");
    }
    private static long ReadLevel(Element element, BuiltInParameter key)
    {
        var parameter = Parameter(element, key, StorageType.ElementId);
        if (!parameter.HasValue || parameter.AsElementId().Value <= 0) throw Invalid($"Native {key} level is unknown.");
        return parameter.AsElementId().Value;
    }
    private static double ReadOffset(Element element, BuiltInParameter key)
    {
        var parameter = Parameter(element, key, StorageType.Double);
        return ArchitectureRules.NativeOffset(parameter.HasValue, JsonDefaults.InternalToMm(parameter.AsDouble()));
    }
    private static void SetLevel(Element element, BuiltInParameter key, ElementId id)
    {
        var value = Parameter(element, key, StorageType.ElementId);
        if (value.HasValue && value.AsElementId() == id) return;
        if (value.IsReadOnly || !value.Set(id)) throw Invalid($"Revit refused the reviewed {key}.");
    }
    private static void SetOffset(Element element, BuiltInParameter key, double offset)
    {
        var value = Parameter(element, key, StorageType.Double);
        if (value.HasValue && double.IsFinite(value.AsDouble()) && Math.Abs(value.AsDouble() - offset) <= 1e-10) return;
        if (value.IsReadOnly || !value.Set(offset)) throw Invalid($"Revit refused the reviewed {key}.");
    }

    public static void ValidateGrid(Document doc, JsonElement op)
    {
        ArchitectureRules.Grid(op);
        if (new FilteredElementCollector(doc).OfClass(typeof(Grid)).Cast<Grid>().Any(grid => grid.Name == JsonDefaults.String(op, "name")))
            throw new BridgeException("invalid_grid", "Grid name already exists; select a distinct explicit name or inspect the existing grid.");
        GridLine(doc, op);
    }
    private static Line GridLine(Document doc, JsonElement op)
    {
        static XYZ Point(JsonElement point) => new(Mm(PlanRules.Number(point, "xMm")), Mm(PlanRules.Number(point, "yMm")), Mm(JsonDefaults.Double(point, "zMm") ?? 0));
        var start = Point(JsonDefaults.Get(op, "start")); var end = Point(JsonDefaults.Get(op, "end"));
        if (start.DistanceTo(end) < doc.Application.ShortCurveTolerance) throw new BridgeException("invalid_grid", "Grid is shorter than native ShortCurveTolerance.");
        return Line.CreateBound(start, end);
    }
    public static Grid CreateGrid(Document doc, JsonElement op)
    {
        ValidateGrid(doc, op);
        var grid = Grid.Create(doc, GridLine(doc, op)); grid.Name = JsonDefaults.String(op, "name")!;
        doc.Regenerate();
        VerifyGrid(grid, op, "after-creation");
        return grid;
    }

    internal static object VerifyGrid(Grid grid, JsonElement operation, string phase)
    {
        using var curve = grid.Curve;
        if (curve is not Line line || !line.IsBound)
            throw new BridgeException("invalid_grid", "Reviewed grid no longer has a bounded straight native curve; roll back.");
        var start = line.GetEndPoint(0); var end = line.GetEndPoint(1);
        var actual = new GridCreationReadback(grid.Name, grid.IsCurved, line.IsBound,
            new(JsonDefaults.InternalToMm(start.X), JsonDefaults.InternalToMm(start.Y), JsonDefaults.InternalToMm(start.Z),
                JsonDefaults.InternalToMm(end.X), JsonDefaults.InternalToMm(end.Y), JsonDefaults.InternalToMm(end.Z)));
        GridCreationReadbackRules.Require(operation, actual);
        return new { elementId = grid.Id.Value, operationType = "create_grid", verificationPhase = phase,
            coordinateFrame = "Revit internal/project origin, millimeters", reviewedOperation = operation.Clone(), native = actual,
            nativeReadbackVerified = true, sideEffectsVerified = false, persistenceVerified = false, visualVerified = false, engineeringComplianceVerified = false };
    }

    public static object? Snapshot(Element element) => element switch
    {
        Grid grid => GridSnapshot(grid),
        FamilyInstance column when column.Category?.Id.Value == (long)BuiltInCategory.OST_StructuralColumns => ColumnSnapshot(column),
        _ => null
    };
    private static bool FinitePoint(XYZ value) => double.IsFinite(value.X) && double.IsFinite(value.Y) && double.IsFinite(value.Z);
    private static object Point(XYZ value)
    {
        if (!FinitePoint(value)) throw Invalid("Native architecture point is non-finite.");
        return new { xMm = JsonDefaults.InternalToMm(value.X), yMm = JsonDefaults.InternalToMm(value.Y), zMm = JsonDefaults.InternalToMm(value.Z) };
    }
    private static object Direction(XYZ value)
    {
        if (!FinitePoint(value)) throw Invalid("Native architecture direction is non-finite.");
        return new { x = value.X, y = value.Y, z = value.Z };
    }
    private static object GridSnapshot(Grid grid)
    {
        try
        {
            var curve = grid.Curve;
            object geometry = curve switch
            {
                Line line => new { kind = "line", isBound = line.IsBound, start = line.IsBound ? Point(line.GetEndPoint(0)) : null, end = line.IsBound ? Point(line.GetEndPoint(1)) : null, origin = Point(line.Origin), direction = Direction(line.Direction), lengthMm = line.IsBound ? (double?)JsonDefaults.InternalToMm(line.Length) : null },
                Arc arc => new { kind = "arc", isBound = arc.IsBound, center = Point(arc.Center), radiusMm = JsonDefaults.InternalToMm(arc.Radius), normal = Direction(arc.Normal), xDirection = Direction(arc.XDirection), yDirection = Direction(arc.YDirection), start = arc.IsBound ? Point(arc.GetEndPoint(0)) : null, end = arc.IsBound ? Point(arc.GetEndPoint(1)) : null, startParameter = arc.IsBound ? (double?)arc.GetEndParameter(0) : null, endParameter = arc.IsBound ? (double?)arc.GetEndParameter(1) : null },
                _ => throw new InvalidOperationException($"Unsupported native grid curve {curve.GetType().Name}.")
            };
            return new { name = grid.Name, isCurved = grid.IsCurved, curveSupported = true, curveError = (string?)null, curve = geometry };
        }
        catch (Exception error) { return new { name = grid.Name, curveSupported = false, curveError = error.Message, curve = (object?)null }; }
    }
    private static object ColumnSnapshot(FamilyInstance column)
    {
        try
        {
            var location = column.Location as LocationPoint;
            if (location is not null && !double.IsFinite(location.Rotation)) throw Invalid("Native column rotation is non-finite.");
            return new { symbolId = column.Symbol.Id.Value, structuralType = column.StructuralType.ToString(), placement = column.Symbol.Family.FamilyPlacementType.ToString(), constraintsSupported = true, constraintsError = (string?)null,
                baseLevelId = ReadLevel(column, BuiltInParameter.FAMILY_BASE_LEVEL_PARAM), topLevelId = ReadLevel(column, BuiltInParameter.FAMILY_TOP_LEVEL_PARAM),
                baseOffsetMm = ReadOffset(column, BuiltInParameter.FAMILY_BASE_LEVEL_OFFSET_PARAM), topOffsetMm = ReadOffset(column, BuiltInParameter.FAMILY_TOP_LEVEL_OFFSET_PARAM),
                position = location is null ? null : Point(location.Point), rotationDegrees = location is null ? (double?)null : location.Rotation * 180 / Math.PI };
        }
        catch (Exception error) { return new { constraintsSupported = false, constraintsError = error.Message }; }
    }
}
