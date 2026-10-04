var view = new FilteredElementCollector(document).OfClass(typeof(ViewPlan)).Cast<ViewPlan>()
    .First(item => item.Name == "1F_电气平面图" || item.Name.StartsWith("一层照明平面图"));
var options = new ImageExportOptions();
options.ExportRange = ExportRange.SetOfViews;
options.FilePath = @"D:\Desktop\revitt\revit-auto\lighting-plan";
options.HLRandWFViewsFileType = ImageFileType.PNG;
options.ImageResolution = ImageResolution.DPI_300;
options.ZoomType = ZoomFitType.FitToPage;
options.PixelSize = 4096;
options.SetViewsAndSheets(new List<ElementId> { view.Id });
document.ExportImage(options);
return "exported " + view.Name;
