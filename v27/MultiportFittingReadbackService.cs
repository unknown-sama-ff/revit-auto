using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Mechanical;
using Autodesk.Revit.DB.Plumbing;

namespace RevitAutoV27;

internal sealed record MultiportFittingCreationInput(Document Document, string FittingKind, FittingEndpointBinding[] Endpoints);

internal sealed class MultiportFittingReadbackService
{
    private Document? document;
    private readonly List<MultiportFittingCreationBinding> bindings = [];
    private static BridgeException Invalid(string message) => new("invalid_fitting_readback", message);
    private static bool PipeOrDuct(Element owner) => owner is Pipe or FlexPipe or Duct or FlexDuct;
    internal static void ValidateInput(string kind, IReadOnlyList<Element?> owners)
    {
        if (!MultiportFittingReadbackRules.Kind(kind))
            throw new BridgeException("invalid_operation", "Supported multiport fittings: tee and cross.");
        if (owners is null || owners.Count != MultiportFittingReadbackRules.EndpointCount(kind) ||
            owners.Any(o => o is null || !o.IsValidObject || !PipeOrDuct(o)))
            throw Invalid("A tee requires three, and a cross four, distinct explicit pipe/duct owners, including flex curves.");
        var first = owners[0]!;
        if (!first.Document.IsValidObject || owners.Any(o => !o!.Document.Equals(first.Document)) ||
            owners.Select(o => o!.Id.Value).Distinct().Count() != owners.Count ||
            owners.Select(o => o!.UniqueId).Distinct(StringComparer.Ordinal).Count() != owners.Count)
            throw Invalid("Multiport fitting owners must be distinct and belong to the same valid native document.");
    }
    private static FittingEndpointBinding Endpoint(Document doc, Connector connector)
    {
        if (connector is null || !connector.IsValidObject || connector.Owner is not { IsValidObject: true } owner ||
            !PipeOrDuct(owner) || !owner.Document.Equals(doc))
            throw Invalid("The reviewed pipe/duct endpoint is unavailable or belongs to another document.");
        var endpoint = new FittingEndpointBinding(owner.Id.Value, owner.UniqueId, connector.Id,
            connector.Domain.ToString(), connector.ConnectorType.ToString());
        FittingConnectionReadbackRules.RequireEndpoint(endpoint);
        return endpoint;
    }
    internal static MultiportFittingCreationInput CaptureInput(Document doc, string kind, IReadOnlyList<Connector> connectors)
    {
        if (doc is null || !doc.IsValidObject || connectors is null)
            throw Invalid("The reviewed native document or explicit connector list is unavailable.");
        if (!MultiportFittingReadbackRules.Kind(kind))
            throw new BridgeException("invalid_operation", "Supported multiport fittings: tee and cross.");
        if (connectors.Count != MultiportFittingReadbackRules.EndpointCount(kind))
            throw Invalid("Supply exactly three ordered tee endpoints or four ordered cross endpoints.");
        ValidateInput(kind, connectors.Select(c => c is { IsValidObject: true } ? c.Owner : null).ToArray());
        var endpoints = connectors.Select(c => Endpoint(doc, c)).ToArray();
        MultiportFittingReadbackRules.RequireInput(kind, endpoints);
        // Preserve factory argument order: tee 1/2 main run, 3 branch; cross 1/2 and 3/4 pairs.
        // Factory reuse: bimwright/rvt-mcp b44ee0b8032f0603f8e52656bc05ab43aa599263,
        // src/shared/Handlers/Mep/CreateMepFittingHandler.cs (Apache-2.0). No endpoint sorting or proximity fallback.
        return new(doc, kind, endpoints);
    }
    private static string Category(FamilyInstance fitting) => fitting.Category?.Id.Value switch
    {
        (long)BuiltInCategory.OST_PipeFitting => "OST_PipeFitting",
        (long)BuiltInCategory.OST_DuctFitting => "OST_DuctFitting",
        _ => throw Invalid("The created instance is not a native pipe or duct fitting.")
    };
    internal static MultiportFittingCreationBinding Bind(Document doc, FamilyInstance fitting, MultiportFittingCreationInput input)
    {
        if (doc is null || !doc.IsValidObject || input is null || !input.Document.IsValidObject || !input.Document.Equals(doc) ||
            fitting is null || !fitting.IsValidObject || !fitting.Document.Equals(doc))
            throw Invalid("The created fitting or its captured input belongs to another document or is unavailable.");
        MultiportFittingReadbackRules.RequireInput(input.FittingKind, input.Endpoints);
        var binding = new MultiportFittingCreationBinding(fitting.Id.Value, fitting.UniqueId, fitting.GetTypeId().Value,
            Category(fitting), input.FittingKind, input.Endpoints.ToArray());
        MultiportFittingReadbackRules.RequireBinding(binding);
        return binding;
    }
    private static Connector Reacquire(Document doc, FittingEndpointBinding expected)
    {
        var owner = doc.GetElement(new ElementId(expected.OwnerId));
        if (owner is null || !owner.IsValidObject || !PipeOrDuct(owner) || !owner.Document.Equals(doc) || owner.UniqueId != expected.OwnerUniqueId)
            throw Invalid("A reviewed pipe/duct owner disappeared, changed or was replaced.");
        var connector = ConnectorResolutionService.ById(owner, expected.ConnectorId);
        if (Endpoint(doc, connector) != expected) throw Invalid("A reviewed native connector identity, domain or type changed.");
        return connector;
    }
    private static MultiportFittingConnectionReadback Read(Document doc, MultiportFittingCreationBinding binding)
    {
        var fitting = doc.GetElement(new ElementId(binding.FittingId)) as FamilyInstance;
        if (fitting is null || !fitting.IsValidObject || !fitting.Document.Equals(doc) || fitting.UniqueId != binding.UniqueId ||
            fitting.GetTypeId().Value != binding.TypeId || Category(fitting) != binding.Category)
            throw Invalid("The exact created fitting disappeared, was replaced or changed type/category.");
        var manager = fitting.MEPModel?.ConnectorManager ?? throw Invalid("The created fitting has no connector manager.");
        var physical = new List<Connector>();
        var inspected = 0;
        foreach (Connector port in manager.Connectors)
        {
            if (++inspected > MultiportFittingReadbackRules.MaxPorts)
                throw Invalid("Fitting ports exceed the readback budget; partial connection evidence is not accepted.");
            if (!port.IsValidObject || !port.Owner.IsValidObject || !port.Owner.Document.Equals(doc) ||
                port.Owner.Id != fitting.Id || port.Owner.UniqueId != binding.UniqueId)
                throw Invalid("A fitting connector is invalid or belongs to another native element.");
            if (FittingConnectionReadbackRules.Physical(port.ConnectorType.ToString())) physical.Add(port);
        }
        if (physical.Count != MultiportFittingReadbackRules.EndpointCount(binding.FittingKind) ||
            physical.Select(p => p.Id).Distinct().Count() != physical.Count ||
            physical.Any(p => p.Domain.ToString() != binding.Endpoints[0].Domain))
            throw Invalid("The exact created fitting has missing, extra, duplicate or cross-domain physical ports.");
        FittingEndReadback End(FittingEndpointBinding expected)
        {
            var endpoint = Reacquire(doc, expected);
            var links = new List<FittingPortLink>();
            // Adapt existing two-port exact-owner reciprocal IsConnectedTo readback, without AllRefs or nearest-port guesses.
            foreach (var port in physical)
            {
                var toFitting = endpoint.IsConnectedTo(port);
                var toEndpoint = port.IsConnectedTo(endpoint);
                if (toFitting || toEndpoint) links.Add(new(port.Id, toFitting, toEndpoint));
            }
            return new(Endpoint(doc, endpoint), links.ToArray());
        }
        return new(fitting.Id.Value, fitting.UniqueId, fitting.GetTypeId().Value, Category(fitting),
            physical.Select(p => new FittingPortReadback(p.Id, p.Domain.ToString(), p.ConnectorType.ToString())).ToArray(),
            binding.Endpoints.Select(End).ToArray());
    }
    private object Verify(Document doc, MultiportFittingCreationBinding binding, string phase)
    {
        if (document is null || !document.IsValidObject || !document.Equals(doc))
            throw Invalid("Multiport fitting connection evidence belongs to another document.");
        try { return MultiportFittingReadbackRules.Receipt(binding, Read(doc, binding), phase); }
        catch (Exception error) when (error is not (BridgeException or OperationCanceledException or OutOfMemoryException))
        {
            throw new BridgeException("invalid_fitting_readback", "Native multiport fitting evidence is unavailable; roll back instead of claiming connected or disconnected.",
                new { phase, fittingId = binding.FittingId, errorType = error.GetType().Name });
        }
    }
    internal OperationReceipt Remember(Document doc, MultiportFittingCreationBinding binding)
    {
        MultiportFittingReadbackRules.RequireBinding(binding);
        if (bindings.Any(b => b.FittingId == binding.FittingId || b.UniqueId == binding.UniqueId))
            throw Invalid("The same created fitting cannot be registered twice.");
        document ??= doc;
        if (!document.IsValidObject || !document.Equals(doc)) throw Invalid("Multiport fitting evidence belongs to another document.");
        doc.Regenerate();
        var evidence = Verify(doc, binding, "immediate-after-creation");
        bindings.Add(binding with { Endpoints = binding.Endpoints.ToArray() });
        return OperationReceipt.New(binding.FittingId) with { Evidence = evidence };
    }
    internal object VerifyCompleted(Document doc, string phase) => new
    {
        phase, verifiedFittingCount = bindings.Count, elements = bindings.Select(b => Verify(doc, b, phase)).ToArray(),
        nativeReadbackVerified = true, geometryVerified = false, routingComplianceVerified = false,
        systemMembershipVerified = false, sideEffectsVerified = false, persistenceVerified = false, visualVerified = false
    };
}
