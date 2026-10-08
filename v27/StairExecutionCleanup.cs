namespace RevitAutoV27;

internal enum StairExecutionPhase { BeforeScope, StartingScope, BuildingRuns, BuildingLandings, CommittingTransaction, CommittingScope, ReadingResult }
internal sealed record StairCleanupEvidence(string Stage, bool? ScopeStartAttempted, bool? ScopeStartReturned,
    bool? ScopeCommitReturned, bool? CancelAttempted, bool? CancelCallSucceeded, string RollbackStatus,
    bool RollbackVerified, bool RequiresNativeInspection, string? CancelErrorType)
{
    internal static StairCleanupEvidence Unknown() => new("unavailable", null, null, null, null, null, "unknown", false, true, null);
}

// Cancel() returning is an action observation, not independent evidence of model restoration.
// Cache cleanup so diagnostics never cause an automatic second cancellation/retry.
internal sealed class StairExecutionCleanup
{
    internal StairExecutionPhase Phase { get; set; } = StairExecutionPhase.BeforeScope;
    private bool startAttempted, startReturned, commitReturned;
    private StairCleanupEvidence? result;
    internal void StartingScope() { startAttempted = true; Phase = StairExecutionPhase.StartingScope; }
    internal void ScopeStarted() { startReturned = true; Phase = StairExecutionPhase.BuildingRuns; }
    internal void ScopeCommitReturned() { commitReturned = true; Phase = StairExecutionPhase.ReadingResult; }
    internal StairCleanupEvidence AfterFailure(Action cancel)
    {
        if (result is not null) return result;
        if (!startAttempted)
            return result = Evidence(false, false, "not-started", false, null);
        if (commitReturned)
            return result = Evidence(false, false, "scope-commit-returned-unverified", true, null);
        try
        {
            cancel();
            return result = Evidence(true, true, "cancel-returned-unverified", true, null);
        }
        catch (Exception cleanupError)
        {
            return result = Evidence(true, false, "cancel-failed", true, cleanupError.GetType().Name);
        }
    }
    private StairCleanupEvidence Evidence(bool attempted, bool succeeded, string status, bool inspect, string? error)
        => new(Phase.ToString(), startAttempted, startReturned, commitReturned, attempted, succeeded, status, false, inspect, error);
}
internal sealed class StairExecutionFailure(Exception original, StairCleanupEvidence cleanup, IEnumerable<string> warnings) : Exception(original.Message, original)
{
    public StairCleanupEvidence Cleanup { get; } = cleanup;
    public string[] Warnings { get; } = warnings.ToArray();
    public string CauseCode { get; } = original is BridgeException bridge ? bridge.Code : original is OperationCanceledException ? "execution_cancelled" : "revit_error";
    public object? CauseDetails { get; } = (original as BridgeException)?.Details;
}
