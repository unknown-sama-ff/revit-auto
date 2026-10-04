var systemType = typeof(Autodesk.Revit.DB.Electrical.ElectricalSystem);
var distributionType = typeof(Autodesk.Revit.DB.Electrical.DistributionSysType);
return "system methods=" + string.Join(" | ", systemType.GetMethods()
    .Where(method => method.Name.Contains("Panel") || method.Name.Contains("Compatible"))
    .Select(method => method.ToString()))
    + "\ndistribution setters=" + string.Join(" | ", distributionType.GetProperties()
        .Where(property => property.Name.Contains("Voltage") || property.Name.Contains("Phase") || property.Name.Contains("Wires"))
        .Select(property => property.Name + ":" + property.CanWrite))
    + "\ndistribution instance methods=" + string.Join(" | ", distributionType.GetMethods()
        .Where(method => method.Name == "Duplicate")
        .Select(method => method.ToString()));
