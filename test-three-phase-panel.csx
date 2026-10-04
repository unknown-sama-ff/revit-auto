double Mm(double value) => UnitUtils.ConvertToInternalUnits(value, UnitTypeId.Millimeters);
XYZ Point(double x, double y, double z) => new XYZ(Mm(x), Mm(y), Mm(z));
var source = new FilteredElementCollector(document).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>()
    .First(symbol => symbol.FamilyName == "照明配电箱" && symbol.Name == "LB101");
var lightType = new FilteredElementCollector(document).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>()
    .First(symbol => symbol.FamilyName == "无装饰暗装照明设备" && symbol.Name == "300x1200");
var distribution = new FilteredElementCollector(document)
    .OfClass(typeof(Autodesk.Revit.DB.Electrical.DistributionSysType))
    .Cast<Autodesk.Revit.DB.Electrical.DistributionSysType>()
    .First(type => type.Name == "220/380 星形");
var east = new FilteredElementCollector(document).OfClass(typeof(Wall)).Cast<Wall>()
    .First(wall => Math.Abs(((wall.Location as LocationCurve).Curve as Line).GetEndPoint(0).X - Mm(30050)) < Mm(1)
        && Math.Abs(((wall.Location as LocationCurve).Curve as Line).GetEndPoint(1).X - Mm(30050)) < Mm(1));
var reference = HostObjectUtils.GetSideFaces(east, ShellLayerType.Interior).First();
var face = east.GetGeometryObjectFromReference(reference) as PlanarFace;
var result = new List<string>();
using (var transaction = new Transaction(document, "Test three phase panel"))
{
    transaction.Start();
    try
    {
        var symbol = (FamilySymbol)source.Duplicate("LB101-380V-Test");
        symbol.LookupParameter("极数").Set(3);
        symbol.LookupParameter("配电盘电压").Set(UnitUtils.ConvertToInternalUnits(380, UnitTypeId.Volts));
        symbol.Activate();
        lightType.Activate();
        var panel = document.Create.NewFamilyInstance(reference, face.Project(Point(30050, 8700, 1400)).XYZPoint,
            XYZ.BasisZ, symbol);
        var light = document.Create.NewFamilyInstance(Point(9000, 12000, 3000), lightType,
            Autodesk.Revit.DB.Structure.StructuralType.NonStructural);
        document.Regenerate();
        result.Add("panel poles=" + symbol.LookupParameter("极数").AsInteger()
            + " voltage=" + symbol.LookupParameter("配电盘电压").AsValueString());
        result.Add("set distribution=" + panel.get_Parameter(BuiltInParameter.RBS_FAMILY_CONTENT_DISTRIBUTION_SYSTEM).Set(distribution.Id));
        document.Regenerate();
        result.Add("distribution=" + panel.get_Parameter(BuiltInParameter.RBS_FAMILY_CONTENT_DISTRIBUTION_SYSTEM).AsValueString());
        var circuit = Autodesk.Revit.DB.Electrical.ElectricalSystem.Create(document,
            new List<ElementId> { light.Id }, Autodesk.Revit.DB.Electrical.ElectricalSystemType.PowerCircuit);
        circuit.SelectPanel(panel);
        result.Add("selected=" + circuit.PanelName);
    }
    catch (Exception exception)
    {
        result.Add("ERROR " + exception.ToString());
    }
    transaction.RollBack();
}
return string.Join(" | ", result);
