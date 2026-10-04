return string.Join("\n", new FilteredElementCollector(document).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>()
    .Where(symbol => symbol.Category?.Id.Value == (long)BuiltInCategory.OST_TitleBlocks)
    .Select(symbol => symbol.FamilyName + "/" + symbol.Name + " id=" + symbol.Id.Value));
