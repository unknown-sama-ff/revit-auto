using System.Text.Json;
using CurveEvidence = RevitAutoV27.RebarCurveEvidence;

namespace RevitAutoV27;

internal sealed record RebarCurveEvidence(string Kind, RebarPoint Start, RebarPoint End, RebarPoint Midpoint, double LengthMm,
        RebarPoint? Center = null, double? RadiusMm = null, RebarVector? Normal = null, double? SweepRadians = null);

internal sealed record RebarPoint(double XMm, double YMm, double ZMm);
internal sealed record RebarVector(double X, double Y, double Z);
internal sealed record RebarLayoutInput(string Rule, int Positions, int Quantity, double? ArrayLengthMm, double? SpacingMm,
    bool? BarsOnNormalSide, bool? IncludeFirstBar, bool? IncludeLastBar);
internal sealed record RebarCreationInput(string OperationType, long HostElementId, long BarTypeId, long? ShapeId,
    RebarPoint? Start, RebarPoint? End, RebarVector? Normal, RebarPoint? Origin, RebarVector? XDirection, RebarVector? YDirection, RebarLayoutInput Layout, bool AllowNewShape = false);

// Pure rules; complete absolute XYZ, explicit intent and no deferred/native IDs.
internal static class RebarCreationRules
{
    public static void ValidatePlan(IReadOnlyList<JsonElement> operations)
    {
        var sources=new HashSet<long>();
        foreach(var op in operations.Where(op=>JsonDefaults.String(op,"operationType") is "create_rebar_set" or "create_rebar_stirrup"))
        {
            var input=Validate(op);sources.Add(input.HostElementId);sources.Add(input.BarTypeId);
            if(input.ShapeId is long shape)sources.Add(shape);
        }
        if(sources.Count==0)return;
        foreach(var op in operations)
        {
            var kind=JsonDefaults.String(op,"operationType");
            if(kind=="load_family"||kind is "set_parameter" or "delete_element"&&JsonDefaults.Int64(op,"elementId") is long id&&sources.Contains(id))
                throw Invalid("Rebar host/bar-type/shape changes and family loading require a separate reviewed plan; creation cannot share source mutation.");
        }
    }
    internal const double PositionToleranceMm = 0.01;
    internal const double UnitTolerance = 1e-9;
    internal const double DirectionTolerance = 1e-6;
    internal const int MaximumPositions = 1000;
    internal static BridgeException Invalid(string message) => new("invalid_rebar_creation", message);

    public static RebarCreationInput Validate(JsonElement op)
    {
        var kind = JsonDefaults.String(op, "operationType");
        if (kind is not ("create_rebar_set" or "create_rebar_stirrup")) throw Invalid("Unsupported rebar operationType.");
        var straight = kind == "create_rebar_set";
        Shape(op, straight ? ["operationType", "id", "dependencies", "hostElementId", "barTypeId", "start", "end", "normal", "layout", "allowNewShape"] :
            ["operationType", "id", "dependencies", "hostElementId", "barTypeId", "shapeId", "origin", "xDirection", "yDirection", "layout"]);
        Metadata(op);
        var host = Id(op, "hostElementId"); var type = Id(op, "barTypeId");
        var layout = Layout(JsonDefaults.Get(op, "layout"));
        if (straight)
        {
            var start = Point(op, "start"); var end = Point(op, "end"); var normal = Vector(op, "normal");
            var direction = Between(start, end); var length = Length(direction);
            if (length < 1) throw Invalid("Straight rebar endpoints must be at least 1 mm apart in complete XYZ.");
            if (Math.Abs(Dot(direction, normal)) / length > UnitTolerance) throw Invalid("normal must be explicitly perpendicular to the complete XYZ line.");
            var allowNewShape = op.TryGetProperty("allowNewShape", out _) && Boolean(op, "allowNewShape");
            return new(kind, host, type, null, start, end, normal, null, null, null, layout, allowNewShape);
        }
        var x = Vector(op, "xDirection"); var y = Vector(op, "yDirection");
        if (Math.Abs(Dot(x, y)) > UnitTolerance) throw Invalid("xDirection and yDirection must be orthogonal near-unit vectors; no normalization or basis is inferred.");
        return new(kind, host, type, Id(op, "shapeId"), null, null, null, Point(op, "origin"), x, y, layout);
    }

