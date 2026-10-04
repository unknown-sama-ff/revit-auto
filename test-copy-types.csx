var template = document.Application.OpenDocumentFile(@"D:\Desktop\revitt\素材\第9期BIM二级设备第三题样板文件.rte");
try
{
    var symbols = new FilteredElementCollector(template).OfClass(typeof(FamilySymbol))
        .Cast<FamilySymbol>()
        .Where(symbol => (symbol.FamilyName == "照明配电箱" && symbol.Name == "LB101")
            || (symbol.FamilyName == "无装饰暗装照明设备" && symbol.Name == "300x1200")
            || (symbol.FamilyName == "照明开关" && symbol.Name == "单极")
            || (symbol.FamilyName == "子母门" && symbol.Name == "1200 x 2100mm"))
        .Select(symbol => symbol.Id).ToList();
    using (var transaction = new Transaction(document, "Test family transfer"))
    {
        transaction.Start();
        var copied = ElementTransformUtils.CopyElements(template, symbols, document, Transform.Identity, new CopyPasteOptions());
        var names = copied.Select(id => document.GetElement(id)?.Name ?? id.Value.ToString()).ToList();
        transaction.RollBack();
        return string.Join(" | ", names);
    }
}
finally
{
    template.Close(false);
}
