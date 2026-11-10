using Autodesk.Revit.DB;
using Autodesk.Revit.ApplicationServices;

namespace RevitAutoV27;

internal static class HouseGenerationService
{
    private const string TemplatePath = @"D:\revit 2027\Autodesk\Revit 2027\AddIns\FormItConverter\Resources\Templates\Metric\metric.rte";

    public static void Run(Application app, string output)
    {
        Document? document = null;
        try
        {
            document = app.OpenDocumentFile(TemplatePath);
            Build(document);
            document.SaveAs(output, new SaveAsOptions { OverwriteExistingFile = true });
            File.WriteAllText(output + ".done", $"generated={DateTimeOffset.Now:O}\npath={output}\n");
        }
        catch (Exception exception)
        {
            File.WriteAllText(output + ".error", exception.ToString());
        }
        finally
        {
            document?.Close(false);
        }
    }

    private static void Build(Document document)
    {
        static double Mm(double value) => UnitUtils.ConvertToInternalUnits(value, UnitTypeId.Millimeters);

        Level level1;
        Level level2;
        Level roofLevel;
        using (var transaction = new Transaction(document, "Create two story house levels"))
        {
            transaction.Start();
            level1 = FindOrCreateLevel(document, 0, "一层 0.000");
            level2 = FindOrCreateLevel(document, 3000, "二层 3.000");
            roofLevel = FindOrCreateLevel(document, 6000, "屋面 6.000");
            transaction.Commit();
        }

        var wallType = new FilteredElementCollector(document)
            .OfClass(typeof(WallType)).Cast<WallType>()
            .First(type => type.Kind == WallKind.Basic);
        var floorType = new FilteredElementCollector(document)
            .OfClass(typeof(FloorType)).Cast<FloorType>().First();

        double x0 = Mm(0), x1 = Mm(9000), y0 = Mm(0), y1 = Mm(7000), height = Mm(3000);
        using (var transaction = new Transaction(document, "Create two story house structure"))
        {
            transaction.Start();
            foreach (var level in new[] { level1, level2 })
            {
                CreateWall(document, wallType, level, new XYZ(x0, y0, level.Elevation), new XYZ(x1, y0, level.Elevation), height);
                CreateWall(document, wallType, level, new XYZ(x1, y0, level.Elevation), new XYZ(x1, y1, level.Elevation), height);
                CreateWall(document, wallType, level, new XYZ(x1, y1, level.Elevation), new XYZ(x0, y1, level.Elevation), height);
                CreateWall(document, wallType, level, new XYZ(x0, y1, level.Elevation), new XYZ(x0, y0, level.Elevation), height);
                CreateWall(document, wallType, level, new XYZ(Mm(4500), y0, level.Elevation), new XYZ(Mm(4500), y1, level.Elevation), height);
                CreateFloor(document, floorType, level, x0, x1, y0, y1);
            }

            CreateFloor(document, floorType, roofLevel, x0, x1, y0, y1);
            transaction.Commit();
        }

        document.Regenerate();
    }

    private static Level FindOrCreateLevel(Document document, double elevationMm, string name)
    {
        double elevation = UnitUtils.ConvertToInternalUnits(elevationMm, UnitTypeId.Millimeters);
        var level = new FilteredElementCollector(document).OfClass(typeof(Level)).Cast<Level>()
            .FirstOrDefault(candidate => Math.Abs(candidate.Elevation - elevation) < 1e-6);
        level ??= Level.Create(document, elevation);
        level.Name = name;
        return level;
    }

    private static void CreateWall(Document document, WallType type, Level level, XYZ start, XYZ end, double height)
    {
        Wall.Create(document, Line.CreateBound(start, end), type.Id, level.Id, height, 0, false, false);
    }

    private static void CreateFloor(Document document, FloorType type, Level level, double x0, double x1, double y0, double y1)
    {
        var loop = new CurveLoop();
        loop.Append(Line.CreateBound(new XYZ(x0, y0, level.Elevation), new XYZ(x1, y0, level.Elevation)));
        loop.Append(Line.CreateBound(new XYZ(x1, y0, level.Elevation), new XYZ(x1, y1, level.Elevation)));
        loop.Append(Line.CreateBound(new XYZ(x1, y1, level.Elevation), new XYZ(x0, y1, level.Elevation)));
        loop.Append(Line.CreateBound(new XYZ(x0, y1, level.Elevation), new XYZ(x0, y0, level.Elevation)));
        Floor.Create(document, new List<CurveLoop> { loop }, type.Id, level.Id);
    }
}
