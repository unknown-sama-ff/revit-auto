try
{
    if (!document.PathName.EndsWith(@"考生文件夹\照明模型+方昱.rvt", StringComparison.OrdinalIgnoreCase))
        throw new InvalidOperationException("The active document is not the output model.");
    if (new FilteredElementCollector(document).OfClass(typeof(Autodesk.Revit.DB.Electrical.PanelScheduleView))
        .GetElementCount() != 0)
        throw new InvalidOperationException("A panel schedule already exists.");
    double Mm(double value) => UnitUtils.ConvertToInternalUnits(value, UnitTypeId.Millimeters);
    var view = new FilteredElementCollector(document).OfClass(typeof(ViewPlan)).Cast<ViewPlan>()
        .Single(item => item.Name == "1F_电气平面图");
    var planSheet = new FilteredElementCollector(document).OfClass(typeof(ViewSheet)).Cast<ViewSheet>()
        .Single(item => item.SheetNumber == "A101");
    var titleBlock = new FilteredElementCollector(document).OfCategory(BuiltInCategory.OST_TitleBlocks)
        .WhereElementIsNotElementType().Cast<FamilyInstance>()
        .Single(instance => instance.OwnerViewId == planSheet.Id);
    var panel = new FilteredElementCollector(document).OfCategory(BuiltInCategory.OST_ElectricalEquipment)
        .WhereElementIsNotElementType().Cast<FamilyInstance>()
        .Single(instance => instance.get_Parameter(BuiltInParameter.ALL_MODEL_MARK)?.AsString() == "AL1-暗装");
    var result = new List<string>();
    using (var transaction = new Transaction(document, "照明模型 - 平面图纸与配电盘明细表"))
    {
        transaction.Start();
        view.Name = "一层照明平面图 1比100";
        view.Scale = 100;
        view.CropBoxActive = true;
        var crop = new BoundingBoxXYZ();
        crop.Min = new XYZ(Mm(-1500), Mm(-1500), Mm(-1000));
        crop.Max = new XYZ(Mm(31550), Mm(15750), Mm(5000));
        view.CropBox = crop;
        view.CropBoxVisible = false;
        planSheet.SheetNumber = "E101";
        planSheet.Name = "一层照明平面图";
        var planCenter = new XYZ((planSheet.Outline.Min.U + planSheet.Outline.Max.U) / 2,
            (planSheet.Outline.Min.V + planSheet.Outline.Max.V) / 2, 0);
        var viewport = Viewport.Create(document, planSheet.Id, view.Id, planCenter);
        result.Add("plan sheet=" + planSheet.SheetNumber + " view=" + view.Name
            + " viewport=" + viewport.Id.Value);

        var schedule = Autodesk.Revit.DB.Electrical.PanelScheduleView.CreateInstanceView(document, panel.Id);
        schedule.Name = "AL1 配电盘明细表";
        var scheduleSheet = ViewSheet.Create(document, titleBlock.Symbol.Id);
        scheduleSheet.SheetNumber = "E102";
        scheduleSheet.Name = "AL1 配电盘明细表";
        var placedSchedule = Autodesk.Revit.DB.Electrical.PanelScheduleSheetInstance.Create(document,
            schedule.Id, scheduleSheet);
        placedSchedule.Origin = new XYZ(scheduleSheet.Outline.Min.U + Mm(20),
            scheduleSheet.Outline.Max.V - Mm(25), 0);
        result.Add("schedule sheet=" + scheduleSheet.SheetNumber + " schedule=" + schedule.Name
            + " placed=" + placedSchedule.Id.Value);
        if (transaction.Commit() != TransactionStatus.Committed)
            throw new InvalidOperationException("Sheet transaction did not commit.");
    }
    document.Save();
    return string.Join("\n", result);
}
catch (Exception exception)
{
    return exception.ToString();
}
