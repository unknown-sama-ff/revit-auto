using (var transaction = new Transaction(document, "Load C-3 window family"))
{
    transaction.Start();
    Family family;
    bool loaded = document.LoadFamily(@"D:\Desktop\Revit\概论与建模的族\门窗\C-3.rfa", out family);
    var result = "loaded=" + loaded + " family=" + family?.Name + " status=" + transaction.Commit();
    return result;
}
