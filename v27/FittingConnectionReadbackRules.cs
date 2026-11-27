namespace RevitAutoV27;

internal sealed record FittingEndpointBinding(long OwnerId, string OwnerUniqueId, int ConnectorId, string Domain, string ConnectorType);
internal sealed record FittingPortReadback(int ConnectorId, string Domain, string ConnectorType);
internal sealed record FittingPortLink(int FittingConnectorId, bool EndpointToFitting, bool FittingToEndpoint);
internal sealed record FittingEndReadback(FittingEndpointBinding Endpoint, FittingPortLink[] Links);
internal sealed record FittingCreationBinding(long FittingId, string UniqueId, long TypeId, string Category, string FittingKind,
    FittingEndpointBinding First, FittingEndpointBinding Second);
internal sealed record FittingConnectionReadback(long FittingId, string UniqueId, long TypeId, string Category,
    FittingPortReadback[] Ports, FittingEndReadback First, FittingEndReadback Second);

internal static class FittingConnectionReadbackRules
{
    internal const int MaxPorts = 128;
    private const long MaxSafeId = 9007199254740991;
    private static BridgeException Invalid(string message) => new("invalid_fitting_readback", message);
    internal static bool Physical(string type) => type is "End" or "Curve";
    internal static bool Kind(string kind) => kind is "elbow" or "union" or "transition";
    private static bool Id(long value) => value > 0 && value <= MaxSafeId;
    internal static void RequireEndpoint(FittingEndpointBinding endpoint)
    {
        if (endpoint is null || !Id(endpoint.OwnerId) || string.IsNullOrWhiteSpace(endpoint.OwnerUniqueId) || endpoint.ConnectorId < 0 ||
            endpoint.Domain is not ("DomainPiping" or "DomainHvac" or "DomainCableTrayConduit") || !Physical(endpoint.ConnectorType))
            throw Invalid("A fitting endpoint must be a complete local physical pipe/duct/cable-tray/conduit connector.");
    }
    internal static bool CategoryMatchesDomain(string domain, string category) => domain switch
    {
        "DomainPiping" => category == "OST_PipeFitting",
        "DomainHvac" => category == "OST_DuctFitting",
        "DomainCableTrayConduit" => category is "OST_CableTrayFitting" or "OST_ConduitFitting",
        _ => false
    };
    internal static void Require(FittingCreationBinding expected, FittingConnectionReadback actual)
    {
        RequireEndpoint(expected.First); RequireEndpoint(expected.Second);
        if (!Kind(expected.FittingKind) || expected.First.OwnerId == expected.Second.OwnerId || expected.First.Domain != expected.Second.Domain ||
            !Id(expected.FittingId) || !Id(expected.TypeId) || string.IsNullOrWhiteSpace(expected.UniqueId) || !CategoryMatchesDomain(expected.First.Domain, expected.Category) ||
            actual is null || actual.FittingId != expected.FittingId || actual.UniqueId != expected.UniqueId ||
            actual.TypeId != expected.TypeId || actual.Category != expected.Category ||
            actual.First is null || actual.Second is null || actual.First.Endpoint != expected.First || actual.Second.Endpoint != expected.Second)
            throw Invalid("The created fitting or its reviewed endpoint identities changed; roll back.");
        if (actual.Ports is null || actual.Ports.Length != 2 || actual.Ports.Any(p => p is null || p.ConnectorId < 0 ||
            p.Domain != expected.First.Domain || !Physical(p.ConnectorType)) || actual.Ports.Select(p => p.ConnectorId).Distinct().Count() != 2)
            throw Invalid("The requested two-port fitting has missing, extra or incompatible physical ports; roll back.");
        int Port(FittingEndReadback end)
        {
            if (end.Links is null || end.Links.Length != 1 || end.Links[0] is not { EndpointToFitting: true, FittingToEndpoint: true } link ||
                !actual.Ports.Any(p => p.ConnectorId == link.FittingConnectorId))
                throw Invalid("Each reviewed endpoint must connect reciprocally to exactly one port of this created fitting; roll back.");
            return link.FittingConnectorId;
        }
        if (Port(actual.First) == Port(actual.Second))
            throw Invalid("The two reviewed endpoints must use different physical ports of this fitting; roll back.");
    }
    internal static object Receipt(FittingCreationBinding expected, FittingConnectionReadback actual, string phase)
    {
        Require(expected, actual);
        return new { phase, scope = "one-created-fitting-and-two-explicit-physical-endpoints",
            fittingId = actual.FittingId, actual.UniqueId, actual.TypeId, actual.Category, expected.FittingKind,
            requestedEndpoints = new[] { expected.First, expected.Second }, actual.Ports, first = actual.First, second = actual.Second,
            physicalConnectionVerified = true, reciprocalConnectionVerified = true, distinctFittingPortsVerified = true,
            nativeReadbackVerified = true, geometryVerified = false, routingComplianceVerified = false,
            systemMembershipVerified = false, sideEffectsVerified = false, persistenceVerified = false, visualVerified = false };
    }
}
