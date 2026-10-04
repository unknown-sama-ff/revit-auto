double Mm(double value) => UnitUtils.ConvertToInternalUnits(value, UnitTypeId.Millimeters);
XYZ Point(double x, double y, double z) => new XYZ(Mm(x), Mm(y), Mm(z));
var wall = new FilteredElementCollector(document).OfClass(typeof(Wall)).Cast<Wall>()
    .First(item => Math.Abs(((item.Location as LocationCurve).Curve as Line).GetEndPoint(0).X - Mm(30050)) < Mm(1)
        && Math.Abs(((item.Location as LocationCurve).Curve as Line).GetEndPoint(1).X - Mm(30050)) < Mm(1));
var faceReference = HostObjectUtils.GetSideFaces(wall, ShellLayerType.Interior).First();
var face = wall.GetGeometryObjectFromReference(faceReference) as PlanarFace;
var symbols = new FilteredElementCollector(document).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>().ToList();
var results = new List<string>();
using (var transaction = new Transaction(document, "Test wall hosted devices"))
{
    transaction.Start();
    foreach (var item in new[] { ("照明开关", "单极", 14000.0), ("照明配电箱", "LB101", 8700.0) })
    {
        using (var test = new SubTransaction(document))
        {
            test.Start();
            try
            {
                var symbol = symbols.First(candidate => candidate.FamilyName == item.Item1 && candidate.Name == item.Item2);
                symbol.Activate();
                var position = face.Project(Point(30050, item.Item3, 1400)).XYZPoint;
                var instance = document.Create.NewFamilyInstance(faceReference, position, XYZ.BasisY, symbol);
                document.Regenerate();
                var actual = (instance.Location as LocationPoint).Point;
                results.Add(item.Item1 + " hosted=" + (instance.Host?.Id.Value.ToString() ?? "none")
                    + " point=" + actual + " facing=" + instance.FacingOrientation);
            }
            catch (Exception exception)
            {
                results.Add(item.Item1 + " ERROR " + exception.Message);
            }
            test.RollBack();
        }
    }
    transaction.RollBack();
}
return string.Join("\n", results);
