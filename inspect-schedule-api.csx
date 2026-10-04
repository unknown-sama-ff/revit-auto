var types = typeof(Autodesk.Revit.DB.Electrical.PanelScheduleView).Assembly.GetTypes()
    .Where(type => type.Name.Contains("PanelScheduleSheet") || type.Name.Contains("ScheduleSheetInstance"))
    .ToList();
return string.Join("\n", types.Select(type => type.FullName + " props=" + string.Join(",", type.GetProperties()
    .Where(property => property.Name.Contains("Location") || property.Name.Contains("Origin") || property.Name.Contains("Schedule"))
    .Select(property => property.Name + ":" + property.CanWrite)) + " methods=" + string.Join(" | ", type.GetMethods()
    .Where(method => method.IsStatic && method.Name.Contains("Create"))
    .Select(method => method.ToString()))));
