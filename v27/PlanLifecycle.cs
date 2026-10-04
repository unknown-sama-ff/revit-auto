using System.Text.Json;
namespace RevitAutoV27;

internal static class PlanLifetimePolicy
{
    public const int DefaultMinutes = 120;
    public const int MinMinutes = 15;
    public const int MaxMinutes = 480;
    public static DateTime Expires(DateTime now, int minutes = DefaultMinutes)
    {
        if (minutes < MinMinutes || minutes > MaxMinutes)
            throw new BridgeException("invalid_plan_lifetime", $"planLifetimeMinutes must be {MinMinutes}..{MaxMinutes}; document identity/revision checks are always required.");
        return now.AddMinutes(minutes);
    }
}

internal static class PlanLifecycle
{
    public static void ValidateConfirmation(ModelPlan plan, string documentIdentity, long revision, DateTime now)
    {
        if (plan.Status == "committed") return;
        if (plan.Status != "pending") throw new BridgeException("plan_not_pending", $"Plan is {plan.Status}.");
        if (now >= plan.ExpiresAtUtc) { plan.Status = "expired"; throw new BridgeException("plan_expired", "Plan expired. Re-preview."); }
        if (plan.DocumentIdentity != documentIdentity || plan.DocumentRevision != revision)
            throw new BridgeException("stale_plan", "The active project has changed since preview. Re-preview before modifying it.");
    }
}
