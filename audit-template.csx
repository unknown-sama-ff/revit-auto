var template = document.Application.OpenDocumentFile(@"D:\Desktop\revitt\素材\第9期BIM二级设备第三题样板文件.rte");
try
{
    var wanted = new[] { "门", "窗", "照明", "灯具", "电气", "图框", "结构柱" };
    var symbols = new FilteredElementCollector(template).OfClass(typeof(FamilySymbol))
        .Cast<FamilySymbol>()
        .Where(symbol => symbol.Category != null && wanted.Any(word => symbol.Category.Name.Contains(word)))
        .Select(symbol => symbol.Category.Name + " | " + symbol.FamilyName + " | " + symbol.Name + " | " + symbol.Id.Value)
        .ToList();
    var counts = new[] { BuiltInCategory.OST_Walls, BuiltInCategory.OST_Windows, BuiltInCategory.OST_LightingFixtures }
        .Select(category => category + ":" + new FilteredElementCollector(template).OfCategory(category).WhereElementIsNotElementType().GetElementCount());
    return template.Title + "\n" + string.Join("\n", counts) + "\n" + string.Join("\n", symbols);
}
finally
{
    template.Close(false);
}
