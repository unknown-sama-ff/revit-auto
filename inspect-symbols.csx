return string.Join("\n", new FilteredElementCollector(document).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>()
    .Where(symbol => symbol.FamilyName.Contains("楼梯间应急") || symbol.FamilyName == "照明开关")
    .Select(symbol => symbol.FamilyName + "/" + symbol.Name + "/" + symbol.Family.FamilyPlacementType));
