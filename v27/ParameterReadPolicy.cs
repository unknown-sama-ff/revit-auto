namespace RevitAutoV27;
internal sealed record ParameterReadValue(object? Value, bool Supported, string? Error);
internal static class ParameterReadPolicy
{
    public static ParameterReadValue Normalize(object? value)
    {
        if(value is double d && !double.IsFinite(d) || value is float f && !float.IsFinite(f))
            return new(null,false,"The native parameter is NaN or infinity; its numerical value is unavailable, not zero.");
        return new(value,true,null);
    }
}
