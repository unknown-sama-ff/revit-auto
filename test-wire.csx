var instances = new FilteredElementCollector(document).OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>().ToList();
FamilyInstance ByMark(string mark) => instances.First(instance => instance.get_Parameter(BuiltInParameter.ALL_MODEL_MARK)?.AsString() == mark);
Connector Power(FamilyInstance instance) => instance.MEPModel.ConnectorManager.Connectors.Cast<Connector>()
    .First(connector => connector.Domain == Domain.DomainElectrical
        && connector.ElectricalSystemType == Autodesk.Revit.DB.Electrical.ElectricalSystemType.PowerCircuit);
var view = new FilteredElementCollector(document).OfClass(typeof(ViewPlan)).Cast<ViewPlan>()
    .First(item => item.Name == "1F_电气平面图");
var wireType = new FilteredElementCollector(document).OfClass(typeof(Autodesk.Revit.DB.Electrical.WireType))
    .Cast<Autodesk.Revit.DB.Electrical.WireType>().First(item => item.Name == "BV");
var result = "";
using (var transaction = new Transaction(document, "Test connected wire"))
{
    transaction.Start();
    try
    {
        var descriptions = new List<string>();
        foreach (var pair in new[] { ("OFF1-01", "OFF1-02"), ("SW-OFF1", "OFF1-01"),
            ("AL1-暗装", "OFF3-06") })
        {
            var first = Power(ByMark(pair.Item1));
            var second = Power(ByMark(pair.Item2));
            var points = pair.Item1 == "AL1-暗装"
                ? new List<XYZ> { first.Origin, new XYZ(first.Origin.X, second.Origin.Y, second.Origin.Z), second.Origin }
                : new List<XYZ> { first.Origin, second.Origin };
            var wire = Autodesk.Revit.DB.Electrical.Wire.Create(document, wireType.Id, view.Id,
                Autodesk.Revit.DB.Electrical.WiringType.Chamfer,
                points, first, second);
            descriptions.Add(pair.Item1 + "->" + pair.Item2 + ":" + wire.Id.Value);
        }
        result = string.Join(",", descriptions);
    }
    catch (Exception exception)
    {
        result = exception.ToString();
    }
    transaction.RollBack();
}
return result;
