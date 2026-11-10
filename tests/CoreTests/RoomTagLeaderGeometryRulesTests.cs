using RevitAutoV27;
using System.Text.Json;

internal static class RoomTagLeaderGeometryRulesTests
{
    internal static void Run(Action<string, Action> test)
    {
        var end = new TagPosition(34000.125, 3000.375, 1200.625);
        var elbow = new TagPosition(34000, 4100, 0);
        test("room tag straight leader preserves exact end and skips the nonexistent elbow getter", () =>
        {
            var snapshot = RoomTagLeaderGeometryRules.Capture(() => true, () => false, () => end,
                () => throw new Exception("A straight leader has no elbow."));
            if (snapshot.End.Value != end || snapshot.HasElbow.Value != false ||
                snapshot.Elbow.State != "not-applicable" || snapshot.Elbow.Value.HasValue)
                throw new Exception("Straight leader evidence was lost or fabricated.");
        });
        test("room tag bent leader preserves independent native XYZ including known origin", () =>
        {
            var origin = new TagPosition(0, 0, 0);
            var snapshot = RoomTagLeaderGeometryRules.Capture(() => true, () => true, () => origin, () => elbow);
            if (snapshot.End.State != "known" || snapshot.End.Value != origin || snapshot.Elbow.Value != elbow)
                throw new Exception("Native endpoint coordinates changed.");
        });
        test("room tag without leader calls no endpoint or elbow getters", () =>
        {
            var reads = 0;
            var snapshot = RoomTagLeaderGeometryRules.Capture(() => false, () => { reads++; return true; },
                () => { reads++; return end; }, () => { reads++; return elbow; });
            if (reads != 0 || snapshot.HasLeader.Value != false || snapshot.HasElbow.State != "not-applicable" ||
                snapshot.End.State != "not-applicable" || snapshot.Elbow.State != "not-applicable")
                throw new Exception("No-leader state performed invalid dependent reads.");
        });
        test("failed room tag presence read stays unknown and does not guess no leader", () =>
        {
            var reads = 0;
            var snapshot = RoomTagLeaderGeometryRules.Capture(() => throw new InvalidOperationException("native"),
                () => { reads++; return false; }, () => { reads++; return end; }, () => { reads++; return elbow; });
            if (reads != 0 || snapshot.HasLeader.State != "unknown" || snapshot.HasLeader.Value.HasValue ||
                snapshot.HasLeader.ErrorType != nameof(InvalidOperationException) || snapshot.End.State != "unknown")
                throw new Exception("Unknown presence was downgraded to a known absence.");
        });
        test("failed room tag end read does not hide known elbow geometry", () =>
        {
            var snapshot = RoomTagLeaderGeometryRules.Capture(() => true, () => true,
                () => throw new InvalidOperationException("native"), () => elbow);
            if (snapshot.End.State != "unknown" || snapshot.End.Value.HasValue || snapshot.Elbow.Value != elbow)
                throw new Exception("An endpoint error masked an independent observation.");
        });
        test("failed room tag elbow-presence read preserves end and skips elbow position", () =>
        {
            var snapshot = RoomTagLeaderGeometryRules.Capture(() => true, () => throw new InvalidOperationException(),
                () => end, () => throw new Exception("Do not guess an elbow exists."));
            if (snapshot.End.Value != end || snapshot.HasElbow.State != "unknown" || snapshot.Elbow.State != "unknown")
                throw new Exception("Unknown elbow presence was incorrectly resolved.");
        });
        test("room tag missing and nonfinite endpoints never become a fabricated origin", () =>
        {
            var snapshot = RoomTagLeaderGeometryRules.Capture(() => true, () => true, () => null,
                () => new TagPosition(double.NaN, 2, 3));
            if (snapshot.End.State != "unavailable" || snapshot.Elbow.State != "unknown" ||
                snapshot.End.Value.HasValue || snapshot.Elbow.Value.HasValue)
                throw new Exception("Unknown geometry became a numeric point.");
            var wire = JsonSerializer.SerializeToElement(snapshot, JsonDefaults.Options);
            if (wire.GetProperty("end").GetProperty("value").ValueKind != JsonValueKind.Null ||
                wire.GetProperty("elbow").GetProperty("value").ValueKind != JsonValueKind.Null)
                throw new Exception("Explicit unknown values were dropped on the wire.");
        });
        test("room tag observation does not swallow cancellation or memory exhaustion", () =>
        {
            foreach (var failure in new Exception[] { new OperationCanceledException(), new OutOfMemoryException() })
            {
                try { RoomTagLeaderGeometryRules.Capture(() => true, () => true, () => throw failure, () => elbow); }
                catch (Exception actual) when (ReferenceEquals(actual, failure)) { continue; }
                throw new Exception("A control/fatal exception was converted to ordinary unknown evidence.");
            }
        });
    }
}
