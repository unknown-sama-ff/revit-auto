var types = new[] { typeof(StairsEditScope),
    typeof(Autodesk.Revit.DB.Architecture.StairsLanding), typeof(Autodesk.Revit.DB.Architecture.StairsRun) };
return string.Join("\n", types.Select(type => type.Name + "=" + string.Join(" | ", type.GetMethods()
    .Where(method => method.Name == "Start" || method.Name.Contains("Landing")
        || method.Name.Contains("Run") || method.Name.Contains("End"))
    .Select(method => method.ToString()))));
