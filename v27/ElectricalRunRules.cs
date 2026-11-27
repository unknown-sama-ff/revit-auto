using System.Text.Json;

namespace RevitAutoV27;

internal readonly record struct ElectricalRunPointMm(double XMm, double YMm, double ZMm);

internal sealed record CableTrayInput(
    long CableTrayTypeId,
    long LevelId,
    ElectricalRunPointMm Start,
    ElectricalRunPointMm End,
    double WidthMm,
    double HeightMm);

internal sealed record ConduitInput(
    long ConduitTypeId,
    long LevelId,
    ElectricalRunPointMm Start,
    ElectricalRunPointMm End,
    double DiameterMm);

internal sealed record ElectricalRunConnectorSnapshot(
    int ConnectorId,
    string Domain,
    string Shape,
    bool IsConnected,
    ElectricalRunPointMm? OriginMm);

internal sealed record ElectricalRunReadback(
    long ElementId,
    string UniqueId,
    string Kind,
    long TypeId,
    long LevelId,
    ElectricalRunPointMm StartMm,
    ElectricalRunPointMm EndMm,
    double LengthMm,
    double? WidthMm,
    double? HeightMm,
    double? DiameterMm,
    IReadOnlyList<ElectricalRunConnectorSnapshot> EndConnectors);

internal static class ElectricalRunRules
{
    public const long MaxSafeInteger = 9007199254740991;
    public const double ToleranceMm = 1.0;

    internal static BridgeException Invalid(string message) => new("invalid_electrical_run", message);
    internal static bool IsElectricalRun(string? kind) => kind is "create_cable_tray" or "create_conduit";

    public static CableTrayInput ValidateCableTray(JsonElement op)
    {
        CheckFields(op, ["operationType", "id", "dependencies", "cableTrayTypeId", "levelId", "start", "end", "widthMm", "heightMm"]);
        if (JsonDefaults.String(op, "operationType") != "create_cable_tray")
            throw Invalid("Expected create_cable_tray.");
        CheckMetadata(op);
        var typeId = PositiveId(op, "cableTrayTypeId");
        var levelId = PositiveId(op, "levelId");
        var start = Point(op, "start");
        var end = Point(op, "end");
        if (Distance(start, end) < 1.0)
            throw Invalid("Cable tray length must be at least 1 mm.");
        var widthMm = BoundedPositive(op, "widthMm", 1, 10000);
        var heightMm = BoundedPositive(op, "heightMm", 1, 10000);
        return new(typeId, levelId, start, end, widthMm, heightMm);
    }

    public static ConduitInput ValidateConduit(JsonElement op)
    {
        CheckFields(op, ["operationType", "id", "dependencies", "conduitTypeId", "levelId", "start", "end", "diameterMm"]);
        if (JsonDefaults.String(op, "operationType") != "create_conduit")
            throw Invalid("Expected create_conduit.");
        CheckMetadata(op);
        var typeId = PositiveId(op, "conduitTypeId");
        var levelId = PositiveId(op, "levelId");
        var start = Point(op, "start");
        var end = Point(op, "end");
        if (Distance(start, end) < 1.0)
            throw Invalid("Conduit length must be at least 1 mm.");
        var diameterMm = BoundedPositive(op, "diameterMm", 1, 2000);
        return new(typeId, levelId, start, end, diameterMm);
    }

    public static void Validate(JsonElement op)
    {
        var kind = JsonDefaults.String(op, "operationType");
        if (kind == "create_cable_tray") _ = ValidateCableTray(op);
        else if (kind == "create_conduit") _ = ValidateConduit(op);
        else throw Invalid("Expected create_cable_tray or create_conduit.");
    }

