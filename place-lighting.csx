if (!document.PathName.EndsWith(@"考生文件夹\照明模型+方昱.rvt", StringComparison.OrdinalIgnoreCase))
    throw new InvalidOperationException("The active document is not the output model.");
if (new FilteredElementCollector(document).OfCategory(BuiltInCategory.OST_LightingFixtures)
    .WhereElementIsNotElementType().GetElementCount() != 0)
    throw new InvalidOperationException("Lighting fixtures already exist.");

double Mm(double value) => UnitUtils.ConvertToInternalUnits(value, UnitTypeId.Millimeters);
XYZ Point(double x, double y, double z) => new XYZ(Mm(x), Mm(y), Mm(z));
var symbols = new FilteredElementCollector(document).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>().ToList();
var lightType = symbols.First(symbol => symbol.FamilyName == "无装饰暗装照明设备" && symbol.Name == "300x1200");
var stairType = symbols.First(symbol => symbol.FamilyName == "THS_灯具_楼梯间应急吸顶灯" && symbol.Name == "1x18W");
var switchType = symbols.First(symbol => symbol.FamilyName == "照明开关" && symbol.Name == "单极");
var panelSource = symbols.First(symbol => symbol.FamilyName == "照明配电箱" && symbol.Name == "LB101");
var walls = new FilteredElementCollector(document).OfClass(typeof(Wall)).Cast<Wall>().ToList();
var north = walls.First(wall => Math.Abs(((wall.Location as LocationCurve).Curve as Line).GetEndPoint(0).Y - Mm(14250)) < Mm(1)
    && Math.Abs(((wall.Location as LocationCurve).Curve as Line).GetEndPoint(1).Y - Mm(14250)) < Mm(1));
var east = walls.First(wall => Math.Abs(((wall.Location as LocationCurve).Curve as Line).GetEndPoint(0).X - Mm(30050)) < Mm(1)
    && Math.Abs(((wall.Location as LocationCurve).Curve as Line).GetEndPoint(1).X - Mm(30050)) < Mm(1));
var middle = walls.First(wall => Math.Abs(((wall.Location as LocationCurve).Curve as Line).GetEndPoint(0).Y - Mm(8050)) < Mm(1)
    && Math.Abs(((wall.Location as LocationCurve).Curve as Line).GetEndPoint(1).Y - Mm(8050)) < Mm(1));
FamilyInstance OnWall(Wall wall, FamilySymbol symbol, XYZ point)
{
    var reference = HostObjectUtils.GetSideFaces(wall, ShellLayerType.Interior).First();
    var face = wall.GetGeometryObjectFromReference(reference) as PlanarFace;
    return document.Create.NewFamilyInstance(reference, face.Project(point).XYZPoint, XYZ.BasisZ, symbol);
}
var counts = new Dictionary<string, int>();
using (var transaction = new Transaction(document, "照明模型 - 灯具、开关与配电箱"))
{
    transaction.Start();
    lightType.Activate();
    stairType.Activate();
    switchType.Activate();
    var panelType = (FamilySymbol)panelSource.Duplicate("LB101-380V");
    panelType.LookupParameter("极数").Set(3);
    panelType.LookupParameter("配电盘电压").Set(UnitUtils.ConvertToInternalUnits(380, UnitTypeId.Volts));
    panelType.Activate();

    void AddLight(string group, double x, double y, FamilySymbol symbol)
    {
        var instance = document.Create.NewFamilyInstance(Point(x, y, 3000), symbol,
            Autodesk.Revit.DB.Structure.StructuralType.NonStructural);
        instance.get_Parameter(BuiltInParameter.ALL_MODEL_MARK)?.Set(group + "-" + (counts.GetValueOrDefault(group) + 1).ToString("00"));
        counts[group] = counts.GetValueOrDefault(group) + 1;
    }
    foreach (double x in new[] { 7700.0, 10500.0 })
        foreach (double y in new[] { 9500.0, 12500.0 }) AddLight("OFF1", x, y, lightType);
    foreach (double x in new[] { 14100.0, 18000.0 })
        foreach (double y in new[] { 9500.0, 12500.0 }) AddLight("OFF2", x, y, lightType);
    foreach (double x in new[] { 21800.0, 25000.0, 28100.0 })
        foreach (double y in new[] { 9500.0, 12500.0 }) AddLight("OFF3", x, y, lightType);
    foreach (double y in new[] { 9500.0, 12500.0 }) AddLight("HALL", 1500, y, lightType);
    AddLight("STAIR", 4550, 13300, stairType);
    foreach (double x in new[] { 3000.0, 6000.0, 9000.0, 12000.0, 15000.0, 18000.0, 21000.0, 24000.0, 27000.0 })
        foreach (double y in new[] { 1600.0, 4100.0, 6700.0 }) AddLight("MEET", x, y, lightType);

    foreach (var item in new[]
    {
        ("SW-OFF1", north, 8950.0, 14250.0),
        ("SW-OFF2", north, 13850.0, 14250.0),
        ("SW-OFF3", north, 28150.0, 14250.0),
        ("SW-HALL", north, 2800.0, 14250.0),
        ("SW-STAIR", north, 3750.0, 14250.0),
        ("SW-MEET", middle, 3350.0, 8050.0)
    })
        OnWall(item.Item2, switchType, Point(item.Item3, item.Item4, 1400))
            .get_Parameter(BuiltInParameter.ALL_MODEL_MARK)?.Set(item.Item1);

    var panel = OnWall(east, panelType, Point(30050, 8700, 1400));
    panel.LookupParameter("配电盘名称")?.Set("AL1");
    panel.get_Parameter(BuiltInParameter.ALL_MODEL_MARK)?.Set("AL1-暗装");
    document.Regenerate();
    var lights = new FilteredElementCollector(document).OfCategory(BuiltInCategory.OST_LightingFixtures)
        .WhereElementIsNotElementType().Cast<FamilyInstance>().ToList();
    if (lights.Count != 44 || lights.Any(instance => !instance.MEPModel.ConnectorManager.Connectors.Cast<Connector>()
        .Any(connector => connector.Domain == Domain.DomainElectrical)))
        throw new InvalidOperationException("Lighting fixture count or electrical connectors are invalid.");
    if (transaction.Commit() != TransactionStatus.Committed)
        throw new InvalidOperationException("Lighting transaction did not commit.");
}
document.Save();
return string.Join(", ", counts.Select(item => item.Key + "=" + item.Value));
