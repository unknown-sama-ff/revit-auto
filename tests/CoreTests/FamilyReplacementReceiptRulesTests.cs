using RevitAutoV27;

internal static class FamilyReplacementReceiptRulesTests
{
    internal static void Run(Action<string, Action> test)
    {
        test("family replacement receipt preserves retained type and family ids", () =>
        {
            var result = FamilyLibraryRules.ReplacementChangedIds(10, [20, 21], new HashSet<long> { 10, 20, 21, 99 });
            if (!result.SequenceEqual(new long[] { 20, 21, 10 })) throw new Exception("Retained replacement ids changed.");
        });
        test("family replacement receipt accepts removal of original native family and types", () =>
        {
            var result = FamilyLibraryRules.ReplacementChangedIds(10, [20], new HashSet<long> { 30, 40 });
            if (result.Count != 0) throw new Exception("Deleted original ids were reported as surviving changes.");
        });
        test("family replacement receipt keeps surviving types when original family is replaced", () =>
        {
            var result = FamilyLibraryRules.ReplacementChangedIds(10, [20, 21], new HashSet<long> { 20, 30 });
            if (!result.SequenceEqual(new long[] { 20 })) throw new Exception("A surviving original type was lost.");
        });
        test("new family receipts report no preexisting changes and replacement ids remain unique", () =>
        {
            if (FamilyLibraryRules.ReplacementChangedIds(null, [], new HashSet<long> { 30 }).Count != 0)
                throw new Exception("A new family invented a prior change.");
            var result = FamilyLibraryRules.ReplacementChangedIds(10, [20, 20, 10], new HashSet<long> { 10, 20 });
            if (!result.SequenceEqual(new long[] { 20, 10 })) throw new Exception("Replacement ids were duplicated.");
        });
    }
}
