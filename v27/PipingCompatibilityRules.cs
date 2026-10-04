namespace RevitAutoV27;
internal sealed record PipingClassEvidence(long ElementId, int ConnectorId, string? ConnectorClass, long? AssignedSystemTypeId, string? AssignedClass, string? NativeError = null);
internal static class PipingCompatibilityRules
{
    private static readonly HashSet<string> Concrete = new(StringComparer.Ordinal) { "SupplyHydronic", "ReturnHydronic", "DomesticColdWater", "DomesticHotWater", "Sanitary", "Vent", "OtherPipe", "FireProtectWet", "FireProtectDry", "FireProtectPreaction", "FireProtectOther", "Storm", "Recirculation", "CondensateDrain" };
    public static string Resolve(PipingClassEvidence e)
    {
        var connector=e.ConnectorClass is {} c && Concrete.Contains(c)?c:null;
        var assigned=e.AssignedSystemTypeId is >0 && e.AssignedClass is {} a && Concrete.Contains(a)?a:null;
        if(connector is not null && assigned is not null && connector!=assigned)throw new BridgeException("piping_classification_conflict",$"Element {e.ElementId} port {e.ConnectorId}: connector={e.ConnectorClass}, native assigned type {e.AssignedSystemTypeId}={e.AssignedClass}; refusing contradictory evidence.", e);
        if(assigned is not null)return assigned;
        if(connector is not null)return connector;
        throw new BridgeException("piping_classification_unknown",$"Element {e.ElementId} port {e.ConnectorId}: connector={e.ConnectorClass??"unknown"}, native assigned type={e.AssignedSystemTypeId}, classification={e.AssignedClass??"unknown"}; no verified piping classification.",e);
    }
    public static void RequireCompatible(PipingClassEvidence first,PipingClassEvidence second)
    {
        var a=Resolve(first);var b=Resolve(second);
        if(a!=b)throw new BridgeException("piping_classification_mismatch",$"Piping classifications differ: element {first.ElementId} port {first.ConnectorId}={a}, element {second.ElementId} port {second.ConnectorId}={b}.",new{first,second});
    }
}
