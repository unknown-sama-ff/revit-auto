using System.Text.Json;
using RevitAutoV27;

internal static class OpeningProfileFailureDiagnosticsTests
{
    private const string Operation = """{"operationType":"create_opening","openingKind":"floor_profile","hostElementId":10,"boundary":[{"xMm":100,"yMm":100,"zMm":0},{"xMm":1100,"yMm":100,"zMm":0},{"xMm":1100,"yMm":1100,"zMm":0},{"xMm":100,"yMm":1100,"zMm":0}],"cutDirection":"vertical","hostToleranceMm":1}""";
    private static JsonElement Json(string value) => JsonDocument.Parse(value).RootElement.Clone();
    private static JsonElement Details(BridgeException error)
    {
        if (error.Code != "invalid_opening" || error.Message != OpeningProfileFailureDiagnostics.MismatchMessage || error.Details is not JsonElement details)
            throw new Exception("Diagnostic capture changed the original failure contract.");
        return details;
    }
    public static void Run(Action<string, Action> test)
    {
        test("host surface failure message is preserved with raw profile diagnostics", () =>
        {
            var error=OpeningProfileFailureDiagnostics.Create(Json(Operation),"after-creation",()=>Json("""{"openingId":55}"""),null,"Actual host inner-loop match is missing.");
            if(error.Code!="invalid_opening"||error.Message!="Actual host inner-loop match is missing."||error.Details is not JsonElement details||!details.GetProperty("actualNativeSnapshotAvailable").GetBoolean())
                throw new Exception("Host surface failure was replaced or raw evidence lost.");
        });
        test("opening profile failure freezes synthetic XYZ without projecting or changing the reviewed tolerance", () =>
        {
            BridgeException error;
            using (var op = JsonDocument.Parse(Operation))
            using (var actual = JsonDocument.Parse("""{"openingId":55,"boundaryCurves":[{"start":{"xMm":100,"yMm":100,"zMm":731.25}}]}"""))
                error = OpeningProfileFailureDiagnostics.Create(op.RootElement, "after-creation", () => actual.RootElement);
            var details = Details(error);
            if (!details.GetProperty("actualNativeSnapshotAvailable").GetBoolean() ||
                details.GetProperty("actualNativeSnapshot").GetProperty("boundaryCurves")[0].GetProperty("start").GetProperty("zMm").GetDouble() != 731.25 ||
                details.GetProperty("reviewedOperation").GetProperty("boundary")[0].GetProperty("zMm").GetDouble() != 0 ||
                details.GetProperty("reviewedOperation").GetProperty("hostToleranceMm").GetDouble() != 1)
                throw new Exception("Actual/expected geometry or tolerance was rebased.");
            foreach (var gate in new[] { "nativeReadbackVerified", "rollbackVerified", "sideEffectsVerified", "persistenceVerified", "visualVerified", "engineeringComplianceVerified" })
                if (details.GetProperty(gate).GetBoolean()) throw new Exception("A failure diagnostic certified " + gate);
        });
        test("opening profile snapshot failure preserves invalid_opening and reports unavailable evidence", () =>
        {
            var error = OpeningProfileFailureDiagnostics.Create(Json(Operation), "before-transaction-commit", () => throw new InvalidOperationException("native capture unavailable"));
            var details = Details(error);
            if (details.GetProperty("actualNativeSnapshotAvailable").GetBoolean() || !details.GetProperty("actualCaptureError").GetString()!.Contains("native capture unavailable"))
                throw new Exception("Capture failure was hidden or actual evidence was invented.");
        });
        test("opening profile diagnostic drops over-budget section explicitly instead of truncating coordinates", () =>
        {
            var huge = JsonSerializer.SerializeToElement(new { value = new string('x', OpeningProfileFailureDiagnostics.SectionBudgetUtf8Bytes + 100) });
            var details = Details(OpeningProfileFailureDiagnostics.Create(Json(Operation), "after-creation", () => huge));
            if (details.GetProperty("actualNativeSnapshotAvailable").GetBoolean() ||
                details.GetProperty("actualSnapshotUtf8Bytes").GetInt32() <= OpeningProfileFailureDiagnostics.SectionBudgetUtf8Bytes ||
                details.GetProperty("actualCaptureError").GetString() != "snapshot_byte_budget_exceeded")
                throw new Exception("Oversized diagnostic was silently accepted or truncated.");
        });
        test("opening supplementary context failure cannot erase captured actual geometry", () =>
        {
            var details = Details(OpeningProfileFailureDiagnostics.Create(Json(Operation), "after-transaction-commit", () => Json("""{"openingId":55}"""),
                () => throw new InvalidOperationException("plane unavailable")));
            if (!details.GetProperty("actualNativeSnapshotAvailable").GetBoolean() || details.GetProperty("supplementaryContextAvailable").GetBoolean() ||
                details.GetProperty("actualNativeSnapshot").GetProperty("openingId").GetInt64() != 55)
                throw new Exception("Supplementary failure erased the actual snapshot.");
        });
        test("opening diagnostic collectors run once and nonfinite capture errors do not replace the original failure", () =>
        {
            var actualCalls = 0; var contextCalls = 0;
            var details = Details(OpeningProfileFailureDiagnostics.Create(Json(Operation), "after-creation",
                () => { actualCalls++; return JsonSerializer.SerializeToElement(new { value = double.NaN }); },
                () => { contextCalls++; return Json("""{"captured":true}""" ); }));
            if (actualCalls != 1 || contextCalls != 1 || details.GetProperty("actualNativeSnapshotAvailable").GetBoolean() || !details.GetProperty("supplementaryContextAvailable").GetBoolean())
                throw new Exception("Collectors were repeated or failed evidence was certified.");
        });
    }
}
