using System.Text.Json;

namespace RevitAutoV27;

internal readonly record struct AnnotationPointMm(double XMm, double YMm, double ZMm);

internal sealed record TextNoteInput(
    long ViewId,
    long TextTypeId,
    string Text,
    AnnotationPointMm Point,
    double? WidthMm,
    double RotationDegrees);

internal sealed record DetailLineInput(
    long ViewId,
    AnnotationPointMm Start,
    AnnotationPointMm End,
    long? LineStyleId);

internal sealed record TextNoteReadback(
    long ElementId,
    string UniqueId,
    long OwnerViewId,
    long TextTypeId,
    string Text,
    AnnotationPointMm CoordMm,
    double WidthMm);

internal sealed record DetailLineReadback(
    long ElementId,
    string UniqueId,
    long OwnerViewId,
    long LineStyleId,
    AnnotationPointMm StartMm,
    AnnotationPointMm EndMm,
    double LengthMm);

internal static class AnnotationCreationRules
{
    public const long MaxSafeInteger = 9007199254740991;
    public const double ToleranceMm = 1.0;

    internal static BridgeException Invalid(string message) => new("invalid_2d_annotation", message);
    internal static bool IsAnnotation(string? kind) => kind is "create_text_note" or "create_detail_line";

    public static TextNoteInput ValidateTextNote(JsonElement op)
    {
        CheckFields(op, ["operationType", "id", "dependencies", "viewId", "textTypeId", "text", "point", "widthMm", "rotationDegrees"]);
        if (JsonDefaults.String(op, "operationType") != "create_text_note")
            throw Invalid("Expected create_text_note.");
        CheckMetadata(op);
        var viewId = PositiveId(op, "viewId");
        var textTypeId = PositiveId(op, "textTypeId");
        var text = ValidateText(op);
        var point = Point(op, "point");
        double? widthMm = null;
        if (op.TryGetProperty("widthMm", out var widthEl))
        {
            var width = FiniteNumber(widthEl, "widthMm");
            if (width < 1 || width > 50000)
                throw Invalid("widthMm must be between 1 and 50000 mm.");
            widthMm = width;
        }
        var rotationDegrees = 0.0;
        if (op.TryGetProperty("rotationDegrees", out var rotEl))
        {
            rotationDegrees = FiniteNumber(rotEl, "rotationDegrees");
            if (rotationDegrees < -360 || rotationDegrees > 360)
                throw Invalid("rotationDegrees must be between -360 and 360.");
        }
        return new(viewId, textTypeId, text, point, widthMm, rotationDegrees);
    }

    public static DetailLineInput ValidateDetailLine(JsonElement op)
    {
        CheckFields(op, ["operationType", "id", "dependencies", "viewId", "start", "end", "lineStyleId"]);
        if (JsonDefaults.String(op, "operationType") != "create_detail_line")
            throw Invalid("Expected create_detail_line.");
        CheckMetadata(op);
        var viewId = PositiveId(op, "viewId");
        var start = Point(op, "start");
        var end = Point(op, "end");
        if (Distance(start, end) < 1.0)
            throw Invalid("Detail line length must be at least 1 mm.");
        long? lineStyleId = op.TryGetProperty("lineStyleId", out _) ? PositiveId(op, "lineStyleId") : null;
        return new(viewId, start, end, lineStyleId);
    }

    public static void Validate(JsonElement op)
    {
        var kind = JsonDefaults.String(op, "operationType");
        if (kind == "create_text_note") _ = ValidateTextNote(op);
        else if (kind == "create_detail_line") _ = ValidateDetailLine(op);
        else throw Invalid("Expected create_text_note or create_detail_line.");
    }

    public static void ValidatePlan(IReadOnlyList<JsonElement> operations)
    {
        var sources = new HashSet<long>();
        foreach (var op in operations.Where(op => IsAnnotation(JsonDefaults.String(op, "operationType"))))
        {
            if (JsonDefaults.String(op, "operationType") == "create_text_note")
            {
                var input = ValidateTextNote(op);
                sources.Add(input.ViewId);
                sources.Add(input.TextTypeId);
            }
            else
            {
                var input = ValidateDetailLine(op);
                sources.Add(input.ViewId);
                if (input.LineStyleId is long styleId) sources.Add(styleId);
            }
        }
        if (sources.Count == 0) return;
        foreach (var op in operations)
        {
            var kind = JsonDefaults.String(op, "operationType");
            if (kind == "load_family" ||
                (kind is "set_parameter" or "delete_element" && JsonDefaults.Int64(op, "elementId") is long id && sources.Contains(id)))
                throw Invalid("2D annotation target view, text type, or line style changes and family loading require a separate reviewed plan.");
        }
    }

    public static string NormalizeNativeText(string text)
        => text.Replace("\r\n", "\r", StringComparison.Ordinal).Replace("\n", "\r", StringComparison.Ordinal);

