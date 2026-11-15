using RevitAutoV27;
using System.Text.Json;

internal static class FittingConnectionReadbackRulesTests
{
    private static FittingCreationBinding Expected() => new(100, "fitting-uid", 200, "OST_PipeFitting", "transition",
        new(10, "pipe-a", 0, "DomainPiping", "End"), new(20, "pipe-b", 1, "DomainPiping", "End"));
    private static FittingConnectionReadback Actual(FittingCreationBinding e) => new(e.FittingId, e.UniqueId, e.TypeId, e.Category,
        [new(3, e.First.Domain, "End"), new(7, e.Second.Domain, "End")],
        new(e.First, [new(3, true, true)]), new(e.Second, [new(7, true, true)]));
    private static void Reject(Action action)
    {
        try { action(); } catch (BridgeException e) when (e.Code == "invalid_fitting_readback") { return; }
        throw new Exception("Expected invalid_fitting_readback.");
    }
    internal static void Run(Action<string, Action> test)
    {
        test("fitting verifies exact reciprocal two-port bridge for pipe and duct fittings", () =>
        {
            foreach (var kind in new[] { "transition", "union", "elbow" })
            foreach (var domain in new[] { "DomainPiping", "DomainHvac" })
            {
                var p = Expected(); var e = p with { FittingKind = kind, Category = domain == "DomainPiping" ? "OST_PipeFitting" : "OST_DuctFitting",
                    First = p.First with { Domain = domain }, Second = p.Second with { Domain = domain } };
                var a = Actual(e);
                FittingConnectionReadbackRules.Require(e, a with { Ports = a.Ports.Reverse().ToArray() });
                var receipt = JsonSerializer.SerializeToElement(FittingConnectionReadbackRules.Receipt(e, a, "after-transaction-commit"), JsonDefaults.Options);
                if (!receipt.GetProperty("physicalConnectionVerified").GetBoolean() || receipt.GetProperty("sideEffectsVerified").GetBoolean() ||
                    receipt.GetProperty("geometryVerified").GetBoolean() || receipt.GetProperty("routingComplianceVerified").GetBoolean())
                    throw new Exception("Fitting topology receipt overstated unrelated acceptance.");
            }
        });
        test("fitting rejects a nearby unconnected instance or a connection on only one side", () =>
        {
            var e = Expected(); var a = Actual(e);
            foreach (var invalid in new[] { a with { First = a.First with { Links = [] } }, a with { Second = a.Second with { Links = [] } },
                a with { First = a.First with { Links = [] }, Second = a.Second with { Links = [] } } })
                Reject(() => FittingConnectionReadbackRules.Require(e, invalid));
        });
        test("fitting rejects one-way links duplicate ports extra peers and connections through another fitting", () =>
        {
            var e = Expected(); var a = Actual(e);
            foreach (var links in new FittingPortLink[][] { [new(3, false, true)], [new(3, true, false)], [new(3, false, false)],
                [new(3, true, true), new(7, true, true)], [new(99, true, true)] })
                Reject(() => FittingConnectionReadbackRules.Require(e, a with { First = a.First with { Links = links } }));
            Reject(() => FittingConnectionReadbackRules.Require(e, a with { Second = a.Second with { Links = [new(3, true, true)] } }));
            Reject(() => FittingConnectionReadbackRules.Require(e, a with { FittingId = 101 }));
        });
        test("fitting rejects substituted native owners connector ids types and equipment categories", () =>
        {
            var e = Expected(); var a = Actual(e);
            foreach (var invalid in new[] { a with { UniqueId = "replacement" }, a with { TypeId = 201 }, a with { Category = "OST_MechanicalEquipment" },
                a with { First = a.First with { Endpoint = e.First with { OwnerUniqueId = "replacement-pipe" } } },
                a with { First = a.First with { Endpoint = e.First with { OwnerId = 11 } } },
                a with { Second = a.Second with { Endpoint = e.Second with { ConnectorId = 2 } } } })
                Reject(() => FittingConnectionReadbackRules.Require(e, invalid));
        });
        test("fitting rejects logical cross-domain missing duplicate and extra physical ports", () =>
        {
            var e = Expected(); var a = Actual(e);
            foreach (var ports in new FittingPortReadback[][] { [], [a.Ports[0]], [a.Ports[0], a.Ports[0]],
                [a.Ports[0], a.Ports[1], new(8, "DomainPiping", "End")], [a.Ports[0] with { ConnectorType = "Logical" }, a.Ports[1]],
                [a.Ports[0], a.Ports[1] with { Domain = "DomainHvac" }] })
                Reject(() => FittingConnectionReadbackRules.Require(e, a with { Ports = ports }));
            Reject(() => FittingConnectionReadbackRules.Require(e with { Second = e.First }, a));
            Reject(() => FittingConnectionReadbackRules.Require(e with { FittingKind = "tee" }, a));
            foreach (var endpoint in new[] { e.First with { OwnerId = 0 }, e.First with { OwnerUniqueId = "" },
                e.First with { ConnectorId = -1 }, e.First with { Domain = "DomainElectrical" }, e.First with { ConnectorType = "Logical" } })
                Reject(() => FittingConnectionReadbackRules.RequireEndpoint(endpoint));
        });
        test("fitting final verification rejects a later disconnection after an earlier correct result", () =>
        {
            var e = Expected(); var a = Actual(e);
            FittingConnectionReadbackRules.Receipt(e, a, "immediate-after-creation");
            FittingConnectionReadbackRules.Receipt(e, a, "before-transaction-commit");
            Reject(() => FittingConnectionReadbackRules.Receipt(e, a with { Second = a.Second with { Links = [] } }, "after-transaction-commit"));
        });
    }
}
