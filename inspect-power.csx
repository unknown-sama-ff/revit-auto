var assemblies = new[] { typeof(Autodesk.Revit.DB.Electrical.DistributionSysType), typeof(Autodesk.Revit.DB.Electrical.VoltageType) };
var lines = new List<string>();
foreach (var type in assemblies)
{
    lines.Add(type.Name + " static methods=" + string.Join(" | ", type.GetMethods(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static)
        .Where(method => method.Name.Contains("Create"))
        .Select(method => method.ToString())));
    lines.Add(type.Name + " properties=" + string.Join(", ", type.GetProperties(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance)
        .Select(property => property.Name + ":" + property.PropertyType.Name)));
}
foreach (var distribution in new FilteredElementCollector(document)
    .OfClass(typeof(Autodesk.Revit.DB.Electrical.DistributionSysType))
    .Cast<Autodesk.Revit.DB.Electrical.DistributionSysType>())
{
    lines.Add("distribution " + distribution.Name + ": " + string.Join(", ", distribution.Parameters.Cast<Parameter>()
        .Where(parameter => parameter.Definition != null)
        .Select(parameter => parameter.Definition.Name + "=" + parameter.AsValueString()
            + (parameter.StorageType == StorageType.ElementId ? "/" + parameter.AsElementId().Value : ""))));
}
foreach (var symbol in new FilteredElementCollector(document).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>()
    .Where(symbol => symbol.Category?.Id.Value == (long)BuiltInCategory.OST_ElectricalEquipment)
    .Where(symbol => symbol.FamilyName == "照明配电箱" || symbol.FamilyName == "配电箱" || symbol.FamilyName == "低压动力配电及控制箱"))
{
    lines.Add("panel " + symbol.FamilyName + "/" + symbol.Name + ": " + string.Join(", ", symbol.Parameters.Cast<Parameter>()
        .Where(parameter => parameter.Definition != null && (parameter.Definition.Name.Contains("电压") || parameter.Definition.Name.Contains("极数")))
        .Select(parameter => parameter.Definition.Name + "=" + parameter.AsValueString())));
}
return string.Join("\n", lines);
