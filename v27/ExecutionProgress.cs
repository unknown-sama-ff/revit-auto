namespace RevitAutoV27;

internal sealed class ExecutionProgress
{
    public int CompletedOperationCount { get; private set; }
    public int? FailedOperationIndex { get; private set; }
    public void Begin(int oneBasedIndex)
    {
        if (oneBasedIndex != CompletedOperationCount + 1) throw new InvalidOperationException("Operations must be executed in plan order.");
        FailedOperationIndex = oneBasedIndex;
    }
    public void Complete()
    {
        if (FailedOperationIndex is null) throw new InvalidOperationException("No operation is active.");
        CompletedOperationCount++;
        FailedOperationIndex = null;
    }
}
