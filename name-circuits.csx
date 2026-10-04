var circuits = new FilteredElementCollector(document)
    .OfClass(typeof(Autodesk.Revit.DB.Electrical.ElectricalSystem))
    .Cast<Autodesk.Revit.DB.Electrical.ElectricalSystem>()
    .OrderBy(circuit => circuit.CircuitNumber).ToList();
if (circuits.Count != 3) throw new InvalidOperationException("Expected three circuits.");
var names = new[] { "办公室照明", "过道及楼梯间照明", "会议室照明" };
using (var transaction = new Transaction(document, "照明模型 - 配电盘回路名称"))
{
    transaction.Start();
    for (int index = 0; index < circuits.Count; index++)
        circuits[index].LookupParameter("负荷名称").Set(names[index]);
    if (transaction.Commit() != TransactionStatus.Committed)
        throw new InvalidOperationException("Circuit naming transaction did not commit.");
}
document.Save();
return string.Join(",", circuits.Select(circuit => circuit.CircuitNumber + ":"
    + circuit.LookupParameter("负荷名称").AsString()));
