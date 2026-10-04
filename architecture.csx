if (!document.PathName.EndsWith(@"考生文件夹\照明模型+方昱.rvt", StringComparison.OrdinalIgnoreCase))
    throw new InvalidOperationException("The active document is not the output model.");
if (new FilteredElementCollector(document).OfClass(typeof(Wall)).GetElementCount() != 0)
    throw new InvalidOperationException("Walls already exist in the output model.");

double Mm(double value) => UnitUtils.ConvertToInternalUnits(value, UnitTypeId.Millimeters);
XYZ Point(double x, double y, double z = 0) => new XYZ(Mm(x), Mm(y), Mm(z));
var baseLevel = new FilteredElementCollector(document).OfClass(typeof(Level)).Cast<Level>()
    .OrderBy(level => level.Elevation).First();
var topLevel = new FilteredElementCollector(document).OfClass(typeof(Level)).Cast<Level>()
    .OrderBy(level => level.Elevation).Skip(1).First();
var outerWallType = new FilteredElementCollector(document).OfClass(typeof(WallType)).Cast<WallType>()
    .First(type => type.Name == "F1_加气混凝土砌块墙_200mm");
var partitionType = new FilteredElementCollector(document).OfClass(typeof(WallType)).Cast<WallType>()
    .First(type => type.Name == "F37_加气混凝土砌块墙_100mm");
var floorType = new FilteredElementCollector(document).OfClass(typeof(FloorType)).Cast<FloorType>()
    .First(type => type.Name == "F1_建筑楼板_素砼_100mm");
var columnType = new FilteredElementCollector(document).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>()
    .First(type => type.FamilyName == "混凝土-矩形-柱" && type.Name == "300 x 450 mm");

using (var transaction = new Transaction(document, "照明模型 - 轴网与建筑主体"))
{
    transaction.Start();

    foreach (var item in new[] { ("1", 0.0), ("2", 3050.0), ("3", 6050.0),
        ("4", 12050.0), ("5", 20050.0), ("6", 30050.0) })
    {
        var grid = Grid.Create(document, Line.CreateBound(Point(item.Item2, -1500), Point(item.Item2, 15750)));
        grid.Name = item.Item1;
    }
    foreach (var item in new[] { ("A", 0.0), ("B", 8050.0), ("C", 14250.0) })
    {
        var grid = Grid.Create(document, Line.CreateBound(Point(-1500, item.Item2), Point(31550, item.Item2)));
        grid.Name = item.Item1;
    }

    var exteriorSegments = new[]
    {
        (0.0, 0.0, 30050.0, 0.0),
        (30050.0, 0.0, 30050.0, 14250.0),
        (30050.0, 14250.0, 0.0, 14250.0),
        (0.0, 14250.0, 0.0, 0.0),
        (0.0, 8050.0, 30050.0, 8050.0)
    };
    foreach (var segment in exteriorSegments)
        Wall.Create(document, Line.CreateBound(Point(segment.Item1, segment.Item2), Point(segment.Item3, segment.Item4)),
            outerWallType.Id, baseLevel.Id, Mm(4000), 0, false, false);
    foreach (double x in new[] { 3050.0, 6050.0, 12050.0, 20050.0 })
        Wall.Create(document, Line.CreateBound(Point(x, 8050), Point(x, 14250)),
            partitionType.Id, baseLevel.Id, Mm(4000), 0, false, false);

    var boundary = new CurveLoop();
    var corners = new[] { Point(-100, -100), Point(30150, -100), Point(30150, 14350), Point(-100, 14350) };
    for (int index = 0; index < corners.Length; index++)
        boundary.Append(Line.CreateBound(corners[index], corners[(index + 1) % corners.Length]));
    Floor.Create(document, new List<CurveLoop> { boundary }, floorType.Id, baseLevel.Id);

    var squareColumn = columnType.Duplicate("500 x 500 mm") as FamilySymbol
        ?? throw new InvalidOperationException("Cannot duplicate the column family type.");
    squareColumn.LookupParameter("b").Set(Mm(500));
    squareColumn.LookupParameter("h").Set(Mm(500));
    squareColumn.Activate();
    foreach (double x in new[] { 0.0, 6050.0, 12050.0, 18050.0, 24050.0, 30050.0 })
        foreach (double y in new[] { 0.0, 8050.0, 14250.0 })
        {
            var column = document.Create.NewFamilyInstance(Point(x, y), squareColumn, baseLevel,
                Autodesk.Revit.DB.Structure.StructuralType.Column);
            column.get_Parameter(BuiltInParameter.FAMILY_TOP_LEVEL_PARAM)?.Set(topLevel.Id);
        }

    if (transaction.Commit() != TransactionStatus.Committed)
        throw new InvalidOperationException("Architecture transaction was not committed.");
}

document.Save();
return "grids=" + new FilteredElementCollector(document).OfClass(typeof(Grid)).GetElementCount()
    + " walls=" + new FilteredElementCollector(document).OfClass(typeof(Wall)).GetElementCount()
    + " floors=" + new FilteredElementCollector(document).OfClass(typeof(Floor)).GetElementCount()
    + " columns=" + new FilteredElementCollector(document).OfCategory(BuiltInCategory.OST_StructuralColumns)
        .WhereElementIsNotElementType().GetElementCount();
