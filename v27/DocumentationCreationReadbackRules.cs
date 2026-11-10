using System.Text.Json;
using System.Text.Json.Serialization;

namespace RevitAutoV27;

internal readonly record struct TagPosition(
    [property: JsonPropertyName("xMm")] double Xmm,
    [property: JsonPropertyName("yMm")] double Ymm,
    [property: JsonPropertyName("zMm")] double Zmm);
internal sealed record TagNativeObservation<T>(string State, T? Value, string? Reason, string? ErrorType) where T : struct;
internal sealed record TagPositionSnapshot(
    TagNativeObservation<TagPosition> HeadPosition,
    TagNativeObservation<TagPosition> GenericLocationPoint,
    TagNativeObservation<bool> HasLeader);

internal static class TagPositionSnapshotRules
{
    public static TagPositionSnapshot Capture(Func<TagPosition?> readHead, Func<TagPosition?> readLocation, Func<bool> readLeader) =>
        new(Read(readHead, Finite), Read(readLocation, Finite), Read<bool>(() => readLeader(), _ => true));

    private static bool Finite(TagPosition point) => double.IsFinite(point.Xmm) && double.IsFinite(point.Ymm) && double.IsFinite(point.Zmm);

    private static TagNativeObservation<T> Read<T>(Func<T?> read, Func<T, bool> valid) where T : struct
    {
        try
        {
            var value = read();
            if (!value.HasValue) return new("unavailable", null, "native-value-unavailable", null);
            if (!valid(value.Value)) return new("unknown", null, "non-finite-position", null);
            return new("known", value, null, null);
        }
        catch (Exception error)
        {
            return new("unknown", null, "native-read-failed", error.GetType().Name);
        }
    }
}

internal readonly record struct TagTargetReference(long HostElementId, long LinkInstanceId, long LinkedElementId);
internal readonly record struct TagTargetReadback(long TagId, string ClassName, long ViewId, long TypeId,
    bool IsOrphaned, IReadOnlyList<TagTargetReference> Targets);

internal static class TagTargetRules
{
    private static BridgeException Invalid() => new("invalid_tag_target",
        "Created tag identity, class, view, type or local target differs from the reviewed creation; roll back.");

    public static void Require(TagTargetReadback expected, TagTargetReadback actual)
    {
        if (expected.TagId <= 0 || expected.ViewId <= 0 || expected.TypeId <= 0 ||
            expected.ClassName is not ("RoomTag" or "IndependentTag") || expected.IsOrphaned ||
            expected.Targets is null || expected.Targets.Count != 1 ||
            expected.Targets[0].HostElementId <= 0 || expected.Targets[0].LinkInstanceId != -1 ||
            expected.Targets[0].LinkedElementId != -1 || actual.IsOrphaned ||
            actual.TagId != expected.TagId || actual.ClassName != expected.ClassName ||
            actual.ViewId != expected.ViewId || actual.TypeId != expected.TypeId ||
            actual.Targets is null || !actual.Targets.SequenceEqual(expected.Targets))
            throw Invalid();
    }

    public static object Receipt(TagTargetReadback expected, TagTargetReadback actual, string phase)
    {
        Require(expected, actual);
        return new { phase, tagId = actual.TagId, className = actual.ClassName, viewId = actual.ViewId,
            typeId = actual.TypeId, targetElementId = expected.Targets[0].HostElementId,
            actualTargets = actual.Targets, isOrphaned = actual.IsOrphaned, targetAssociationVerified = true,
            nativeReadbackVerified = true, geometryVerified = false, sideEffectsVerified = false,
            persistenceVerified = false, visualVerified = false };
    }
}

