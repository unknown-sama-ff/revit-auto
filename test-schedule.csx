var panel = new FilteredElementCollector(document).OfCategory(BuiltInCategory.OST_ElectricalEquipment)
    .WhereElementIsNotElementType().Cast<FamilyInstance>()
    .Single(instance => instance.get_Parameter(BuiltInParameter.ALL_MODEL_MARK)?.AsString() == "AL1-暗装");
var result = "";
using (var transaction = new Transaction(document, "Test panel schedule"))
{
    transaction.Start();
    try
    {
        var schedule = Autodesk.Revit.DB.Electrical.PanelScheduleView.CreateInstanceView(document, panel.Id);
        result = schedule.Name + " / " + schedule.Id.Value;
    }
    catch (Exception exception)
    {
        result = exception.ToString();
    }
    transaction.RollBack();
}
return result;
