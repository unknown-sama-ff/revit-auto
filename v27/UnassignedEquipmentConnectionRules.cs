namespace RevitAutoV27;

// Selected-port resolution adapted from bimwright/rvt-mcp at b44ee0b8032f0603f8e52656bc05ab43aa599263,
// MepConnectionSystemType.cs (blob 417577a44ddf298df3c17a2a53b01a61d3a52f92). No native calls live here.
internal enum PipingAssignmentReadSource { Unknown, SelectedConnectorMepSystem, PipeSystemTypeParameter }
internal sealed record PipingAssignmentRead(bool Succeeded, bool? HasAssignedType, long? TypeId,
    string? Classification, PipingAssignmentReadSource Source, string? NativeError = null);
internal sealed record PipingPortNativeEvidence(PipingClassEvidence Piping, string OwnerUniqueId,
    string OwnerKind, string Category, string Domain, string ConnectorType,
    bool ConnectorClassReadSucceeded, PipingAssignmentRead Assignment, string? NativeError = null);
internal sealed record PipingConnectionDecision(PipingPortNativeEvidence First, PipingPortNativeEvidence Second,
    bool UsesUnassignedEquipmentAllowance, string? UnassignedEndpoint, string Classification, long? RequiredSystemTypeId);
internal sealed record UnassignedEquipmentConnectionReadback(PipingPortNativeEvidence First,
    PipingPortNativeEvidence Second, bool FirstReferencesSecond, bool SecondReferencesFirst);

internal static class UnassignedEquipmentConnectionRules
{
    private static BridgeException Refuse(string reason, object? evidence = null) =>
        new("piping_unassigned_equipment_refused", reason, evidence);

    // This allowance belongs only to connect_elements. The strict legacy path deliberately preserves
    // its existing classification behavior, including same-class / different-type-ID compatibility.
    internal static PipingConnectionDecision RequireCompatible(PipingPortNativeEvidence first,
        PipingPortNativeEvidence second, bool allowUnassignedEquipmentPort = false, string operationType = "connect_elements")
    {
        if (!allowUnassignedEquipmentPort || operationType != "connect_elements")
            return Strict(first, second);
        var firstClass = ResolvedOrUnknown(first.Piping);
        var secondClass = ResolvedOrUnknown(second.Piping);
        if (firstClass is not null && secondClass is not null) return Strict(first, second);
        if ((firstClass is null) == (secondClass is null))
            throw Refuse("Exactly one verified unassigned mechanical-equipment port and one classified pipe port are required.", new { first, second });

        var equipment = firstClass is null ? first : second;
        var pipe = firstClass is null ? second : first;
        RequireComplete(equipment); RequireComplete(pipe);
        if (equipment.Piping.ElementId == pipe.Piping.ElementId ||
            equipment.OwnerKind != "FamilyInstance" || equipment.Category != "OST_MechanicalEquipment" ||
            pipe.OwnerKind != "Pipe" || pipe.Category != "OST_PipeCurves")
            throw Refuse("The allowance requires distinct native MechanicalEquipment family-instance and Pipe owners.", new { first, second });
        if (equipment.Piping.ConnectorClass != "UndefinedSystemType" ||
            equipment.Assignment.Source != PipingAssignmentReadSource.SelectedConnectorMepSystem ||
            equipment.Assignment.HasAssignedType != false || equipment.Assignment.TypeId is not null ||
            equipment.Assignment.Classification is not null || equipment.Piping.AssignedSystemTypeId is not null ||
            equipment.Piping.AssignedClass is not null)
            throw Refuse("Equipment must have a successfully read UndefinedSystemType and a successfully read absent selected-connector system; missing evidence is unknown.", equipment);
        RequireAssigned(pipe);
        var classification = PipingCompatibilityRules.Resolve(pipe.Piping);
        return new(first, second, true, firstClass is null ? "first" : "second", classification, pipe.Assignment.TypeId);
    }

