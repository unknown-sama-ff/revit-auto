using RevitAutoV27;

internal static class OpeningCreationReadbackRulesTests
{
    private static void Reject(Action action)
    {
        try { action(); }
        catch (BridgeException error) when (error.Code == "invalid_opening") { return; }
        throw new Exception("Expected invalid_opening; unknown native shaft offset must not certify zero.");
    }

    public static void Run(Action<string, Action> test)
    {
        test("shaft zero-offset readback rejects unknown and every nonfinite value", () =>
        {
            foreach (double? value in new double?[] { null, double.NaN, double.PositiveInfinity, double.NegativeInfinity })
                Reject(() => OpeningRules.RequireZeroNativeOffset(value, 1));
        });
        test("shaft zero-offset readback requires the finite reviewed tolerance range", () =>
        {
            foreach (var tolerance in new[] { double.NaN, double.PositiveInfinity, double.NegativeInfinity, -1, 0, 100.00001 })
                Reject(() => OpeningRules.RequireZeroNativeOffset(0, tolerance));
        });
        test("shaft zero-offset readback permits both signs only within explicit tolerance", () =>
        {
            foreach (var value in new[] { -1d, -0.1, 0, 0.1, 1 }) OpeningRules.RequireZeroNativeOffset(value, 1);
            OpeningRules.RequireZeroNativeOffset(0, 0.001);
            OpeningRules.RequireZeroNativeOffset(-100, 100);
            OpeningRules.RequireZeroNativeOffset(100, 100);
        });
        test("shaft zero-offset readback rejects drift beyond either tolerance boundary", () =>
        {
            foreach (var value in new[] { -1.000001, 1.000001, -100d, 100d })
                Reject(() => OpeningRules.RequireZeroNativeOffset(value, 1));
        });
    }
}
