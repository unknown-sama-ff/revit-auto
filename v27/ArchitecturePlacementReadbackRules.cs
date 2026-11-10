namespace RevitAutoV27;

internal readonly record struct ArchitecturePlacementReadback(double Xmm, double Ymm, double Zmm, double RotationRadians);

internal static class ArchitecturePlacementReadbackRules
{
    private static BridgeException Invalid(string message) => new("invalid_operation", message);

    public static double ExpectedRotation(double initialRotationRadians, double rotationDegrees)
    {
        var expected = initialRotationRadians + rotationDegrees * (Math.PI / 180);
        if (!double.IsFinite(initialRotationRadians) || !double.IsFinite(rotationDegrees) || !double.IsFinite(expected))
            throw Invalid("Copied door/window rotation requires finite native and reviewed angles; roll back.");
        return expected;
    }

    public static void Require(ArchitecturePlacementReadback expected, ArchitecturePlacementReadback actual)
    {
        static bool Finite(ArchitecturePlacementReadback value) => double.IsFinite(value.Xmm) && double.IsFinite(value.Ymm) &&
            double.IsFinite(value.Zmm) && double.IsFinite(value.RotationRadians);
        if (!Finite(expected) || !Finite(actual))
            throw Invalid("Copied door/window placement point or rotation is non-finite; it cannot certify reviewed geometry.");
        var distanceMm = Math.Sqrt(Math.Pow(actual.Xmm - expected.Xmm, 2) + Math.Pow(actual.Ymm - expected.Ymm, 2) + Math.Pow(actual.Zmm - expected.Zmm, 2));
        var difference = actual.RotationRadians - expected.RotationRadians;
        var angleDifference = Math.Abs(Math.Atan2(Math.Sin(difference), Math.Cos(difference)));
        if (!double.IsFinite(distanceMm) || !double.IsFinite(angleDifference) || distanceMm > 1 || angleDifference > 1e-6)
            throw Invalid("Native copied door/window point or relative rotation differs from the reviewed placement; roll back.");
    }
}
