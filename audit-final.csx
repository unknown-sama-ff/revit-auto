var lines = new List<string>();
var categories = new[]
{
    BuiltInCategory.OST_Grids, BuiltInCategory.OST_Walls, BuiltInCategory.OST_StructuralColumns,
    BuiltInCategory.OST_Floors, BuiltInCategory.OST_Stairs, BuiltInCategory.OST_Doors,
    BuiltInCategory.OST_Windows, BuiltInCategory.OST_Rooms, BuiltInCategory.OST_LightingFixtures,
    BuiltInCategory.OST_LightingDevices, BuiltInCategory.OST_ElectricalEquipment,
    BuiltInCategory.OST_ElectricalCircuit, BuiltInCategory.OST_Wire, BuiltInCategory.OST_Sheets
};
lines.Add("file=" + document.PathName);
lines.Add("counts=" + string.Join(",", categories.Select(category => category + "="
    + new FilteredElementCollector(document).OfCategory(category).WhereElementIsNotElementType().GetElementCount())));
foreach (var circuit in new FilteredElementCollector(document)
    .OfClass(typeof(Autodesk.Revit.DB.Electrical.ElectricalSystem))
    .Cast<Autodesk.Revit.DB.Electrical.ElectricalSystem>())
{
    lines.Add("circuit=" + circuit.CircuitNumber + " panel=" + circuit.PanelName + " members="
        + string.Join(",", circuit.Elements.Cast<FamilyInstance>()
            .Select(instance => instance.get_Parameter(BuiltInParameter.ALL_MODEL_MARK)?.AsString())));
    lines.Add("name params=" + string.Join(",", circuit.Parameters.Cast<Parameter>()
        .Where(parameter => parameter.Definition != null && (parameter.Definition.Name.Contains("名称")
            || parameter.Definition.Name.Contains("说明") || parameter.Definition.Name.Contains("负载")))
        .Select(parameter => parameter.Definition.Name + "=" + parameter.AsValueString()
            + "/readonly=" + parameter.IsReadOnly)));
}
var warnings = document.GetWarnings();
lines.Add("warnings=" + warnings.Count);
lines.AddRange(warnings.Take(15).Select(warning => warning.GetDescriptionText()));
return string.Join("\n", lines);
