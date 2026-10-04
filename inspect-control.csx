var lines = new List<string>();
lines.Add("parameters=" + string.Join(",", Enum.GetNames(typeof(BuiltInParameter))
    .Where(name => name.Contains("SWITCH") || name.Contains("CIRCUIT_NUMBER") || name.Contains("PANEL_NAME"))));
var circuits = new FilteredElementCollector(document).OfClass(typeof(Autodesk.Revit.DB.Electrical.ElectricalSystem))
    .Cast<Autodesk.Revit.DB.Electrical.ElectricalSystem>().ToList();
foreach (var circuit in circuits)
{
    lines.Add("circuit " + circuit.Id.Value + " panel=" + circuit.PanelName + " number=" + circuit.CircuitNumber
        + " elements=" + string.Join(",", circuit.Elements.Cast<FamilyInstance>()
            .Select(instance => instance.get_Parameter(BuiltInParameter.ALL_MODEL_MARK)?.AsString())));
    lines.Add("params=" + string.Join(",", circuit.Parameters.Cast<Parameter>()
        .Where(parameter => parameter.Definition.Name.Contains("回路") || parameter.Definition.Name.Contains("编号")
            || parameter.Definition.Name.Contains("负载名称"))
        .Select(parameter => parameter.Definition.Name + "=" + parameter.AsValueString())));
}
var panel = new FilteredElementCollector(document).OfCategory(BuiltInCategory.OST_ElectricalEquipment)
    .WhereElementIsNotElementType().Cast<FamilyInstance>()
    .First(instance => instance.get_Parameter(BuiltInParameter.ALL_MODEL_MARK)?.AsString() == "AL1-暗装");
lines.Add("panel system=" + panel.get_Parameter(BuiltInParameter.RBS_FAMILY_CONTENT_DISTRIBUTION_SYSTEM).AsValueString());
foreach (var mark in new[] { "OFF1-01", "HALL-01", "STAIR-01", "MEET-01", "SW-OFF1", "SW-HALL", "SW-MEET" })
{
    var instance = new FilteredElementCollector(document).OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>()
        .First(item => item.get_Parameter(BuiltInParameter.ALL_MODEL_MARK)?.AsString() == mark);
    var parameter = instance.get_Parameter(BuiltInParameter.RBS_ELEC_SWITCH_ID_PARAM);
    lines.Add(mark + " switchId=" + parameter?.AsString() + " readonly=" + parameter?.IsReadOnly);
    lines.Add(mark + " connectors=" + string.Join(",", instance.MEPModel.ConnectorManager.Connectors.Cast<Connector>()
        .Where(connector => connector.Domain == Domain.DomainElectrical)
        .Select(connector => connector.ElectricalSystemType.ToString())));
}
return string.Join("\n", lines);
