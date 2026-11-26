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
                Mm(start.X), Mm(start.Y), Mm(end.X), Mm(end.Y),
                wall.WallType?.Name ?? string.Empty));
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
        var structuralMembers = new List<AuditStructuralMemberFamily>();
        foreach (var col in new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_StructuralColumns).WhereElementIsNotElementType())
        {
            if (col is FamilyInstance colInst && colInst.Symbol is { } colSym)
                structuralMembers.Add(new AuditStructuralMemberFamily(col.Id.Value, "OST_StructuralColumns", colSym.FamilyName, colSym.Name));
            var bb = col.get_BoundingBox(null);
            if (bb is null) continue;
            var minX = Mm(bb.Min.X); var maxX = Mm(bb.Max.X);
            var minY = Mm(bb.Min.Y); var maxY = Mm(bb.Max.Y);
            columns.Add(new AuditColumnGeometry(
                col.Id.Value, Mm(bb.Min.Z), Mm(bb.Max.Z),
                (minX + maxX) * 0.5, (minY + maxY) * 0.5,
                Math.Max(1.0, (maxX - minX) * 0.5), Math.Max(1.0, (maxY - minY) * 0.5)));
        }
        var beams = new List<AuditBeamGeometry>();
        foreach (var beam in new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_StructuralFraming).WhereElementIsNotElementType().OfType<FamilyInstance>())
        {
            if (beam.Symbol is { } beamSym)
                structuralMembers.Add(new AuditStructuralMemberFamily(beam.Id.Value, "OST_StructuralFraming", beamSym.FamilyName, beamSym.Name));
            if (beam.Location is LocationCurve bLoc && bLoc.Curve is Line bLine && bLine.IsBound)
            {
                var p0 = bLine.GetEndPoint(0);
                var p1 = bLine.GetEndPoint(1);
                var zMm = Mm((p0.Z + p1.Z) * 0.5);
                beams.Add(new AuditBeamGeometry(
                    beam.Id.Value, Mm(p0.X), Mm(p0.Y), Mm(p1.X), Mm(p1.Y), zMm,
                    beam.Symbol?.Name ?? string.Empty));
            }
        }

        var stairsAndRailings = new List<AuditStairOrRailingGeometry>();
        var stairRuns = new List<AuditStairRunMetric>();
        foreach (var stair in new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Stairs).WhereElementIsNotElementType())
        {
            if (stair is Stairs st)
            {
                var treadMm = Mm(st.ActualTreadDepth);
                foreach (var runId in st.GetStairsRuns())
                {
                    if (doc.GetElement(runId) is StairsRun run)
                        stairRuns.Add(new AuditStairRunMetric(st.Id.Value, run.Id.Value, Mm(run.ActualRunWidth), treadMm));
                }
            }
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

        var doors = new List<AuditDoorGeometry>();
        var openings = new List<AuditOpeningGeometry>();
        foreach (var door in new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Doors).WhereElementIsNotElementType().OfType<FamilyInstance>())
        {
            if (door.Location is not LocationPoint pt) continue;
            var hostId = door.Host?.Id.Value ?? -1;
            var baseZMm = doc.GetElement(door.LevelId) is Level lvl ? Mm(lvl.ProjectElevation) : Mm(pt.Point.Z);
            doors.Add(new AuditDoorGeometry(door.Id.Value, hostId, baseZMm, Mm(pt.Point.X), Mm(pt.Point.Y)));
            openings.Add(new AuditOpeningGeometry(door.Id.Value, "OST_Doors", hostId, baseZMm, Mm(pt.Point.X), Mm(pt.Point.Y), ReadOpeningWidthMm(door, 900.0)));
        }

        var windowCount = 0;
        foreach (var win in new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Windows).WhereElementIsNotElementType().OfType<FamilyInstance>())
        {
            windowCount++;
            if (win.Location is not LocationPoint pt) continue;
            var hostId = win.Host?.Id.Value ?? -1;
            var baseZMm = doc.GetElement(win.LevelId) is Level lvl ? Mm(lvl.ProjectElevation) : Mm(pt.Point.Z);
            openings.Add(new AuditOpeningGeometry(win.Id.Value, "OST_Windows", hostId, baseZMm, Mm(pt.Point.X), Mm(pt.Point.Y), ReadOpeningWidthMm(win, 1000.0)));
        }
        var hasNativeTopography =
            new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Toposolid).WhereElementIsNotElementType().GetElementCount() > 0 ||
            new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Topography).WhereElementIsNotElementType().GetElementCount() > 0;

        return ArchitecturalGeometryAuditRules.Analyze(walls, surfaces, columns, stairsAndRailings, doors.Count, windowCount, doors, hasNativeTopography, structuralMembers, openings, stairRuns, beams);
    }

    private static double ReadOpeningWidthMm(FamilyInstance instance, double fallbackMm)
    {
        BuiltInParameter[] candidates = [BuiltInParameter.DOOR_WIDTH, BuiltInParameter.WINDOW_WIDTH, BuiltInParameter.FAMILY_WIDTH_PARAM];
        foreach (var bip in candidates)
        {
            var p = instance.get_Parameter(bip) ?? instance.Symbol?.get_Parameter(bip);
            if (p is { HasValue: true, StorageType: StorageType.Double })
            {
                var mm = Mm(p.AsDouble());
                if (double.IsFinite(mm) && mm > 50.0) return mm;
            }
        }
        return fallbackMm;
    }
}
