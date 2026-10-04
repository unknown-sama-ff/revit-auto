try
{
    var sheets = new FilteredElementCollector(document).OfClass(typeof(ViewSheet)).Cast<ViewSheet>().ToList();
    var planSheet = sheets.Single(sheet => sheet.SheetNumber == "E101");
    var oldScheduleSheet = sheets.Single(sheet => sheet.SheetNumber == "E102");
    var schedule = new FilteredElementCollector(document)
        .OfClass(typeof(Autodesk.Revit.DB.Electrical.PanelScheduleView))
        .Cast<Autodesk.Revit.DB.Electrical.PanelScheduleView>()
        .Single(view => view.Name == "AL1 配电盘明细表");
    var a1 = new FilteredElementCollector(document).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>()
        .Single(symbol => symbol.FamilyName == "THS-A1" && symbol.Name == "THS-A1");
    using (var transaction = new Transaction(document, "照明模型 - 修正图纸排版"))
    {
        transaction.Start();
        var viewport = (Viewport)document.GetElement(planSheet.GetAllViewports().Single());
        viewport.SetBoxCenter(new XYZ(3.05, 0.63, 0));
        document.Delete(oldScheduleSheet.Id);
        var scheduleSheet = ViewSheet.Create(document, a1.Id);
        scheduleSheet.SheetNumber = "E102";
        scheduleSheet.Name = "AL1 配电盘明细表";
        var placedSchedule = Autodesk.Revit.DB.Electrical.PanelScheduleSheetInstance.Create(document,
            schedule.Id, scheduleSheet);
        placedSchedule.Origin = new XYZ(1.35, 1.75, 0);
        document.Regenerate();
        if (transaction.Commit() != TransactionStatus.Committed)
            throw new InvalidOperationException("Sheet layout transaction did not commit.");
    }
    document.Save();
    return "E101 viewport centered; E102 A1 panel schedule placed";
}
catch (Exception exception)
{
    return exception.ToString();
}
