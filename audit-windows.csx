var folder = @"D:\Desktop\Revit\概论与建模的族\门窗";
var results = new List<string>();
foreach (var name in new[] { "C-1.rfa", "C-2.rfa", "C-3.rfa", "C-4.rfa" })
{
    var path = System.IO.Path.Combine(folder, name);
    var familyDocument = document.Application.OpenDocumentFile(path);
    try
    {
        var family = familyDocument.OwnerFamily;
        var types = familyDocument.FamilyManager.Types.Cast<FamilyType>().Select(type => type.Name);
        results.Add(name + " | " + family.FamilyCategory.Name + " | " + string.Join(",", types));
    }
    finally
    {
        familyDocument.Close(false);
    }
}
return string.Join("\n", results);
