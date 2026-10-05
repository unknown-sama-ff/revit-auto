namespace RevitAutoV27;

internal enum MechanicalPortAuditState
{
    Unconnected,
    Connected,
    Unknown
}

internal static class MechanicalPortAuditClassification
{
    public static MechanicalPortAuditState Classify(bool connectionStatusSupported, bool? connected)
    {
        if (!connectionStatusSupported || connected is null) return MechanicalPortAuditState.Unknown;
        return connected.Value ? MechanicalPortAuditState.Connected : MechanicalPortAuditState.Unconnected;
    }
}
