var names = new[] { "混凝土-矩形-柱", "单嵌板玻璃门 1", "THS_灯具_普通单管荧光灯", "配电箱", "THS_开关_单级开关" };
var symbols = new FilteredElementCollector(document).OfClass(typeof(FamilySymbol))
    .Cast<FamilySymbol>().Where(symbol => names.Contains(symbol.FamilyName))
    .GroupBy(symbol => symbol.FamilyName).Select(group => group.First());
return string.Join("\n", symbols.Select(symbol => symbol.FamilyName + " | " + symbol.Name + " | "
    + string.Join(", ", symbol.Parameters.Cast<Parameter>()
        .Where(parameter => parameter.Definition != null && (parameter.Definition.Name.Contains("宽")
            || parameter.Definition.Name.Contains("高") || parameter.Definition.Name == "b"
            || parameter.Definition.Name == "h" || parameter.Definition.Name.Contains("功率")))
        .Select(parameter => parameter.Definition.Name + "=" + parameter.AsValueString() + " readOnly=" + parameter.IsReadOnly))));
