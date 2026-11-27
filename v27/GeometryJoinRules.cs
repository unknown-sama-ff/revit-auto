using System.Text.Json;

namespace RevitAutoV27;

internal sealed record GeometryJoinInput(
    string FirstRef,
    string SecondRef,
    long? FirstId,
    long? SecondId,
    string Action,
    bool IgnoreAlreadyJoined,
    bool SkipIfUnjoinable = false);

internal sealed record GeometryJoinReadback(
    long FirstElementId,
    long SecondElementId,
    string Action,
    bool WasJoinedBefore,
    bool IsJoinedAfter,
    bool? FirstWasCuttingBefore,
    bool? FirstIsCuttingAfter,
    bool NoOp,
    bool SkippedUnjoinable = false,
    string? SkippedReason = null);

// Pure validation and readback rules for native JoinGeometryUtils operations.
// Zero Revit API dependencies so CoreTests verifies every contract offline.
internal static class GeometryJoinRules
{
    public const long MaxSafeInteger = 9007199254740991;
    private static readonly string[] AllowedFields =
    [
        "operationType", "id", "dependencies",
        "firstElementId", "secondElementId", "action", "ignoreAlreadyJoined", "skipIfUnjoinable"
    ];
    private static readonly string[] AllowedActions = ["join", "unjoin", "switch_order"];

    internal static BridgeException Invalid(string message) => new("invalid_geometry_join", message);

    public static GeometryJoinInput Validate(JsonElement op)
    {
        if (op.ValueKind != JsonValueKind.Object)
            throw Invalid("join_geometry requires an explicit JSON object.");
        if (JsonDefaults.String(op, "operationType") != "join_geometry")
            throw Invalid("Expected operationType 'join_geometry'.");

        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var prop in op.EnumerateObject())
        {
            if (!AllowedFields.Contains(prop.Name, StringComparer.Ordinal) || !seen.Add(prop.Name))
                throw Invalid($"Unsupported or duplicate join_geometry field '{prop.Name}'.");
        }

        var (firstRef, firstId) = ParseElementRef(op, "firstElementId");
        var (secondRef, secondId) = ParseElementRef(op, "secondElementId");
        if (string.Equals(firstRef, secondRef, StringComparison.Ordinal))
            throw Invalid("join_geometry requires two distinct elements.");

        var action = "join";
        if (op.TryGetProperty("action", out var actionEl))
        {
            if (actionEl.ValueKind != JsonValueKind.String || actionEl.GetString() is not { } raw ||
                !AllowedActions.Contains(raw, StringComparer.Ordinal))
                throw Invalid("join_geometry action must be 'join', 'unjoin', or 'switch_order'.");
            action = raw;
        }

        var ignoreAlreadyJoined = true;
        if (op.TryGetProperty("ignoreAlreadyJoined", out var ignoreEl))
        {
            ignoreAlreadyJoined = ignoreEl.ValueKind switch
            {
                JsonValueKind.True => true,
                JsonValueKind.False => false,
                _ => throw Invalid("join_geometry ignoreAlreadyJoined must be a boolean.")
            };
        }

        var skipIfUnjoinable = false;
        if (op.TryGetProperty("skipIfUnjoinable", out var skipEl))
        {
            skipIfUnjoinable = skipEl.ValueKind switch
            {
                JsonValueKind.True => true,
                JsonValueKind.False => false,
                _ => throw Invalid("join_geometry skipIfUnjoinable must be a boolean.")
            };
        }

        return new(firstRef, secondRef, firstId, secondId, action, ignoreAlreadyJoined, skipIfUnjoinable);
    }

    public static void ValidateWallJoinFields(JsonElement op)
    {
        foreach (var field in new[] { "disallowJoin", "disallowJoinStart", "disallowJoinEnd" })
        {
            if (op.TryGetProperty(field, out var flag) && flag.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                throw new BridgeException("invalid_operation", $"create_wall {field} must be a boolean.");
        }
        foreach (var field in new[] { "joinTypeStart", "joinTypeEnd" })
        {
            if (op.TryGetProperty(field, out var jt))
            {
                if (jt.ValueKind != JsonValueKind.String || jt.GetString() is not ("abut" or "miter" or "square_off"))
                    throw new BridgeException("invalid_operation", $"create_wall {field} must be 'abut', 'miter', or 'square_off'.");
            }
        }
    }

    public static (bool DisallowStart, bool DisallowEnd) ResolveEndDisallow(JsonElement op)
    {
        var both = JsonDefaults.Bool(op, "disallowJoin");
        var start = JsonDefaults.Has(op, "disallowJoinStart") ? JsonDefaults.Bool(op, "disallowJoinStart") : both;
        var end = JsonDefaults.Has(op, "disallowJoinEnd") ? JsonDefaults.Bool(op, "disallowJoinEnd") : both;
        return (start, end);
    }

    public static void Require(GeometryJoinReadback actual)
    {
        if (actual.FirstElementId <= 0 || actual.SecondElementId <= 0 || actual.FirstElementId == actual.SecondElementId)
            throw Invalid("Native join_geometry readback requires two distinct positive element IDs.");
        switch (actual.Action)
        {
            case "join":
                if (!actual.SkippedUnjoinable && !actual.IsJoinedAfter)
                    throw Invalid($"Native elements {actual.FirstElementId} and {actual.SecondElementId} did not remain joined after join_geometry.");
                break;
            case "unjoin":
                if (actual.IsJoinedAfter)
                    throw Invalid($"Native elements {actual.FirstElementId} and {actual.SecondElementId} remained joined after unjoin.");
                break;
            case "switch_order":
                if (!actual.IsJoinedAfter)
                    throw Invalid($"Native elements {actual.FirstElementId} and {actual.SecondElementId} lost join during switch_order.");
                if (!actual.NoOp && actual.FirstWasCuttingBefore is bool before && actual.FirstIsCuttingAfter is bool after && before == after)
                    throw Invalid($"Native join cut order between {actual.FirstElementId} and {actual.SecondElementId} did not change.");
                break;
            default:
                throw Invalid($"Unknown join_geometry action '{actual.Action}'.");
        }
    }

    private static (string Canonical, long? Id) ParseElementRef(JsonElement op, string field)
    {
        if (!op.TryGetProperty(field, out var value))
            throw Invalid($"join_geometry: {field} is required.");
        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var id) && id > 0 && id <= MaxSafeInteger)
            return ($"id:{id}", id);
        if (value.ValueKind == JsonValueKind.String && value.GetString() is { } text &&
            text.Length is >= 2 and <= 81 && text.StartsWith('@') && !string.IsNullOrWhiteSpace(text[1..]))
            return ($"ref:{text}", null);
        throw Invalid($"join_geometry {field} must be a positive safe native ID or @reference to an earlier operation.");
    }
}
