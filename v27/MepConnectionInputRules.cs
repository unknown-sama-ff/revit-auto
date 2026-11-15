using System.Text.Json;
namespace RevitAutoV27;
internal static class MepConnectionInputRules
{
    private static readonly string[] All = ["first", "second", "third", "fourth"];
    private static BridgeException Invalid(string message) => new("invalid_connection_input", message);
    internal static string[] Prefixes(JsonElement op)
    {
        if (JsonDefaults.String(op, "operationType") == "connect_elements") return All[..2];
        string kind = "elbow";
        if (op.TryGetProperty("fittingType", out var type))
            kind = type.ValueKind == JsonValueKind.String ? type.GetString()! : throw Invalid("fittingType must be a supported exact string.");
        return kind switch { "elbow" or "union" or "transition" => All[..2], "tee" => All[..3], "cross" => All[..4], _ => throw Invalid("Supported fittingType values: elbow, union, transition, tee, cross.") };
    }
    internal static string[] Validate(JsonElement op)
    {
        var active = Prefixes(op);
        foreach (var side in All.Except(active)) foreach (var suffix in new[] { "ElementId", "ConnectorId", "Connector" })
            if (op.TryGetProperty(side + suffix, out _)) throw Invalid("Unused endpoint fields are not part of this connection or fitting.");
        var owners = new HashSet<string>(StringComparer.Ordinal);
        foreach (var side in active)
        {
            PlanRules.Require(op, side + "ElementId");
            ConnectorSelectionRules.ValidateSelection(op, side);
            var owner = JsonDefaults.Get(op, side + "ElementId");
            var key = owner.ValueKind == JsonValueKind.Number && owner.TryGetInt64(out var id) ? "id:" + id : "ref:" + owner.GetRawText();
            if (!owners.Add(key)) throw Invalid("Every connection endpoint must have a distinct owner.");
        }
        if (op.TryGetProperty("allowUnassignedEquipmentPort", out var allow))
        {
            if (JsonDefaults.String(op, "operationType") != "connect_elements" || allow.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                throw Invalid("allowUnassignedEquipmentPort is an explicit boolean for connect_elements only.");
            if (allow.ValueKind == JsonValueKind.True)
                foreach (var side in active)
                    if (JsonDefaults.Get(op, side + "ElementId").ValueKind != JsonValueKind.Number || JsonDefaults.Int64(op, side + "ElementId") is not > 0)
                        throw Invalid("Known-unassigned permission requires existing inspected endpoints, not deferred elements.");
        }
        return active;
    }
}
