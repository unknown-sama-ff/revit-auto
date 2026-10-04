double Mm(double value) => UnitUtils.ConvertToInternalUnits(value, UnitTypeId.Millimeters);
XYZ Point(double x, double y, double z) => new XYZ(Mm(x), Mm(y), Mm(z));
var symbols = new FilteredElementCollector(document).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>().ToList();
var lightType = symbols.First(symbol => symbol.FamilyName == "无装饰暗装照明设备" && symbol.Name == "300x1200");
var panelType = symbols.First(symbol => symbol.FamilyName == "照明配电箱" && symbol.Name == "LB101");
var east = new FilteredElementCollector(document).OfClass(typeof(Wall)).Cast<Wall>()
    .First(wall => Math.Abs(((wall.Location as LocationCurve).Curve as Line).GetEndPoint(0).X - Mm(30050)) < Mm(1)
        && Math.Abs(((wall.Location as LocationCurve).Curve as Line).GetEndPoint(1).X - Mm(30050)) < Mm(1));
var reference = HostObjectUtils.GetSideFaces(east, ShellLayerType.Interior).First();
var face = east.GetGeometryObjectFromReference(reference) as PlanarFace;
string Parameters(Element element) => string.Join(", ", element.Parameters.Cast<Parameter>()
    .Where(parameter => parameter.Definition != null && (parameter.Definition.Name.Contains("电压")
        || parameter.Definition.Name.Contains("配电") || parameter.Definition.Name.Contains("极")
        || parameter.Definition.Name.Contains("相") || parameter.Definition.Name.Contains("Voltage")
        || parameter.Definition.Name.Contains("Distribution")))
    .Select(parameter => parameter.Definition.Name + "=" + parameter.AsValueString()
        + "/" + (parameter.StorageType == StorageType.ElementId ? parameter.AsElementId().Value.ToString() : "-")
        + "/readonly=" + parameter.IsReadOnly));
var results = new List<string>();
using (var transaction = new Transaction(document, "Inspect electrical family parameters"))
{
    transaction.Start();
    lightType.Activate();
    panelType.Activate();
    var light = document.Create.NewFamilyInstance(Point(9000, 12000, 3000), lightType,
        Autodesk.Revit.DB.Structure.StructuralType.NonStructural);
    var panel = document.Create.NewFamilyInstance(reference, face.Project(Point(30050, 8700, 1400)).XYZPoint,
        XYZ.BasisZ, panelType);
    document.Regenerate();
    results.Add("light type: " + Parameters(lightType));
    results.Add("light instance: " + Parameters(light));
    results.Add("panel type: " + Parameters(panelType));
    results.Add("panel instance: " + Parameters(panel));
    foreach (var instance in new[] { light, panel })
    {
        foreach (var connector in instance.MEPModel.ConnectorManager.Connectors.Cast<Connector>()
            .Where(connector => connector.Domain == Domain.DomainElectrical))
        {
            var info = connector.GetMEPConnectorInfo();
            var values = info.GetType().GetProperties()
                .Where(property => property.Name.Contains("Voltage") || property.Name.Contains("Pole")
                    || property.Name.Contains("Power") || property.Name.Contains("Distribution"))
                .Select(property => property.Name + "=" + property.GetValue(info));
            results.Add(instance.Symbol.FamilyName + " connector: " + info.GetType().Name + " " + string.Join(",", values));
        }
    }
    var circuit = Autodesk.Revit.DB.Electrical.ElectricalSystem.Create(document,
        new List<ElementId> { light.Id }, Autodesk.Revit.DB.Electrical.ElectricalSystemType.PowerCircuit);
    results.Add("circuit: " + Parameters(circuit));
    transaction.RollBack();
}
return string.Join("\n", results);
