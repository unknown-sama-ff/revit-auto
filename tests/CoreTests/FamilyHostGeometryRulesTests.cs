using System.Text.Json;
using RevitAutoV27;

internal static class FamilyHostGeometryRulesTests
{
    private static JsonElement Operation(string operationType, string extra = "") =>
        JsonDocument.Parse("{\"operationType\":\"" + operationType + "\"" + extra + "}").RootElement.Clone();
    internal static void Run(Action<string, Action> test)
    {
        test("host geometry preflight permits view and paper-only prefixes", () =>
        {
            foreach (var kind in new[] { "create_view_plan", "configure_view", "create_schedule", "create_panel_schedule",
                "create_sheet", "place_viewport", "move_drawing_placement", "move_viewport_label" })
                if (!FamilyHostGeometryRules.PreservesCurrentHostGeometry(Operation(kind))) throw new Exception(kind);
        });
        test("unhosted legacy point lighting preserves current wall geometry", () =>
        {
            if (!FamilyHostGeometryRules.PreservesCurrentHostGeometry(Operation("create_family_instance", ",\"placementMode\":\"legacyPoint\"")))
                throw new Exception("Unhosted point placement unexpectedly deferred face inspection.");
        });
        test("any hosted family defers subsequent current-host geometry checks", () =>
        {
            foreach (var extra in new[] { ",\"hostElementId\":7", ",\"hostElementId\":\"@wall\"",
                ",\"placementMode\":\"legacyPoint\",\"hostElementId\":7" })
                if (FamilyHostGeometryRules.PreservesCurrentHostGeometry(Operation("create_family_instance", extra)))
                    throw new Exception("A potential host cut was treated as unchanged geometry.");
        });
        test("parameter edits, type changes and geometry creation never use stale host preflight", () =>
        {
            foreach (var kind in new[] { "set_parameter", "delete_element", "load_family", "duplicate_type",
                "duplicate_architecture_type", "create_wall", "create_floor", "create_opening", "create_stair",
                "create_structural_column", "create_family_instance", "unknown_write" })
                if (FamilyHostGeometryRules.PreservesCurrentHostGeometry(Operation(kind))) throw new Exception(kind);
        });
        test("missing operation kind conservatively defers current-host inspection", () =>
        {
            if (FamilyHostGeometryRules.PreservesCurrentHostGeometry(JsonDocument.Parse("{}").RootElement.Clone()))
                throw new Exception("Unknown operation cannot certify unchanged host geometry.");
        });
    }
}
