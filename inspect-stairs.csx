var stairTypes = new FilteredElementCollector(document).OfClass(typeof(Autodesk.Revit.DB.Architecture.StairsType))
    .Cast<Autodesk.Revit.DB.Architecture.StairsType>()
    .Select(type => type.Id.Value + ":" + type.Name);
var runTypes = new FilteredElementCollector(document).OfClass(typeof(Autodesk.Revit.DB.Architecture.StairsRunType))
    .Cast<Autodesk.Revit.DB.Architecture.StairsRunType>()
    .Select(type => type.Id.Value + ":" + type.Name);
return "stairs=" + string.Join(";", stairTypes) + "\nruns=" + string.Join(";", runTypes);
