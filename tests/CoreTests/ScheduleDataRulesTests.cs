using System.Text.Json;
using RevitAutoV27;

internal static class ScheduleDataRulesTests
{
    private static JsonElement Parse(string json) => JsonDocument.Parse(json).RootElement.Clone();

    public static void Run(Action<string, Action> test)
    {
        test("schedule data parses valid pins, scheduleId, and defaults", () =>
        {
            var d = ScheduleDataRules.Parse(Parse("""{"documentIdentity":"doc-s","expectedRevision":1,"scheduleId":999}"""));
            if (d.ScheduleId != 999 || d.StartRow != 0 || d.MaxRows != 100 || d.IncludeCellMeta)
                throw new Exception("Unexpected schedule data defaults.");

            var custom = ScheduleDataRules.Parse(Parse("""
            {"documentIdentity":"doc-s","expectedRevision":4,"scheduleId":999,"startRow":20,"maxRows":200,"includeCellMeta":true}
            """));
            if (custom.StartRow != 20 || custom.MaxRows != 200 || !custom.IncludeCellMeta)
                throw new Exception("Unexpected custom schedule data parameters.");
        });

        test("schedule data rejects name lookup, unknown keys, and invalid bounds", () =>
        {
            foreach (var bad in new[]
            {
                """{}""",
                """{"documentIdentity":"doc-s","expectedRevision":0}""",
                """{"documentIdentity":"doc-s","expectedRevision":0,"scheduleName":"Door Schedule"}""",
                """{"documentIdentity":"doc-s","expectedRevision":0,"scheduleId":0}""",
                """{"documentIdentity":"doc-s","expectedRevision":0,"scheduleId":9007199254740992}""",
                """{"documentIdentity":"doc-s","expectedRevision":0,"scheduleId":10,"startRow":-1}""",
                """{"documentIdentity":"doc-s","expectedRevision":0,"scheduleId":10,"maxRows":0}""",
                """{"documentIdentity":"doc-s","expectedRevision":0,"scheduleId":10,"maxRows":201}""",
                """{"documentIdentity":"doc-s","expectedRevision":0,"scheduleId":10,"includeCellMeta":"true"}""",
                """{"documentIdentity":"doc-s","expectedRevision":0,"scheduleId":10,"extra":1}"""
            })
            {
                try { ScheduleDataRules.Parse(Parse(bad)); throw new Exception("Expected rejection for " + bad); }
                catch (BridgeException ex) when (ex.Code == "invalid_schedule_data_request") { }
            }
        });

        test("schedule pagination handles empty, exact boundary, and overflow startRow", () =>
        {
            var empty = ScheduleDataRules.ComputeWindow(0, 0, 100);
            if (empty.ReturnedRows != 0 || empty.HasMore) throw new Exception("Empty schedule cannot have hasMore.");

            var exact = ScheduleDataRules.ComputeWindow(50, 20, 30);
            if (exact.AbsStart != 20 || exact.AbsEndExclusive != 50 || exact.ReturnedRows != 30 || exact.HasMore)
                throw new Exception("Exact end boundary must set hasMore=false.");

            var more = ScheduleDataRules.ComputeWindow(51, 20, 30);
            if (more.ReturnedRows != 30 || !more.HasMore)
                throw new Exception("Expected hasMore=true before end.");

            var past = ScheduleDataRules.ComputeWindow(10, 20, 5);
            if (past.ReturnedRows != 0 || past.HasMore)
                throw new Exception("Past-end startRow must return 0 rows and hasMore=false.");
        });

        test("schedule row classification distinguishes partial, blank, header, text, and data", () =>
        {
            var cols = new[] { "Mark", "Count" };
            if (ScheduleDataRules.ClassifyRow(new string?[] { "D1", null }, false, cols) != "partial")
                throw new Exception("Null cell must classify row as partial.");
            if (ScheduleDataRules.ClassifyRow(new string?[] { "", "   " }, true, cols) != "blank")
                throw new Exception("Whitespace row must classify as blank.");
            if (ScheduleDataRules.ClassifyRow(new string?[] { "Mark", "Count" }, true, cols) != "header")
                throw new Exception("Text row matching columns must classify as header.");
            if (ScheduleDataRules.ClassifyRow(new string?[] { "Summary", "" }, true, cols) != "text")
                throw new Exception("Text-only row must classify as text.");
            if (ScheduleDataRules.ClassifyRow(new string?[] { "D1", "2" }, false, cols) != "data")
                throw new Exception("Parameter row must classify as data.");
        });
    }
}