    public static void ValidatePlan(IReadOnlyList<JsonElement> operations)
    {
        var sources = new HashSet<long>();
        foreach (var op in operations.Where(op => IsElectricalRun(JsonDefaults.String(op, "operationType"))))
        {
            if (JsonDefaults.String(op, "operationType") == "create_cable_tray")
            {
                var input = ValidateCableTray(op);
                sources.Add(input.CableTrayTypeId);
                sources.Add(input.LevelId);
            }
            else
            {
                var input = ValidateConduit(op);
                sources.Add(input.ConduitTypeId);
                sources.Add(input.LevelId);
            }
        }
        if (sources.Count == 0) return;
        foreach (var op in operations)
        {
            var kind = JsonDefaults.String(op, "operationType");
            if (kind == "load_family" ||
                (kind is "set_parameter" or "delete_element" && JsonDefaults.Int64(op, "elementId") is long id && sources.Contains(id)))
                throw Invalid("Electrical run type or level changes and family loading require a separate reviewed plan.");
        }
    }

    public static void RequireCableTray(CableTrayInput input, string expectedUniqueId, ElectricalRunReadback actual, bool allowFittingTrim = false)
    {
        RequireLinearGeometry("CableTray", input.CableTrayTypeId, input.LevelId, input.Start, input.End, expectedUniqueId, actual, allowFittingTrim);
        if (actual.WidthMm is not double w || !double.IsFinite(w) || Math.Abs(w - input.WidthMm) > ToleranceMm ||
            actual.HeightMm is not double h || !double.IsFinite(h) || Math.Abs(h - input.HeightMm) > ToleranceMm)
            throw Invalid("Native CableTray cross-section width or height differs from the reviewed operation; roll back.");
    }

    public static void RequireConduit(ConduitInput input, string expectedUniqueId, ElectricalRunReadback actual, bool allowFittingTrim = false)
    {
        RequireLinearGeometry("Conduit", input.ConduitTypeId, input.LevelId, input.Start, input.End, expectedUniqueId, actual, allowFittingTrim);
        if (actual.DiameterMm is not double d || !double.IsFinite(d) || Math.Abs(d - input.DiameterMm) > ToleranceMm)
            throw Invalid("Native Conduit diameter differs from the reviewed operation; roll back.");
    }

    private static void RequireLinearGeometry(
        string label, long expectedTypeId, long expectedLevelId,
        ElectricalRunPointMm start, ElectricalRunPointMm end, string expectedUniqueId, ElectricalRunReadback actual, bool allowFittingTrim)
    {
        if (actual.ElementId <= 0 || actual.UniqueId != expectedUniqueId ||
            actual.TypeId != expectedTypeId || actual.LevelId != expectedLevelId)
            throw Invalid($"Native {label} identity, type, or reference level differs from the reviewed operation; roll back.");
        var expectedLength = Distance(start, end);
        if (allowFittingTrim)
        {
            if (!double.IsFinite(actual.LengthMm) || actual.LengthMm <= 0 || actual.LengthMm > expectedLength + ToleranceMm ||
                !PointOnSegmentWithinTolerance(actual.StartMm, start, end, ToleranceMm) ||
                !PointOnSegmentWithinTolerance(actual.EndMm, start, end, ToleranceMm))
                throw Invalid($"Native {label} trimmed by a same-plan fitting moved off its reviewed axis or exceeded reviewed bounds; roll back.");
            return;
        }
        var forward = Distance(actual.StartMm, start) <= ToleranceMm && Distance(actual.EndMm, end) <= ToleranceMm;
        var reversed = Distance(actual.StartMm, end) <= ToleranceMm && Distance(actual.EndMm, start) <= ToleranceMm;
        if ((!forward && !reversed) || !double.IsFinite(actual.LengthMm) || Math.Abs(actual.LengthMm - expectedLength) > ToleranceMm)
            throw Invalid($"Native {label} endpoints or length differ from the reviewed geometry; roll back.");
    }

    private static bool PointOnSegmentWithinTolerance(ElectricalRunPointMm p, ElectricalRunPointMm a, ElectricalRunPointMm b, double tol)
    {
        var vx = b.XMm - a.XMm; var vy = b.YMm - a.YMm; var vz = b.ZMm - a.ZMm;
        var len2 = vx * vx + vy * vy + vz * vz;
        if (len2 < 1e-9) return Distance(p, a) <= tol;
        var t = ((p.XMm - a.XMm) * vx + (p.YMm - a.YMm) * vy + (p.ZMm - a.ZMm) * vz) / len2;
        var len = Math.Sqrt(len2);
        if (t * len < -tol || (t - 1.0) * len > tol) return false;
        var proj = new ElectricalRunPointMm(a.XMm + t * vx, a.YMm + t * vy, a.ZMm + t * vz);
        return Distance(p, proj) <= tol;
    }

