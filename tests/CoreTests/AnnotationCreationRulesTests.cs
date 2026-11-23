using System.Text.Json;
using RevitAutoV27;

internal static class AnnotationCreationRulesTests
{
    private static JsonElement Parse(string json) => JsonDocument.Parse(json).RootElement.Clone();

    public static void Run(Action<string, Action> test)
    {
        test("2d annotations validate text note and detail line contracts", () =>
        {
            var tn = AnnotationCreationRules.ValidateTextNote(Parse("""
            {"operationType":"create_text_note","id":"tn1","viewId":10,"textTypeId":20,"text":"Note A\r\nLine 2","point":{"xMm":100,"yMm":200,"zMm":0},"widthMm":120,"rotationDegrees":45}
            """));
            if (tn.ViewId != 10 || tn.TextTypeId != 20 || tn.WidthMm != 120 || tn.RotationDegrees != 45)
                throw new Exception("Unexpected TextNote parse.");

            var dl = AnnotationCreationRules.ValidateDetailLine(Parse("""
            {"operationType":"create_detail_line","id":"dl1","viewId":10,"start":{"xMm":0,"yMm":0,"zMm":0},"end":{"xMm":500,"yMm":0,"zMm":0},"lineStyleId":30}
            """));
            if (dl.ViewId != 10 || dl.LineStyleId != 30)
                throw new Exception("Unexpected DetailLine parse.");
        });

        test("2d annotations reject empty/control text, short lines, out-of-range widths/rotations, and unknown keys", () =>
        {
            foreach (var bad in new[]
            {
                """{"operationType":"create_text_note","viewId":10,"textTypeId":20,"text":"","point":{"xMm":0,"yMm":0,"zMm":0}}""",
                """{"operationType":"create_text_note","viewId":10,"textTypeId":20,"text":"   ","point":{"xMm":0,"yMm":0,"zMm":0}}""",
                """{"operationType":"create_text_note","viewId":10,"textTypeId":20,"text":"bad\u0007text","point":{"xMm":0,"yMm":0,"zMm":0}}""",
                """{"operationType":"create_text_note","viewId":10,"textTypeId":20,"text":"ok","point":{"xMm":0,"yMm":0}}""",
                """{"operationType":"create_text_note","viewId":10,"textTypeId":20,"text":"ok","point":{"xMm":0,"yMm":0,"zMm":0},"widthMm":0.5}""",
                """{"operationType":"create_text_note","viewId":10,"textTypeId":20,"text":"ok","point":{"xMm":0,"yMm":0,"zMm":0},"rotationDegrees":361}""",
                """{"operationType":"create_text_note","viewId":10,"textTypeId":20,"text":"ok","point":{"xMm":0,"yMm":0,"zMm":0},"extra":true}""",
                """{"operationType":"create_detail_line","viewId":10,"start":{"xMm":0,"yMm":0,"zMm":0},"end":{"xMm":0.5,"yMm":0,"zMm":0}}""",
                """{"operationType":"create_detail_line","viewId":10,"start":{"xMm":0,"yMm":0,"zMm":0},"end":{"xMm":50,"yMm":0,"zMm":0},"lineStyleId":0}"""
            })
            {
                try { AnnotationCreationRules.Validate(Parse(bad)); throw new Exception("Expected rejection for " + bad); }
                catch (BridgeException ex) when (ex.Code == "invalid_2d_annotation") { }
            }
        });

        test("2d annotation plan refuses same-plan source mutation and load_family", () =>
        {
            var note = Parse("""{"operationType":"create_text_note","viewId":10,"textTypeId":20,"text":"Hello","point":{"xMm":0,"yMm":0,"zMm":0}}""");
            var line = Parse("""{"operationType":"create_detail_line","viewId":10,"start":{"xMm":0,"yMm":0,"zMm":0},"end":{"xMm":100,"yMm":0,"zMm":0},"lineStyleId":30}""");
            AnnotationCreationRules.ValidatePlan([note, line]);
            foreach (var badSecond in new[]
            {
                Parse("""{"operationType":"delete_element","elementId":10}"""),
                Parse("""{"operationType":"set_parameter","elementId":20,"parameter":"Comments","value":"x"}"""),
                Parse("""{"operationType":"delete_element","elementId":30}"""),
                Parse("""{"operationType":"load_family","familyKey":"k","conflictPolicy":"reject","overwriteTypeParameters":false}""")
            })
            {
                try { AnnotationCreationRules.ValidatePlan([note, line, badSecond]); throw new Exception("Expected plan conflict failure."); }
                catch (BridgeException ex) when (ex.Code == "invalid_2d_annotation") { }
            }
        });

        test("text note and detail line readback rules normalize Revit line endings and verify geometry", () =>
        {
            var tnInput = new TextNoteInput(10, 20, "Line 1\r\nLine 2", new(100, 200, 0), null, 0);
            AnnotationCreationRules.RequireTextNote(
                tnInput,
                new(100, 200, 0),
                "u1",
                new(500, "u1", 10, 20, "Line 1\rLine 2\r", new(100.1, 199.9, 0), 30));

            try
            {
                AnnotationCreationRules.RequireTextNote(
                    tnInput,
                    new(100, 200, 0),
                    "u1",
                    new(500, "u1", 10, 20, "Line 1\rLine X\r", new(100, 200, 0), 30));
                throw new Exception("Expected mismatch error.");
            }
            catch (BridgeException ex) when (ex.Code == "invalid_2d_annotation") { }

            var dlInput = new DetailLineInput(10, new(0, 0, 0), new(100, 0, 0), 30);
            AnnotationCreationRules.RequireDetailLine(
                dlInput,
                new(0, 0, 0),
                new(100, 0, 0),
                "u2",
                new(501, "u2", 10, 30, new(100, 0, 0), new(0, 0, 0), 100));
        });
    }
}
