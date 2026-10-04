double Mm(double value) => UnitUtils.ConvertToInternalUnits(value, UnitTypeId.Millimeters);
var symbol = new FilteredElementCollector(document).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>()
    .First(item => item.FamilyName == "照明配电箱" && item.Name == "LB101");
var level = new FilteredElementCollector(document).OfClass(typeof(Level)).Cast<Level>().OrderBy(item => item.Elevation).First();
var results = new List<string>();
using (var transaction = new Transaction(document, "Inspect panel connectors"))
{
    transaction.Start();
    symbol.Activate();
    var panel = document.Create.NewFamilyInstance(new XYZ(Mm(25000), Mm(9000), Mm(1400)), symbol, level,
        Autodesk.Revit.DB.Structure.StructuralType.NonStructural);
    document.Regenerate();
    foreach (var connector in panel.MEPModel.ConnectorManager.Connectors.Cast<Connector>())
    {
        var properties = connector.GetType().GetProperties()
            .Where(property => property.Name.Contains("Voltage") || property.Name.Contains("Pole")
                || property.Name.Contains("System") || property.Name.Contains("Type"))
            .Select(property => { try { return property.Name + "=" + property.GetValue(connector); }
                catch { return property.Name + "=<error>"; } });
        results.Add("connector=" + string.Join(",", properties));
    }
    transaction.RollBack();
}
return string.Join("\n", results);
