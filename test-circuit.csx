double Mm(double value) => UnitUtils.ConvertToInternalUnits(value, UnitTypeId.Millimeters);
XYZ Point(double x, double y, double z) => new XYZ(Mm(x), Mm(y), Mm(z));
var symbols = new FilteredElementCollector(document).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>().ToList();
var lightType = symbols.First(symbol => symbol.FamilyName == "无装饰暗装照明设备" && symbol.Name == "300x1200");
var switchType = symbols.First(symbol => symbol.FamilyName == "照明开关" && symbol.Name == "单极");
var panelType = symbols.First(symbol => symbol.FamilyName == "照明配电箱" && symbol.Name == "LB101");
var walls = new FilteredElementCollector(document).OfClass(typeof(Wall)).Cast<Wall>().ToList();
var north = walls.First(wall => Math.Abs(((wall.Location as LocationCurve).Curve as Line).GetEndPoint(0).Y - Mm(14250)) < Mm(1)
    && Math.Abs(((wall.Location as LocationCurve).Curve as Line).GetEndPoint(1).Y - Mm(14250)) < Mm(1));
var east = walls.First(wall => Math.Abs(((wall.Location as LocationCurve).Curve as Line).GetEndPoint(0).X - Mm(30050)) < Mm(1)
    && Math.Abs(((wall.Location as LocationCurve).Curve as Line).GetEndPoint(1).X - Mm(30050)) < Mm(1));
FamilyInstance OnWall(Wall wall, FamilySymbol symbol, XYZ point)
{
    var reference = HostObjectUtils.GetSideFaces(wall, ShellLayerType.Interior).First();
    var face = wall.GetGeometryObjectFromReference(reference) as PlanarFace;
    return document.Create.NewFamilyInstance(reference, face.Project(point).XYZPoint, XYZ.BasisZ, symbol);
}
var results = new List<string>();
using (var transaction = new Transaction(document, "Test lighting circuit"))
{
    transaction.Start();
    lightType.Activate();
    switchType.Activate();
    panelType.Activate();
    var light = document.Create.NewFamilyInstance(Point(9000, 12000, 3000), lightType,
        Autodesk.Revit.DB.Structure.StructuralType.NonStructural);
    var lightSwitch = OnWall(north, switchType, Point(8950, 14250, 1400));
    var panel = OnWall(east, panelType, Point(30050, 8700, 1400));
    document.Regenerate();
    try
    {
        var circuit = Autodesk.Revit.DB.Electrical.ElectricalSystem.Create(document,
            new List<ElementId> { light.Id }, Autodesk.Revit.DB.Electrical.ElectricalSystemType.PowerCircuit);
        results.Add("created=" + circuit.Id.Value);
        try
        {
            var members = new ElementSet();
            members.Insert(lightSwitch);
            results.Add("addSwitch=" + circuit.AddToCircuit(members));
        }
        catch (Exception exception)
        {
            results.Add("switch=" + exception.Message);
        }
        try
        {
            circuit.SelectPanel(panel);
            results.Add("panel=" + panel.Id.Value + " number=" + circuit.CircuitNumber);
        }
        catch (Exception exception)
        {
            results.Add("panel=" + exception.Message);
        }
    }
    catch (Exception exception)
    {
        results.Add("circuit=" + exception.ToString());
    }
    transaction.RollBack();
}
return string.Join(" | ", results);
