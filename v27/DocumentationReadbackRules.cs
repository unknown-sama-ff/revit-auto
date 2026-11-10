namespace RevitAutoV27;

internal readonly record struct DocumentationPlacementReadback(long PlacementId, string ClassName, long SheetId, long ViewId, double Xmm, double Ymm, double Zmm);

internal sealed record DocumentationReadbackEvidence(bool NativeReadbackVerified, bool PlacementWritePerformed,
    bool SideEffectsVerified, bool PersistenceVerified, bool VisualVerified, double ToleranceMm);

internal static class DocumentationReadbackRules
{
    private const double ToleranceMm = 1;
    private static BridgeException Invalid(string message) => new("invalid_documentation_readback", message);

    public static void RequirePlacement(DocumentationPlacementReadback expected, DocumentationPlacementReadback actual)
    {
        if (expected.PlacementId <= 0 || actual.PlacementId != expected.PlacementId ||
            string.IsNullOrWhiteSpace(expected.ClassName) || actual.ClassName != expected.ClassName ||
            expected.SheetId <= 0 || actual.SheetId != expected.SheetId || expected.ViewId <= 0 || actual.ViewId != expected.ViewId ||
            !Finite(expected.Xmm) || !Finite(expected.Ymm) || !Finite(expected.Zmm) ||
            !Finite(actual.Xmm) || !Finite(actual.Ymm) || !Finite(actual.Zmm) ||
            Math.Sqrt(Math.Pow(actual.Xmm - expected.Xmm, 2) + Math.Pow(actual.Ymm - expected.Ymm, 2)) > ToleranceMm)
            throw Invalid("Native placement class, owner/source relationship or paper XY differs from the reviewed operation; roll back.");
    }

    public static DocumentationReadbackEvidence Receipt(DocumentationPlacementReadback actual, bool writePerformed, bool noOp)
    {
        if (actual.PlacementId <= 0 || string.IsNullOrWhiteSpace(actual.ClassName) || !Finite(actual.Xmm) || !Finite(actual.Ymm) || !Finite(actual.Zmm))
            throw Invalid("Native placement evidence is missing or non-finite.");
        return new(true, writePerformed && !noOp, false, false, false, ToleranceMm);
    }

    private static bool Finite(double value) => double.IsFinite(value);
}
