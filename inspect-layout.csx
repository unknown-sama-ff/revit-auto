var lines = new List<string>();
foreach (var sheet in new FilteredElementCollector(document).OfClass(typeof(ViewSheet)).Cast<ViewSheet>()
    .Where(item => item.SheetNumber == "E101" || item.SheetNumber == "E102"))
{
    lines.Add(sheet.SheetNumber + " outline=" + sheet.Outline.Min + "/" + sheet.Outline.Max);
    foreach (var title in new FilteredElementCollector(document).OfCategory(BuiltInCategory.OST_TitleBlocks)
        .WhereElementIsNotElementType().Cast<FamilyInstance>()
        .Where(item => item.OwnerViewId == sheet.Id))
    {
        var box = title.get_BoundingBox(sheet);
        lines.Add("title=" + title.Symbol.FamilyName + " bbox=" + box?.Min + "/" + box?.Max);
    }
    foreach (var viewportId in sheet.GetAllViewports())
    {
        var viewport = (Viewport)document.GetElement(viewportId);
        var outline = viewport.GetBoxOutline();
        lines.Add("viewport center=" + viewport.GetBoxCenter() + " outline=" + outline.MinimumPoint + "/"
            + outline.MaximumPoint);
    }
    foreach (var schedule in new FilteredElementCollector(document)
        .OfClass(typeof(Autodesk.Revit.DB.Electrical.PanelScheduleSheetInstance))
        .Cast<Autodesk.Revit.DB.Electrical.PanelScheduleSheetInstance>()
        .Where(item => item.OwnerViewId == sheet.Id))
    {
        var box = schedule.get_BoundingBox(sheet);
        lines.Add("schedule origin=" + schedule.Origin + " bbox=" + box?.Min + "/" + box?.Max);
    }
}
return string.Join("\n", lines);
