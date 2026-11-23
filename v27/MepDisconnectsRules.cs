using System.Text.Json;

namespace RevitAutoV27;

internal sealed record MepDisconnectsInput(
    string DocumentIdentity,
    long ExpectedRevision,
    string Domain,
    long? ViewId,
    int Offset,
    int Limit);

internal sealed record MepPointMm(double XMm, double YMm, double ZMm);

internal sealed record MepOpenConnector(
    int ConnectorId,
    string Domain,
    string? Shape,
    MepPointMm? OriginMm);

internal sealed record MepConnectorObservation(
    int? ConnectorId,
    bool? IsPhysicalEnd,
    bool? IsConnected,
    string? Domain,
    string? Shape,
    MepPointMm? OriginMm,
    bool ReadError);

internal sealed record MepElementDisconnectSummary(
    IReadOnlyList<MepOpenConnector> OpenConnectors,
    int UnknownConnectorCount);

internal static class MepDisconnectsRules
{
    public const long MaxSafeInteger = 9007199254740991;
    public const int MaxOffset = 100000;
    public const int MaxLimit = 200;

    internal static BridgeException Invalid(string message) => new("invalid_mep_disconnects_request", message);

    public static MepDisconnectsInput Parse(JsonElement request)
    {
        if (request.ValueKind != JsonValueKind.Object)
            throw Invalid("MEP disconnects request must be a JSON object.");
        string[] allowed = ["documentIdentity", "expectedRevision", "domain", "viewId", "offset", "limit"];
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var prop in request.EnumerateObject())
        {
            if (!allowed.Contains(prop.Name, StringComparer.Ordinal) || !seen.Add(prop.Name))
                throw Invalid($"Unsupported or duplicate MEP disconnects field '{prop.Name}'.");
        }

        var identity = Identity(request);
        var revision = Revision(request);
        var domain = OptionalDomain(request);
        long? viewId = request.TryGetProperty("viewId", out var viewEl) ? PositiveId(viewEl, "viewId") : null;
        var offset = OptionalInt(request, "offset", 0, 0, MaxOffset);
        var limit = OptionalInt(request, "limit", 50, 1, MaxLimit);
        return new(identity, revision, domain, viewId, offset, limit);
    }

    public static bool DomainMatches(string domainFilter, string? nativeDomainName)
    {
        if (domainFilter == "all") return nativeDomainName is not null;
        return domainFilter switch
        {
            "hvac" => nativeDomainName == "DomainHvac",
            "piping" => nativeDomainName == "DomainPiping",
            "electrical" => nativeDomainName == "DomainElectrical",
            "cableTrayConduit" => nativeDomainName == "DomainCableTrayConduit",
            _ => false
        };
    }

    public static MepElementDisconnectSummary EvaluateElement(IEnumerable<MepConnectorObservation> observations, string domainFilter)
    {
        var open = new List<MepOpenConnector>();
        var unknown = 0;

        foreach (var obs in observations)
        {
            if (obs.ReadError || obs.IsPhysicalEnd is null)
            {
                unknown++;
                continue;
            }
            if (obs.IsPhysicalEnd != true)
                continue;
            if (obs.IsConnected is null || obs.Domain is null || obs.ConnectorId is null)
            {
                unknown++;
                continue;
            }
            if (obs.IsConnected == true)
                continue;
            if (!DomainMatches(domainFilter, obs.Domain))
                continue;

            open.Add(new(obs.ConnectorId.Value, obs.Domain, obs.Shape, obs.OriginMm));
        }

        return new(open.OrderBy(c => c.ConnectorId).ToArray(), unknown);
    }

    private static string Identity(JsonElement request)
    {
        if (!request.TryGetProperty("documentIdentity", out var value) || value.ValueKind != JsonValueKind.String)
            throw Invalid("documentIdentity must be an explicit nonblank string.");
        var text = value.GetString();
        if (string.IsNullOrWhiteSpace(text) || text.Length > 200 || text.Trim() != text || text.Any(char.IsControl))
            throw Invalid("documentIdentity must be an explicit nonblank string up to 200 characters.");
        return text;
    }

    private static long Revision(JsonElement request)
    {
        if (!request.TryGetProperty("expectedRevision", out var value) || value.ValueKind != JsonValueKind.Number ||
            !value.TryGetInt64(out var revision) || revision < 0 || revision > MaxSafeInteger)
            throw Invalid("expectedRevision must be an explicit nonnegative safe integer.");
        return revision;
    }

    private static string OptionalDomain(JsonElement request)
    {
        if (!request.TryGetProperty("domain", out var value)) return "all";
        if (value.ValueKind != JsonValueKind.String)
            throw Invalid("domain must be one of: all, hvac, piping, electrical, cableTrayConduit.");
        var text = value.GetString();
        if (text is not ("all" or "hvac" or "piping" or "electrical" or "cableTrayConduit"))
            throw Invalid("domain must be one of: all, hvac, piping, electrical, cableTrayConduit.");
        return text;
    }

    private static long PositiveId(JsonElement value, string field)
    {
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetInt64(out var id) || id <= 0 || id > MaxSafeInteger)
            throw Invalid($"{field} must be a positive safe native View ID.");
        return id;
    }

    private static int OptionalInt(JsonElement request, string field, int fallback, int min, int max)
    {
        if (!request.TryGetProperty(field, out var value)) return fallback;
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetInt32(out var number) || number < min || number > max)
            throw Invalid($"{field} must be an integer between {min} and {max}.");
        return number;
    }
}
