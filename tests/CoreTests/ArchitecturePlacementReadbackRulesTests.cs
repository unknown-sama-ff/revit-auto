using RevitAutoV27;

internal static class ArchitecturePlacementReadbackRulesTests
{
    private static void Reject(Action action)
    {
        try { action(); }
        catch (BridgeException error) when (error.Code == "invalid_operation") { return; }
        throw new Exception("Expected invalid_operation.");
    }

    public static void Run(Action<string, Action> test)
    {
        test("copied hosted placement preserves native wall direction and reviewed relative rotation", () =>
        {
            var expected = ArchitecturePlacementReadbackRules.ExpectedRotation(Math.PI / 2, 90);
            if (Math.Abs(expected - Math.PI) > 1e-12) throw new Exception("Host direction was discarded.");
            ArchitecturePlacementReadbackRules.Require(new(1000, 2000, 900, expected), new(1000, 2000, 900, -Math.PI));
            Reject(() => ArchitecturePlacementReadbackRules.Require(new(1000, 2000, 900, expected), new(1000, 2000, 900, Math.PI / 2)));
        });
        test("copied placement angles accept equivalent turns and reject actual angular drift", () =>
        {
            foreach (var degrees in new[] { -360d, -90d, 0d, 90d, 360d })
            {
                var expected = ArchitecturePlacementReadbackRules.ExpectedRotation(Math.PI / 3, degrees);
                foreach (var turns in new[] { -2, -1, 0, 1, 2 })
                    ArchitecturePlacementReadbackRules.Require(new(0, 0, 0, expected), new(0, 0, 0, expected + turns * 2 * Math.PI));
                ArchitecturePlacementReadbackRules.Require(new(0, 0, 0, expected), new(0, 0, 0, expected + 0.9e-6));
                Reject(() => ArchitecturePlacementReadbackRules.Require(new(0, 0, 0, expected), new(0, 0, 0, expected + 1.1e-6)));
            }
        });
        test("copied placement uses full XYZ distance and refuses sill height relocation", () =>
        {
            var expected = new ArchitecturePlacementReadback(1000, 2000, 900, 0);
            ArchitecturePlacementReadbackRules.Require(expected, expected);
            ArchitecturePlacementReadbackRules.Require(expected, new(1000.5, 2000.5, 900.5, 0));
            Reject(() => ArchitecturePlacementReadbackRules.Require(expected, new(1000.8, 2000.8, 900, 0)));
            Reject(() => ArchitecturePlacementReadbackRules.Require(expected, new(1000, 2000, 1200, 0)));
            Reject(() => ArchitecturePlacementReadbackRules.Require(new(double.MaxValue, 0, 0, 0), new(-double.MaxValue, 0, 0, 0)));
        });
        test("copied placement nonfinite native and expected geometry never certify a match", () =>
        {
            var finite = new ArchitecturePlacementReadback(1, 2, 3, 0);
            foreach (var value in new[] { double.NaN, double.PositiveInfinity, double.NegativeInfinity })
            {
                foreach (var invalid in new[] { finite with { Xmm = value }, finite with { Ymm = value }, finite with { Zmm = value }, finite with { RotationRadians = value } })
                {
                    Reject(() => ArchitecturePlacementReadbackRules.Require(finite, invalid));
                    Reject(() => ArchitecturePlacementReadbackRules.Require(invalid, finite));
                }
                Reject(() => ArchitecturePlacementReadbackRules.ExpectedRotation(value, 0));
                Reject(() => ArchitecturePlacementReadbackRules.ExpectedRotation(0, value));
            }
            Reject(() => ArchitecturePlacementReadbackRules.ExpectedRotation(double.MaxValue, double.MaxValue));
            Reject(() => ArchitecturePlacementReadbackRules.Require(new(0, 0, 0, double.MaxValue), new(0, 0, 0, -double.MaxValue)));
        });
    }
}
