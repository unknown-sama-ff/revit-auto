var lines = new List<string>();
foreach (var view in new FilteredElementCollector(document).OfClass(typeof(View)).Cast<View>()
    .Where(view => !view.IsTemplate && (view.ViewType == ViewType.FloorPlan || view.ViewType == ViewType.DrawingSheet)))
{
    lines.Add("view " + view.Id.Value + " " + view.Name + " type=" + view.ViewType + " scale=" + view.Scale);
    if (view.Name == "1F_电气平面图")
        lines.Add("electrical crop=" + view.CropBoxActive + " box=" + view.CropBox?.Min + " to " + view.CropBox?.Max
            + " template=" + view.ViewTemplateId.Value);
    if (view is ViewSheet sheet)
    {
        lines.Add("sheet " + sheet.SheetNumber + " " + sheet.Name + " viewports="
            + string.Join(",", sheet.GetAllViewports().Select(id => document.GetElement(id) is Viewport viewport
                ? viewport.ViewId.Value + "@" + viewport.GetBoxCenter() : "other")));
    }
}
foreach (var titleBlock in new FilteredElementCollector(document).OfCategory(BuiltInCategory.OST_TitleBlocks)
    .WhereElementIsNotElementType().Cast<FamilyInstance>())
    lines.Add("titleblock " + titleBlock.Id.Value + " " + titleBlock.Symbol.FamilyName + "/"
        + titleBlock.Symbol.Name + " sheet=" + titleBlock.OwnerViewId.Value);
return string.Join("\n", lines);
