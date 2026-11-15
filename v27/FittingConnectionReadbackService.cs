using Autodesk.Revit.DB;

namespace RevitAutoV27;

internal sealed record FittingCreationInput(string FittingKind, FittingEndpointBinding First, FittingEndpointBinding Second);

internal sealed class FittingConnectionReadbackService
{
    private Document? document;
    private readonly List<FittingCreationBinding> bindings = [];
    private static BridgeException Invalid(string message) => new("invalid_fitting_readback", message);
    internal static void ValidateInput(string kind, Element? firstOwner)
    {
        if (!FittingConnectionReadbackRules.Kind(kind))
            throw new BridgeException("invalid_operation", "Supported fittings: elbow, union, transition.");
        if (kind == "transition" && firstOwner is not null && firstOwner is not MEPCurve)
            throw new BridgeException("invalid_operation", "A transition requires the first reviewed connector to belong to a pipe or duct curve, including flex curves. Do not silently reorder endpoints.");
    }
    private static FittingEndpointBinding Endpoint(Connector c)
    {
        if (!c.IsValidObject || !c.Owner.IsValidObject) throw Invalid("The reviewed physical connector is unavailable.");
        var result = new FittingEndpointBinding(c.Owner.Id.Value, c.Owner.UniqueId, c.Id, c.Domain.ToString(), c.ConnectorType.ToString());
        FittingConnectionReadbackRules.RequireEndpoint(result);
        return result;
    }
    internal static FittingCreationInput CaptureInput(Document doc, string kind, Connector first, Connector second)
    {
        ValidateInput(kind, first.Owner);
        if (!first.Owner.Document.Equals(doc) || !second.Owner.Document.Equals(doc))
            throw Invalid("Fitting endpoints must belong to the reviewed native document.");
        var a = Endpoint(first); var b = Endpoint(second);
        if (a.OwnerId == b.OwnerId || a.Domain != b.Domain) throw Invalid("Fitting endpoints must have different owners and the same physical domain.");
        return new(kind, a, b);
    }
    private static string Category(FamilyInstance fitting) => fitting.Category?.Id.Value switch
    {
        (long)BuiltInCategory.OST_PipeFitting => "OST_PipeFitting",
        (long)BuiltInCategory.OST_DuctFitting => "OST_DuctFitting",
        _ => throw Invalid("The created instance is not a native pipe or duct fitting.")
    };
    internal static FittingCreationBinding Bind(Document doc, FamilyInstance fitting, FittingCreationInput input)
    {
        if (!fitting.IsValidObject || !fitting.Document.Equals(doc)) throw Invalid("The fitting belongs to another document or is missing.");
        return new(fitting.Id.Value, fitting.UniqueId, fitting.GetTypeId().Value, Category(fitting), input.FittingKind, input.First, input.Second);
    }
    private static Connector Reacquire(Document doc, FittingEndpointBinding endpoint)
    {
        var owner = doc.GetElement(new ElementId(endpoint.OwnerId));
        if (owner is null || owner.UniqueId != endpoint.OwnerUniqueId) throw Invalid("A reviewed endpoint owner disappeared or was replaced.");
        return ConnectorResolutionService.ById(owner, endpoint.ConnectorId);
    }
    private static FittingConnectionReadback Read(Document doc, FittingCreationBinding binding)
    {
        var fitting = doc.GetElement(new ElementId(binding.FittingId)) as FamilyInstance ?? throw Invalid("The created fitting disappeared.");
        var manager = fitting.MEPModel?.ConnectorManager ?? throw Invalid("The created fitting has no connector manager.");
        var physical = new List<Connector>(); var inspected = 0;
        foreach (Connector port in manager.Connectors)
        {
            if (++inspected > FittingConnectionReadbackRules.MaxPorts) throw Invalid("Fitting ports exceed the readback budget; no partial connection acceptance.");
            if (!port.IsValidObject || port.Owner.Id != fitting.Id) throw Invalid("A native fitting connector is invalid or belongs to another element.");
            if (FittingConnectionReadbackRules.Physical(port.ConnectorType.ToString())) physical.Add(port);
        }
        FittingEndReadback End(FittingEndpointBinding expected)
        {
            var endpoint = Reacquire(doc, expected);
            var actual = Endpoint(endpoint);
            var links = new List<FittingPortLink>();
            // Adapted from rvt-mcp ConnectMepElementsHandler.HasPhysicalConnection, e49c796, Apache-2.0.
            // Bind to this exact created fitting, then require two distinct physical ports and both directions.
            foreach (var port in physical)
            {
                if (port.Domain != endpoint.Domain) throw Invalid("A fitting port domain differs from the reviewed endpoint.");
                var toFitting = endpoint.IsConnectedTo(port);
                var toEndpoint = port.IsConnectedTo(endpoint);
                if (toFitting || toEndpoint) links.Add(new(port.Id, toFitting, toEndpoint));
            }
            return new(actual, links.ToArray());
        }
        return new(fitting.Id.Value, fitting.UniqueId, fitting.GetTypeId().Value, Category(fitting),
            physical.Select(c => new FittingPortReadback(c.Id, c.Domain.ToString(), c.ConnectorType.ToString())).ToArray(), End(binding.First), End(binding.Second));
    }
    private object Verify(Document doc, FittingCreationBinding binding, string phase)
    {
        if (document is null || !document.IsValidObject || !document.Equals(doc)) throw Invalid("Fitting connection evidence belongs to another document.");
        try { return FittingConnectionReadbackRules.Receipt(binding, Read(doc, binding), phase); }
        catch (Exception error) when (error is not (BridgeException or OperationCanceledException or OutOfMemoryException))
        {
            throw new BridgeException("invalid_fitting_readback", "Native fitting connection evidence is unavailable; roll back instead of claiming connected or disconnected.",
                new { phase, fittingId = binding.FittingId, errorType = error.GetType().Name });
        }
    }
    internal OperationReceipt Remember(Document doc, FittingCreationBinding binding)
    {
        document ??= doc;
        doc.Regenerate();
        var evidence = Verify(doc, binding, "immediate-after-creation");
        bindings.Add(binding);
        return OperationReceipt.New(binding.FittingId) with { Evidence = evidence };
    }
    internal object VerifyCompleted(Document doc, string phase) => new
    {
        phase, verifiedFittingCount = bindings.Count, elements = bindings.Select(b => Verify(doc, b, phase)).ToArray(),
        nativeReadbackVerified = true, sideEffectsVerified = false, geometryVerified = false, persistenceVerified = false, visualVerified = false
    };
}
