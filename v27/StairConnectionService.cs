using System.Diagnostics;
using System.Text.Json;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using Autodesk.Revit.UI;

namespace RevitAutoV27;

internal static class StairConnectionService
{
    public static object Get(UIApplication app, JsonElement parameters, CancellationToken cancellation)
    {
        var input = StairConnectionRules.Parse(parameters);
        var doc = app.ActiveUIDocument?.Document ?? throw new BridgeException("no_active_document", "Open the reviewed project first.");
        if (!doc.IsValidObject || doc.IsFamilyDocument) throw new BridgeException("project_required", "Stair connections require a valid project document.");
        var identity = RevitCommandRouter.Identity(doc);
        var revision = RevitCommandRouter.Revision(doc);
        if (identity != input.DocumentIdentity) throw new BridgeException("document_changed", "The reviewed stair document changed.");
        if (revision != input.ExpectedRevision) throw new BridgeException("document_revision_changed", "The reviewed stair revision changed.");
        var path = doc.PathName;
        var modified = doc.IsModified;
        var readOnly = doc.IsReadOnly;
        var started = Stopwatch.StartNew();
        void Check()
        {
            cancellation.ThrowIfCancellationRequested();
            if (started.Elapsed > TimeSpan.FromSeconds(10)) throw new BridgeException("stairs_connections_timeout", "The stair query exceeded its read-only time budget.");
            if (!doc.IsValidObject || app.ActiveUIDocument?.Document is not { } active || !active.IsValidObject || !active.Equals(doc) || doc.IsFamilyDocument ||
                RevitCommandRouter.Identity(active) != identity || !string.Equals(doc.PathName, path, StringComparison.Ordinal)) throw new BridgeException("document_changed", "The pinned stair document changed during the read.");
            if (RevitCommandRouter.Revision(doc) != revision) throw new BridgeException("document_revision_changed", "The pinned stair revision changed during the read.");
            if (doc.IsModified != modified || doc.IsReadOnly != readOnly || doc.IsModifiable) throw new BridgeException("document_state_changed", "The stair query requires unchanged document and transaction state.");
        }
        Check();
        var stair = doc.GetElement(new ElementId(input.StairId)) as Stairs ?? throw new BridgeException("stair_not_found", "The requested ID is not an existing native Stairs in this document.");
        if (!stair.IsValidObject || stair.Id.Value != input.StairId) throw new BridgeException("stairs_connections_invalid_native_evidence", "The native stair became invalid or resolved to another ID.");
        var nativeRuns = stair.GetStairsRuns();
        Check();
        var nativeLandings = stair.GetStairsLandings();
        Check();
        if (nativeRuns is null || nativeLandings is null) throw new BridgeException("stairs_connections_invalid_native_evidence", "Native stair membership is unavailable; empty membership was not inferred.");
        if ((long)nativeRuns.Count + nativeLandings.Count > StairConnectionRules.MaxComponents) throw new BridgeException("stairs_connections_limit_exceeded", "The stair component budget was exceeded before materializing IDs.");
        var runIds = nativeRuns.Select(id => StairConnectionRules.SafeId(id.Value)).ToArray();
        var landingIds = nativeLandings.Select(id => StairConnectionRules.SafeId(id.Value)).ToArray();
        if (runIds.Concat(landingIds).Distinct().Count() != runIds.Length + landingIds.Length) throw new BridgeException("stairs_connections_invalid_native_evidence", "Native stair membership contains duplicate component IDs.");
        var components = new List<StairComponentConnections>();
        var total = 0;
        IEnumerable<StairConnectionRow> Rows(IEnumerable<StairsComponentConnection> connections)
        {
            foreach (var connection in connections)
            {
                Check();
                try
                {
                    if (connection is null || !connection.IsValidObject) throw new InvalidOperationException("The native stair connection object is unavailable.");
                    yield return new(connection.ElementId.Value, connection.PeerElementId.Value, connection.ConnectionType.ToString(), (long)connection.ConnectionType, connection.PeerConnectionType.ToString(), (long)connection.PeerConnectionType);
                }
                finally { if ((object?)connection is IDisposable disposable) disposable.Dispose(); }
            }
        }
        foreach (var (id, kind) in runIds.Select(id => (id, "run")).Concat(landingIds.Select(id => (id, "landing"))).OrderBy(row => row.id))
        {
            Check();
            var element = doc.GetElement(new ElementId(id));
            Stairs? owner;
            Func<IEnumerable<StairConnectionRow>?> read;
            if (kind == "run" && element is StairsRun run) { owner = run.GetStairs(); read = () => Rows(run.GetConnections()); }
            else if (kind == "landing" && element is StairsLanding landing) { owner = landing.GetStairs(); read = () => Rows(landing.GetConnections()); }
            else throw new BridgeException("stairs_connections_invalid_native_evidence", "Native component membership has an unreadable or unexpected component class.");
            if (element is null || !element.IsValidObject || owner is null || !owner.IsValidObject || owner.Id != stair.Id) throw new BridgeException("stairs_connections_invalid_native_evidence", "Native component ownership differs from the requested stair.");
            var evidence = StairConnectionRules.ReadConnections(read, Check, ref total);
            var records = evidence.Records.OrderBy(r => r.ElementId).ThenBy(r => r.PeerElementId).ThenBy(r => r.ConnectionType, StringComparer.Ordinal)
                .ThenBy(r => r.ConnectionTypeValue).ThenBy(r => r.PeerConnectionType, StringComparer.Ordinal).ThenBy(r => r.PeerConnectionTypeValue).ToArray();
            components.Add(new(id, kind, stair.Id.Value, evidence.Complete, records, evidence.Error));
        }
        Check();
        var graph = StairConnectionRules.Analyze(stair.Id.Value, components);
        var snapshot = NativeReadSnapshot.Freeze(new
        {
            documentIdentity = identity, documentRevision = revision,
            stair = new { id = stair.Id.Value, uniqueId = stair.UniqueId, name = stair.Name, className = stair.GetType().Name, typeId = stair.GetTypeId().Value },
            runIds = runIds.Order().ToArray(), landingIds = landingIds.Order().ToArray(), components, graph,
            readOnly = true, modelWritesRequested = false, automaticSave = false, planCreated = false,
            allModelSideEffectsVerified = false, completeStairConnectionsVerified = false, engineeringComplianceVerified = false
        });
        StairConnectionRules.RequireResponseBudget(CommandResult.Success(snapshot).Serialize());
        Check();
        return snapshot;
    }
}
