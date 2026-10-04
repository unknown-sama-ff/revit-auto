var distributionTypes = new FilteredElementCollector(document)
    .OfClass(typeof(Autodesk.Revit.DB.Electrical.DistributionSysType))
    .Cast<Autodesk.Revit.DB.Electrical.DistributionSysType>()
    .Select(type => type.Id.Value + ":" + type.Name);
var voltageTypes = new FilteredElementCollector(document)
    .OfClass(typeof(Autodesk.Revit.DB.Electrical.VoltageType))
    .Cast<Autodesk.Revit.DB.Electrical.VoltageType>()
    .Select(type => type.Id.Value + ":" + type.Name);
return "distribution=" + string.Join(",", distributionTypes) + "\nvoltage=" + string.Join(",", voltageTypes);
