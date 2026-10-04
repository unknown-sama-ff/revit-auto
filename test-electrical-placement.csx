double Mm(double value) => UnitUtils.ConvertToInternalUnits(value, UnitTypeId.Millimeters);
XYZ Point(double x, double y, double z) => new XYZ(Mm(x), Mm(y), Mm(z));
var level = new FilteredElementCollector(document).OfClass(typeof(Level)).Cast<Level>()
    .OrderBy(item => item.Elevation).First();
var names = new[]
{
    ("THS_灯具_普通单管荧光灯", "2×28瓦(T5管)"),
    ("THS_灯具_楼梯间应急吸顶灯", "1x18W"),
    ("无装饰暗装照明设备", "300x1200"),
    ("照明开关", "单极"),
    ("照明配电箱", "LB101")
};
var symbols = new FilteredElementCollector(document).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>().ToList();
var results = new List<string>();
using (var transaction = new Transaction(document, "Test electrical family placement"))
{
    transaction.Start();
    foreach (var item in names)
    {
        using (var test = new SubTransaction(document))
        {
            test.Start();
            try
            {
                var symbol = symbols.First(candidate => candidate.FamilyName == item.Item1 && candidate.Name == item.Item2);
                symbol.Activate();
                var instance = item.Item1 == "THS_灯具_普通单管荧光灯"
                    ? document.Create.NewFamilyInstance(Point(9000, 12000, 3000), symbol, level,
                        Autodesk.Revit.DB.Structure.StructuralType.NonStructural)
                    : document.Create.NewFamilyInstance(Point(9000, 12000, 3000), symbol,
                        Autodesk.Revit.DB.Structure.StructuralType.NonStructural);
                document.Regenerate();
                var connectors = instance.MEPModel?.ConnectorManager?.Connectors.Cast<Connector>()
                    .Select(connector => connector.Domain + "/" + connector.ConnectorType + "/"
                        + (connector.Domain == Domain.DomainElectrical ? connector.ElectricalSystemType.ToString() : "other"))
                    .ToList() ?? new List<string>();
                results.Add(item.Item1 + ": placed, connectors=" + string.Join(",", connectors));
            }
            catch (Exception exception)
            {
                results.Add(item.Item1 + ": " + exception.Message);
            }
            test.RollBack();
        }
    }
    transaction.RollBack();
}
return string.Join("\n", results);
