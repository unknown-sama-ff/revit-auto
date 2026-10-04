try
{
if (!document.PathName.EndsWith(@"考生文件夹\照明模型+方昱.rvt", StringComparison.OrdinalIgnoreCase))
    throw new InvalidOperationException("The active document is not the output model.");
var existingWires = new FilteredElementCollector(document).OfCategory(BuiltInCategory.OST_Wire)
    .WhereElementIsNotElementType().ToElementIds().ToList();
if (existingWires.Count != 49)
    throw new InvalidOperationException("Expected 49 current wires; found " + existingWires.Count);
double Mm(double value) => UnitUtils.ConvertToInternalUnits(value, UnitTypeId.Millimeters);
var instances = new FilteredElementCollector(document).OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>()
    .Where(instance => new[] { "OFF", "HALL", "STAIR", "MEET", "SW-", "AL1-" }
        .Any(prefix => instance.get_Parameter(BuiltInParameter.ALL_MODEL_MARK)?.AsString()?.StartsWith(prefix) == true))
    .ToDictionary(instance => instance.get_Parameter(BuiltInParameter.ALL_MODEL_MARK).AsString(), instance => instance);
Connector Power(string mark) => instances[mark].MEPModel.ConnectorManager.Connectors.Cast<Connector>()
    .First(connector => connector.Domain == Domain.DomainElectrical
        && connector.ElectricalSystemType == Autodesk.Revit.DB.Electrical.ElectricalSystemType.PowerCircuit);
var view = new FilteredElementCollector(document).OfClass(typeof(ViewPlan)).Cast<ViewPlan>()
    .Single(item => item.Name == "1F_电气平面图" || item.Name.StartsWith("一层照明平面图"));
var wireType = new FilteredElementCollector(document).OfClass(typeof(Autodesk.Revit.DB.Electrical.WireType))
    .Cast<Autodesk.Revit.DB.Electrical.WireType>().Single(item => item.Name == "BV");
var wireCount = 0;
using (var transaction = new Transaction(document, "照明模型 - 照明导线与开关控制"))
{
    transaction.Start();
    document.Delete(existingWires);
    void Connect(string firstMark, string secondMark, params (double x, double y)[] bends)
    {
        var first = Power(firstMark);
        var second = Power(secondMark);
        var vertices = new List<XYZ> { first.Origin };
        vertices.AddRange(bends.Select(bend => new XYZ(Mm(bend.x), Mm(bend.y), second.Origin.Z)));
        vertices.Add(second.Origin);
        Autodesk.Revit.DB.Electrical.Wire.Create(document, wireType.Id, view.Id,
            Autodesk.Revit.DB.Electrical.WiringType.Chamfer, vertices, first, second);
        wireCount++;
    }
    var officeTop = new[] { "OFF1-02", "OFF1-04", "OFF2-02", "OFF2-04", "OFF3-02", "OFF3-04", "OFF3-06" };
    var officeBottom = new[] { "OFF1-01", "OFF1-03", "OFF2-01", "OFF2-03", "OFF3-01", "OFF3-03", "OFF3-05" };
    for (int index = 0; index < officeTop.Length; index++) Connect(officeTop[index], officeBottom[index]);
    for (int index = 1; index < officeTop.Length; index++) Connect(officeTop[index - 1], officeTop[index]);
    Connect("SW-OFF1", "OFF1-02");
    Connect("SW-OFF2", "OFF2-02");
    Connect("SW-OFF3", "OFF3-06");
    Connect("HALL-01", "HALL-02");
    Connect("SW-HALL", "HALL-02");
    Connect("SW-STAIR", "STAIR-01");
    var meetingTop = new[] { "MEET-03", "MEET-06", "MEET-09", "MEET-12", "MEET-15",
        "MEET-18", "MEET-21", "MEET-24", "MEET-27" };
    var meetingMiddle = new[] { "MEET-02", "MEET-05", "MEET-08", "MEET-11", "MEET-14",
        "MEET-17", "MEET-20", "MEET-23", "MEET-26" };
    var meetingBottom = new[] { "MEET-01", "MEET-04", "MEET-07", "MEET-10", "MEET-13",
        "MEET-16", "MEET-19", "MEET-22", "MEET-25" };
    for (int index = 0; index < meetingTop.Length; index++)
    {
        Connect(meetingTop[index], meetingMiddle[index]);
        Connect(meetingMiddle[index], meetingBottom[index]);
    }
    for (int index = 1; index < meetingTop.Length; index++) Connect(meetingTop[index - 1], meetingTop[index]);
    Connect("SW-MEET", "MEET-03");
    Connect("AL1-暗装", "OFF3-06", (29800, 12500));
    Connect("AL1-暗装", "MEET-27", (29800, 8700), (29800, 6700));
    Connect("AL1-暗装", "SW-MEET", (29800, 7400), (12050, 7400), (3350, 7700));
    foreach (var item in new[]
    {
        ("SW-OFF1", "K1"), ("SW-OFF2", "K2"), ("SW-OFF3", "K3"),
        ("SW-HALL", "K4"), ("SW-STAIR", "K5"), ("SW-MEET", "K6")
    })
        instances[item.Item1].get_Parameter(BuiltInParameter.RBS_ELEC_SWITCH_ID_PARAM).Set(item.Item2);
    if (transaction.Commit() != TransactionStatus.Committed)
        throw new InvalidOperationException("Wire transaction did not commit.");
}
document.Save();
return "wires=" + wireCount;
}
catch (Exception exception)
{
    return exception.ToString();
}