internal readonly record struct TagLeaderReadback(long TagId, string ClassName, long ViewId, bool HasLeader);
internal static class TagLeaderRules
{
    private static BridgeException Invalid(string message) => new("invalid_tag_leader", message);
    public static bool? Requested(JsonElement op)
    {
        if (!op.TryGetProperty("leader", out var value)) return null;
        if (value.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
            throw Invalid("create_tag leader must be an explicit boolean when supplied.");
        return value.GetBoolean();
    }
    public static void Require(TagLeaderReadback expected, TagLeaderReadback actual)
    {
        if (expected.TagId <= 0 || expected.ViewId <= 0 || expected.ClassName is not ("RoomTag" or "IndependentTag") ||
            actual.TagId != expected.TagId || actual.ClassName != expected.ClassName || actual.ViewId != expected.ViewId ||
            actual.HasLeader != expected.HasLeader)
            throw Invalid("Created tag identity, class, owner view or leader differs from the reviewed request; roll back.");
    }
    public static object Receipt(TagLeaderReadback expected, TagLeaderReadback actual, string phase)
    {
        Require(expected, actual);
        return new { phase, tagId = actual.TagId, className = actual.ClassName, viewId = actual.ViewId,
            requestedLeader = expected.HasLeader, actualLeader = actual.HasLeader, nativeReadbackVerified = true,
            sideEffectsVerified = false, persistenceVerified = false, visualVerified = false };
    }
}

internal readonly record struct DocumentationSheetCreationReadback(
    long SheetId,
    string ClassName,
    string Number,
    string Name,
    long? RequestedTitleBlockTypeId,
    IReadOnlyList<long> TitleBlockIds,
    IReadOnlyList<long> TitleBlockTypeIds);

internal static class DocumentationCreationReadbackRules
{
    private const int EvidenceLimit = 1000;
    private static BridgeException Invalid(string message) => new("invalid_documentation_readback", message);

    public static void RequireSheet(DocumentationSheetCreationReadback expected, DocumentationSheetCreationReadback actual)
    {
        if (expected.SheetId <= 0 || actual.SheetId != expected.SheetId ||
            expected.ClassName != "ViewSheet" || actual.ClassName != expected.ClassName ||
            string.IsNullOrWhiteSpace(expected.Number) || actual.Number != expected.Number ||
            string.IsNullOrWhiteSpace(expected.Name) || actual.Name != expected.Name ||
            expected.RequestedTitleBlockTypeId != actual.RequestedTitleBlockTypeId ||
            !Ids(actual.TitleBlockIds) || !Ids(expected.TitleBlockIds) ||
            !Ids(actual.TitleBlockTypeIds) || !Ids(expected.TitleBlockTypeIds) ||
            !expected.TitleBlockIds.SequenceEqual(actual.TitleBlockIds) ||
            !expected.TitleBlockTypeIds.SequenceEqual(actual.TitleBlockTypeIds) ||
            expected.RequestedTitleBlockTypeId is long requested &&
            (!actual.TitleBlockTypeIds.Contains(requested) || actual.TitleBlockTypeIds.Count != 1))
            throw Invalid("Native sheet class, number, name or title-block membership differs from the reviewed creation; roll back.");
    }

    public static void RequireViewport(DocumentationPlacementReadback expected, DocumentationPlacementReadback actual) =>
        DocumentationReadbackRules.RequirePlacement(expected, actual);

    public static string ExpectedPlacementClass(string sourceViewClassName) => sourceViewClassName switch
    {
        "ViewSchedule" => "ScheduleSheetInstance",
        "PanelScheduleView" => "PanelScheduleSheetInstance",
        _ => "Viewport"
    };

    public static object SheetReceipt(DocumentationSheetCreationReadback actual, bool writePerformed)
    {
        if (actual.SheetId <= 0 || actual.ClassName != "ViewSheet" || string.IsNullOrWhiteSpace(actual.Number) ||
            string.IsNullOrWhiteSpace(actual.Name) || !Ids(actual.TitleBlockIds) || !Ids(actual.TitleBlockTypeIds) ||
            actual.RequestedTitleBlockTypeId is long requested &&
            (!actual.TitleBlockTypeIds.Contains(requested) || actual.TitleBlockTypeIds.Count != 1))
            throw Invalid("Native sheet creation evidence is missing or invalid.");
        return new
        {
            sheetId = actual.SheetId,
            className = actual.ClassName,
            number = actual.Number,
            name = actual.Name,
            requestedTitleBlockTypeId = actual.RequestedTitleBlockTypeId,
            titleBlockIds = actual.TitleBlockIds,
            titleBlockTypeIds = actual.TitleBlockTypeIds,
            sheetWritePerformed = writePerformed,
            nativeReadbackVerified = true,
            sideEffectsVerified = false,
            persistenceVerified = false,
            visualVerified = false
        };
    }

    private static bool Ids(IReadOnlyList<long>? ids) => ids is not null && ids.Count <= EvidenceLimit &&
        ids.All(id => id > 0) && ids.Distinct().Count() == ids.Count;
}
