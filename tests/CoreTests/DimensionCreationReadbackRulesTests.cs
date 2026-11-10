using RevitAutoV27;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

internal static class DimensionCreationReadbackRulesTests
{
    private static DimensionCreationReadback Expected() => new(100, "dim-uid", "Dimension", 20, 30, true,
        new(new(0, 0, 0), new(1, 0, 0)),
        [new("ref-a", 1, -1, "REFERENCE_TYPE_SURFACE"), new("ref-b", 2, -1, "REFERENCE_TYPE_SURFACE")], true);
    private static void Reject(Action action)
    {
        try { action(); }
        catch (BridgeException e) when (e.Code == "invalid_dimension_readback") { return; }
        throw new Exception("Expected invalid_dimension_readback.");
    }
    private static JsonElement FailureDetails(Action action)
    {
        try { action(); }
        catch (BridgeException error) when (error.Code == "invalid_dimension_readback" && error.Details is not null)
        { return JsonSerializer.SerializeToElement(error.Details, JsonDefaults.Options); }
        throw new Exception("Expected invalid_dimension_readback with structured mismatch details.");
    }
    private static string Sha256(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
    internal static void Run(Action<string, Action> test)
    {
        test("dimension readback accepts the actual Revit 2027 LinearDimension class without losing exact class binding", () =>
        {
            // Five captured native samples (2292811/2292832/2292855/2295304/2295312) use this runtime class.
            var native = Expected() with { ClassName = "LinearDimension" };
            DimensionCreationReadbackRules.RequireStructure(native);
            DimensionCreationReadbackRules.Require(native, native);
            var receipt = JsonSerializer.SerializeToElement(DimensionCreationReadbackRules.Receipt(native, native, "after-transaction-commit"), JsonDefaults.Options);
            if (receipt.GetProperty("className").GetString() != "LinearDimension")
                throw new Exception("Native class evidence was normalized to the old base class.");
            Reject(() => DimensionCreationReadbackRules.Require(native, native with { ClassName = "Dimension" }));
            foreach (var other in new[] { "AngularDimension", "RadialDimension", "DiameterDimension", "SpotDimension", "UnknownDimension" })
                Reject(() => DimensionCreationReadbackRules.RequireStructure(native with { ClassName = other }));
        });
        test("dimension readback verifies the supporting line independent of native bound extents and orientation", () =>
        {
            var expected = Expected();
            var actual = expected with { Axis = new(new(500, 0, 0), new(-1, 0, 0)), IsBound = false };
            DimensionCreationReadbackRules.Require(expected, actual);
            var receipt = JsonSerializer.SerializeToElement(DimensionCreationReadbackRules.Receipt(expected, actual, "after-transaction-commit"), JsonDefaults.Options);
            if (!receipt.GetProperty("supportingLineVerified").GetBoolean() || receipt.GetProperty("lineExtentsVerified").GetBoolean() ||
                receipt.GetProperty("measurementVerified").GetBoolean() || receipt.GetProperty("sideEffectsVerified").GetBoolean() ||
                receipt.GetProperty("persistenceVerified").GetBoolean() || receipt.GetProperty("visualVerified").GetBoolean())
                throw new Exception("Receipt overstated its verified geometry scope.");
        });
        test("dimension rejects wrong identity native class type view and unresolved references", () =>
        {
            var expected = Expected();
            foreach (var actual in new[] { expected with { DimensionId = 101 }, expected with { UniqueId = "replaced" },
                expected with { ClassName = "SpotDimension" }, expected with { TypeId = 31 }, expected with { ViewId = 21 },
                expected with { AreReferencesAvailable = false } })
                Reject(() => DimensionCreationReadbackRules.Require(expected, actual));
        });
        test("dimension mismatch diagnostics identify failed fields without exposing stable reference strings", () =>
        {
            var expected = Expected(); var first = expected.References[0]; var second = expected.References[1];
            var cases = new (string Field, DimensionCreationReadback Actual)[]
            {
                ("dimensionId", expected with { DimensionId = 101 }),
                ("uniqueId", expected with { UniqueId = "replacement" }),
                ("className", expected with { ClassName = "LinearDimension" }),
                ("viewId", expected with { ViewId = 21 }),
                ("typeId", expected with { TypeId = 31 }),
                ("areReferencesAvailable", expected with { AreReferencesAvailable = false }),
                ("referenceMembership", expected with { References = [first, second with { StableReference = "private-reference" }] })
            };
            foreach (var (field, actual) in cases)
            {
                var details = FailureDetails(() => DimensionCreationReadbackRules.Require(expected, actual));
                var fields = details.GetProperty("mismatchFields").EnumerateArray().Select(value => value.GetString()).ToArray();
                if (!fields.SequenceEqual([field])) throw new Exception($"Expected only the {field} diagnostic.");
                var json = details.GetRawText();
                if (json.Contains("dim-uid", StringComparison.Ordinal) || json.Contains("replacement", StringComparison.Ordinal))
                    throw new Exception("Mismatch diagnostics exposed a raw UniqueId.");
                if (details.GetProperty("expected").GetProperty("uniqueIdSha256").GetString() != Sha256(expected.UniqueId) ||
                    details.GetProperty("actual").GetProperty("uniqueIdSha256").GetString() != Sha256(actual.UniqueId))
                    throw new Exception("UniqueId diagnostic fingerprints do not match the native evidence.");
                var expectedReferences = details.GetProperty("expected").GetProperty("references");
                var actualReferences = details.GetProperty("actual").GetProperty("references");
                if (expectedReferences.GetArrayLength() != expected.References.Count || actualReferences.GetArrayLength() != actual.References.Count)
                    throw new Exception("Reference diagnostics dropped members.");
                if (json.Contains("ref-a", StringComparison.Ordinal) || json.Contains("ref-b", StringComparison.Ordinal) ||
                    json.Contains("private-reference", StringComparison.Ordinal))
                    throw new Exception("Mismatch diagnostics exposed raw stable-reference strings.");
                var orderedExpectedReferences = expected.References.OrderBy(reference => reference.StableReference, StringComparer.Ordinal).ToArray();
                var orderedActualReferences = actual.References.OrderBy(reference => reference.StableReference, StringComparer.Ordinal).ToArray();
                for (var index = 0; index < orderedExpectedReferences.Length; index++)
                {
                    if (expectedReferences[index].GetProperty("stableReferenceLength").GetInt32() != orderedExpectedReferences[index].StableReference.Length ||
                        expectedReferences[index].GetProperty("stableReferenceSha256").GetString() != Sha256(orderedExpectedReferences[index].StableReference))
                        throw new Exception("Expected stable-reference diagnostic fingerprints do not match the reviewed evidence.");
                }
                for (var index = 0; index < orderedActualReferences.Length; index++)
                {
                    if (actualReferences[index].GetProperty("stableReferenceLength").GetInt32() != orderedActualReferences[index].StableReference.Length ||
                        actualReferences[index].GetProperty("stableReferenceSha256").GetString() != Sha256(orderedActualReferences[index].StableReference))
                        throw new Exception("Stable-reference diagnostic fingerprints do not match the actual evidence.");
                }
            }
        });
        test("dimension accepts reference reordering while preserving native receipt order", () =>
        {
            var expected = Expected();var actual = expected with { References = expected.References.Reverse().ToArray() };
            var receipt = JsonSerializer.SerializeToElement(DimensionCreationReadbackRules.Receipt(expected, actual, "before-transaction-commit"), JsonDefaults.Options);
            if (receipt.GetProperty("referenceOrderMatches").GetBoolean() || !receipt.GetProperty("referenceMembershipVerified").GetBoolean() ||
                receipt.GetProperty("actualReferences")[0].GetProperty("stableReference").GetString() != "ref-b")
                throw new Exception("Reordering was hidden or treated as missing membership.");
        });
        test("dimension rejects lost extra substituted duplicate or changed target references", () =>
        {
            var expected = Expected();var a = expected.References[0];var b = expected.References[1];
            foreach (var refs in new DimensionReferenceReadback[][] {
                [a], [a,b,new("ref-c",3,-1,"REFERENCE_TYPE_SURFACE")], [a,a],
                [a,b with { StableReference = "different" }], [a,b with { ElementId = 3 }],
                [a,b with { LinkedElementId = 5 }], [a,b with { ReferenceType = "REFERENCE_TYPE_LINEAR" }] })
                Reject(() => DimensionCreationReadbackRules.Require(expected, expected with { References = refs }));
        });
        test("dimension line checks perpendicular offset in full XYZ instead of comparing an arbitrary origin", () =>
        {
            var expected = Expected();
            DimensionCreationReadbackRules.Require(expected, expected with { Axis = new(new(250, 0.009, 0), new(1, 0, 0)) });
            foreach (var axis in new DimensionAxis[] { new(new(0, 0.011, 0), new(1, 0, 0)),
                new(new(0, 0, 0.011), new(1, 0, 0)), new(new(0, 0, 0), new(1, 1e-6, 0)), new(new(0,0,0),new(0,1,0)) })
                Reject(() => DimensionCreationReadbackRules.Require(expected, expected with { Axis = axis }));
        });
        test("dimension rejects nonfinite degenerate axes and unsafe evidence IDs", () =>
        {
            var expected = Expected();
            foreach (var actual in new[] { expected with { DimensionId = 0 }, expected with { ViewId = -1 },
                expected with { TypeId = 9007199254740992 }, expected with { UniqueId = " " },
                expected with { Axis = new(new(double.NaN,0,0),new(1,0,0)) },
                expected with { Axis = new(new(0,0,0),new(0,0,0)) },
                expected with { Axis = new(new(0,0,0),new(double.PositiveInfinity,0,0)) } })
                Reject(() => DimensionCreationReadbackRules.Require(expected, actual));
        });
        test("dimension reference limits preserve complete boundary-sized evidence", () =>
        {
            var refs = Enumerable.Range(1,128).Select(i => new DimensionReferenceReadback("ref-"+i,i,-1,"REFERENCE_TYPE_SURFACE")).ToArray();
            DimensionCreationReadbackRules.RequireReferences(refs);
            DimensionCreationReadbackRules.RequireReferences([refs[0] with { StableReference = new string('x',4096) },refs[1]]);
            Reject(() => DimensionCreationReadbackRules.RequireReferences(refs.Concat([new("ref-129",129,-1,"REFERENCE_TYPE_SURFACE")]).ToArray()));
            Reject(() => DimensionCreationReadbackRules.RequireReferences([refs[0] with { StableReference = new string('x',4097) },refs[1]]));
            foreach(var bad in new[] { refs[0] with { ElementId = -1 }, refs[0] with { LinkedElementId = 0 }, refs[0] with { ReferenceType = "" } })
                Reject(() => DimensionCreationReadbackRules.RequireReferences([bad,refs[1]]));
        });
        test("dimension observations may expose unavailable references but cannot certify a write", () =>
        {
            var expected = Expected();var observed = expected with { AreReferencesAvailable = false };
            DimensionCreationReadbackRules.RequireStructure(observed);
            Reject(() => DimensionCreationReadbackRules.Require(expected, observed));
            Reject(() => DimensionCreationReadbackRules.Require(observed, expected));
        });
        test("dimension repeated final verification detects a later operation changing the previously correct result", () =>
        {
            var expected = Expected();DimensionCreationReadbackRules.Receipt(expected,expected,"immediate-after-creation");
            DimensionCreationReadbackRules.Receipt(expected,expected,"before-transaction-commit");
            Reject(() => DimensionCreationReadbackRules.Receipt(expected,expected with { TypeId = 31 },"after-transaction-commit"));
        });
    }
}
