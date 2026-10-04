var a1 = new FilteredElementCollector(document).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>()
    .Single(symbol => symbol.FamilyName == "THS-A1" && symbol.Name == "THS-A1");
var result = "";
using (var transaction = new Transaction(document, "Test A1 sheet"))
{
    transaction.Start();
    var sheet = ViewSheet.Create(document, a1.Id);
    var title = new FilteredElementCollector(document).OfCategory(BuiltInCategory.OST_TitleBlocks)
        .WhereElementIsNotElementType().Cast<FamilyInstance>()
        .Single(instance => instance.OwnerViewId == sheet.Id);
    var box = title.get_BoundingBox(sheet);
    result = "outline=" + sheet.Outline.Min + "/" + sheet.Outline.Max + " title=" + box.Min + "/" + box.Max;
    transaction.RollBack();
}
return result;
