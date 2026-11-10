using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace RevitAutoV27;

internal sealed record StairConnectionInput(string DocumentIdentity, long ExpectedRevision, long StairId);
internal sealed record StairConnectionRow(long ElementId, long PeerElementId, string ConnectionType, long ConnectionTypeValue, string PeerConnectionType, long PeerConnectionTypeValue);
internal sealed record StairConnectionRead(bool Complete, StairConnectionRow[] Records, string? Error);
internal sealed record StairComponentConnections(long ElementId, string Kind, long StairId, bool ConnectionsComplete, StairConnectionRow[] Connections,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? Error);
internal sealed record StairConnectionIssue(string Code, long ElementId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] long? PeerElementId = null);
internal sealed record StairConnectionGraph(bool EnumerationComplete, string ReciprocityStatus, StairConnectionIssue[] Issues, long[] IsolatedComponentIds);

internal static class StairConnectionRules
{
    public const long MaxSafeInteger = 9007199254740991;
    public const int MaxComponents = 1000, MaxConnections = 4000, MaxResponseBytes = 2 * 1024 * 1024;
    static BridgeException Invalid(string message) => new("stairs_connections_invalid_native_evidence", message);
    public static StairConnectionInput Parse(JsonElement request)
    {
        BridgeException Bad(string message) => new("invalid_stairs_connections_request", message);
        if (request.ValueKind != JsonValueKind.Object) throw Bad("Provide one explicit pinned stair query.");
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var field in request.EnumerateObject())
            if (field.Name is not ("documentIdentity" or "expectedRevision" or "stairId") || !seen.Add(field.Name)) throw Bad("Unknown or duplicate stair query field.");
        if (!request.TryGetProperty("documentIdentity", out var identity) || identity.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(identity.GetString()) || identity.GetString()!.Length > 200) throw Bad("A current nonblank document identity is required.");
        long Number(string name, long minimum)
        {
            if (!request.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.Number || !value.TryGetInt64(out var n) || n < minimum || n > MaxSafeInteger) throw Bad(name + " must be an explicit safe integer.");
            return n;
        }
        return new(identity.GetString()!, Number("expectedRevision", 0), Number("stairId", 1));
    }
    public static long SafeId(long id)
    {
        if (id <= 0 || id > MaxSafeInteger) throw Invalid("Native component IDs must be positive safe integers.");
        return id;
    }
    static void ValidateRow(StairConnectionRow row)
    {
        if (row is null) throw Invalid("A native connection row is unavailable.");
        SafeId(row.ElementId); SafeId(row.PeerElementId);
        if (string.IsNullOrWhiteSpace(row.ConnectionType) || row.ConnectionType.Length > 80 || string.IsNullOrWhiteSpace(row.PeerConnectionType) || row.PeerConnectionType.Length > 80 ||
            row.ConnectionTypeValue < -MaxSafeInteger || row.ConnectionTypeValue > MaxSafeInteger || row.PeerConnectionTypeValue < -MaxSafeInteger || row.PeerConnectionTypeValue > MaxSafeInteger)
            throw Invalid("Native connection endpoint evidence is invalid.");
    }
    static string Error(Exception error)
    {
        var text = (error.GetType().Name + ": " + error.Message).Replace('\0', ' ').Replace('\r', ' ').Replace('\n', ' ');
        return text.Length > 1200 ? text[..1200] : text;
    }
    public static StairConnectionRead ReadConnections(Func<IEnumerable<StairConnectionRow>?> read, Action check, ref int total)
    {
        var rows = new List<StairConnectionRow>();
        check();
        // Only native getter/enumerator failures become unknown. Pin, budget,
        // cancellation and structural validation failures always propagate.
        IEnumerator<StairConnectionRow>? iterator;
        try { iterator = read()?.GetEnumerator(); }
        catch (OperationCanceledException) { throw; }
        catch (BridgeException) { throw; }
        catch (Exception e) { check(); return new(false, [], Error(e)); }
        if (iterator is null) { check(); return new(false, [], "native_collection_unavailable"); }
        string? failure = null;
        try
        {
            while (true)
            {
                check();
                StairConnectionRow row;
                try { if (!iterator.MoveNext()) break; row = iterator.Current; }
                catch (OperationCanceledException) { throw; }
                catch (BridgeException) { throw; }
                catch (Exception e) { failure = Error(e); break; }
                ValidateRow(row);
                if (total >= MaxConnections) throw new BridgeException("stairs_connections_limit_exceeded", "Native connection record budget exceeded; evidence was not truncated.");
                total++;
                rows.Add(row);
            }
        }
        finally
        {
            try { iterator.Dispose(); }
            catch (OperationCanceledException) { throw; }
            catch (BridgeException) { throw; }
            catch (Exception e) { failure ??= Error(e); }
        }
        check();
        return new(failure is null, rows.ToArray(), failure);
    }
    static bool Endpoint(string kind, string name) => kind == "run" ? name is "ET_RunStart" or "ET_RunEnd" : name == "ET_Landing";
    static bool KnownEndpoint(string name) => name is "ET_RunStart" or "ET_RunEnd" or "ET_Landing";
    public static StairConnectionGraph Analyze(long stairId, IReadOnlyList<StairComponentConnections> components)
    {
        SafeId(stairId);
        if (components.Count > MaxComponents) throw new BridgeException("stairs_connections_limit_exceeded", "Native component budget exceeded.");
        var map = new Dictionary<long, StairComponentConnections>();
        var count = 0;
        foreach (var c in components)
        {
            if (c is null || c.Kind is not ("run" or "landing") || c.StairId != stairId || c.Connections is null ||
                (c.ConnectionsComplete ? c.Error is not null : string.IsNullOrWhiteSpace(c.Error)) || c.Error?.Length > 1200) throw Invalid("Native component ownership or completeness is inconsistent.");
            SafeId(c.ElementId);
            if (!map.TryAdd(c.ElementId, c)) throw Invalid("Native stair components are duplicated.");
            foreach (var row in c.Connections) ValidateRow(row);
            count += c.Connections.Length;
            if (count > MaxConnections) throw new BridgeException("stairs_connections_limit_exceeded", "Native connection record budget exceeded.");
        }
        var isolated = components.Where(c => c.ConnectionsComplete && c.Connections.Length == 0).Select(c => c.ElementId).Order().ToArray();
        if (components.Any(c => !c.ConnectionsComplete)) return new(false, "unknown", [], isolated);
        var issues = new List<StairConnectionIssue>();
        var sets = components.ToDictionary(c => c.ElementId, c => c.Connections.ToHashSet());
        foreach (var c in components)
        {
            foreach (var duplicate in c.Connections.GroupBy(r => r).Where(g => g.Count() > 1)) issues.Add(new("duplicate_connection", c.ElementId, duplicate.Key.PeerElementId));
            if (c.Kind == "run" && c.Connections.Length > 2) issues.Add(new("run_connection_count_exceeded", c.ElementId));
            foreach (var r in c.Connections)
            {
                // The SDK identifies both ends but does not require a record's
                // first end to be the component whose GetConnections was read.
                // Interpret membership without rewriting any native row.
                if (r.ElementId != c.ElementId && r.PeerElementId != c.ElementId) { issues.Add(new("source_component_mismatch", c.ElementId, r.PeerElementId)); continue; }
                var first = r.ElementId == c.ElementId;
                var peerId = first ? r.PeerElementId : r.ElementId;
                var ownType = first ? r.ConnectionType : r.PeerConnectionType;
                var peerType = first ? r.PeerConnectionType : r.ConnectionType;
                if (r.ElementId == r.PeerElementId) issues.Add(new("self_connection", c.ElementId, peerId));
                if (!map.TryGetValue(peerId, out var peer)) { issues.Add(new("peer_outside_stair", c.ElementId, peerId)); continue; }
                if (c.Kind == peer.Kind) issues.Add(new("connection_kinds_invalid", c.ElementId, peerId));
                if (!KnownEndpoint(ownType) || !KnownEndpoint(peerType)) issues.Add(new("endpoint_type_unknown", c.ElementId, peerId));
                else if (!Endpoint(c.Kind, ownType) || !Endpoint(peer.Kind, peerType)) issues.Add(new("endpoint_type_invalid", c.ElementId, peerId));
                var reverse = new StairConnectionRow(r.PeerElementId, r.ElementId, r.PeerConnectionType, r.PeerConnectionTypeValue, r.ConnectionType, r.ConnectionTypeValue);
                if (!sets[peer.ElementId].Contains(r) && !sets[peer.ElementId].Contains(reverse)) issues.Add(new("missing_reverse_connection", c.ElementId, peerId));
            }
        }
        var ordered = issues.Distinct().OrderBy(i => i.ElementId).ThenBy(i => i.PeerElementId).ThenBy(i => i.Code, StringComparer.Ordinal).ToArray();
        return new(true, ordered.Any(i => i.Code == "endpoint_type_unknown") ? "unknown" : ordered.Length == 0 ? "verified" : "inconsistent", ordered, isolated);
    }
    public static void RequireResponseBudget(string envelope)
    {
        if ((long)Encoding.UTF8.GetByteCount(envelope) + 2 > MaxResponseBytes) throw new BridgeException("stairs_connections_response_too_large", "Stair connection response exceeds its 2 MiB wire budget.");
    }
}
