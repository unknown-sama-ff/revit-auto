using RevitAutoV27;
using System.Text.Json;

internal static class MultiportFittingReadbackRulesTests
{
    private static MultiportFittingCreationBinding Expected(string kind = "tee", string domain = "DomainPiping") => new(
        100, "created-fitting", 200, domain == "DomainPiping" ? "OST_PipeFitting" : "OST_DuctFitting", kind,
        Enumerable.Range(0, kind == "cross" ? 4 : 3)
            .Select(i => new FittingEndpointBinding(10 + i, "owner-" + i, i, domain, "End")).ToArray());
    private static MultiportFittingConnectionReadback Actual(MultiportFittingCreationBinding e) => new(
        e.FittingId, e.UniqueId, e.TypeId, e.Category,
        e.Endpoints.Select((p, i) => new FittingPortReadback(30 + i, p.Domain, "End")).ToArray(),
        e.Endpoints.Select((p, i) => new FittingEndReadback(p, [new(30 + i, true, true)])).ToArray());
    private static void Reject(Action action)
    {
        try { action(); } catch (BridgeException error) when (error.Code == "invalid_fitting_readback") { return; }
        throw new Exception("Expected invalid_fitting_readback.");
    }
    private static IEnumerable<int[]> Permutations(int count)
    {
        IEnumerable<int[]> Permute(int[] prefix, int[] rest)
        {
            if (rest.Length == 0) { yield return prefix; yield break; }
            foreach (var next in rest)
            foreach (var result in Permute([.. prefix, next], rest.Where(i => i != next).ToArray())) yield return result;
        }
        return Permute([], Enumerable.Range(0, count).ToArray());
    }
    private static MultiportFittingConnectionReadback ChangeEnd(MultiportFittingConnectionReadback actual, int index,
        Func<FittingEndReadback, FittingEndReadback> change) => actual with
        { Endpoints = actual.Endpoints.Select((e, i) => i == index ? change(e) : e).ToArray() };
    internal static void Run(Action<string, Action> test)
    {
        test("multiport accepts tee and cross pipe/duct bijections for every port order and mapping", () =>
        {
            foreach (var kind in new[] { "tee", "cross" })
            foreach (var domain in new[] { "DomainPiping", "DomainHvac" })
            {
                var e = Expected(kind, domain); var a = Actual(e);
                foreach (var permutation in Permutations(e.Endpoints.Length))
                {
                    var mapped = a with { Endpoints = a.Endpoints.Select((end, i) => end with
                        { Links = [new(a.Ports[permutation[i]].ConnectorId, true, true)] }).ToArray() };
                    MultiportFittingReadbackRules.Require(e, mapped);
                    MultiportFittingReadbackRules.Require(e, mapped with { Ports = permutation.Select(i => a.Ports[i]).ToArray() });
                }
                MultiportFittingReadbackRules.Require(e, a with { Ports = a.Ports.Select(p => p with { ConnectorType = "Curve" }).ToArray() });
            }
        });
        test("multiport preserves every caller endpoint order and rejects silent readback reordering", () =>
        {
            foreach (var kind in new[] { "tee", "cross" })
            {
                var original = Expected(kind); var a = Actual(original);
                foreach (var permutation in Permutations(original.Endpoints.Length))
                {
                    var expected = original with { Endpoints = permutation.Select(i => original.Endpoints[i]).ToArray() };
                    var reordered = a with { Endpoints = permutation.Select(i => a.Endpoints[i]).ToArray() };
                    MultiportFittingReadbackRules.Require(expected, reordered);
                    if (!permutation.SequenceEqual(Enumerable.Range(0, permutation.Length)))
                        Reject(() => MultiportFittingReadbackRules.Require(original, reordered));
                }
            }
        });
        test("multiport rejects unsupported kind null and wrong input cardinality", () =>
        {
            var e = Expected();
            foreach (var kind in new[] { "union", "elbow", "transition", "Tee", "", null! })
                Reject(() => MultiportFittingReadbackRules.RequireInput(kind, e.Endpoints));
            foreach (var endpoints in new FittingEndpointBinding[][] { null!, [], [e.Endpoints[0]],
                [.. e.Endpoints, new(14, "owner-4", 4, "DomainPiping", "End")], [null!, e.Endpoints[1], e.Endpoints[2]] })
                Reject(() => MultiportFittingReadbackRules.RequireInput("tee", endpoints));
            Reject(() => MultiportFittingReadbackRules.RequireInput("cross", e.Endpoints));
            Reject(() => MultiportFittingReadbackRules.RequireBinding(null!));
        });
        test("multiport rejects duplicate owners incomplete endpoints and mixed domains at every position", () =>
        {
            foreach (var kind in new[] { "tee", "cross" })
            {
                var e = Expected(kind);
                foreach (var index in Enumerable.Range(0, e.Endpoints.Length))
                {
                    foreach (var bad in new[] { e.Endpoints[index] with { OwnerId = 0 }, e.Endpoints[index] with { OwnerId = -1 },
                        e.Endpoints[index] with { OwnerId = 9007199254740992 }, e.Endpoints[index] with { OwnerUniqueId = " " },
                        e.Endpoints[index] with { ConnectorId = -1 }, e.Endpoints[index] with { Domain = "DomainHvac" },
                        e.Endpoints[index] with { Domain = "DomainElectrical" }, e.Endpoints[index] with { ConnectorType = "Logical" },
                        e.Endpoints[index] with { ConnectorType = "Unknown" } })
                        Reject(() => MultiportFittingReadbackRules.RequireInput(kind,
                            e.Endpoints.Select((p, i) => i == index ? bad : p).ToArray()));
                }
                for (var i = 0; i < e.Endpoints.Length; i++)
                for (var j = 0; j < e.Endpoints.Length; j++)
                {
                    if (i == j) continue;
                    foreach (var duplicate in new[] { e.Endpoints[i], e.Endpoints[j] with { OwnerId = e.Endpoints[i].OwnerId },
                        e.Endpoints[j] with { OwnerUniqueId = e.Endpoints[i].OwnerUniqueId } })
                        Reject(() => MultiportFittingReadbackRules.RequireInput(kind,
                            e.Endpoints.Select((p, index) => index == j ? duplicate : p).ToArray()));
                }
            }
        });
        test("multiport rejects invalid fitting binding identity category and endpoint self ownership", () =>
        {
            var e = Expected();
            foreach (var bad in new[] { e with { FittingId = 0 }, e with { FittingId = 9007199254740992 }, e with { TypeId = 0 },
                e with { TypeId = 9007199254740992 }, e with { UniqueId = "" }, e with { Category = "OST_DuctFitting" },
                e with { Category = "OST_MechanicalEquipment" }, e with { FittingId = e.Endpoints[0].OwnerId },
                e with { UniqueId = e.Endpoints[0].OwnerUniqueId } })
                Reject(() => MultiportFittingReadbackRules.RequireBinding(bad));
        });
        test("multiport rejects replaced fitting identity type category and missing readback endpoints", () =>
        {
            foreach (var kind in new[] { "tee", "cross" })
            {
                var e = Expected(kind); var a = Actual(e);
                foreach (var bad in new[] { null!, a with { FittingId = 101 }, a with { UniqueId = "replacement" },
                    a with { TypeId = 201 }, a with { Category = "OST_DuctFitting" }, a with { Endpoints = null! },
                    a with { Endpoints = [] }, a with { Endpoints = a.Endpoints[..^1] }, a with { Endpoints = [.. a.Endpoints, a.Endpoints[0]] } })
                    Reject(() => MultiportFittingReadbackRules.Require(e, bad));
            }
        });
        test("multiport rejects missing extra duplicate logical cross domain and invalid fitting ports", () =>
        {
            foreach (var kind in new[] { "tee", "cross" })
            {
                var e = Expected(kind); var a = Actual(e);
                foreach (var ports in new FittingPortReadback[][] { null!, [], a.Ports[..^1], [.. a.Ports, new(99, "DomainPiping", "End")] })
                    Reject(() => MultiportFittingReadbackRules.Require(e, a with { Ports = ports }));
                for (var index = 0; index < a.Ports.Length; index++)
                foreach (var bad in new[] { null!, a.Ports[index] with { ConnectorId = -1 },
                    a.Ports[index] with { ConnectorType = "Logical" }, a.Ports[index] with { Domain = "DomainHvac" },
                    a.Ports[index] with { ConnectorId = a.Ports[(index + 1) % a.Ports.Length].ConnectorId } })
                    Reject(() => MultiportFittingReadbackRules.Require(e, a with
                    { Ports = a.Ports.Select((p, i) => i == index ? bad : p).ToArray() }));
            }
        });
        test("multiport rejects mutated owner uid connector domain and connector type at every endpoint", () =>
        {
            foreach (var kind in new[] { "tee", "cross" })
            {
                var e = Expected(kind); var a = Actual(e);
                for (var index = 0; index < e.Endpoints.Length; index++)
                {
                    var endpoint = e.Endpoints[index];
                    foreach (var bad in new[] { null!, endpoint with { OwnerId = 90 }, endpoint with { OwnerUniqueId = "substitute" },
                        endpoint with { ConnectorId = 100 }, endpoint with { Domain = "DomainHvac" }, endpoint with { ConnectorType = "Curve" } })
                        Reject(() => MultiportFittingReadbackRules.Require(e, ChangeEnd(a, index, end => end with { Endpoint = bad })));
                    Reject(() => MultiportFittingReadbackRules.Require(e, ChangeEnd(a, index, _ => null!)));
                }
            }
        });
        test("multiport rejects absent one way duplicate foreign and multiply connected endpoint links", () =>
        {
            foreach (var kind in new[] { "tee", "cross" })
            {
                var e = Expected(kind); var a = Actual(e);
                for (var index = 0; index < a.Endpoints.Length; index++)
                {
                    var own = a.Endpoints[index].Links[0].FittingConnectorId;
                    var other = a.Endpoints[(index + 1) % a.Endpoints.Length].Links[0].FittingConnectorId;
                    foreach (var links in new FittingPortLink[][] { null!, [], [null!], [new(own, true, false)],
                        [new(own, false, true)], [new(own, false, false)], [new(99, true, true)], [new(-1, true, true)],
                        [new(own, true, true), new(other, true, true)], [new(own, true, true), new(own, true, true)],
                        [new(other, true, true)] })
                        Reject(() => MultiportFittingReadbackRules.Require(e, ChangeEnd(a, index, end => end with { Links = links })));
                }
            }
        });
        test("multiport receipt exposes original order roles and only bounded topology acceptance", () =>
        {
            foreach (var kind in new[] { "tee", "cross" })
            {
                var e = Expected(kind); var a = Actual(e);
                var receipt = JsonSerializer.SerializeToElement(MultiportFittingReadbackRules.Receipt(e, a, "before-assimilate"), JsonDefaults.Options);
                foreach (var property in new[] { "physicalConnectionVerified", "reciprocalConnectionVerified", "distinctFittingPortsVerified",
                    "callerEndpointOrderPreserved", "nativeReadbackVerified" })
                    if (!receipt.GetProperty(property).GetBoolean()) throw new Exception("Missing bounded topology evidence.");
                foreach (var property in new[] { "geometryVerified", "routingComplianceVerified", "systemMembershipVerified", "sideEffectsVerified",
                    "persistenceVerified", "visualVerified" })
                    if (receipt.GetProperty(property).GetBoolean()) throw new Exception("Unrelated acceptance was overstated.");
                if (receipt.GetProperty("requestedEndpoints").EnumerateArray().Select(p => p.GetProperty("ownerId").GetInt64())
                    .SequenceEqual(e.Endpoints.Select(p => p.OwnerId)) is false) throw new Exception("Caller endpoint order changed.");
                var roles = receipt.GetProperty("requestedEndpointRoles").EnumerateArray().Select(p => p.GetString()).ToArray();
                if (roles.Length != e.Endpoints.Length || (kind == "tee" ? roles[2] != "branch" : roles[2] != "second-pair-first"))
                    throw new Exception("Requested endpoint role metadata changed.");
            }
        });
        test("multiport revalidation rejects later branch disconnection and committed fitting mutation", () =>
        {
            foreach (var kind in new[] { "tee", "cross" })
            {
                var e = Expected(kind); var a = Actual(e);
                MultiportFittingReadbackRules.Receipt(e, a, "immediate-after-creation");
                MultiportFittingReadbackRules.Receipt(e, a, "before-transaction-commit");
                Reject(() => MultiportFittingReadbackRules.Receipt(e, ChangeEnd(a, a.Endpoints.Length - 1, end => end with { Links = [] }),
                    "after-transaction-commit-before-assimilate"));
                Reject(() => MultiportFittingReadbackRules.Receipt(e, a with { TypeId = 300 }, "after-transaction-commit-before-assimilate"));
            }
        });
    }
}
