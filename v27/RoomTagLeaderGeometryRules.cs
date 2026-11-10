using System.Text.Json.Serialization;

namespace RevitAutoV27;

internal sealed record RoomTagLeaderField<T>(string State,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] T? Value,
    string? Reason = null, string? ErrorType = null) where T : struct;
internal sealed record RoomTagLeaderGeometry(
    RoomTagLeaderField<bool> HasLeader, RoomTagLeaderField<bool> HasElbow,
    RoomTagLeaderField<TagPosition> End, RoomTagLeaderField<TagPosition> Elbow);

internal static class RoomTagLeaderGeometryRules
{
    public static RoomTagLeaderGeometry Capture(Func<bool> readHasLeader, Func<bool> readHasElbow,
        Func<TagPosition?> readEnd, Func<TagPosition?> readElbow)
    {
        var hasLeader = Read<bool>(() => readHasLeader(), _ => true);
        if (hasLeader.State != "known")
            return new(hasLeader, Unknown<bool>("leader-presence-unknown"),
                Unknown<TagPosition>("leader-presence-unknown"), Unknown<TagPosition>("leader-presence-unknown"));
        if (hasLeader.Value == false)
            return new(hasLeader, NotApplicable<bool>("tag-has-no-leader"),
                NotApplicable<TagPosition>("tag-has-no-leader"), NotApplicable<TagPosition>("tag-has-no-leader"));

        // End and elbow are independent observations. Never replace a failed getter with the head or LocationPoint.
        var end = Read(readEnd, Finite);
        var hasElbow = Read<bool>(() => readHasElbow(), _ => true);
        var elbow = hasElbow.State != "known" ? Unknown<TagPosition>("elbow-presence-unknown")
            : hasElbow.Value == false ? NotApplicable<TagPosition>("straight-leader-has-no-elbow")
            : Read(readElbow, Finite);
        return new(hasLeader, hasElbow, end, elbow);
    }

    private static bool Finite(TagPosition point) => double.IsFinite(point.Xmm) && double.IsFinite(point.Ymm) && double.IsFinite(point.Zmm);
    private static RoomTagLeaderField<T> Unknown<T>(string reason) where T : struct => new("unknown", null, reason);
    private static RoomTagLeaderField<T> NotApplicable<T>(string reason) where T : struct => new("not-applicable", null, reason);
    private static RoomTagLeaderField<T> Read<T>(Func<T?> read, Func<T, bool> valid) where T : struct
    {
        try
        {
            var value = read();
            if (!value.HasValue) return new("unavailable", null, "native-value-unavailable");
            return valid(value.Value) ? new("known", value) : new("unknown", null, "non-finite-position");
        }
        catch (Exception error) when (error is not (OperationCanceledException or OutOfMemoryException))
        {
            return new("unknown", null, "native-read-failed", error.GetType().Name);
        }
    }
}
