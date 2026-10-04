double Mm(double value) => UnitUtils.ConvertToInternalUnits(value, UnitTypeId.Millimeters);
var level = new FilteredElementCollector(document).OfClass(typeof(Level)).Cast<Level>()
    .OrderBy(item => item.Elevation).First();
var locations = new[]
{
    ("101", "过道", 1500.0, 11000.0),
    ("102", "楼梯间", 4550.0, 11000.0),
    ("103", "办公室1", 9000.0, 11000.0),
    ("104", "办公室2", 16000.0, 11000.0),
    ("105", "办公室3", 25000.0, 11000.0),
    ("106", "会议室", 15000.0, 4000.0)
};
var results = new List<string>();
using (var transaction = new Transaction(document, "照明模型 - 房间"))
{
    transaction.Start();
    foreach (var location in locations)
    {
        var room = document.Create.NewRoom(level, new UV(Mm(location.Item3), Mm(location.Item4)));
        room.Number = location.Item1;
        room.Name = location.Item2;
        results.Add(room.Name + ": " + Math.Round(UnitUtils.ConvertFromInternalUnits(room.Area, UnitTypeId.SquareMeters), 1) + " m2");
        if (room.Area <= 0)
            throw new InvalidOperationException(room.Name + " is not enclosed.");
    }
    if (transaction.Commit() != TransactionStatus.Committed)
        throw new InvalidOperationException("Room transaction did not commit.");
}
document.Save();
return string.Join(" | ", results);
