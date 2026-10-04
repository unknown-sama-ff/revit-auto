var instances = new FilteredElementCollector(document).OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>()
    .Where(instance =>
    {
        var mark = instance.get_Parameter(BuiltInParameter.ALL_MODEL_MARK)?.AsString();
        return mark?.StartsWith("SW-") == true || mark == "AL1-暗装";
    }).ToList();
if (instances.Count != 7) throw new InvalidOperationException("Expected six switches and one panel.");
using (var transaction = new Transaction(document, "照明模型 - 暗装标注"))
{
    transaction.Start();
    foreach (var instance in instances)
    {
        var comments = instance.get_Parameter(BuiltInParameter.ALL_MODEL_INSTANCE_COMMENTS);
        if (comments == null || comments.IsReadOnly || !comments.Set("暗装；安装高度 1.4 m"))
            throw new InvalidOperationException("Could not set mounting note for " + instance.Id.Value);
    }
    if (transaction.Commit() != TransactionStatus.Committed)
        throw new InvalidOperationException("Mounting note transaction did not commit.");
}
document.Save();
return "flush mounted notes=" + instances.Count;
