var families = new[]
{
    @"D:\Desktop\Revit\概论与建模的族\门窗\C-3.rfa",
    @"D:\Desktop\revitt\revit-auto\families\子母门.rfa",
    @"D:\Desktop\revitt\revit-auto\families\无装饰暗装照明设备.rfa",
    @"D:\Desktop\revitt\revit-auto\families\照明开关.rfa",
    @"D:\Desktop\revitt\revit-auto\families\照明配电箱.rfa"
};
var results = new List<string>();
using (var transaction = new Transaction(document, "Load lighting model families"))
{
    transaction.Start();
    foreach (var path in families)
    {
        try
        {
            if (!System.IO.File.Exists(path))
                throw new System.IO.FileNotFoundException(path);
            Family loadedFamily;
            var loaded = document.LoadFamily(path, out loadedFamily);
            if (loadedFamily == null)
                loadedFamily = new FilteredElementCollector(document).OfClass(typeof(Family)).Cast<Family>()
                    .FirstOrDefault(family => family.Name == System.IO.Path.GetFileNameWithoutExtension(path));
            if (loadedFamily == null)
                throw new InvalidOperationException("Cannot load " + path);
            var symbols = loadedFamily.GetFamilySymbolIds().Select(id => document.GetElement(id) as FamilySymbol)
                .Where(symbol => symbol != null)
                .Select(symbol => symbol.Name + " [" + symbol.Id.Value + "] width="
                    + symbol.get_Parameter(BuiltInParameter.FAMILY_WIDTH_PARAM)?.AsValueString()
                    + " height=" + symbol.get_Parameter(BuiltInParameter.FAMILY_HEIGHT_PARAM)?.AsValueString());
            results.Add(loadedFamily.Name + " loaded=" + loaded + " placement="
                + loadedFamily.FamilyPlacementType + " types=" + string.Join(", ", symbols));
        }
        catch (Exception exception)
        {
            results.Add(path + " ERROR " + exception.ToString());
        }
    }
    results.Add("status=" + transaction.Commit());
}
return string.Join("\n", results);