    // Keep the reviewed pre-connection proof: after ConnectTo the equipment is expected to acquire
    // an assigned system, so rerunning the precondition alone would discard that proof.
    internal static void RequireReadback(PipingConnectionDecision expected, UnassignedEquipmentConnectionReadback actual)
    {
        if (!expected.UsesUnassignedEquipmentAllowance)
            throw Refuse("This readback rule is only for a reviewed unassigned-equipment allowance.", expected);
        var reviewed = RequireCompatible(expected.First, expected.Second, true);
        if (reviewed != expected || actual is null || !SamePort(expected.First, actual.First) ||
            !SamePort(expected.Second, actual.Second) || !actual.FirstReferencesSecond || !actual.SecondReferencesFirst)
            throw Refuse("Reviewed endpoint identities and their exact reciprocal physical connection must survive native reread.", new { expected, actual });
        foreach (var endpoint in new[] { actual.First, actual.Second })
        {
            RequireComplete(endpoint); RequireAssigned(endpoint);
            if (endpoint.Assignment.TypeId != expected.RequiredSystemTypeId ||
                PipingCompatibilityRules.Resolve(endpoint.Piping) != expected.Classification)
                throw Refuse("Both selected ports must read back the reviewed assigned system type and compatible classification.", new { expected, actual });
        }
        PipingCompatibilityRules.RequireCompatible(actual.First.Piping, actual.Second.Piping);
    }

    private static PipingConnectionDecision Strict(PipingPortNativeEvidence first, PipingPortNativeEvidence second)
    {
        PipingCompatibilityRules.RequireCompatible(first.Piping, second.Piping);
        return new(first, second, false, null, PipingCompatibilityRules.Resolve(first.Piping), null);
    }
    private static string? ResolvedOrUnknown(PipingClassEvidence evidence)
    {
        try { return PipingCompatibilityRules.Resolve(evidence); }
        catch (BridgeException e) when (e.Code == "piping_classification_unknown") { return null; }
    }
    private static void RequireComplete(PipingPortNativeEvidence e)
    {
        if (e is null || e.Piping is null || e.Assignment is null || e.Piping.ElementId <= 0 || e.Piping.ConnectorId < 0 ||
            string.IsNullOrWhiteSpace(e.OwnerUniqueId) || e.Domain != "DomainPiping" ||
            e.ConnectorType is not ("End" or "Curve") || !e.ConnectorClassReadSucceeded ||
            e.Piping.ConnectorClass is null || e.NativeError is not null || e.Piping.NativeError is not null ||
            !e.Assignment.Succeeded || e.Assignment.NativeError is not null || e.Assignment.HasAssignedType is null ||
            e.Assignment.Source == PipingAssignmentReadSource.Unknown)
            throw Refuse("The allowance requires successful native identity, physical piping-port, classification and selected-port assignment reads.", e);
    }
    private static void RequireAssigned(PipingPortNativeEvidence e)
    {
        if (e.Assignment.HasAssignedType != true || e.Assignment.TypeId is not > 0 ||
            e.Assignment.Classification is null || e.Piping.AssignedSystemTypeId != e.Assignment.TypeId ||
            e.Piping.AssignedClass != e.Assignment.Classification ||
            (e.Assignment.Source != PipingAssignmentReadSource.SelectedConnectorMepSystem &&
             !(e.OwnerKind == "Pipe" && e.Assignment.Source == PipingAssignmentReadSource.PipeSystemTypeParameter)))
            throw Refuse("Assigned native type resolution must succeed and agree with the existing classification evidence.", e);
        // Resolve rejects a conflicting concrete connector classification; it must not be overridden.
        if (PipingCompatibilityRules.Resolve(e.Piping) != e.Assignment.Classification)
            throw Refuse("Assigned system classification must be a concrete supported piping classification.", e);
    }
    private static bool SamePort(PipingPortNativeEvidence expected, PipingPortNativeEvidence actual) =>
        actual is not null && actual.Piping is not null && expected.Piping.ElementId == actual.Piping.ElementId &&
        expected.Piping.ConnectorId == actual.Piping.ConnectorId && expected.OwnerUniqueId == actual.OwnerUniqueId &&
        expected.OwnerKind == actual.OwnerKind && expected.Category == actual.Category && expected.Domain == actual.Domain &&
        expected.ConnectorType == actual.ConnectorType;
}
