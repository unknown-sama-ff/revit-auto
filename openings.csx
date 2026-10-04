double Mm(double value) => UnitUtils.ConvertToInternalUnits(value, UnitTypeId.Millimeters);
XYZ Point(double x, double y, double z = 0) => new XYZ(Mm(x), Mm(y), Mm(z));
bool Near(double first, double second) => Math.Abs(first - second) < Mm(1);
var level = new FilteredElementCollector(document).OfClass(typeof(Level)).Cast<Level>()
    .OrderBy(item => item.Elevation).First();
var walls = new FilteredElementCollector(document).OfClass(typeof(Wall)).Cast<Wall>().ToList();
Wall AtY(double y) => walls.First(wall =>
    Near(((wall.Location as LocationCurve).Curve as Line).GetEndPoint(0).Y, Mm(y))
    && Near(((wall.Location as LocationCurve).Curve as Line).GetEndPoint(1).Y, Mm(y)));
Wall AtX(double x) => walls.First(wall =>
    Near(((wall.Location as LocationCurve).Curve as Line).GetEndPoint(0).X, Mm(x))
    && Near(((wall.Location as LocationCurve).Curve as Line).GetEndPoint(1).X, Mm(x)));
var north = AtY(14250);
var south = AtY(0);
var west = AtX(0);
var middle = AtY(8050);
var symbols = new FilteredElementCollector(document).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>().ToList();
var doorSource = symbols.First(symbol => symbol.FamilyName == "子母门" && symbol.Name == "1200 x 2100mm");
var largeDoorSource = symbols.First(symbol => symbol.FamilyName == "子母门" && symbol.Name == "2100 x 2100mm");
var windowSource = symbols.First(symbol => symbol.FamilyName == "C-3" && symbol.Name == "1200 x 2100mm");

using (var transaction = new Transaction(document, "照明模型 - 门窗"))
{
    transaction.Start();
    var officeDoor = (FamilySymbol)doorSource.Duplicate("M1521");
    officeDoor.get_Parameter(BuiltInParameter.FAMILY_WIDTH_PARAM).Set(Mm(1500));
    officeDoor.get_Parameter(BuiltInParameter.FAMILY_HEIGHT_PARAM).Set(Mm(2100));
    officeDoor.Activate();
    var meetingDoor = (FamilySymbol)largeDoorSource.Duplicate("M2024");
    meetingDoor.get_Parameter(BuiltInParameter.FAMILY_WIDTH_PARAM).Set(Mm(2000));
    meetingDoor.get_Parameter(BuiltInParameter.FAMILY_HEIGHT_PARAM).Set(Mm(2400));
    meetingDoor.Activate();
    var windowType = (FamilySymbol)windowSource.Duplicate("C0921");
    windowType.get_Parameter(BuiltInParameter.FAMILY_WIDTH_PARAM).Set(Mm(900));
    windowType.get_Parameter(BuiltInParameter.FAMILY_HEIGHT_PARAM).Set(Mm(2100));
    windowType.Activate();

    foreach (double x in new[] { 4550.0, 7800.0, 15050.0, 27050.0 })
        document.Create.NewFamilyInstance(Point(x, 14250), officeDoor, north, level,
            Autodesk.Revit.DB.Structure.StructuralType.NonStructural);
    document.Create.NewFamilyInstance(Point(1550, 8050), meetingDoor, middle, level,
        Autodesk.Revit.DB.Structure.StructuralType.NonStructural);

    foreach (double x in new[] { 2300.0, 3800.0, 8300.0, 9800.0, 14300.0, 15800.0,
        20300.0, 21800.0, 26300.0, 27800.0 })
    {
        var window = document.Create.NewFamilyInstance(Point(x, 0), windowType, south, level,
            Autodesk.Revit.DB.Structure.StructuralType.NonStructural);
        window.get_Parameter(BuiltInParameter.INSTANCE_SILL_HEIGHT_PARAM).Set(Mm(900));
    }
    foreach (double y in new[] { 11800.0, 10300.0 })
    {
        var window = document.Create.NewFamilyInstance(Point(0, y), windowType, west, level,
            Autodesk.Revit.DB.Structure.StructuralType.NonStructural);
        window.get_Parameter(BuiltInParameter.INSTANCE_SILL_HEIGHT_PARAM).Set(Mm(900));
    }
    if (transaction.Commit() != TransactionStatus.Committed)
        throw new InvalidOperationException("Door and window transaction did not commit.");
}
document.Save();
return "doors=" + new FilteredElementCollector(document).OfCategory(BuiltInCategory.OST_Doors)
    .WhereElementIsNotElementType().GetElementCount()
    + " windows=" + new FilteredElementCollector(document).OfCategory(BuiltInCategory.OST_Windows)
        .WhereElementIsNotElementType().GetElementCount();
