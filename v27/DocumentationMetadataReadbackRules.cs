namespace RevitAutoV27;

internal readonly record struct DocumentationMetadataReadback(long ElementId, string ElementClass, string Parameter, object? ExpectedValue, object? ActualValue);

internal static class DocumentationMetadataReadbackRules
{
    private static BridgeException Invalid(string message) => new("invalid_documentation_readback", message);
    public static void Require(DocumentationMetadataReadback expected, DocumentationMetadataReadback actual)
    {
        if (expected.ElementId <= 0 || actual.ElementId != expected.ElementId || string.IsNullOrWhiteSpace(expected.ElementClass) || actual.ElementClass != expected.ElementClass ||
            string.IsNullOrWhiteSpace(expected.Parameter) || actual.Parameter != expected.Parameter || !Equivalent(expected.ExpectedValue, actual.ActualValue))
            throw Invalid("Native documentation metadata parameter differs from the reviewed value; roll back.");
    }
    private static bool Equivalent(object? expected, object? actual) => expected switch
    {
        int value => actual is int actualInt && actualInt == value,
        long value => actual is long actualLong && actualLong == value,
        string value => actual is string actualString && actualString == value,
        null => actual is null,
        _ => Equals(expected, actual)
    };
}
