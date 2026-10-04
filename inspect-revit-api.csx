var types = new[]
{
    typeof(Autodesk.Revit.DB.Electrical.Wire),
    typeof(Autodesk.Revit.DB.Electrical.PanelScheduleView),
    typeof(Autodesk.Revit.DB.Viewport)
};
return "system enum=" + string.Join(",", Enum.GetNames(typeof(Autodesk.Revit.DB.Electrical.ElectricalSystemType)))
    + "\nswitch types=" + string.Join(",", typeof(Autodesk.Revit.DB.Electrical.ElectricalSystem).Assembly.GetTypes()
    .Where(type => type.FullName.Contains("Switch") && type.FullName.StartsWith("Autodesk.Revit"))
    .Select(type => type.FullName)) + "\n"
    + "electrical properties=" + string.Join(" | ", typeof(Autodesk.Revit.DB.Electrical.ElectricalSystem).GetProperties()
        .Where(property => property.Name.Contains("Switch") || property.Name.Contains("Circuit") || property.Name.Contains("Panel"))
        .Select(property => property.Name + ":" + property.PropertyType.Name + "/" + property.CanWrite)) + "\n"
    + string.Join("\n", types.Select(type => type.Name + "=" + string.Join(" | ", type.GetMethods()
    .Where(method => method.IsStatic && (method.Name.Contains("Create") || method.Name.Contains("Place")))
    .Select(method => method.ToString()))
    + " instance=" + string.Join(" | ", type.GetMethods()
        .Where(method => method.Name.Contains("Switch") || method.Name.Contains("Wire") || method.Name.Contains("Load"))
        .Select(method => method.ToString()))));
