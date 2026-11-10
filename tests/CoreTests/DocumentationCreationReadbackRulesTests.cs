using RevitAutoV27;
using System.Text.Json;

internal static class DocumentationCreationReadbackRulesTests
{
    private static void Reject(Action action)
    {
        try { action(); }
        catch (BridgeException error) when (error.Code == "invalid_documentation_readback") { return; }
        throw new Exception("Expected invalid_documentation_readback.");
    }

    public static void Run(Action<string, Action> test)
    {
        test("tag head observation preserves distinct head and generic location without projection", () =>
        {
            var head = new TagPosition(34000, 4200, 0);
            var generic = new TagPosition(34000, 3000, 1200);
            var snapshot = TagPositionSnapshotRules.Capture(() => head, () => generic, () => true);
            if (snapshot.HeadPosition.State != "known" || snapshot.HeadPosition.Value != head ||
                snapshot.GenericLocationPoint.Value != generic || snapshot.HasLeader.Value != true)
                throw new Exception("Head and generic locations must remain separate native observations.");
        });
        test("tag head getter failure never falls back to a readable generic location", () =>
        {
            var point = new TagPosition(1, 2, 3);
            var snapshot = TagPositionSnapshotRules.Capture(() => throw new InvalidOperationException("native"), () => point, () => true);
            if (snapshot.HeadPosition.State != "unknown" || snapshot.HeadPosition.Value.HasValue ||
                snapshot.HeadPosition.ErrorType != nameof(InvalidOperationException) || snapshot.GenericLocationPoint.Value != point)
                throw new Exception("A failed head read must not be replaced by generic coordinates.");
        });
        test("generic tag location failure does not hide the known head position", () =>
        {
            var point = new TagPosition(-5, 2, 0);
            var snapshot = TagPositionSnapshotRules.Capture(() => point, () => throw new InvalidOperationException(), () => false);
            if (snapshot.HeadPosition.Value != point || snapshot.GenericLocationPoint.State != "unknown" ||
                snapshot.HasLeader.State != "known" || snapshot.HasLeader.Value != false)
                throw new Exception("Independent native observations must not mask each other.");
        });
        test("missing tag points are unavailable rather than a fabricated origin", () =>
        {
            var snapshot = TagPositionSnapshotRules.Capture(() => null, () => null, () => false);
            if (snapshot.HeadPosition.State != "unavailable" || snapshot.HeadPosition.Value.HasValue ||
                snapshot.GenericLocationPoint.Value.HasValue || snapshot.GenericLocationPoint.State != "unavailable")
                throw new Exception("Missing points cannot become known zero coordinates.");
        });
        test("tag head observations reject every nonfinite axis without changing other fields", () =>
        {
            var finite = new TagPosition(1, 2, 3);
            foreach (var bad in new[] { double.NaN, double.PositiveInfinity, double.NegativeInfinity })
            foreach (var invalid in new[] { new TagPosition(bad, 2, 3), new TagPosition(1, bad, 3), new TagPosition(1, 2, bad) })
            {
                var head = TagPositionSnapshotRules.Capture(() => invalid, () => finite, () => true);
                var generic = TagPositionSnapshotRules.Capture(() => finite, () => invalid, () => false);
                if (head.HeadPosition.State != "unknown" || head.HeadPosition.Value.HasValue || head.GenericLocationPoint.Value != finite ||
                    generic.GenericLocationPoint.State != "unknown" || generic.GenericLocationPoint.Value.HasValue || generic.HeadPosition.Value != finite)
                    throw new Exception("Nonfinite native points must remain unknown with no coordinate repair.");
            }
        });
        test("known false tag leader survives JSON while unknown leader has no false value", () =>
        {
            var noLeader = TagPositionSnapshotRules.Capture(() => new TagPosition(0, 0, 0), () => null, () => false);
            var unknown = TagPositionSnapshotRules.Capture(() => new TagPosition(0, 0, 0), () => null, () => throw new InvalidOperationException());
            var knownJson = JsonSerializer.SerializeToElement(noLeader, JsonDefaults.Options).GetProperty("hasLeader");
            var unknownJson = JsonSerializer.SerializeToElement(unknown, JsonDefaults.Options).GetProperty("hasLeader");
            if (knownJson.GetProperty("state").GetString() != "known" || knownJson.GetProperty("value").GetBoolean() ||
                unknownJson.GetProperty("state").GetString() != "unknown" || unknownJson.TryGetProperty("value", out _))
                throw new Exception("Unknown leader state cannot masquerade as false.");
        });
        test("tag position snapshot reads each native property exactly once", () =>
        {
            int heads = 0, locations = 0, leaders = 0;
            TagPositionSnapshotRules.Capture(() => { heads++; return new TagPosition(1, 2, 3); },
                () => { locations++; return new TagPosition(4, 5, 6); }, () => { leaders++; return true; });
            if (heads != 1 || locations != 1 || leaders != 1) throw new Exception("Native getter count changed.");
        });
        test("tag position JSON preserves millimeter keys and unrounded finite values", () =>
        {
            var point = new TagPosition(-0.000000123456, 4200.123456789, 1200.0000000001);
            var snapshot = TagPositionSnapshotRules.Capture(() => point, () => null, () => true);
            var json = JsonSerializer.SerializeToElement(snapshot, JsonDefaults.Options).GetProperty("headPosition").GetProperty("value");
            if (json.GetProperty("xMm").GetDouble() != point.Xmm || json.GetProperty("yMm").GetDouble() != point.Ymm ||
                json.GetProperty("zMm").GetDouble() != point.Zmm) throw new Exception("Native coordinates were rounded or renamed.");
        });
        TagTargetReadback Target(string kind = "RoomTag") => new(10, kind, 20, 30, false,
            new[] { new TagTargetReference(40, -1, -1) });
        void RejectTarget(Action action)
        {
            try { action(); }
            catch (BridgeException error) when (error.Code == "invalid_tag_target") { return; }
            throw new Exception("Expected invalid_tag_target.");
        }
        test("tag target accepts exactly the requested local room or independent target", () =>
        {
            foreach (var kind in new[] { "RoomTag", "IndependentTag" })
            {
                var expected = Target(kind);
                TagTargetRules.Require(expected, expected with { Targets = new[] { new TagTargetReference(40, -1, -1) } });
            }
        });
        test("tag target rejects replaced identity wrong class view type or orphaned tags", () =>
        {
            foreach (var kind in new[] { "RoomTag", "IndependentTag" })
            {
                var expected = Target(kind);
                foreach (var actual in new[] { expected with { TagId = 11 }, expected with { ClassName = "TextNote" },
                    expected with { ViewId = 21 }, expected with { TypeId = 31 }, expected with { IsOrphaned = true } })
                    RejectTarget(() => TagTargetRules.Require(expected, actual));
            }
        });
        test("tag target rejects wrong missing extra duplicate linked and unknown associations", () =>
        {
            var expected = Target();
            foreach (var targets in new IReadOnlyList<TagTargetReference>[] {
                Array.Empty<TagTargetReference>(), new[] { new TagTargetReference(41, -1, -1) },
                new[] { new TagTargetReference(40, -1, -1), new TagTargetReference(41, -1, -1) },
                new[] { new TagTargetReference(40, -1, -1), new TagTargetReference(40, -1, -1) },
                new[] { new TagTargetReference(-1, 40, 40) }, new[] { new TagTargetReference(40, 50, -1) },
                new[] { new TagTargetReference(40, -1, 50) }, new[] { new TagTargetReference(-1, -1, -1) } })
                RejectTarget(() => TagTargetRules.Require(expected, expected with { Targets = targets }));
            RejectTarget(() => TagTargetRules.Require(expected, expected with { Targets = null! }));
        });
        test("invalid tag target expectations cannot certify themselves", () =>
        {
            var expected = Target();
            foreach (var invalid in new[] { expected with { TagId = 0 }, expected with { ViewId = -1 },
                expected with { TypeId = 0 }, expected with { ClassName = "TextNote" }, expected with { IsOrphaned = true },
                expected with { Targets = Array.Empty<TagTargetReference>() }, expected with { Targets = null! },
                expected with { Targets = new[] { new TagTargetReference(40, 50, -1) } },
                expected with { Targets = new[] { new TagTargetReference(40, -1, 50) } },
                expected with { Targets = new[] { new TagTargetReference(0, -1, -1) } } })
                RejectTarget(() => TagTargetRules.Require(invalid, invalid));
        });
        test("tag target receipts report association without claiming geometry or whole-model acceptance", () =>
        {
            var expected = Target();
            foreach (var phase in new[] { "immediate-after-creation", "before-transaction-commit", "after-transaction-commit" })
            {
                var receipt = JsonSerializer.SerializeToElement(TagTargetRules.Receipt(expected, expected, phase), JsonDefaults.Options);
                if (receipt.GetProperty("phase").GetString() != phase || receipt.GetProperty("targetElementId").GetInt64() != 40 ||
                    !receipt.GetProperty("targetAssociationVerified").GetBoolean() || !receipt.GetProperty("nativeReadbackVerified").GetBoolean())
                    throw new Exception("Tag target receipt lost native association evidence.");
                foreach (var flag in new[] { "geometryVerified", "sideEffectsVerified", "persistenceVerified", "visualVerified", "isOrphaned" })
                    if (receipt.GetProperty(flag).GetBoolean()) throw new Exception("Tag target receipt overclaimed " + flag);
                RejectTarget(() => TagTargetRules.Receipt(expected, expected with { TypeId = 31 }, phase));
            }
        });
        test("tag leader input distinguishes omitted true false and rejects coercion", () =>
        {
            JsonElement Json(string s) => JsonDocument.Parse(s).RootElement.Clone();
            if (TagLeaderRules.Requested(Json("{}")) is not null || TagLeaderRules.Requested(Json("{\"leader\":true}")) != true ||
                TagLeaderRules.Requested(Json("{\"leader\":false}")) != false) throw new Exception("Tag leader boolean contract changed.");
            foreach (var value in new[] { "null", "0", "\"true\"", "{}", "[]" })
            {
                try { PlanRules.Validate(Json("[{\"operationType\":\"create_tag\",\"elementId\":10,\"viewId\":20,\"xMm\":0,\"yMm\":0,\"leader\":" + value + "}]")); }
                catch (BridgeException e) when (e.Code == "invalid_tag_leader") { continue; }
                throw new Exception("Tag leader accepted coercion: " + value);
            }
        });
        test("tag leader readback binds identity class view and the requested boolean", () =>
        {
            var expected = new TagLeaderReadback(10, "RoomTag", 20, true);
            TagLeaderRules.Require(expected, expected);
            TagLeaderRules.Require(expected with { ClassName = "IndependentTag", HasLeader = false }, expected with { ClassName = "IndependentTag", HasLeader = false });
            foreach (var actual in new[] { expected with { TagId = 11 }, expected with { ClassName = "IndependentTag" },
                expected with { ViewId = 21 }, expected with { HasLeader = false } })
            {
                try { TagLeaderRules.Require(expected, actual); }
                catch (BridgeException e) when (e.Code == "invalid_tag_leader") { continue; }
                throw new Exception("Tag leader mismatch was accepted.");
            }
        });
        test("tag leader evidence preserves actual values and independent acceptance gates", () =>
        {
            var expected = new TagLeaderReadback(10, "RoomTag", 20, false);
            var r = JsonSerializer.SerializeToElement(TagLeaderRules.Receipt(expected, expected, "after-transaction-commit"), JsonDefaults.Options);
            if (r.GetProperty("requestedLeader").GetBoolean() || r.GetProperty("actualLeader").GetBoolean() ||
                !r.GetProperty("nativeReadbackVerified").GetBoolean() || r.GetProperty("sideEffectsVerified").GetBoolean() ||
                r.GetProperty("persistenceVerified").GetBoolean() || r.GetProperty("visualVerified").GetBoolean())
                throw new Exception("Tag leader evidence overstated acceptance.");
        });
        test("sheet creation evidence keeps title-block type separate from instance membership", () =>
        {
            if (typeof(DocumentationSheetCreationReadback).GetProperty("RequestedTitleBlockTypeId") is null ||
                typeof(DocumentationSheetCreationReadback).GetProperty("TitleBlockIds") is null ||
                typeof(DocumentationSheetCreationReadback).GetProperty("TitleBlockTypeIds") is null)
                throw new Exception("Sheet creation readback must distinguish the requested title-block symbol type from created instance IDs.");
        });
        test("sheet creation readback preserves native identity and title block membership", () =>
        {
            var expected = new DocumentationSheetCreationReadback(10, "ViewSheet", "E101", "Lighting", 300, new long[] { 30 }, new long[] { 300 });
            DocumentationCreationReadbackRules.RequireSheet(expected, expected);
            Reject(() => DocumentationCreationReadbackRules.RequireSheet(expected, expected with { ClassName = "ViewPlan" }));
            Reject(() => DocumentationCreationReadbackRules.RequireSheet(expected, expected with { Number = "E102" }));
            Reject(() => DocumentationCreationReadbackRules.RequireSheet(expected, expected with { Name = "Other" }));
            Reject(() => DocumentationCreationReadbackRules.RequireSheet(expected, expected with { TitleBlockIds = Array.Empty<long>() }));
        });
        test("sheet creation readback rejects invalid or unbounded evidence", () =>
        {
            var expected = new DocumentationSheetCreationReadback(10, "ViewSheet", "E101", "Lighting", 300, new long[] { 30 }, new long[] { 300 });
            Reject(() => DocumentationCreationReadbackRules.RequireSheet(expected, expected with { SheetId = 0 }));
            Reject(() => DocumentationCreationReadbackRules.RequireSheet(expected, expected with { Number = "" }));
            Reject(() => DocumentationCreationReadbackRules.RequireSheet(expected, expected with { TitleBlockIds = new long[] { 30, 30 } }));
        });
        test("created placement readback preserves class owner source and paper XY", () =>
        {
            var expected = new DocumentationPlacementReadback(10, "Viewport", 20, 30, 420, 280, 0);
            DocumentationCreationReadbackRules.RequireViewport(expected, expected with { Zmm = 99 });
            Reject(() => DocumentationCreationReadbackRules.RequireViewport(expected, expected with { ClassName = "ScheduleSheetInstance" }));
            Reject(() => DocumentationCreationReadbackRules.RequireViewport(expected, expected with { SheetId = 21 }));
            Reject(() => DocumentationCreationReadbackRules.RequireViewport(expected, expected with { Xmm = 422 }));
        });
        test("created placement class follows the native source view kind", () =>
        {
            if (DocumentationCreationReadbackRules.ExpectedPlacementClass("ViewPlan") != "Viewport" ||
                DocumentationCreationReadbackRules.ExpectedPlacementClass("ViewSchedule") != "ScheduleSheetInstance" ||
                DocumentationCreationReadbackRules.ExpectedPlacementClass("PanelScheduleView") != "PanelScheduleSheetInstance" ||
                DocumentationCreationReadbackRules.ExpectedPlacementClass("UnknownView") != "Viewport")
                throw new Exception("Created placement class mapping does not preserve native Viewport, schedule and panel schedule semantics.");
        });
    }
}