    internal static double Distance(ElectricalRunPointMm a, ElectricalRunPointMm b)
    {
        var dx = a.XMm - b.XMm;
        var dy = a.YMm - b.YMm;
        var dz = a.ZMm - b.ZMm;
        return Math.Sqrt(dx * dx + dy * dy + dz * dz);
    }

    private static double BoundedPositive(JsonElement op, string field, double min, double max)
    {
        if (!op.TryGetProperty(field, out var value) || value.ValueKind != JsonValueKind.Number ||
            !value.TryGetDouble(out var number) || !double.IsFinite(number) || number < min || number > max)
            throw Invalid($"{field} must be a finite number between {min} and {max} mm.");
        return number;
    }

    private static ElectricalRunPointMm Point(JsonElement op, string field)
    {
        if (!op.TryGetProperty(field, out var pt))
            throw Invalid($"{field} coordinates are required.");
        CheckFields(pt, ["xMm", "yMm", "zMm"], requireAll: true);
        return new(
            FiniteCoord(pt.GetProperty("xMm"), $"{field}.xMm"),
            FiniteCoord(pt.GetProperty("yMm"), $"{field}.yMm"),
            FiniteCoord(pt.GetProperty("zMm"), $"{field}.zMm"));
    }

    private static double FiniteCoord(JsonElement value, string field)
    {
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetDouble(out var n) || !double.IsFinite(n) || Math.Abs(n) > 1e8)
            throw Invalid($"{field} must be a finite number with absolute value at most 100000000 mm.");
        return n;
    }

    private static long PositiveId(JsonElement op, string field)
    {
        if (!op.TryGetProperty(field, out var value) || value.ValueKind != JsonValueKind.Number ||
            !value.TryGetInt64(out var id) || id <= 0 || id > MaxSafeInteger)
            throw Invalid($"{field} must be an existing positive safe native element ID.");
        return id;
    }

    private static void CheckMetadata(JsonElement op)
    {
        string? opId = null;
        if (op.TryGetProperty("id", out var idEl))
        {
            if (idEl.ValueKind != JsonValueKind.String)
                throw Invalid("Operation id must be a nonblank string up to 80 characters.");
            opId = idEl.GetString()!;
            if (opId.Length < 1 || opId.Length > 80 || opId.Trim() != opId || opId.Any(char.IsControl))
                throw Invalid("Operation id must be 1..80 characters without surrounding whitespace or controls.");
        }
        if (op.TryGetProperty("dependencies", out var deps))
        {
            if (deps.ValueKind != JsonValueKind.Array || deps.GetArrayLength() > 1000)
                throw Invalid("dependencies must be a bounded array of operation IDs.");
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var item in deps.EnumerateArray())
            {
                if (item.ValueKind != JsonValueKind.String)
                    throw Invalid("dependencies entries must be strings.");
                var dep = item.GetString()!;
                if (dep.Length < 1 || dep.Length > 80 || dep.Trim() != dep || dep.Any(char.IsControl) || !seen.Add(dep) || dep == opId)
                    throw Invalid("Dependencies must be distinct valid IDs and cannot reference the operation itself.");
            }
        }
    }

    private static void CheckFields(JsonElement value, string[] allowed, bool requireAll = false)
    {
        if (value.ValueKind != JsonValueKind.Object)
            throw Invalid("Electrical run input requires an explicit JSON object.");
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in value.EnumerateObject())
        {
            if (!allowed.Contains(item.Name, StringComparer.Ordinal) || !seen.Add(item.Name))
                throw Invalid($"Unsupported or duplicate electrical run field '{item.Name}'.");
        }
        if (requireAll && allowed.Any(k => !seen.Contains(k)))
            throw Invalid("Point requires explicit xMm, yMm, and zMm fields.");
    }
}