    public static void RequireTextNote(TextNoteInput input, AnnotationPointMm projectedPointMm, string expectedUniqueId, TextNoteReadback actual)
    {
        if (actual.ElementId <= 0 || actual.UniqueId != expectedUniqueId ||
            actual.OwnerViewId != input.ViewId || actual.TextTypeId != input.TextTypeId)
            throw Invalid("Native TextNote identity, owner view, or text type differs from the reviewed operation; roll back.");
        if (!double.IsFinite(actual.WidthMm) || actual.WidthMm <= 0 || Distance(actual.CoordMm, projectedPointMm) > ToleranceMm)
            throw Invalid("Native TextNote coordinates or width differ from the reviewed placement; roll back.");
        var expectedNorm = NormalizeNativeText(input.Text);
        var actualNorm = NormalizeNativeText(actual.Text);
        if (!expectedNorm.EndsWith('\r') && actualNorm.EndsWith('\r'))
            actualNorm = actualNorm[..^1];
        if (!string.Equals(actualNorm, expectedNorm, StringComparison.Ordinal))
            throw Invalid("Native TextNote text content differs from the reviewed operation; roll back.");
    }

    public static void RequireDetailLine(DetailLineInput input, AnnotationPointMm projectedStartMm, AnnotationPointMm projectedEndMm, string expectedUniqueId, DetailLineReadback actual)
    {
        if (actual.ElementId <= 0 || actual.UniqueId != expectedUniqueId || actual.OwnerViewId != input.ViewId)
            throw Invalid("Native DetailCurve identity or owner view differs from the reviewed operation; roll back.");
        if (input.LineStyleId is long expectedStyle && actual.LineStyleId != expectedStyle)
            throw Invalid("Native DetailCurve line style differs from the reviewed style; roll back.");
        var expectedLength = Distance(projectedStartMm, projectedEndMm);
        var forward = Distance(actual.StartMm, projectedStartMm) <= ToleranceMm && Distance(actual.EndMm, projectedEndMm) <= ToleranceMm;
        var reversed = Distance(actual.StartMm, projectedEndMm) <= ToleranceMm && Distance(actual.EndMm, projectedStartMm) <= ToleranceMm;
        if ((!forward && !reversed) || !double.IsFinite(actual.LengthMm) || Math.Abs(actual.LengthMm - expectedLength) > ToleranceMm)
            throw Invalid("Native DetailCurve endpoints or length differ from the reviewed geometry; roll back.");
    }

    internal static double Distance(AnnotationPointMm a, AnnotationPointMm b)
    {
        var dx = a.XMm - b.XMm;
        var dy = a.YMm - b.YMm;
        var dz = a.ZMm - b.ZMm;
        return Math.Sqrt(dx * dx + dy * dy + dz * dz);
    }

    private static string ValidateText(JsonElement op)
    {
        if (!op.TryGetProperty("text", out var value) || value.ValueKind != JsonValueKind.String)
            throw Invalid("text must be a non-empty string.");
        var text = value.GetString()!;
        if (text.Length is < 1 or > 4000 || string.IsNullOrWhiteSpace(text))
            throw Invalid("text must be 1..4000 characters and not blank.");
        for (var i = 0; i < text.Length; i++)
        {
            var ch = text[i];
            if (ch == '\n') continue;
            if (ch == '\r' && i + 1 < text.Length && text[i + 1] == '\n') continue;
            if (char.IsControl(ch))
                throw Invalid("text may not contain control characters other than newline (\\n or \\r\\n).");
        }
        return text;
    }

    private static AnnotationPointMm Point(JsonElement op, string field)
    {
        if (!op.TryGetProperty(field, out var pt))
            throw Invalid($"{field} coordinates are required.");
        CheckFields(pt, ["xMm", "yMm", "zMm"], requireAll: true);
        return new(
            FiniteNumber(pt.GetProperty("xMm"), $"{field}.xMm"),
            FiniteNumber(pt.GetProperty("yMm"), $"{field}.yMm"),
            FiniteNumber(pt.GetProperty("zMm"), $"{field}.zMm"));
    }

    private static double FiniteNumber(JsonElement value, string field)
    {
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetDouble(out var n) || !double.IsFinite(n) || Math.Abs(n) > 1e8)
            throw Invalid($"{field} must be a finite number with absolute value at most 100000000.");
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
            throw Invalid("Annotation input requires an explicit JSON object.");
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in value.EnumerateObject())
        {
            if (!allowed.Contains(item.Name, StringComparer.Ordinal) || !seen.Add(item.Name))
                throw Invalid($"Unsupported or duplicate annotation field '{item.Name}'.");
        }
        if (requireAll && allowed.Any(k => !seen.Contains(k)))
            throw Invalid("Point requires explicit xMm, yMm, and zMm fields.");
    }
}
