using System.Text.Json;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Events;

namespace RevitAuto;

public sealed class App : IExternalApplication
{
    private const string Root = @"D:\Desktop\revitt\revit-auto";
    private const string Source = @"D:\Desktop\revitt\素材\样板.rvt";
    private DateTime lastJobWrite;
    private Document? document;
    private bool busy;

    public Result OnStartup(UIControlledApplication application)
    {
        application.Idling += OnIdling;
        return Result.Succeeded;
    }

    public Result OnShutdown(UIControlledApplication application)
    {
        application.Idling -= OnIdling;
        document?.Close(false);
        return Result.Succeeded;
    }

    private void OnIdling(object? sender, IdlingEventArgs args)
    {
        if (busy || sender is not UIApplication uiApplication)
            return;

        string jobPath = Path.Combine(Root, "job-v2.txt");
        if (!File.Exists(jobPath))
            return;

        DateTime writeTime = File.GetLastWriteTimeUtc(jobPath);
        if (writeTime <= lastJobWrite)
            return;

        lastJobWrite = writeTime;
        busy = true;
        try
        {
            string job = File.ReadAllText(jobPath).Trim();
            if (job == "audit")
            {
                document ??= uiApplication.Application.OpenDocumentFile(Source);
                Audit(document);
            }
            else if (job == "preflight")
            {
                document ??= uiApplication.Application.OpenDocumentFile(Source);
                ModelBuilder.Preflight(document);
            }
            else if (job == "build")
            {
                document ??= uiApplication.Application.OpenDocumentFile(Source);
                ModelBuilder.Build(document);
            }
        }
        catch (Exception exception)
        {
            File.WriteAllText(Path.Combine(Root, "error-v2.txt"), exception.ToString());
        }
        finally
        {
            busy = false;
        }
    }

    private static void Audit(Document document)
    {
        var categories = new[]
        {
            BuiltInCategory.OST_Levels,
            BuiltInCategory.OST_Grids,
            BuiltInCategory.OST_Walls,
            BuiltInCategory.OST_StructuralColumns,
            BuiltInCategory.OST_Columns,
            BuiltInCategory.OST_Doors,
            BuiltInCategory.OST_Windows,
            BuiltInCategory.OST_Floors,
            BuiltInCategory.OST_Stairs,
            BuiltInCategory.OST_LightingFixtures,
            BuiltInCategory.OST_LightingDevices,
            BuiltInCategory.OST_ElectricalEquipment,
            BuiltInCategory.OST_ElectricalCircuit,
            BuiltInCategory.OST_Wire,
            BuiltInCategory.OST_Rooms,
            BuiltInCategory.OST_Sheets,
            BuiltInCategory.OST_TitleBlocks
        };

        var counts = categories.ToDictionary(
            category => category.ToString(),
            category => new FilteredElementCollector(document)
                .OfCategory(category).WhereElementIsNotElementType().GetElementCount());

        var familyCategories = new HashSet<int>
        {
            (int)BuiltInCategory.OST_Doors,
            (int)BuiltInCategory.OST_Windows,
            (int)BuiltInCategory.OST_StructuralColumns,
            (int)BuiltInCategory.OST_Columns,
            (int)BuiltInCategory.OST_LightingFixtures,
            (int)BuiltInCategory.OST_LightingDevices,
            (int)BuiltInCategory.OST_ElectricalEquipment,
            (int)BuiltInCategory.OST_TitleBlocks
        };

        var symbols = new FilteredElementCollector(document)
            .OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>()
            .Where(symbol => symbol.Category != null && familyCategories.Contains(symbol.Category.Id.IntegerValue))
            .Select(symbol => new
            {
                id = symbol.Id.Value,
                category = symbol.Category.Name,
                family = symbol.FamilyName,
                name = symbol.Name,
                active = symbol.IsActive,
                placement = symbol.Family.FamilyPlacementType.ToString()
            }).OrderBy(symbol => symbol.category).ThenBy(symbol => symbol.family).ToList();

        var wallTypes = new FilteredElementCollector(document).OfClass(typeof(WallType))
            .Cast<WallType>().Select(type => new { id = type.Id.Value, name = type.Name, widthMm = Mm(type.Width) }).ToList();
        var floorTypes = new FilteredElementCollector(document).OfClass(typeof(FloorType))
            .Cast<FloorType>().Select(type => new { id = type.Id.Value, name = type.Name }).ToList();
        var levels = new FilteredElementCollector(document).OfClass(typeof(Level))
            .Cast<Level>().Select(level => new { id = level.Id.Value, name = level.Name, elevationMm = Mm(level.Elevation) }).ToList();
        var grids = new FilteredElementCollector(document).OfClass(typeof(Grid))
            .Cast<Grid>().Select(grid => new { name = grid.Name, id = grid.Id.Value }).ToList();
        var views = new FilteredElementCollector(document).OfClass(typeof(View))
            .Cast<View>().Where(view => !view.IsTemplate)
            .Select(view => new { id = view.Id.Value, name = view.Name, type = view.ViewType.ToString() }).Take(100).ToList();

        var result = new
        {
            title = document.Title,
            path = document.PathName,
            isWorkshared = document.IsWorkshared,
            counts,
            symbols,
            wallTypes,
            floorTypes,
            levels,
            grids,
            views
        };
        File.WriteAllText(Path.Combine(Root, "audit.json"),
            JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }));
    }

    private static double Mm(double feet) => Math.Round(UnitUtils.ConvertFromInternalUnits(feet, UnitTypeId.Millimeters), 1);
}
