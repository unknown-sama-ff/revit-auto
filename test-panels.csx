double Mm(double value) => UnitUtils.ConvertToInternalUnits(value, UnitTypeId.Millimeters);
XYZ Point(double x, double y, double z) => new XYZ(Mm(x), Mm(y), Mm(z));
var level = new FilteredElementCollector(document).OfClass(typeof(Level)).Cast<Level>()
    .OrderBy(item => item.Elevation).First();
var symbols = new FilteredElementCollector(document).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>().ToList();
var lightType = symbols.First(symbol => symbol.FamilyName == "无装饰暗装照明设备" && symbol.Name == "300x1200");
var panels = symbols.Where(symbol => (symbol.FamilyName == "照明配电箱" && symbol.Name == "LB101")
    || (symbol.FamilyName == "照明配电箱" && symbol.Name == "LB102")
    || (symbol.FamilyName == "配电箱")
    || (symbol.FamilyName == "低压动力配电及控制箱")
    || (symbol.FamilyName == "动力配电箱" && symbol.Name == "WY-LDAP")).ToList();
var east = new FilteredElementCollector(document).OfClass(typeof(Wall)).Cast<Wall>()
    .First(wall => Math.Abs(((wall.Location as LocationCurve).Curve as Line).GetEndPoint(0).X - Mm(30050)) < Mm(1)
        && Math.Abs(((wall.Location as LocationCurve).Curve as Line).GetEndPoint(1).X - Mm(30050)) < Mm(1));
var reference = HostObjectUtils.GetSideFaces(east, ShellLayerType.Interior).First();
var face = east.GetGeometryObjectFromReference(reference) as PlanarFace;
var results = new List<string>();
using (var transaction = new Transaction(document, "Test electrical panels"))
{
    transaction.Start();
    foreach (var symbol in panels)
    {
        using (var test = new SubTransaction(document))
        {
            test.Start();
            try
            {
                lightType.Activate();
                symbol.Activate();
                var light = document.Create.NewFamilyInstance(Point(9000, 12000, 3000), lightType,
                    Autodesk.Revit.DB.Structure.StructuralType.NonStructural);
                var panel = symbol.Family.FamilyPlacementType == Autodesk.Revit.DB.FamilyPlacementType.WorkPlaneBased
                    ? document.Create.NewFamilyInstance(reference, face.Project(Point(30050, 8700, 1400)).XYZPoint,
                        XYZ.BasisZ, symbol)
                    : document.Create.NewFamilyInstance(Point(30000, 8700, 1400), symbol, level,
                        Autodesk.Revit.DB.Structure.StructuralType.NonStructural);
                document.Regenerate();
                var circuit = Autodesk.Revit.DB.Electrical.ElectricalSystem.Create(document,
                    new List<ElementId> { light.Id }, Autodesk.Revit.DB.Electrical.ElectricalSystemType.PowerCircuit);
                var description = symbol.FamilyName + "/" + symbol.Name + " circuit="
                    + circuit.Voltage + "V/" + circuit.PolesNumber + " poles";
                try
                {
                    circuit.SelectPanel(panel);
                    results.Add(description + " OK");
                }
                catch (Exception exception)
                {
                    results.Add(description + " ERROR " + exception.Message);
                }
            }
            catch (Exception exception)
            {
                results.Add(symbol.FamilyName + "/" + symbol.Name + " CREATE ERROR " + exception.Message);
            }
            test.RollBack();
        }
    }
    transaction.RollBack();
}
return string.Join("\n", results);
