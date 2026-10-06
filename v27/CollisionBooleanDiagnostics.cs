namespace RevitAutoV27;

internal sealed record CollisionBooleanFailureDetails(string ExceptionType, string Message, bool MessageTruncated,
    int TargetSolidIndex, int CandidateSolidIndex, int TargetSolidCount, int CandidateSolidCount,
    CollisionBounds TargetBounds, CollisionBounds CandidateBounds);

// Diagnostic data only. No retry, geometry offset, tolerance change, or alternative verdict.
internal static class CollisionBooleanDiagnostics
{
    internal const int MessageLimit = 1200;
    public static CollisionBooleanFailureDetails Capture(Exception error, int targetSolidIndex, int candidateSolidIndex,
        int targetSolidCount, int candidateSolidCount, CollisionBounds targetBounds, CollisionBounds candidateBounds)
    {
        var original = error.Message;
        var message = new string(original.Select(character => char.IsControl(character) ? ' ' : character).ToArray());
        var truncated = message.Length > MessageLimit;
        if (truncated) message = message[..(MessageLimit - 1)] + "…";
        return new(error.GetType().FullName ?? error.GetType().Name, message, truncated,
            targetSolidIndex, candidateSolidIndex, targetSolidCount, candidateSolidCount, targetBounds, candidateBounds);
    }
}
