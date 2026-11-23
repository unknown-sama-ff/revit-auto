using System.Text.Json;
using RevitAutoV27;

internal static class FamilyHostGeometryRulesTests
{
    private static JsonElement Operation(string operationType, string extra = "") =>
        JsonDocument.Parse("{\"operationType\":\"" + operationType + "\"" + extra + "}").RootElement.Clone();
    private static JsonElement Hosted(string host = "7", string extra = "") =>
        Operation("create_family_instance", ",\"id\":\"switch\",\"hostElementId\":" + host + extra);
    private static FamilyHostGeometryProbe Projected(double x = 43500, double y = 1050, double z = 1400, double targetY = 950) =>
        new("available", null, new(new(x, y, z), new(x, targetY, z), Math.Abs(y - targetY), "wall-face-reference", null));
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
        test("successful wall host preflight exposes the full 100mm projection with legacy defaults", () =>
        {
            var operation = Hosted(); var original = operation.GetRawText();
            var result = FamilyHostGeometryRules.Preflight([operation], _ => Projected());
            var row = result.Entries.Single();
            if (row.OperationIndex != 1 || row.OperationId != "switch" || row.HostElementId.GetInt64() != 7 ||
                row.HostSide != "interior" || row.HostToleranceMm != 500 || row.Status != "available" || row.Reason is not null ||
                row.RequestedPoint != new FamilyHostGeometryPoint(43500, 1050, 1400) ||
                row.ProjectedPoint != new FamilyHostGeometryPoint(43500, 950, 1400) || row.ProjectionDistanceMm != 100 ||
                row.StableFaceReference != "wall-face-reference" || !row.PreflightOnly || row.FinalPlacementVerified ||
                !result.PreflightOnly || result.FinalPlacementVerified || result.Truncated || result.TotalEntryCount != 1)
                throw new Exception("Successful projection evidence was missing, changed or overstated.");
            if (operation.GetRawText() != original) throw new Exception("Preflight modified reviewed operations.");
        });
        test("near zero coordinates retain their full precision and explicit exterior settings", () =>
        {
            const double tiny = 0.00000000000019;
            var result = FamilyHostGeometryRules.Preflight([Hosted(extra: ",\"hostSide\":\"exterior\",\"hostToleranceMm\":0.25")],
                _ => Projected(tiny, tiny, -tiny, 0));
            var row = result.Entries.Single();
            var json = JsonSerializer.SerializeToElement(result, JsonDefaults.Options);
            var captured = json.GetProperty("entries")[0];
            if (row.HostSide != "exterior" || row.HostToleranceMm != 0.25 ||
                captured.GetProperty("requestedPoint").GetProperty("xMm").GetDouble() != tiny ||
                row.ProjectedPoint?.Xmm != tiny || row.RequestedPoint?.Zmm != -tiny || row.ProjectionDistanceMm != tiny)
                throw new Exception("Projection coordinates or distance were rounded or normalized.");
        });
        test("future hosts and changed prefixes never call current geometry or expose fabricated projection", () =>
        {
            var calls = 0;
            FamilyHostGeometryProbe Inspect(JsonElement _) { calls++; return Projected(); }
            var future = FamilyHostGeometryRules.Preflight([Hosted("\"@future-wall\"")], Inspect).Entries.Single();
            var prefix = FamilyHostGeometryRules.Preflight([Operation("set_parameter"), Hosted()], Inspect).Entries.Single();
            if (calls != 0 || future.Reason != "host-not-materialized" || prefix.Reason != "preceding-operation-may-change-host-geometry" ||
                future.Status != "deferred" || prefix.Status != "deferred" || prefix.OperationIndex != 2 ||
                future.ProjectedPoint is not null || prefix.ProjectedPoint is not null ||
                future.ProjectionDistanceMm is not null || prefix.StableFaceReference is not null)
                throw new Exception("Future geometry was represented by current native evidence.");
        });
        test("view prefix permits the first current host but the hosted operation defers the next", () =>
        {
            var calls = 0;
            var rows = FamilyHostGeometryRules.Preflight([Operation("configure_view"), Hosted(), Hosted()], _ => { calls++; return Projected(); }).Entries;
            if (calls != 1 || rows.Length != 2 || rows[0].OperationIndex != 2 || rows[0].Status != "available" ||
                rows[1].OperationIndex != 3 || rows[1].Status != "deferred")
                throw new Exception("Host geometry prefix boundary moved.");
        });
        test("unavailable and deferred type evidence cannot carry an apparent successful projection", () =>
        {
            foreach (var status in new[] { "unavailable", "deferred" })
            {
                var row = FamilyHostGeometryRules.Preflight([Hosted()], _ => new(status, "family-type-not-materialized", Projected().Projection)).Entries.Single();
                if (row.Status != status || row.Reason != "family-type-not-materialized" || row.ProjectedPoint is not null ||
                    row.RequestedPoint is not null || row.ProjectionDistanceMm is not null || row.StableFaceReference is not null)
                    throw new Exception("Unavailable native evidence was fabricated.");
            }
            var empty = FamilyHostGeometryRules.Preflight([Operation("create_family_instance"),
                Operation("create_family_instance", ",\"placementMode\":\"legacyPoint\"")], _ => throw new Exception("No face-based host expected."));
            if (empty.TotalEntryCount != 0 || empty.Entries.Length != 0) throw new Exception("Unhosted legacy scope changed.");
        });
        test("bounded host preflight discloses omitted rows while later native errors remain visible", () =>
        {
            var operations = Enumerable.Range(0, FamilyHostGeometryRules.MaxPreflightEntries + 1).Select(_ => Hosted("\"@future\"")).ToArray();
            var result = FamilyHostGeometryRules.Preflight(operations, _ => throw new Exception("Future host must not be queried."));
            if (result.Entries.Length != FamilyHostGeometryRules.MaxPreflightEntries || !result.Truncated ||
                result.TotalEntryCount != operations.Length || result.Entries[^1].OperationIndex != FamilyHostGeometryRules.MaxPreflightEntries)
                throw new Exception("Preflight output cap concealed completeness.");
            var first = Hosted();
            try { FamilyHostGeometryRules.Preflight([first], _ => throw new BridgeException("invalid_operation", "existing native geometry failure")); }
            catch (BridgeException e) when (e.Code == "invalid_operation") { return; }
            throw new Exception("Existing preflight refusal was swallowed.");
        });
        test("unavailable or oversized stable references remain optional without truncating to a false identity", () =>
        {
            var projection = Projected().Projection!;
            var row = FamilyHostGeometryRules.Preflight([Hosted()], _ => new("available", null,
                projection with { StableFaceReference = new string('x', FamilyHostGeometryRules.MaxStableReferenceLength + 1) })).Entries.Single();
            if (row.StableFaceReference is not null || row.StableFaceReferenceUnavailableReason != "stable-reference-exceeds-output-bound" || row.ProjectedPoint is null)
                throw new Exception("Oversized stable face reference was misrepresented.");
            row = FamilyHostGeometryRules.Preflight([Hosted()], _ => new("available", null,
                projection with { StableFaceReference = null, StableFaceReferenceUnavailableReason = "stable-reference-unavailable" })).Entries.Single();
            if (row.StableFaceReference is not null || row.StableFaceReferenceUnavailableReason != "stable-reference-unavailable" || row.Status != "available")
                throw new Exception("Optional reference failure erased valid projection evidence.");
        });
        test("model plan publishes host preflight without changing original operation content", () =>
        {
            var operation = Hosted();
            var evidence = FamilyHostGeometryRules.Preflight([operation], _ => Projected());
            var plan = new ModelPlan { DocumentIdentity = "doc", DocumentRevision = 0, Summary = "preview", Operations = [operation], FamilyHostGeometryPreflight = evidence };
            var view = JsonSerializer.SerializeToElement(plan.View(), JsonDefaults.Options);
            if (view.GetProperty("operations")[0].GetRawText() != JsonSerializer.SerializeToElement(operation, JsonDefaults.Options).GetRawText() ||
                view.GetProperty("familyHostGeometryPreflight").GetProperty("entries")[0].GetProperty("projectionDistanceMm").GetDouble() != 100)
                throw new Exception("Model plan lost additive evidence or rewrote its operations.");
        });
    }
}
