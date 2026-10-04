var sheets = new FilteredElementCollector(document).OfClass(typeof(ViewSheet)).Cast<ViewSheet>()
    .Where(sheet => sheet.SheetNumber == "E101" || sheet.SheetNumber == "E102")
    .OrderBy(sheet => sheet.SheetNumber).ToList();
var options = new ImageExportOptions();
options.ExportRange = ExportRange.SetOfViews;
options.FilePath = @"D:\Desktop\revitt\revit-auto\sheet-check";
options.HLRandWFViewsFileType = ImageFileType.PNG;
options.ShadowViewsFileType = ImageFileType.PNG;
options.ImageResolution = ImageResolution.DPI_300;
options.ZoomType = ZoomFitType.FitToPage;
options.PixelSize = 4096;
options.SetViewsAndSheets(sheets.Select(sheet => sheet.Id).ToList());
document.ExportImage(options);
return string.Join(",", sheets.Select(sheet => sheet.SheetNumber + ":" + sheet.Name));
