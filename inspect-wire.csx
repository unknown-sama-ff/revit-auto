var lines = new List<string>();
lines.Add("wire types=" + string.Join(",", new FilteredElementCollector(document)
    .OfClass(typeof(Autodesk.Revit.DB.Electrical.WireType))
    .Cast<Autodesk.Revit.DB.Electrical.WireType>()
    .Select(type => type.Id.Value + ":" + type.Name)));
var view = new FilteredElementCollector(document).OfClass(typeof(ViewPlan)).Cast<ViewPlan>()
    .First(item => item.Name == "1F_电气平面图");
lines.Add("view level=" + view.GenLevel.Name + " elevation=" + view.GenLevel.Elevation);
var sheet = new FilteredElementCollector(document).OfClass(typeof(ViewSheet)).Cast<ViewSheet>().Single();
lines.Add("sheet outline=" + sheet.Outline.Min + " to " + sheet.Outline.Max);
return string.Join("\n", lines);
