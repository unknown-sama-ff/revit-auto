var walls = new FilteredElementCollector(document).OfClass(typeof(Wall)).GetElementCount();
var levels = new FilteredElementCollector(document).OfClass(typeof(Level)).GetElementCount();
return document.PathName + " | walls=" + walls + " | levels=" + levels;
