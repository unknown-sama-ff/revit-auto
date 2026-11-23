using System.Text.Json;
using RevitAutoV27;

internal static class MepDisconnectsRulesTests
{
    private static JsonElement Parse(string json) => JsonDocument.Parse(json).RootElement.Clone();

    public static void Run(Action<string, Action> test)
    {
        test("mep disconnects parses defaults, domain filters, and explicit viewId", () =>
        {
            var d = MepDisconnectsRules.Parse(Parse("""{"documentIdentity":"doc-m","expectedRevision":2}"""));
            if (d.Domain != "all" || d.ViewId is not null || d.Offset != 0 || d.Limit != 50)
                throw new Exception("Unexpected disconnects defaults.");

            var custom = MepDisconnectsRules.Parse(Parse("""
            {"documentIdentity":"doc-m","expectedRevision":2,"domain":"cableTrayConduit","viewId":888,"offset":10,"limit":200}
            """));
            if (custom.Domain != "cableTrayConduit" || custom.ViewId != 888 || custom.Offset != 10 || custom.Limit != 200)
                throw new Exception("Unexpected custom disconnects parameters.");
        });

        test("mep disconnects rejects unknown domains, bad viewIds, pagination overflow, and extra keys", () =>
        {
            foreach (var bad in new[]
            {
                """{}""",
                """{"documentIdentity":"doc-m"}""",
                """{"documentIdentity":"doc-m","expectedRevision":0,"domain":"mechanical"}""",
                """{"documentIdentity":"doc-m","expectedRevision":0,"domain":"unknown"}""",
                """{"documentIdentity":"doc-m","expectedRevision":0,"viewId":0}""",
                """{"documentIdentity":"doc-m","expectedRevision":0,"viewOnly":true}""",
                """{"documentIdentity":"doc-m","expectedRevision":0,"offset":-1}""",
                """{"documentIdentity":"doc-m","expectedRevision":0,"limit":201}"""
            })
            {
                try { MepDisconnectsRules.Parse(Parse(bad)); throw new Exception("Expected rejection for " + bad); }
                catch (BridgeException ex) when (ex.Code == "invalid_mep_disconnects_request") { }
            }
        });

        test("mep disconnects separates unknown reads from open connectors and respects domain filter", () =>
        {
            var observations = new[]
            {
                new MepConnectorObservation(null, false, null, null, null, null, false), // logical/curve connector skipped
                new MepConnectorObservation(0, true, true, "DomainPiping", "Round", new(0, 0, 0), false), // connected
                new MepConnectorObservation(1, true, false, "DomainPiping", "Round", new(1000, 0, 0), false), // open piping
                new MepConnectorObservation(2, true, null, "DomainPiping", "Round", null, true), // failed IsConnected -> unknown, NOT open!
                new MepConnectorObservation(3, true, false, "DomainCableTrayConduit", "Rectangular", new(2000, 0, 0), false), // open cable tray
                new MepConnectorObservation(null, null, null, null, null, null, true) // failed ConnectorType -> unknown
            };

            var all = MepDisconnectsRules.EvaluateElement(observations, "all");
            if (all.OpenConnectors.Count != 2 || all.UnknownConnectorCount != 2)
                throw new Exception("Expected 2 open and 2 unknown connectors under domain=all.");

            var piping = MepDisconnectsRules.EvaluateElement(observations, "piping");
            if (piping.OpenConnectors.Count != 1 || piping.OpenConnectors[0].ConnectorId != 1 || piping.UnknownConnectorCount != 2)
                throw new Exception("Expected 1 open piping connector and 2 unknown reads.");

            var electrical = MepDisconnectsRules.EvaluateElement(observations, "cableTrayConduit");
            if (electrical.OpenConnectors.Count != 1 || electrical.OpenConnectors[0].ConnectorId != 3)
                throw new Exception("Expected 1 open cableTrayConduit connector.");
        });
    }
}
