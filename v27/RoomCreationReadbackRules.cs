using System.Text.Json;

namespace RevitAutoV27;

internal readonly record struct RoomPointReadback(double Xmm, double Ymm, double Zmm);
internal sealed record RoomBoundarySegmentReadback(string CurveType, RoomPointReadback Start, RoomPointReadback Mid, RoomPointReadback End, double LengthMm);
internal sealed record RoomCreationReadback(long LevelId, string? Name, string? Number, RoomPointReadback Location, double AreaM2, RoomBoundarySegmentReadback[][] BoundaryLoops);

internal static class RoomCreationReadbackRules
{
    internal const int MaxBoundarySegments = 1000;
    private const double ToleranceMm = 1;
    private static BridgeException Invalid(string message) => new("invalid_operation", message);

    internal static JsonElement Resolve(JsonElement reviewed, long levelId, double projectElevationMm)
    {
        if (levelId <= 0 || !double.IsFinite(projectElevationMm)) throw Invalid("A room requires its resolved native level and finite project elevation.");
        _ = Text(reviewed, "name"); _ = Text(reviewed, "number");
        _ = Number(reviewed, "xMm"); _ = Number(reviewed, "yMm");
        var fields = reviewed.EnumerateObject().ToDictionary(property => property.Name, property => property.Value.Clone(), StringComparer.Ordinal);
        fields["levelId"] = JsonSerializer.SerializeToElement(levelId);
        fields["zMm"] = JsonSerializer.SerializeToElement(projectElevationMm);
        return JsonSerializer.SerializeToElement(fields, JsonDefaults.Options);
    }

    internal static void Require(JsonElement resolved, RoomCreationReadback actual)
    {
        var levelId = JsonDefaults.Int64(resolved, "levelId");
        var name = Text(resolved, "name"); var number = Text(resolved, "number");
        var point = new RoomPointReadback(Number(resolved, "xMm"), Number(resolved, "yMm"), Number(resolved, "zMm"));
        if (actual is null || levelId is null or <= 0 || actual.LevelId != levelId ||
            !string.Equals(actual.Name, name, StringComparison.Ordinal) || !string.Equals(actual.Number, number, StringComparison.Ordinal) ||
            !Close(point, actual.Location)) throw Invalid("Native room name, number, level or location differs from the reviewed operation; roll back.");
        RequireNative(actual);
    }

    internal static void RequireNative(RoomCreationReadback actual)
    {
        if (actual is null || actual.LevelId <= 0 || string.IsNullOrWhiteSpace(actual.Name) || string.IsNullOrWhiteSpace(actual.Number) || !Finite(actual.Location))
            throw Invalid("The native room identity, level or location is unavailable; roll back.");
        if (!double.IsFinite(actual.AreaM2) || actual.AreaM2 <= 0) throw Invalid("The requested room is unplaced or not enclosed; roll back.");
        if (actual.BoundaryLoops is null || actual.BoundaryLoops.Length == 0 ||
            actual.BoundaryLoops.Any(loop => loop is null || loop.Length == 0) ||
            actual.BoundaryLoops.Sum(loop => (long)loop.Length) > MaxBoundarySegments)
            throw Invalid("Complete room boundaries are missing or exceed the bounded evidence budget; roll back.");
        foreach (var loop in actual.BoundaryLoops)
        {
            for (var index = 0; index < loop.Length; index++)
            {
                var segment = loop[index]; var next = loop[(index + 1) % loop.Length];
                if (segment is null || next is null || string.IsNullOrWhiteSpace(segment.CurveType) ||
                    !Finite(segment.Start) || !Finite(segment.Mid) || !Finite(segment.End) ||
                    !double.IsFinite(segment.LengthMm) || segment.LengthMm <= 0 || !Close(segment.End, next.Start))
                    throw Invalid("Native room boundary evidence is nonfinite, disconnected or incomplete; roll back.");
            }
        }
    }

    private static string Text(JsonElement operation, string field)
    {
        var text = JsonDefaults.String(operation, field);
        return !string.IsNullOrWhiteSpace(text) && string.Equals(text, text.Trim(), StringComparison.Ordinal)
            ? text : throw Invalid($"Room readback requires the original explicit {field}.");
    }
    private static double Number(JsonElement operation, string field) => JsonDefaults.Double(operation, field)
        ?? throw Invalid($"Room readback requires finite resolved {field}.");
    private static bool Finite(RoomPointReadback point) => double.IsFinite(point.Xmm) && double.IsFinite(point.Ymm) && double.IsFinite(point.Zmm);
    private static bool Close(RoomPointReadback a, RoomPointReadback b)
    {
        var distance = Math.Sqrt(Math.Pow(a.Xmm - b.Xmm, 2) + Math.Pow(a.Ymm - b.Ymm, 2) + Math.Pow(a.Zmm - b.Zmm, 2));
        return Finite(a) && Finite(b) && double.IsFinite(distance) && distance <= ToleranceMm;
    }
}
