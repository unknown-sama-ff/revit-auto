using System.Text.Json;

namespace RevitAutoV27;

internal static class OpeningProfileFailureDiagnostics
{
    internal const string MismatchMessage = "Native profile segments do not match the reviewed polygon edges; the transaction must roll back.";
    internal const int SectionBudgetUtf8Bytes = 256 * 1024;
    private sealed record CapturedSection(JsonElement? Value, int? Utf8Bytes, string? Error);

    private static CapturedSection Capture(Func<JsonElement>? collector)
    {
        if (collector is null) return new(null, null, "not-requested");
        try
        {
            var value = collector();
            var length = JsonSerializer.SerializeToUtf8Bytes(value, JsonDefaults.Options).Length;
            if (length > SectionBudgetUtf8Bytes) return new(null, length, "snapshot_byte_budget_exceeded");
            return new(value.Clone(), length, null);
        }
        catch (Exception error)
        {
            var message = error.GetType().Name + ": " + error.Message;
            return new(null, null, message.Length <= 512 ? message : message[..512] + " [error-message-truncated]");
        }
    }

    internal static BridgeException Create(JsonElement reviewedOperation, string phase, Func<JsonElement> actualCollector, Func<JsonElement>? contextCollector = null, string? failureMessage = null)
    {
        var actual = Capture(actualCollector);
        var context = Capture(contextCollector);
        var details = NativeReadSnapshot.Freeze(new
        {
            schemaVersion = 1, kind = "opening-profile-readback-mismatch", verificationPhase = phase,
            reviewedOperation = reviewedOperation.Clone(),
            coordinatePolicy = "Raw native and reviewed values in Revit internal/project-origin millimeters; no projection, translation or normalization performed.",
            comparisonPolicy = "Existing complete3D OpeningRules.EdgesMatch and reviewed hostToleranceMm remain unchanged.",
            actualNativeSnapshotAvailable = actual.Value.HasValue, actualNativeSnapshot = actual.Value,
            actualSnapshotUtf8Bytes = actual.Utf8Bytes, actualCaptureError = actual.Error,
            supplementaryContextAvailable = context.Value.HasValue, supplementaryNativeContext = context.Value,
            supplementarySnapshotUtf8Bytes = context.Utf8Bytes, supplementaryCaptureError = context.Error,
            sectionBudgetUtf8Bytes = SectionBudgetUtf8Bytes,
            nativeReadbackVerified = false, rollbackVerified = false, sideEffectsVerified = false,
            persistenceVerified = false, visualVerified = false, engineeringComplianceVerified = false
        });
        return new BridgeException("invalid_opening", failureMessage ?? MismatchMessage, details);
    }
}
