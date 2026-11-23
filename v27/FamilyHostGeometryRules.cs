using System.Text.Json;
using System.Text.Json.Serialization;

namespace RevitAutoV27;

internal sealed record FamilyHostGeometryPoint(
    [property: JsonPropertyName("xMm")] double Xmm,
    [property: JsonPropertyName("yMm")] double Ymm,
    [property: JsonPropertyName("zMm")] double Zmm);
internal sealed record FamilyHostGeometryProjection(FamilyHostGeometryPoint RequestedPoint,
    FamilyHostGeometryPoint ProjectedPoint, double ProjectionDistanceMm,
    string? StableFaceReference, string? StableFaceReferenceUnavailableReason);
internal sealed record FamilyHostGeometryProbe(string Status, string? Reason, FamilyHostGeometryProjection? Projection = null);
internal sealed record FamilyHostGeometryPreflightEntry(int OperationIndex, string? OperationId,
    JsonElement HostElementId, string HostSide, double HostToleranceMm, string Status, string? Reason,
    FamilyHostGeometryPoint? RequestedPoint, FamilyHostGeometryPoint? ProjectedPoint, double? ProjectionDistanceMm,
    string? StableFaceReference, string? StableFaceReferenceUnavailableReason,
    bool PreflightOnly = true, bool FinalPlacementVerified = false);
internal sealed record FamilyHostGeometryPreflight(FamilyHostGeometryPreflightEntry[] Entries,
    int TotalEntryCount, bool Truncated, bool PreflightOnly = true, bool FinalPlacementVerified = false);

internal static class FamilyHostGeometryRules
{
    internal const int MaxPreflightEntries = 128;
    internal const int MaxStableReferenceLength = 2048;
    internal static string EffectiveHostSide(JsonElement operation) =>
        JsonDefaults.StringOr(operation, "hostSide", "interior") == "exterior" ? "exterior" : "interior";
    internal static double HostToleranceMm(JsonElement operation) => JsonDefaults.Double(operation, "hostToleranceMm") ?? 500;

    // Native geometry is read only for an existing host whose complete preceding prefix
    // preserves current geometry. All eligible rows are still inspected when output is capped.
    internal static FamilyHostGeometryPreflight Preflight(IReadOnlyList<JsonElement> operations,
        Func<JsonElement, FamilyHostGeometryProbe> inspectCurrent)
    {
        var entries = new List<FamilyHostGeometryPreflightEntry>();
        var total = 0;
        var currentHostGeometryUnchanged = true;
        for (var index = 0; index < operations.Count; index++)
        {
            var operation = operations[index];
            if (JsonDefaults.String(operation, "operationType") == "create_family_instance" &&
                JsonDefaults.String(operation, "placementMode") != "legacyPoint" && JsonDefaults.Has(operation, "hostElementId"))
            {
                var host = JsonDefaults.Get(operation, "hostElementId");
                var probe = host.ValueKind == JsonValueKind.String && host.GetString()!.StartsWith('@')
                    ? new FamilyHostGeometryProbe("deferred", "host-not-materialized")
                    : !currentHostGeometryUnchanged
                        ? new FamilyHostGeometryProbe("deferred", "preceding-operation-may-change-host-geometry")
                        : inspectCurrent(operation);
                total++;
                if (entries.Count < MaxPreflightEntries)
                {
                    // Deferred/unavailable rows must never carry a current projection supplied by a caller.
                    var p = probe.Status == "available" ? probe.Projection : null;
                    var stable = p?.StableFaceReference;
                    var stableReason = p?.StableFaceReferenceUnavailableReason;
                    if (stable?.Length > MaxStableReferenceLength) { stable = null; stableReason = "stable-reference-exceeds-output-bound"; }
                    entries.Add(new(index + 1, JsonDefaults.String(operation, "id"), host.Clone(), EffectiveHostSide(operation),
                        HostToleranceMm(operation), probe.Status, probe.Reason, p?.RequestedPoint, p?.ProjectedPoint,
                        p?.ProjectionDistanceMm, stable, stableReason));
                }
            }
            currentHostGeometryUnchanged &= PreservesCurrentHostGeometry(operation);
        }
        return new(entries.ToArray(), total, total > entries.Count);
    }

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
