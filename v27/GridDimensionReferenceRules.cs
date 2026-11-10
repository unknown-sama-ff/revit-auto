namespace RevitAutoV27;

internal static class GridDimensionReferenceRules
{
    private static BridgeException Invalid() => new("invalid_grid_dimension_reference", "Native grid reference did not round-trip to the same local grid and stable representation.");
    public static void Require(long gridId, DimensionReferenceReadback original, DimensionReferenceReadback parsed)
    {
        if (gridId <= 0 || gridId > 9007199254740991 || original.ElementId != gridId || original.LinkedElementId != -1 ||
            string.IsNullOrWhiteSpace(original.StableReference) || original.StableReference.Length > DimensionCreationReadbackRules.MaxStableReferenceLength ||
            string.IsNullOrWhiteSpace(original.ReferenceType) || original != parsed)
            throw Invalid();
    }
}
