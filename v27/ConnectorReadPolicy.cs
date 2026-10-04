namespace RevitAutoV27;

internal sealed record ConnectorReadValue<T>(bool Supported, T? Value, string? Error);
internal sealed record ConnectorConnectionStatus(bool Supported, bool? Connected, string? Error);
internal sealed record ConnectorPoint(double XMm, double YMm, double ZMm);
internal static class ConnectorReadPolicy
{
    public static ConnectorReadValue<T> TryRead<T>(Func<T> read, Func<Exception, bool> unsupported)
    {
        try { return new(true, read(), null); }
        catch (Exception exception) when (unsupported(exception))
        {
            // An unavailable API property is unknown, never a guessed false/default.
            return new(false, default, exception.Message);
        }
    }
    public static ConnectorConnectionStatus ConnectionStatus(Func<bool> read, Func<Exception, bool> unsupported)
    {
        var result = TryRead(read, unsupported);
        return new(result.Supported, result.Supported ? result.Value : (bool?)null, result.Error);
    }
}
