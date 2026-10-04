if (!document.PathName.EndsWith(@"考生文件夹\照明模型+方昱.rvt", StringComparison.OrdinalIgnoreCase))
    throw new InvalidOperationException("The active document is not the output model.");
if (new FilteredElementCollector(document).OfCategory(BuiltInCategory.OST_ElectricalCircuit)
    .WhereElementIsNotElementType().GetElementCount() != 0)
    throw new InvalidOperationException("Electrical circuits already exist.");
var instances = new FilteredElementCollector(document).OfClass(typeof(FamilyInstance))
    .Cast<FamilyInstance>().ToList();
string Mark(FamilyInstance instance) => instance.get_Parameter(BuiltInParameter.ALL_MODEL_MARK)?.AsString() ?? "";
var lights = instances.Where(instance => instance.Category?.Id.Value == (long)BuiltInCategory.OST_LightingFixtures)
    .ToDictionary(Mark, instance => instance);
var switches = instances.Where(instance => Mark(instance).StartsWith("SW-"))
    .ToDictionary(Mark, instance => instance);
var panel = instances.Single(instance => Mark(instance) == "AL1-暗装");
var distribution = new FilteredElementCollector(document)
    .OfClass(typeof(Autodesk.Revit.DB.Electrical.DistributionSysType))
    .Cast<Autodesk.Revit.DB.Electrical.DistributionSysType>()
    .Single(type => type.Name == "220/380 星形");
var result = new List<string>();
using (var transaction = new Transaction(document, "照明模型 - 三条照明回路"))
{
    transaction.Start();
    if (!panel.get_Parameter(BuiltInParameter.RBS_FAMILY_CONTENT_DISTRIBUTION_SYSTEM).Set(distribution.Id))
        throw new InvalidOperationException("The panel distribution system could not be assigned.");
    document.Regenerate();
    void Circuit(string name, Func<string, bool> includeLight, string[] switchMarks, int expected)
    {
        var members = lights.Where(item => includeLight(item.Key)).Select(item => item.Value).ToList();
        if (members.Count != expected)
            throw new InvalidOperationException(name + " has " + members.Count + " lights; expected " + expected);
        var circuit = Autodesk.Revit.DB.Electrical.ElectricalSystem.Create(document,
            members.Select(instance => instance.Id).ToList(), Autodesk.Revit.DB.Electrical.ElectricalSystemType.PowerCircuit);
        var controls = new ElementSet();
        foreach (var mark in switchMarks) controls.Insert(switches[mark]);
        if (!circuit.AddToCircuit(controls))
            throw new InvalidOperationException("Could not add switches to " + name);
        circuit.SelectPanel(panel);
        circuit.LookupParameter("负载名称")?.Set(name);
        result.Add(name + ": " + circuit.CircuitNumber + ", lights=" + members.Count
            + ", switches=" + switchMarks.Length + ", panel=" + circuit.PanelName);
    }
    Circuit("办公室照明", mark => mark.StartsWith("OFF"),
        new[] { "SW-OFF1", "SW-OFF2", "SW-OFF3" }, 14);
    Circuit("过道与楼梯间照明", mark => mark.StartsWith("HALL") || mark.StartsWith("STAIR"),
        new[] { "SW-HALL", "SW-STAIR" }, 3);
    Circuit("会议室照明", mark => mark.StartsWith("MEET"),
        new[] { "SW-MEET" }, 27);
    if (transaction.Commit() != TransactionStatus.Committed)
        throw new InvalidOperationException("Circuit transaction did not commit.");
}
document.Save();
return string.Join("\n", result);
