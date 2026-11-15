using System.Text.Json;

namespace RevitAutoV27;

internal static class FamilyHostGeometryRules
{
    // Conservative prefix policy: never validate a future host surface against
    // stale present geometry after a possible model/host edit.
    internal static bool PreservesCurrentHostGeometry(JsonElement operation) =>
        JsonDefaults.String(operation, "operationType") switch
        {
            "create_view_plan" or "configure_view" or "create_schedule" or
            "create_panel_schedule" or "create_sheet" or "place_viewport" or
            "move_drawing_placement" or "move_viewport_label" => true,
            "create_family_instance" =>
                JsonDefaults.String(operation, "placementMode") == "legacyPoint" &&
                !JsonDefaults.Has(operation, "hostElementId"),
            _ => false
        };
}
