var names = new[] { "C-3", "子母门", "无装饰暗装照明设备", "照明开关", "照明配电箱" };
return string.Join("\n", new FilteredElementCollector(document).OfClass(typeof(Family)).Cast<Family>()
    .Where(family => names.Contains(family.Name))
    .Select(family => family.Name + " | " + family.FamilyCategory.Name + " | "
        + string.Join(",", family.GetFamilySymbolIds().Select(id => document.GetElement(id).Name))));
