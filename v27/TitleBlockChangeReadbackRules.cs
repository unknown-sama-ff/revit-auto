namespace RevitAutoV27;

internal readonly record struct TitleBlockChangeReadback(long OriginalInstanceId, long ResultingInstanceId,
    long SheetId, long TargetTypeId, bool Replaced);

internal sealed record TitleBlockDependencyPreservation(long[] RequiredDependentElementIds,
    long[] ExemptOriginalSelfReferenceIds, long[] MissingDependentElementIds,
    bool Verified, bool AllOriginalDependentIdsStillExist);

internal static class TitleBlockChangeReadbackRules
{
    private static BridgeException Invalid(string message) => new("invalid_documentation_readback", message);
    private static bool ValidId(long id) => id > 0 && id <= 9007199254740991;

    private static void ValidateIdentity(TitleBlockChangeReadback expected)
    {
        if (!ValidId(expected.OriginalInstanceId) || !ValidId(expected.ResultingInstanceId) ||
            !ValidId(expected.SheetId) || !ValidId(expected.TargetTypeId) ||
            expected.Replaced != (expected.OriginalInstanceId != expected.ResultingInstanceId))
            throw Invalid("Titleblock readback requires valid native IDs and a replacement flag consistent with its original/result IDs.");
    }

    public static TitleBlockDependencyPreservation InspectDependencies(TitleBlockChangeReadback expected,
        IReadOnlyList<long> reviewedDependents, Func<long, bool> exists)
    {
        ValidateIdentity(expected);
        if (reviewedDependents is null || exists is null || reviewedDependents.Count > 1000)
            throw Invalid("Reviewed titleblock dependents and an existence reader are required, bounded to 1000 IDs.");
        var reviewed = reviewedDependents.ToArray();
        if (reviewed.Length > 1000 || reviewed.Any(id => !ValidId(id)) || reviewed.Distinct().Count() != reviewed.Length)
            throw Invalid("Reviewed titleblock dependent IDs must be complete, unique and valid positive native IDs.");

        // One coherent existence snapshot per invocation. Every later verification
        // stage calls this method again; no cached true can outlive this call.
        var presence = new Dictionary<long, bool>();
        bool Present(long id)
        {
            if (!presence.TryGetValue(id, out var value))
            {
                value = exists(id);
                presence.Add(id, value);
            }
            return value;
        }

        Require(expected, expected, Present(expected.OriginalInstanceId), requiredDependentsPresent: true);
        if (!Present(expected.ResultingInstanceId))
            throw Invalid("The resulting titleblock instance must exist during every dependency preservation check.");

        var exempt = reviewed.Where(id => expected.Replaced && id == expected.OriginalInstanceId).ToArray();
        var required = reviewed.Where(id => !expected.Replaced || id != expected.OriginalInstanceId).ToArray();
        var missing = required.Where(id => !Present(id)).ToArray();
        var allOriginalPresent = reviewed.All(Present);
        return new(required, exempt, missing, missing.Length == 0, allOriginalPresent);
    }

    public static void Require(TitleBlockChangeReadback expected, TitleBlockChangeReadback actual,
        bool originalInstancePresent, bool requiredDependentsPresent)
    {
        ValidateIdentity(expected);
        if (actual.OriginalInstanceId != expected.OriginalInstanceId || actual.ResultingInstanceId != expected.ResultingInstanceId ||
            actual.SheetId != expected.SheetId || actual.TargetTypeId != expected.TargetTypeId || actual.Replaced != expected.Replaced)
            throw Invalid("Native titleblock result ID, owner sheet, target type or replacement outcome differs from the reviewed operation; roll back.");
        if (expected.Replaced)
        {
            if (expected.OriginalInstanceId == expected.ResultingInstanceId || originalInstancePresent)
                throw Invalid("A reviewed titleblock replacement must produce a distinct result ID and remove the original instance.");
        }
        else if (expected.OriginalInstanceId != expected.ResultingInstanceId || !originalInstancePresent)
            throw Invalid("An in-place titleblock change must retain the original instance ID.");
        if (!requiredDependentsPresent) throw Invalid("Native type change deleted reviewed dependent elements; dependent deletion was not approved.");
    }
}
