using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;

namespace RevitAutoV27;

// Native Revit UI-thread collector feeding ArchitecturalGeometryAuditRules.
// Strictly read-only: never modifies elements or saves documents.
internal static class ArchitecturalGeometryAuditService
{
    private static double Mm(double internalFeet) => JsonDefaults.InternalToMm(internalFeet);

    public static ArchitecturalGeometryAuditReport Run(Document doc)
    {
        var walls = new List<AuditWallGeometry>();
        foreach (var wall in new FilteredElementCollector(doc).OfClass(typeof(Wall)).WhereElementIsNotElementType().Cast<Wall>())
        {
            if (wall.Location is not LocationCurve loc || loc.Curve is not Line line || !line.IsBound) continue;
            var bb = wall.get_BoundingBox(null);
            if (bb is null) continue;
            var start = line.GetEndPoint(0);
            var end = line.GetEndPoint(1);
            var baseLevelId = wall.get_Parameter(BuiltInParameter.WALL_BASE_CONSTRAINT)?.AsElementId().Value ?? -1;
            walls.Add(new AuditWallGeometry(
                wall.Id.Value, baseLevelId,
                Mm(bb.Min.Z), Mm(bb.Max.Z), Mm(wall.Width),
                Mm(start.X), Mm(start.Y), Mm(end.X), Mm(end.Y)));
        }

        var surfaces = new List<AuditHorizontalSurface>();
        foreach (var floor in new FilteredElementCollector(doc).OfClass(typeof(Floor)).WhereElementIsNotElementType().Cast<Floor>())
        {
            var bb = floor.get_BoundingBox(null);
            if (bb is null) continue;
            surfaces.Add(new AuditHorizontalSurface(
                floor.Id.Value, "Floor", floor.LevelId.Value,
                Mm(bb.Min.Z), Mm(bb.Max.Z),
                Mm(bb.Min.X), Mm(bb.Min.Y), Mm(bb.Max.X), Mm(bb.Max.Y)));
        }
        foreach (var roof in new FilteredElementCollector(doc).OfClass(typeof(RoofBase)).WhereElementIsNotElementType().Cast<RoofBase>())
        {
            var bb = roof.get_BoundingBox(null);
            if (bb is null) continue;
            surfaces.Add(new AuditHorizontalSurface(
                roof.Id.Value, "Roof", roof.LevelId.Value,
                Mm(bb.Min.Z), Mm(bb.Max.Z),
                Mm(bb.Min.X), Mm(bb.Min.Y), Mm(bb.Max.X), Mm(bb.Max.Y)));
        }

        var columns = new List<AuditColumnGeometry>();
        foreach (var col in new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_StructuralColumns).WhereElementIsNotElementType())
        {
            var bb = col.get_BoundingBox(null);
            if (bb is null) continue;
            var minX = Mm(bb.Min.X); var maxX = Mm(bb.Max.X);
            var minY = Mm(bb.Min.Y); var maxY = Mm(bb.Max.Y);
            columns.Add(new AuditColumnGeometry(
                col.Id.Value, Mm(bb.Min.Z), Mm(bb.Max.Z),
                (minX + maxX) * 0.5, (minY + maxY) * 0.5,
                Math.Max(1.0, (maxX - minX) * 0.5), Math.Max(1.0, (maxY - minY) * 0.5)));
        }

        var stairsAndRailings = new List<AuditStairOrRailingGeometry>();
        foreach (var stair in new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Stairs).WhereElementIsNotElementType())
        {
            var bb = stair.get_BoundingBox(null);
            if (bb is null) continue;
            stairsAndRailings.Add(new AuditStairOrRailingGeometry(
                stair.Id.Value, "OST_Stairs",
                Mm(bb.Min.X), Mm(bb.Min.Y), Mm(bb.Min.Z),
                Mm(bb.Max.X), Mm(bb.Max.Y), Mm(bb.Max.Z)));
        }
        foreach (var railing in new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_StairsRailing).WhereElementIsNotElementType())
        {
            var bb = railing.get_BoundingBox(null);
            if (bb is null) continue;
            stairsAndRailings.Add(new AuditStairOrRailingGeometry(
                railing.Id.Value, "OST_StairsRailing",
                Mm(bb.Min.X), Mm(bb.Min.Y), Mm(bb.Min.Z),
                Mm(bb.Max.X), Mm(bb.Max.Y), Mm(bb.Max.Z)));
        }

        var doorCount = new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Doors).WhereElementIsNotElementType().GetElementCount();
        var windowCount = new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Windows).WhereElementIsNotElementType().GetElementCount();

        return ArchitecturalGeometryAuditRules.Analyze(walls, surfaces, columns, stairsAndRailings, doorCount, windowCount);
    }
}
