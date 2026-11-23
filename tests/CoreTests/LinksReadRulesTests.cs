using System.Text.Json;
using RevitAutoV27;

internal static class LinksReadRulesTests
{
    private static JsonElement Parse(string json) => JsonDocument.Parse(json).RootElement.Clone();

    public static void Run(Action<string, Action> test)
    {
        test("links list parses defaults and explicit filters", () =>
        {
            var d = LinksReadRules.ParseList(Parse("""{"documentIdentity":"doc-1","expectedRevision":3}"""));
            if (d.DocumentIdentity != "doc-1" || d.ExpectedRevision != 3 || !d.IncludeRevitLinks || !d.IncludeCad ||
                !d.IncludeUnloaded || !d.IncludeInstances || !d.IncludeCadLinks || !d.IncludeCadImports ||
                d.Offset != 0 || d.Limit != 100)
                throw new Exception("Unexpected list defaults.");

            var custom = LinksReadRules.ParseList(Parse("""
            {"documentIdentity":"doc-1","expectedRevision":0,"includeRevitLinks":false,"includeCad":true,
             "includeUnloaded":false,"includeInstances":false,"includeCadLinks":true,"includeCadImports":false,
             "offset":10,"limit":25}
            """));
            if (custom.IncludeRevitLinks || custom.Offset != 10 || custom.Limit != 25 || custom.IncludeCadImports)
                throw new Exception("Unexpected custom list values.");
        });

        test("links list rejects missing pins, unknown fields, non-boolean flags, and empty filters", () =>
        {
            foreach (var bad in new[]
            {
                """{}""",
                """{"documentIdentity":"doc-1"}""",
                """{"documentIdentity":" ","expectedRevision":0}""",
                """{"documentIdentity":"doc-1","expectedRevision":-1}""",
                """{"documentIdentity":"doc-1","expectedRevision":0,"unknown":1}""",
                """{"documentIdentity":"doc-1","expectedRevision":0,"includeRevitLinks":"true"}""",
                """{"documentIdentity":"doc-1","expectedRevision":0,"includeRevitLinks":false,"includeCad":false}""",
                """{"documentIdentity":"doc-1","expectedRevision":0,"includeCad":true,"includeCadLinks":false,"includeCadImports":false}""",
                """{"documentIdentity":"doc-1","expectedRevision":0,"offset":-1}""",
                """{"documentIdentity":"doc-1","expectedRevision":0,"limit":0}""",
                """{"documentIdentity":"doc-1","expectedRevision":0,"limit":201}"""
            })
            {
                try { LinksReadRules.ParseList(Parse(bad)); throw new Exception("Expected rejection for " + bad); }
                catch (BridgeException ex) when (ex.Code == "invalid_links_request") { }
            }
        });

        test("link elements parses defaults and rejects bad IDs, categories, and pagination", () =>
        {
            var valid = LinksReadRules.ParseElements(Parse("""
            {"documentIdentity":"doc-2","expectedRevision":5,"linkInstanceId":12345,"category":"OST_Walls","offset":5,"limit":20,"includeBounds":true}
            """));
            if (valid.LinkInstanceId != 12345 || valid.Category != "OST_Walls" || valid.Offset != 5 || valid.Limit != 20 || !valid.IncludeBounds)
                throw new Exception("Unexpected link elements parse.");

            foreach (var bad in new[]
            {
                """{"documentIdentity":"doc-2","expectedRevision":5}""",
                """{"documentIdentity":"doc-2","expectedRevision":5,"linkInstanceId":0}""",
                """{"documentIdentity":"doc-2","expectedRevision":5,"linkInstanceId":9007199254740992}""",
                """{"documentIdentity":"doc-2","expectedRevision":5,"linkInstanceId":12,"category":" "}""",
                """{"documentIdentity":"doc-2","expectedRevision":5,"linkInstanceId":12,"category":" Walls"}""",
                """{"documentIdentity":"doc-2","expectedRevision":5,"linkInstanceId":12,"includeBounds":"yes"}""",
                """{"documentIdentity":"doc-2","expectedRevision":5,"linkInstanceId":12,"limit":201}"""
            })
            {
                try { LinksReadRules.ParseElements(Parse(bad)); throw new Exception("Expected rejection for " + bad); }
                catch (BridgeException ex) when (ex.Code == "invalid_links_request") { }
            }
        });

        test("links pagination handles boundaries deterministically", () =>
        {
            var source = new[] { 1, 2, 3, 4, 5 };
            var (p1, m1) = LinksReadRules.Paginate(source, 0, 3);
            if (p1.Count != 3 || !m1) throw new Exception("Expected first page with hasMore=true.");
            var (p2, m2) = LinksReadRules.Paginate(source, 3, 2);
            if (p2.Count != 2 || m2) throw new Exception("Expected exact final page with hasMore=false.");
            var (p3, m3) = LinksReadRules.Paginate(source, 10, 5);
            if (p3.Count != 0 || m3) throw new Exception("Expected empty page beyond end.");
        });

        test("rotated link 8-corner bounding box computes conservative host AABB", () =>
        {
            // Local box [0..1000] x [0..200] x [0..500], rotated 90 deg around Z and translated to (500, 100, 0).
            // Rotating (x, y) by +90 deg gives (-y, x), so host X spans [300, 500] and host Y spans [100, 1100].
            var box90 = LinksReadRules.TransformBoundsMm(
                new(0, 0, 0),
                new(1000, 200, 500),
                p => new(500 - p.YMm, 100 + p.XMm, p.ZMm));
            if (box90 is null) throw new Exception("Expected rotated box.");
            if (Math.Abs(box90.Min.XMm - 300) > 1e-9 || Math.Abs(box90.Max.XMm - 500) > 1e-9 ||
                Math.Abs(box90.Min.YMm - 100) > 1e-9 || Math.Abs(box90.Max.YMm - 1100) > 1e-9 ||
                Math.Abs(box90.Size.XMm - 200) > 1e-9 || Math.Abs(box90.Size.YMm - 1000) > 1e-9)
                throw new Exception("90-degree rotated host bounds mismatch.");

            // 45-degree rotation of [0..1000] x [0..1000] x [0..100]: max Y must be sqrt(2)*1000, not 0.
            var c = Math.Cos(Math.PI / 4);
            var s = Math.Sin(Math.PI / 4);
            var box45 = LinksReadRules.TransformBoundsMm(
                new(0, 0, 0),
                new(1000, 1000, 100),
                p => new(p.XMm * c - p.YMm * s, p.XMm * s + p.YMm * c, p.ZMm));
            if (box45 is null) throw new Exception("Expected 45-degree box.");
            var expectedExtent = 1000 * Math.Sqrt(2);
            if (Math.Abs(box45.Min.XMm - (-1000 * s)) > 1e-6 || Math.Abs(box45.Max.XMm - (1000 * c)) > 1e-6 ||
                Math.Abs(box45.Max.YMm - expectedExtent) > 1e-6)
                throw new Exception("45-degree rotated 8-corner AABB failed.");
        });
    }
}
