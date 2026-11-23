using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Plumbing;
namespace RevitAutoV27;

internal sealed class UnassignedEquipmentConnectionService
{
    private Document? document;
    private readonly List<PipingConnectionDecision> bindings = [];
    private static BridgeException Invalid(string message) => new("piping_unassigned_equipment_refused", message);
    internal static PipingPortNativeEvidence Capture(Connector connector)
    {
        var owner = connector.Owner;
        if (!connector.IsValidObject || !owner.IsValidObject) throw Invalid("Selected connector or owner is unavailable.");
        string? classification = null, readError = null;
        try { classification = connector.PipeSystemType.ToString(); }
        catch (Autodesk.Revit.Exceptions.InvalidOperationException error) { readError = error.GetType().Name; }
        PipingAssignmentRead assignment;
        try
        {
            var system = connector.MEPSystem;
            if (system is not null)
            {
                var nativeType = owner.Document.GetElement(system.GetTypeId()) as PipingSystemType
                    ?? throw Invalid("Selected connector system has no readable piping system type.");
                assignment = new(true, true, nativeType.Id.Value, nativeType.SystemClassification.ToString(), PipingAssignmentReadSource.SelectedConnectorMepSystem, SystemId: system.Id.Value);
            }
            else if (owner is Pipe)
            {
                var parameter = owner.get_Parameter(BuiltInParameter.RBS_PIPING_SYSTEM_TYPE_PARAM);
                if (parameter is not { StorageType: StorageType.ElementId, HasValue: true })
                    throw Invalid("Pipe system type parameter is unknown, not an unassigned equipment port.");
                var nativeType = owner.Document.GetElement(parameter.AsElementId()) as PipingSystemType
                    ?? throw Invalid("Pipe system type parameter does not identify an existing native piping system type.");
                assignment = new(true, true, nativeType.Id.Value, nativeType.SystemClassification.ToString(), PipingAssignmentReadSource.PipeSystemTypeParameter);
            }
            else assignment = new(true, false, null, null, PipingAssignmentReadSource.SelectedConnectorMepSystem);
        }
        catch (Exception error) when (error is not (OperationCanceledException or Autodesk.Revit.Exceptions.OperationCanceledException or OutOfMemoryException))
        { assignment = new(false, null, null, null, PipingAssignmentReadSource.Unknown, error.GetType().Name); }
        var evidence = new PipingClassEvidence(owner.Id.Value, connector.Id, classification, assignment.TypeId, assignment.Classification, readError);
        var category = owner.Category?.Id.Value switch { (long)BuiltInCategory.OST_MechanicalEquipment => "OST_MechanicalEquipment", (long)BuiltInCategory.OST_PipeCurves => "OST_PipeCurves", _ => "other" };
        return new(evidence, owner.UniqueId, owner is Pipe ? "Pipe" : owner is FamilyInstance ? "FamilyInstance" : owner.GetType().Name,
            category, connector.Domain.ToString(), connector.ConnectorType.ToString(), readError is null && classification is not null, assignment);
    }
    internal static PipingConnectionDecision Review(Connector first, Connector second) =>
        UnassignedEquipmentConnectionRules.RequireCompatible(Capture(first), Capture(second), true);
    private static Connector Reacquire(Document doc, PipingPortNativeEvidence expected)
    {
        var owner = doc.GetElement(new ElementId(expected.Piping.ElementId));
        if (owner is null || owner.UniqueId != expected.OwnerUniqueId) throw Invalid("Reviewed equipment/pipe owner changed or disappeared.");
        return ConnectorResolutionService.ById(owner, expected.Piping.ConnectorId);
    }
    private static object Verify(Document doc, PipingConnectionDecision expected, string phase)
    {
        var first = Reacquire(doc, expected.First); var second = Reacquire(doc, expected.Second);
        var actual = new UnassignedEquipmentConnectionReadback(Capture(first), Capture(second), first.IsConnectedTo(second), second.IsConnectedTo(first));
        var resolution = UnassignedEquipmentConnectionRules.RequireReadback(expected, actual);
        return new { phase, scope = "two-explicit-physical-ports-known-unassigned-equipment-to-assigned-pipe", reviewed = expected, actual,
            physicalConnectionVerified = resolution.PhysicalConnectionVerified, reciprocalConnectionVerified = true,
            pipeSystemTypeVerified = resolution.PipeSystemTypeVerified, equipmentSystemAssignmentState = resolution.EquipmentSystemAssignmentState,
            equipmentSystemTypeVerified = resolution.EquipmentSystemTypeVerified, systemMembershipVerified = resolution.SystemMembershipVerified,
            sideEffectsVerified = false, hydraulicComplianceVerified = false, routingComplianceVerified = false, persistenceVerified = false };
    }
    internal OperationReceipt Remember(Document doc, PipingConnectionDecision decision)
    {
        if (!decision.UsesUnassignedEquipmentAllowance) throw Invalid("Only actual unassigned allowance decisions are registered here.");
        if (document is not null && !document.Equals(doc)) throw Invalid("Connection evidence belongs to another document.");
        var evidence = Verify(doc, decision, "after-operation"); document = doc; bindings.Add(decision);
        return new([], [decision.First.Piping.ElementId, decision.Second.Piping.ElementId]) { Evidence = evidence };
    }
    internal object VerifyCompleted(Document doc, string phase)
    {
        if (bindings.Count != 0 && (document is null || !document.IsValidObject || !document.Equals(doc))) throw Invalid("Connection verification document changed.");
        return new { phase, connectionCount = bindings.Count, connections = bindings.Select(binding => Verify(doc, binding, phase)).ToArray() };
    }
}
