namespace RevitAutoV27;

// Reuse the established endpoint/port evidence shapes; two-port rules remain unchanged.
internal sealed record MultiportFittingCreationBinding(long FittingId, string UniqueId, long TypeId, string Category,
    string FittingKind, FittingEndpointBinding[] Endpoints);
internal sealed record MultiportFittingConnectionReadback(long FittingId, string UniqueId, long TypeId, string Category,
    FittingPortReadback[] Ports, FittingEndReadback[] Endpoints);

internal static class MultiportFittingReadbackRules
{
    internal const int MaxPorts = FittingConnectionReadbackRules.MaxPorts;
    private const long MaxSafeId = 9007199254740991;
    private static BridgeException Invalid(string message) => new("invalid_fitting_readback", message);
    internal static bool Kind(string kind) => kind is "tee" or "cross";
    internal static int EndpointCount(string kind) => kind switch
    {
        "tee" => 3, "cross" => 4,
        _ => throw Invalid("Supported multiport fittings: tee and cross.")
    };
    internal static void RequireInput(string kind, IReadOnlyList<FittingEndpointBinding> endpoints)
    {
        var count = EndpointCount(kind);
        if (endpoints is null || endpoints.Count != count)
            throw Invalid("A tee requires three, and a cross four, explicit ordered physical endpoints.");
        foreach (var endpoint in endpoints) FittingConnectionReadbackRules.RequireEndpoint(endpoint);
        if (endpoints.Select(e => e.OwnerId).Distinct().Count() != count ||
            endpoints.Select(e => e.OwnerUniqueId).Distinct(StringComparer.Ordinal).Count() != count ||
            endpoints.Any(e => e.Domain != endpoints[0].Domain))
            throw Invalid("Multiport fitting endpoints must have distinct native owners and the same pipe/duct domain.");
    }
    internal static void RequireBinding(MultiportFittingCreationBinding expected)
    {
        if (expected is null) throw Invalid("The created fitting binding is missing.");
        RequireInput(expected.FittingKind, expected.Endpoints);
        if (expected.FittingId <= 0 || expected.FittingId > MaxSafeId || expected.TypeId <= 0 || expected.TypeId > MaxSafeId ||
            string.IsNullOrWhiteSpace(expected.UniqueId) ||
            !FittingConnectionReadbackRules.CategoryMatchesDomain(expected.Endpoints[0].Domain, expected.Category) ||
            expected.Endpoints.Any(e => e.OwnerId == expected.FittingId || e.OwnerUniqueId == expected.UniqueId))
            throw Invalid("The created fitting requires a distinct native identity, valid type and matching MEP fitting category.");
    }
    internal static void Require(MultiportFittingCreationBinding expected, MultiportFittingConnectionReadback actual)
    {
        RequireBinding(expected);
        var count = expected.Endpoints.Length;
        if (actual is null || actual.FittingId != expected.FittingId || actual.UniqueId != expected.UniqueId ||
            actual.TypeId != expected.TypeId || actual.Category != expected.Category ||
            actual.Endpoints is null || actual.Endpoints.Length != count)
            throw Invalid("The created multiport fitting identity, type, category or endpoint count changed; roll back.");
        if (actual.Ports is null || actual.Ports.Length != count || actual.Ports.Any(p => p is null || p.ConnectorId < 0 ||
            p.Domain != expected.Endpoints[0].Domain || !FittingConnectionReadbackRules.Physical(p.ConnectorType)) ||
            actual.Ports.Select(p => p.ConnectorId).Distinct().Count() != count)
            throw Invalid("The created fitting has missing, extra, duplicate or incompatible physical ports; roll back.");
        var usedPorts = new HashSet<int>();
        for (var i = 0; i < count; i++)
        {
            var end = actual.Endpoints[i];
            if (end is null || end.Endpoint != expected.Endpoints[i] || end.Links is null || end.Links.Length != 1 ||
                end.Links[0] is not { EndpointToFitting: true, FittingToEndpoint: true } link ||
                !actual.Ports.Any(p => p.ConnectorId == link.FittingConnectorId) || !usedPorts.Add(link.FittingConnectorId))
                throw Invalid("Each exact caller-ordered endpoint must connect reciprocally to a different port of this created fitting; roll back.");
        }
    }
    internal static object Receipt(MultiportFittingCreationBinding expected, MultiportFittingConnectionReadback actual, string phase)
    {
        Require(expected, actual);
        return new
        {
            phase, scope = "one-created-fitting-and-explicit-ordered-multiport-endpoints",
            fittingId = actual.FittingId, actual.UniqueId, actual.TypeId, actual.Category, expected.FittingKind,
            requestedEndpoints = expected.Endpoints, actual.Ports, endpoints = actual.Endpoints,
            requestedEndpointRoles = expected.FittingKind == "tee"
                ? new[] { "main-run-first", "main-run-second", "branch" }
                : new[] { "first-pair-first", "first-pair-second", "second-pair-first", "second-pair-second" },
            callerEndpointOrderPreserved = true, physicalConnectionVerified = true, reciprocalConnectionVerified = true,
            distinctFittingPortsVerified = true, nativeReadbackVerified = true, geometryVerified = false,
            routingComplianceVerified = false, systemMembershipVerified = false, sideEffectsVerified = false,
            persistenceVerified = false, visualVerified = false
        };
    }
}