    private static void Metadata(JsonElement op)
    {
        string Text(JsonElement value) => value.ValueKind == JsonValueKind.String && value.GetString() is { Length: > 0 and <= 80 } text && text == text.Trim() && !text.Any(char.IsControl)
            ? text : throw Invalid("Operation metadata requires nonblank, unpadded strings of at most 80 characters.");
        string? id = op.TryGetProperty("id", out var value) ? Text(value) : null;
        if (!op.TryGetProperty("dependencies", out var dependencies)) return;
        if (dependencies.ValueKind != JsonValueKind.Array || dependencies.GetArrayLength() > 1000) throw Invalid("dependencies must be an explicit bounded array.");
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in dependencies.EnumerateArray())
        {
            var dependency = Text(item);
            if (!seen.Add(dependency) || dependency == id) throw Invalid("Duplicate or self dependencies are refused.");
        }
    }
    internal static RebarLayoutInput Layout(JsonElement value)
    {
        var rule = JsonDefaults.String(value, "rule");
        if (rule == "Single") { Shape(value, ["rule"]); return new(rule, 1, 1, null, null, null, null, null); }
        if (rule is not ("FixedNumber" or "MaximumSpacing")) throw Invalid("layout.rule must be exactly Single, FixedNumber or MaximumSpacing.");
        Shape(value, rule == "FixedNumber" ? ["rule", "quantity", "arrayLengthMm", "barsOnNormalSide", "includeFirstBar", "includeLastBar"] :
            ["rule", "spacingMm", "arrayLengthMm", "barsOnNormalSide", "includeFirstBar", "includeLastBar"]);
        var length = Number(value, "arrayLengthMm"); if (length <= 0) throw Invalid("arrayLengthMm must be positive.");
        var side = Boolean(value, "barsOnNormalSide"); var first = Boolean(value, "includeFirstBar"); var last = Boolean(value, "includeLastBar");
        double? spacing = null; int positions;
        if (rule == "FixedNumber")
        {
            var quantity = JsonDefaults.Get(value, "quantity");
            if (quantity.ValueKind != JsonValueKind.Number || !quantity.TryGetInt32(out positions) || positions < 2 || positions > MaximumPositions)
                throw Invalid("FixedNumber.quantity must be an integer from 2 through 1000 and denotes potential bar positions.");
        }
        else
        {
            spacing = Number(value, "spacingMm"); if (spacing <= 0) throw Invalid("spacingMm must be positive.");
            var intervals = Math.Ceiling(length / spacing.Value);
            if (!double.IsFinite(intervals) || intervals < 1 || intervals >= MaximumPositions) throw Invalid("MaximumSpacing requires between 2 and 1000 potential bar positions.");
            positions = (int)intervals + 1;
        }
        var actualQuantity = positions - (first ? 0 : 1) - (last ? 0 : 1);
        if (actualQuantity < 1) throw Invalid("The explicit endpoint exclusions would remove every bar.");
        return new(rule, positions, actualQuantity, length, spacing, side, first, last);
    }
    internal static bool Included(RebarLayoutInput layout, int index) => index >= 0 && index < layout.Positions &&
        (layout.Rule == "Single" || (index != 0 || layout.IncludeFirstBar == true) && (index != layout.Positions - 1 || layout.IncludeLastBar == true));
    internal static RebarVector ExpectedNormal(RebarCreationInput input) => input.Normal ?? Cross(input.XDirection!, input.YDirection!);
    internal static RebarPoint MapDefaultPoint(RebarCreationInput input, RebarPoint local) => new(
        input.Origin!.XMm + input.XDirection!.X*local.XMm + input.YDirection!.X*local.YMm,
        input.Origin!.YMm + input.XDirection!.Y*local.XMm + input.YDirection!.Y*local.YMm,
        input.Origin!.ZMm + input.XDirection!.Z*local.XMm + input.YDirection!.Z*local.YMm);
    internal static RebarVector ExpectedOffset(RebarCreationInput input, int index)
    {
        var distance = input.Layout.Rule == "Single" ? 0 : input.Layout.ArrayLengthMm!.Value * index / (input.Layout.Positions - 1) * (input.Layout.BarsOnNormalSide == true ? 1 : -1);
        var normal = ExpectedNormal(input); return new(normal.X * distance, normal.Y * distance, normal.Z * distance);
    }
    internal static long Id(JsonElement op, string key)
    {
        var value = JsonDefaults.Get(op, key);
        return value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var id) && id > 0 && id <= 9007199254740991 ? id :
            throw Invalid(key + " must be an explicit existing positive safe native ID; deferred IDs are refused.");
    }
    internal static double Number(JsonElement value, string key)
    {
        var item = JsonDefaults.Get(value, key);
        return item.ValueKind == JsonValueKind.Number && item.TryGetDouble(out var number) && double.IsFinite(number) && Math.Abs(number) <= 1e8 ? number :
            throw Invalid(key + " requires an explicit finite number with absolute value at most 100000000.");
    }
    private static bool Boolean(JsonElement value, string key) => JsonDefaults.Get(value, key).ValueKind switch
    { JsonValueKind.True => true, JsonValueKind.False => false, _ => throw Invalid(key + " requires an explicit boolean.") };
    internal static RebarPoint Point(JsonElement op, string key)
    { var value = JsonDefaults.Get(op, key); Shape(value, ["xMm", "yMm", "zMm"]); return new(Number(value, "xMm"), Number(value, "yMm"), Number(value, "zMm")); }
    internal static RebarVector Vector(JsonElement op, string key)
    {
        var value = JsonDefaults.Get(op, key); Shape(value, ["x", "y", "z"]); var vector = new RebarVector(Number(value, "x"), Number(value, "y"), Number(value, "z"));
        if (Math.Abs(Length(vector) - 1) > UnitTolerance) throw Invalid(key + " must already be a near-unit vector; silent normalization is forbidden.");
        return vector;
    }
    internal static void Shape(JsonElement value, string[] allowed)
    {
        if (value.ValueKind != JsonValueKind.Object) throw Invalid("An explicit rebar object is required.");
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in value.EnumerateObject())
            if (!allowed.Contains(property.Name, StringComparer.Ordinal) || !seen.Add(property.Name)) throw Invalid("Unsupported or duplicate rebar field '" + property.Name + "'.");
    }
    internal static RebarVector Between(RebarPoint a, RebarPoint b) => new(b.XMm-a.XMm,b.YMm-a.YMm,b.ZMm-a.ZMm);
    internal static RebarPoint Add(RebarPoint point, RebarVector vector) => new(point.XMm+vector.X,point.YMm+vector.Y,point.ZMm+vector.Z);
    internal static double Dot(RebarVector a, RebarVector b) => a.X*b.X+a.Y*b.Y+a.Z*b.Z;
    internal static RebarVector Cross(RebarVector a, RebarVector b) => new(a.Y*b.Z-a.Z*b.Y,a.Z*b.X-a.X*b.Z,a.X*b.Y-a.Y*b.X);
    internal static double Length(RebarVector vector) => Math.Sqrt(Dot(vector,vector));
    internal static void RequirePoint(RebarPoint expected, RebarPoint actual, string field)
    { if (!double.IsFinite(Length(Between(expected,actual))) || Length(Between(expected,actual)) > PositionToleranceMm) throw Invalid(field + " differs from reviewed complete XYZ by more than 0.01 mm."); }
    internal static void RequireVector(RebarVector expected, RebarVector actual, string field)
    { var delta = new RebarVector(expected.X-actual.X,expected.Y-actual.Y,expected.Z-actual.Z); if (!double.IsFinite(Length(delta)) || Length(delta) > DirectionTolerance) throw Invalid(field + " differs from the reviewed direction."); }
    internal static void RequireLength(double expected, double actual, string field)
    { if (!double.IsFinite(expected) || !double.IsFinite(actual) || Math.Abs(expected-actual) > PositionToleranceMm) throw Invalid(field + " differs from the reviewed length."); }
    internal static void RequireClosed(CurveEvidence[] curves, string field)
    {
        if (curves.Length < 3) throw Invalid(field + " is not a complete closed chain.");
        for (var i=0;i<curves.Length;i++) RebarCreationRules.RequirePoint(curves[i].End, curves[(i+1)%curves.Length].Start, field + " closure");
    }
    // The browser has default dimensions; optional fillet arcs separate adjacent
    // straight driving segments. Recover their analytic intersections, preserving
    // arbitrary planar polygon orientation/topology rather than assuming rectangles.
    internal static RebarPoint[] DefaultPolygon(CurveEvidence[] browser, int segmentCount)
    {
        RequireClosed(browser, "source shape browser");
        foreach (var curve in browser)
            foreach (var point in new[] { curve.Start, curve.End, curve.Midpoint })
                if (Math.Abs(point.ZMm) > RebarCreationRules.PositionToleranceMm) throw Invalid("The source shape browser must expose its default planar geometry in shape XY.");
        var indices = Enumerable.Range(0,browser.Length).Where(i => browser[i].Kind == "Line").ToArray();
        if (indices.Length != segmentCount) throw Invalid("Default source driving curves are not completely recoverable as straight segments.");
        var vertices = new List<RebarPoint>();
        for (var i=0;i<indices.Length;i++)
        {
            var previousIndex = indices[(i+indices.Length-1)%indices.Length]; var currentIndex = indices[i];
            var gap = (currentIndex-previousIndex-1+browser.Length)%browser.Length;
            if (gap > 1 || gap == 1 && browser[(previousIndex+1)%browser.Length].Kind != "Arc") throw Invalid("Only one bounded tangent fillet may separate consecutive source driving lines.");
            var a = browser[previousIndex]; var b = browser[currentIndex];
            var u = RebarCreationRules.Between(a.Start,a.End); var v = RebarCreationRules.Between(b.Start,b.End);
            var determinant = u.X*v.Y-u.Y*v.X;
            if (!double.IsFinite(determinant) || Math.Abs(determinant) < 1e-10*RebarCreationRules.Length(u)*RebarCreationRules.Length(v)) throw Invalid("Parallel/collinear driving neighbors do not provide a provable default vertex.");
            var delta = RebarCreationRules.Between(a.Start,b.Start); var factor = (delta.X*v.Y-delta.Y*v.X)/determinant;
            var intersection = new RebarPoint(a.Start.XMm+factor*u.X,a.Start.YMm+factor*u.Y,0);
            if (!double.IsFinite(intersection.XMm) || !double.IsFinite(intersection.YMm) || Math.Max(Math.Abs(intersection.XMm),Math.Abs(intersection.YMm)) > 1e8) throw Invalid("Default polygon reconstruction is unbounded.");
            if (gap == 0) RebarCreationRules.RequirePoint(intersection,b.Start, "unfilleted source vertex");
            else
            {
                var arc = browser[(previousIndex+1)%browser.Length];
                if (arc.SweepRadians > Math.PI || arc.Center is null || arc.RadiusMm is null || arc.Normal is null) throw Invalid("Source arc cannot be proved to be a simple planar fillet.");
                RebarCreationRules.RequireLength(0, RebarCreationRules.Dot(RebarCreationRules.Between(arc.Center,arc.Start),u)/RebarCreationRules.Length(u), "source fillet start tangency");
                RebarCreationRules.RequireLength(0, RebarCreationRules.Dot(RebarCreationRules.Between(arc.Center,arc.End),v)/RebarCreationRules.Length(v), "source fillet end tangency");
            }
            vertices.Add(intersection);
        }
        var minX = vertices.Min(point=>point.XMm); var minY = vertices.Min(point=>point.YMm);
        var maxX = vertices.Max(point=>point.XMm); var maxY = vertices.Max(point=>point.YMm);
        foreach (var curve in browser.Where(curve=>curve.Kind=="Arc"))
        {
            // A conservative full-circle envelope avoids understating an arc's
            // unsampled extrema. Reject ambiguous origins instead of sampling a
            // curve and pretending its three sampled points are exact bounds.
            if (curve.Center is null || curve.RadiusMm is null ||
                curve.Center.XMm-curve.RadiusMm.Value < minX-PositionToleranceMm || curve.Center.XMm+curve.RadiusMm.Value > maxX+PositionToleranceMm ||
                curve.Center.YMm-curve.RadiusMm.Value < minY-PositionToleranceMm || curve.Center.YMm+curve.RadiusMm.Value > maxY+PositionToleranceMm)
                throw Invalid("Source fillet bounds cannot prove the default shape lower-left origin convention.");
        }
        // Reject browser representations whose rounded bounds differ from the
        // driving bounds: their CreateFromRebarShape origin mapping is ambiguous
        // without a shape-specific native proof. Never guess that translation.
        var samples = browser.SelectMany(curve=>new[]{curve.Start,curve.End,curve.Midpoint}).ToArray();
        RebarCreationRules.RequireLength(minX,samples.Min(point=>point.XMm), "source lower-left X bounding convention");
        RebarCreationRules.RequireLength(minY,samples.Min(point=>point.YMm), "source lower-left Y bounding convention");
        return vertices.Select(point=>new RebarPoint(point.XMm-minX,point.YMm-minY,0)).ToArray();
    }
    internal static void RequireLine(RebarPoint start, RebarPoint end, CurveEvidence curve, string field)
    {
        if (curve.Kind != "Line") throw Invalid(field + " is not a bounded line.");
        var direct = RebarCreationRules.Length(RebarCreationRules.Between(start,curve.Start)) <= RebarCreationRules.PositionToleranceMm;
        RebarCreationRules.RequirePoint(start,direct?curve.Start:curve.End,field+" start");
        RebarCreationRules.RequirePoint(end,direct?curve.End:curve.Start,field+" end");
    }
    internal static void RequirePolygon(RebarPoint[] polygon, CurveEvidence[] actual)
    {
        var remaining = actual.ToList();
        for (var i=0;i<polygon.Length;i++)
        {
            var start=polygon[i]; var end=polygon[(i+1)%polygon.Length];
            var match=remaining.FindIndex(curve=>curve.Kind=="Line" &&
                ((Near(start,curve.Start)&&Near(end,curve.End))||(Near(start,curve.End)&&Near(end,curve.Start))));
            if(match<0) throw Invalid("Native shape driving geometry differs from the reviewed default polygon mapped by origin/X/Y.");
            remaining.RemoveAt(match);
        }
    }
    internal static bool Near(RebarPoint a, RebarPoint b) => RebarCreationRules.Length(RebarCreationRules.Between(a,b)) <= RebarCreationRules.PositionToleranceMm;
    internal static void RequireCurves(CurveEvidence[] expected, CurveEvidence[] actual, RebarVector offset, string field)
    {
        if (expected.Length != actual.Length) throw Invalid(field + " curve count changed.");
        for (var i=0;i<expected.Length;i++)
        {
            var a=expected[i]; var b=actual[i];
            if(a.Kind!=b.Kind) throw Invalid(field + " curve type changed.");
            RebarCreationRules.RequirePoint(RebarCreationRules.Add(a.Start,offset),b.Start,field+" start");
            RebarCreationRules.RequirePoint(RebarCreationRules.Add(a.End,offset),b.End,field+" end");
            RebarCreationRules.RequirePoint(RebarCreationRules.Add(a.Midpoint,offset),b.Midpoint,field+" midpoint");
            RebarCreationRules.RequireLength(a.LengthMm,b.LengthMm,field+" length");
            if(a.Kind=="Arc")
            {
                if(a.Center is null||b.Center is null||a.RadiusMm is null||b.RadiusMm is null||a.Normal is null||b.Normal is null||a.SweepRadians is null||b.SweepRadians is null) throw Invalid(field+" arc evidence is incomplete.");
                RebarCreationRules.RequirePoint(RebarCreationRules.Add(a.Center,offset),b.Center,field+" arc center");
                RebarCreationRules.RequireLength(a.RadiusMm.Value,b.RadiusMm.Value,field+" arc radius");
                RebarCreationRules.RequireVector(a.Normal,b.Normal,field+" arc normal");
                if(Math.Abs(a.SweepRadians.Value-b.SweepRadians.Value)>1e-8) throw Invalid(field+" arc sweep changed.");
            }
        }
    }

    internal static void RequireHookMatch(int expectedHookAngleDeg, long actualHookTypeId, double? actualHookAngleRad, string endLabel)
    {
        if (expectedHookAngleDeg < 0 || expectedHookAngleDeg > 360)
            throw Invalid($"Source shape hook angle at {endLabel} is outside [0,360] degrees.");
        if (expectedHookAngleDeg == 0)
        {
            if (actualHookTypeId >= 0) throw Invalid($"Native rebar acquired an unexpected hook at {endLabel}.");
            return;
        }
        if (actualHookTypeId <= 0 || actualHookAngleRad is not double rad || !double.IsFinite(rad) ||
            Math.Abs(rad * 180.0 / Math.PI - expectedHookAngleDeg) > 1.0)
            throw Invalid($"Native rebar hook at {endLabel} does not match expected shape hook angle {expectedHookAngleDeg} deg.");
    }

    internal static double CoplanarPlaneOffsetMm(RebarPoint origin, RebarVector normal, CurveEvidence[] curves, string field)
    {
        if (curves.Length < 1) throw Invalid(field + " is empty.");
        double minDist = double.PositiveInfinity, maxDist = double.NegativeInfinity;
        foreach (var curve in curves)
        {
            foreach (var point in new[] { curve.Start, curve.End, curve.Midpoint }.Concat(curve.Center is null ? [] : new[] { curve.Center }))
            {
                var distance = Dot(Between(origin, point), normal);
                if (!double.IsFinite(distance))
                    throw Invalid(field + " has non-finite plane distance.");
                if (distance < minDist) minDist = distance;
                if (distance > maxDist) maxDist = distance;
            }
        }
        if (maxDist - minDist > PositionToleranceMm)
            throw Invalid($"{field} is not coplanar perpendicular to the reviewed normal (offset range [{minDist:F4}, {maxDist:F4}] mm).");
        return (minDist + maxDist) / 2.0;
    }

    internal static void RequirePlanarInShapePlane(RebarPoint origin, RebarVector normal, CurveEvidence[] curves, string field)
    {
        var offset = CoplanarPlaneOffsetMm(origin, normal, curves, field);
        if (Math.Abs(offset) > PositionToleranceMm)
            throw Invalid($"{field} leaves the reviewed shape plane (normal offset {offset:F4} mm).");
    }
}
