using System.Text.Json;
using RevitAutoV27;

internal static class ElectricalRunRulesTests
{
    private static JsonElement Parse(string json) => JsonDocument.Parse(json).RootElement.Clone();

    public static void Run(Action<string, Action> test)
    {
        test("electrical runs validate explicit cable tray and conduit contracts", () =>
        {
            var tray = ElectricalRunRules.ValidateCableTray(Parse("""
            {"operationType":"create_cable_tray","id":"ct1","cableTrayTypeId":10,"levelId":20,"start":{"xMm":0,"yMm":0,"zMm":3200},"end":{"xMm":5000,"yMm":0,"zMm":3200},"widthMm":300,"heightMm":100}
            """));
            if (tray.CableTrayTypeId != 10 || tray.WidthMm != 300 || tray.HeightMm != 100)
                throw new Exception("Unexpected CableTray parse.");

            var conduit = ElectricalRunRules.ValidateConduit(Parse("""
            {"operationType":"create_conduit","id":"cd1","cableTrayTypeId":null}
            """.Replace("\"cableTrayTypeId\":null", "\"conduitTypeId\":11,\"levelId\":20,\"start\":{\"xMm\":0,\"yMm\":0,\"zMm\":3000},\"end\":{\"xMm\":0,\"yMm\":4000,\"zMm\":3000},\"diameterMm\":25")));
            if (conduit.ConduitTypeId != 11 || conduit.DiameterMm != 25)
                throw new Exception("Unexpected Conduit parse.");
        });

        test("electrical runs reject missing dimensions, short segments, unknown fields, and bad IDs", () =>
        {
            foreach (var bad in new[]
            {
                """{"operationType":"create_cable_tray","cableTrayTypeId":10,"levelId":20,"start":{"xMm":0,"yMm":0,"zMm":0},"end":{"xMm":1000,"yMm":0,"zMm":0},"widthMm":300}""",
                """{"operationType":"create_cable_tray","cableTrayTypeId":10,"levelId":20,"start":{"xMm":0,"yMm":0,"zMm":0},"end":{"xMm":1000,"yMm":0,"zMm":0},"widthMm":0,"heightMm":100}""",
                """{"operationType":"create_cable_tray","cableTrayTypeId":10,"levelId":20,"start":{"xMm":0,"yMm":0,"zMm":0},"end":{"xMm":1000,"yMm":0,"zMm":0},"widthMm":300,"heightMm":10001}""",
                """{"operationType":"create_cable_tray","cableTrayTypeId":10,"levelId":20,"start":{"xMm":0,"yMm":0,"zMm":0},"end":{"xMm":0.5,"yMm":0,"zMm":0},"widthMm":300,"heightMm":100}""",
                """{"operationType":"create_cable_tray","cableTrayTypeId":0,"levelId":20,"start":{"xMm":0,"yMm":0,"zMm":0},"end":{"xMm":1000,"yMm":0,"zMm":0},"widthMm":300,"heightMm":100}""",
                """{"operationType":"create_conduit","conduitTypeId":11,"levelId":20,"start":{"xMm":0,"yMm":0,"zMm":0},"end":{"xMm":1000,"yMm":0,"zMm":0}}""",
                """{"operationType":"create_conduit","conduitTypeId":11,"levelId":20,"start":{"xMm":0,"yMm":0,"zMm":0},"end":{"xMm":1000,"yMm":0,"zMm":0},"diameterMm":2001}""",
                """{"operationType":"create_conduit","conduitTypeId":11,"levelId":20,"start":{"xMm":0,"yMm":0},"end":{"xMm":1000,"yMm":0,"zMm":0},"diameterMm":25}""",
                """{"operationType":"create_conduit","conduitTypeId":11,"levelId":20,"start":{"xMm":0,"yMm":0,"zMm":0},"end":{"xMm":1000,"yMm":0,"zMm":0},"diameterMm":25,"extra":1}"""
            })
            {
                try { ElectricalRunRules.Validate(Parse(bad)); throw new Exception("Expected rejection for " + bad); }
                catch (BridgeException ex) when (ex.Code == "invalid_electrical_run") { }
            }
        });

        test("electrical run plan refuses same-plan type/level mutations and load_family", () =>
        {
            var tray = Parse("""{"operationType":"create_cable_tray","cableTrayTypeId":10,"levelId":20,"start":{"xMm":0,"yMm":0,"zMm":0},"end":{"xMm":1000,"yMm":0,"zMm":0},"widthMm":300,"heightMm":100}""");
            var conduit = Parse("""{"operationType":"create_conduit","conduitTypeId":11,"levelId":20,"start":{"xMm":0,"yMm":0,"zMm":0},"end":{"xMm":0,"yMm":1000,"zMm":0},"diameterMm":25}""");
            ElectricalRunRules.ValidatePlan([tray, conduit]);
            foreach (var conflict in new[]
            {
                Parse("""{"operationType":"set_parameter","elementId":10,"parameter":"Comments","value":"x"}"""),
                Parse("""{"operationType":"delete_element","elementId":11}"""),
                Parse("""{"operationType":"delete_element","elementId":20}"""),
                Parse("""{"operationType":"load_family","familyKey":"k","conflictPolicy":"reject","overwriteTypeParameters":false}""")
            })
            {
                try { ElectricalRunRules.ValidatePlan([tray, conduit, conflict]); throw new Exception("Expected plan rejection."); }
                catch (BridgeException ex) when (ex.Code == "invalid_electrical_run") { }
            }
        });

        test("electrical run readback rules verify endpoints, dimensions, and reject drift", () =>
        {
            var trayInput = new CableTrayInput(10, 20, new(0, 0, 3200), new(5000, 0, 3200), 300, 100);
            ElectricalRunRules.RequireCableTray(trayInput, "u-tray",
                new(700, "u-tray", "create_cable_tray", 10, 20, new(5000, 0, 3200), new(0, 0, 3200), 5000, 300, 100, null, []));
            try
            {
                ElectricalRunRules.RequireCableTray(trayInput, "u-tray",
                    new(700, "u-tray", "create_cable_tray", 10, 20, new(0, 0, 3200), new(5000, 0, 3200), 5000, 250, 100, null, []));
                throw new Exception("Expected width mismatch rejection.");
            }
            catch (BridgeException ex) when (ex.Code == "invalid_electrical_run") { }

            var conduitInput = new ConduitInput(11, 20, new(0, 0, 3000), new(0, 4000, 3000), 25);
            ElectricalRunRules.RequireConduit(conduitInput, "u-cond",
                new(701, "u-cond", "create_conduit", 11, 20, new(0, 0, 3000), new(0, 4000, 3000), 4000, null, null, 25, []));
        });
    }
}
