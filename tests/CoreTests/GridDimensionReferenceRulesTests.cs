using RevitAutoV27;

internal static class GridDimensionReferenceRulesTests
{
    internal static void Run(Action<string, Action> test)
    {
        var native = new DimensionReferenceReadback("native-datum-stable", 123, -1, "REFERENCE_TYPE_NONE");
        test("grid dimension reference accepts only the exact local native datum round trip", () =>
        {
            GridDimensionReferenceRules.Require(123, native, native);
            var bounded = native with { StableReference = new string('x',4096) };
            GridDimensionReferenceRules.Require(123, bounded, bounded);
        });
        test("grid dimension reference rejects wrong target links and canonical changes", () =>
        {
            foreach(var actual in new[] { native with { ElementId = 124 }, native with { LinkedElementId = 5 },
                native with { StableReference = "other-stable" }, native with { ReferenceType = "REFERENCE_TYPE_LINEAR" } })
            {
                try { GridDimensionReferenceRules.Require(123, native, actual); }
                catch (BridgeException e) when (e.Code == "invalid_grid_dimension_reference") { continue; }
                throw new Exception("A different round-tripped datum reference was accepted.");
            }
        });
        test("grid dimension reference rejects malformed source evidence without inventing strings", () =>
        {
            foreach(var original in new[] { native with { ElementId = 0 }, native with { ElementId = 9007199254740992 },
                native with { LinkedElementId = 0 }, native with { LinkedElementId = 42 }, native with { ReferenceType = " " },
                native with { StableReference = "" }, native with { StableReference = new string('x',4097) } })
            {
                try { GridDimensionReferenceRules.Require(123, original, original); }
                catch (BridgeException e) when (e.Code == "invalid_grid_dimension_reference") { continue; }
                throw new Exception("Invalid native datum source evidence was accepted.");
            }
        });
        test("model-curve observations preserve native reference types without certifying dimension suitability", () =>
        {
            var curve = new DimensionReferenceReadback("curve-stable", 123, -1, "REFERENCE_TYPE_LINEAR");
            foreach (var type in new[] { "REFERENCE_TYPE_LINEAR", "REFERENCE_TYPE_SURFACE", "REFERENCE_TYPE_NONE" })
            {
                var observed = curve with { ReferenceType = type };
                GridDimensionReferenceRules.RequireCurveReference(123, observed, observed);
            }
            foreach (var invalid in new[]
            {
                curve with { ElementId = 124 },
                curve with { LinkedElementId = 5 },
                curve with { ReferenceType = "REFERENCE_TYPE_NONE" },
                curve with { StableReference = "changed" }
            })
            {
                try { GridDimensionReferenceRules.RequireCurveReference(123, curve, invalid); }
                catch (BridgeException error) when (error.Code == "invalid_grid_curve_reference") { continue; }
                throw new Exception("A changed model-curve reference was accepted.");
            }
        });
        test("model-curve observation rejects malformed source and cross-grid identity", () =>
        {
            var curve = new DimensionReferenceReadback("curve-stable", 123, -1, "REFERENCE_TYPE_SURFACE");
            foreach (var invalid in new[] {
                curve with { ElementId = 0 }, curve with { ElementId = 124 },
                curve with { LinkedElementId = 0 }, curve with { LinkedElementId = 9 },
                curve with { ReferenceType = " " }, curve with { StableReference = "" },
                curve with { StableReference = new string('x',4097) } })
            {
                try { GridDimensionReferenceRules.RequireCurveReference(123, invalid, invalid); }
                catch (BridgeException error) when (error.Code == "invalid_grid_curve_reference") { continue; }
                throw new Exception("Invalid model-curve source was accepted.");
            }
            var bounded = curve with { StableReference = new string('x',4096) };
            GridDimensionReferenceRules.RequireCurveReference(123, bounded, bounded);
        });
    }
}
