var saved = document.Application.OpenDocumentFile(@"D:\Desktop\revitt\revit-auto\stair-test.rvt");
try
{
    double Mm(double feet) => UnitUtils.ConvertFromInternalUnits(feet, UnitTypeId.Millimeters);
    int Count(BuiltInCategory category) => new FilteredElementCollector(saved)
        .OfCategory(category).WhereElementIsNotElementType().GetElementCount();
    var grids = new FilteredElementCollector(saved).OfClass(typeof(Grid)).Cast<Grid>().ToList();
    var x = grids.Where(grid => char.IsDigit(grid.Name[0]))
        .OrderBy(grid => grid.Name).Select(grid => Math.Round(Mm(grid.Curve.GetEndPoint(0).X))).ToList();
    var y = grids.Where(grid => char.IsLetter(grid.Name[0]))
        .OrderBy(grid => grid.Name).Select(grid => Math.Round(Mm(grid.Curve.GetEndPoint(0).Y))).ToList();
    var circuits = new FilteredElementCollector(saved)
        .OfClass(typeof(Autodesk.Revit.DB.Electrical.ElectricalSystem))
        .Cast<Autodesk.Revit.DB.Electrical.ElectricalSystem>()
        .OrderBy(circuit => circuit.CircuitNumber).ToList();
    var windows = new FilteredElementCollector(saved).OfCategory(BuiltInCategory.OST_Windows)
        .WhereElementIsNotElementType().Cast<FamilyInstance>().ToList();
    var stairs = new FilteredElementCollector(saved)
        .OfClass(typeof(Autodesk.Revit.DB.Architecture.Stairs))
        .Cast<Autodesk.Revit.DB.Architecture.Stairs>().ToList();
    var flushNotes = new FilteredElementCollector(saved).OfClass(typeof(FamilyInstance))
        .Cast<FamilyInstance>()
        .Count(instance => instance.get_Parameter(BuiltInParameter.ALL_MODEL_INSTANCE_COMMENTS)
            ?.AsString() == "暗装；安装高度 1.4 m");
    return "gridX=" + string.Join(",", x) + " gridY=" + string.Join(",", y)
        + "\nlights=" + Count(BuiltInCategory.OST_LightingFixtures)
        + " switches=" + Count(BuiltInCategory.OST_LightingDevices)
        + " wires=" + Count(BuiltInCategory.OST_Wire)
        + " sheets=" + Count(BuiltInCategory.OST_Sheets)
        + " windows=" + windows.Count
        + " sillMm=" + string.Join(",", windows.Select(window => Math.Round(Mm(window
            .get_Parameter(BuiltInParameter.INSTANCE_SILL_HEIGHT_PARAM).AsDouble()))).Distinct())
        + "\ncircuits=" + string.Join(" | ", circuits.Select(circuit => circuit.CircuitNumber
            + ":" + circuit.PanelName + ":" + circuit.LookupParameter("负荷名称").AsString()
            + ":" + circuit.Elements.Size))
        + "\nstairs=" + stairs.Count + " landings=" + stairs.Sum(stair => stair.GetStairsLandings().Count)
        + " flushNotes=" + flushNotes + " warnings=" + saved.GetWarnings().Count;
}
finally
{
    saved.Close(false);
}
