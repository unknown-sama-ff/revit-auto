var lines = new List<string>();
foreach (var stair in new FilteredElementCollector(document)
    .OfClass(typeof(Autodesk.Revit.DB.Architecture.Stairs))
    .Cast<Autodesk.Revit.DB.Architecture.Stairs>())
{
    lines.Add("stair " + stair.Id.Value + " base=" + stair.BaseElevation + " top=" + stair.TopElevation
        + " runs=" + string.Join(",", stair.GetStairsRuns().Select(id => id.Value))
        + " landings=" + string.Join(",", stair.GetStairsLandings().Select(id => id.Value)));
    foreach (var runId in stair.GetStairsRuns())
    {
        var run = (Autodesk.Revit.DB.Architecture.StairsRun)document.GetElement(runId);
        lines.Add("run " + run.Id.Value + " risers=" + run.ActualRisersNumber
            + " base=" + run.BaseElevation + " top=" + run.TopElevation
            + " width=" + run.ActualRunWidth);
        lines.Add("params=" + string.Join(",", run.Parameters.Cast<Parameter>()
            .Where(parameter => parameter.Definition.Name.Contains("高度") || parameter.Definition.Name.Contains("踢面")
                || parameter.Definition.Name.Contains("标高") || parameter.Definition.Name.Contains("相对"))
            .Select(parameter => parameter.Definition.Name + "=" + parameter.AsValueString()
                + "/readonly=" + parameter.IsReadOnly)));
    }
}
foreach (var warning in document.GetWarnings())
    lines.Add("warning " + warning.GetDescriptionText() + " elements="
        + string.Join(",", warning.GetFailingElements().Select(id => id.Value)));
return string.Join("\n", lines);
