var source = new FilteredElementCollector(document)
    .OfClass(typeof(Autodesk.Revit.DB.Electrical.DistributionSysType))
    .Cast<Autodesk.Revit.DB.Electrical.DistributionSysType>()
    .First(type => type.Name == "120/240 单相");
var voltage = new FilteredElementCollector(document)
    .OfClass(typeof(Autodesk.Revit.DB.Electrical.VoltageType))
    .Cast<Autodesk.Revit.DB.Electrical.VoltageType>()
    .First(type => type.Name == "220");
var result = new List<string>();
using (var transaction = new Transaction(document, "Test 220V distribution"))
{
    transaction.Start();
    try
    {
        var distribution = (Autodesk.Revit.DB.Electrical.DistributionSysType)source.Duplicate("220V 单相测试");
        distribution.NumWires = 2;
        distribution.ElectricalPhase = Autodesk.Revit.DB.Electrical.ElectricalPhase.SinglePhase;
        distribution.ElectricalPhaseConfiguration = Autodesk.Revit.DB.Electrical.ElectricalPhaseConfiguration.Undefined;
        distribution.VoltageLineToGround = voltage;
        distribution.VoltageLineToLine = voltage;
        document.Regenerate();
        result.Add("name=" + distribution.Name + " wires=" + distribution.NumWires
            + " phase=" + distribution.ElectricalPhase + " L-N=" + distribution.VoltageLineToGround?.Name
            + " L-L=" + distribution.VoltageLineToLine?.Name);
    }
    catch (Exception exception)
    {
        result.Add(exception.ToString());
    }
    transaction.RollBack();
}
return string.Join("\n", result);
