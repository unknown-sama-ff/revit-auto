namespace RevitAutoV27;

// Operation outcomes only; the native event receipt remains independent evidence.
internal sealed record OperationReceipt(List<long> Created, List<long> Changed)
{
    public object? Evidence { get; init; }
    public static OperationReceipt New(long elementId) => new([elementId], []);
    public static OperationReceipt ForParameter(long elementId, string parameter, bool writePerformed)
    {
        if (elementId <= 0 || string.IsNullOrWhiteSpace(parameter))
            throw new ArgumentException("A parameter outcome requires a real element ID and parameter name.");
        return new([], writePerformed ? [elementId] : [])
        {
            Evidence = new
            {
                elementId, parameter,
                outcome = writePerformed ? "write_performed" : "no_change",
                parameterWritePerformed = writePerformed,
                noOp = !writePerformed,
                nativeReadbackVerified = false,
                sideEffectsVerified = false
            }
        };
    }
}
