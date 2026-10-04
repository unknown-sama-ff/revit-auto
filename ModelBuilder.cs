using System.Text.Json;
using Autodesk.Revit.DB;

namespace RevitAuto;

internal static class ModelBuilder
{
    private const string Root = @"D:\Desktop\revitt\revit-auto";

    public static void Preflight(Document document)
    {
        string familyFolder = Path.Combine(Root, "families");
        Directory.CreateDirectory(familyFolder);
        Document template = document.Application.OpenDocumentFile(@"D:\Desktop\revitt\素材\第9期BIM二级设备第三题样板文件.rte");
        var results = new List<string>();
        try
        {
            string[] families = ["照明配电箱", "无装饰暗装照明设备", "照明开关", "子母门"];
            foreach (string name in families)
            {
                Family? family = new FilteredElementCollector(template).OfClass(typeof(Family))
                    .Cast<Family>().FirstOrDefault(item => item.Name == name);
                if (family == null)
                {
                    results.Add(name + ": missing");
                    continue;
                }

                try
                {
                    Document familyDocument = template.EditFamily(family);
                    try
                    {
                        string path = Path.Combine(familyFolder, name + ".rfa");
                        familyDocument.SaveAs(path, new SaveAsOptions { OverwriteExistingFile = true });
                        results.Add(name + ": " + path + " | category=" + familyDocument.OwnerFamily.FamilyCategory.Name);
                    }
                    finally
                    {
                        familyDocument.Close(false);
                    }
                }
                catch (Exception exception)
                {
                    results.Add(name + ": " + exception.Message);
                }
            }
        }
        finally
        {
            template.Close(false);
        }

        string windowPath = @"D:\Desktop\Revit\窗参数族.rfa";
        try
        {
            Document windowDocument = document.Application.OpenDocumentFile(windowPath);
            try
            {
                results.Add("窗参数族: category=" + windowDocument.OwnerFamily.FamilyCategory.Name);
            }
            finally
            {
                windowDocument.Close(false);
            }
        }
        catch (Exception exception)
        {
            results.Add("窗参数族: " + exception.Message);
        }

        File.WriteAllText(Path.Combine(Root, "preflight.json"), JsonSerializer.Serialize(results, new JsonSerializerOptions { WriteIndented = true }));
    }

    public static void Build(Document document)
    {
        throw new NotImplementedException("Model audit must finish before construction.");
    }
}
