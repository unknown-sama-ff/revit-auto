using Autodesk.Revit.DB.Events;
using Autodesk.Revit.UI.Events;
using System.Text.Json;

namespace RevitAutoV27;

internal static class DocumentLifecycleEvents
{
    private static readonly object Gate = new();
    private static DocumentLifecycleStore? store;
    private static string? operationId, requestHash;
    private static bool closed;
    private static DocumentLifecycleEventPolicy policy = new(null);
    public static string? StopReason { get { lock (Gate) return policy.StopReason; } }
    public static bool SavedSuccessfully { get { lock (Gate) return policy.SavedSuccessfully; } }
    public static bool OpenedSuccessfully { get { lock (Gate) return policy.OpenedSuccessfully; } }
    public static void Arm(DocumentLifecycleStore value, string op, string hash, string? targetIdentity)
    {
        lock (Gate) { store = value; operationId = op; requestHash = hash; closed = false; policy = new(targetIdentity); }
    }
    public static void BeginSave() { lock (Gate) policy.BeginSave(); }
    public static void EndSave() { lock (Gate) policy.EndSave(); }
    public static void BeginOpen(string path) { lock (Gate) policy.BeginOpen(path); }
    public static void EndOpen() { lock (Gate) policy.EndOpen(); }
    public static void BeginExit() { lock (Gate) policy.BeginExit(); }
    public static void EndExit() { lock (Gate) policy.EndExit(); }
    private static void Capture(string eventKind, Action capture)
    {
        lock (Gate)
        {
            if (store is null || closed) return;
            try { capture(); }
            catch (Exception) { Record("event_capture_failed", new { eventKind }, "event_capture_incomplete"); }
        }
    }
    private static void Record(string kind, object data, string? stop = null)
    {
        lock (Gate)
        {
            if (store is null || operationId is null || requestHash is null || closed) return;
            if (stop is not null) policy.Stop(stop);
            try
            {
                var payload = JsonSerializer.SerializeToElement(data, DocumentLifecycleRules.Json).EnumerateObject().ToDictionary(field => field.Name, field => (object?)field.Value.Clone(), StringComparer.Ordinal);
                payload["stopReason"] = policy.StopReason;
                store.Append(operationId, requestHash, kind, payload, "event");
            }
            catch (Exception) { policy.Stop("event_log_incomplete"); }
        }
    }
    public static void Stop(string reason) => Record("stopped", new { reason }, reason);
    public static void OnDialog(object? sender, DialogBoxShowingEventArgs e)
        => Capture("dialog", () => Record("dialog", new { dialogId = e.DialogId, eventType = e.GetType().Name }, "dialog_shown"));
    public static void OnSaving(object? sender, DocumentSavingEventArgs e)
        => Capture("document_saving", () => {
        var doc = e.Document; var id = RevitCommandRouter.Identity(doc);
        policy.Saving(id);
        Record("document_saving", new { documentIdentity = id, path = doc.PathName, cancellable = e.Cancellable });
    });
    public static void OnSaved(object? sender, DocumentSavedEventArgs e)
        => Capture("document_saved", () => {
        var doc = e.Document; var id = RevitCommandRouter.Identity(doc);
        policy.Saved(id, e.Status == RevitAPIEventStatus.Succeeded);
        Record("document_saved", new { documentIdentity = id, path = doc.PathName, status = e.Status.ToString() });
    });
    public static void OnOpened(object? sender, DocumentOpenedEventArgs e)
        => Capture("document_opened", () => {
        if (e.Status != RevitAPIEventStatus.Succeeded) { Record("document_opened", new { status = e.Status.ToString() }, "document_open_failed"); return; }
        var doc = e.Document;
        policy.Opened(RevitCommandRouter.Identity(doc), doc.PathName, doc.IsLinked, true);
        Record("document_opened", new { documentIdentity = RevitCommandRouter.Identity(doc), path = doc.PathName, isLinked = doc.IsLinked, status = e.Status.ToString() });
    });
    public static void OnClosing(object? sender, DocumentClosingEventArgs e)
        => Capture("document_closing", () => {
            var doc = e.Document; var id = RevitCommandRouter.Identity(doc);
            policy.Closing(id, doc.IsLinked);
            Record("document_closing", new { documentIdentity = id, path = doc.PathName, isLinked = doc.IsLinked, cancellable = e.Cancellable });
        });
    public static void OnChanged(object? sender, DocumentChangedEventArgs e)
        => Capture("document_changed", () => {
        var doc = e.GetDocument();
        Record("document_changed", new { documentIdentity = RevitCommandRouter.Identity(doc), revision = RevitCommandRouter.Revision(doc), operation = e.Operation.ToString() }, "native_document_changed");
    });
    public static void OnApplicationClosing(object? sender, ApplicationClosingEventArgs e)
        => Capture("application_closing", () => { policy.ApplicationClosing(); Record("application_closing", new { cancellable = e.Cancellable }); });
    public static void ShutdownClose()
    {
        lock (Gate)
        {
            Record("shutdown_closed", new { complete = policy.StopReason is null, stopReason = policy.StopReason });
            closed = true;
        }
    }
    public static void Disarm() { lock (Gate) { store = null; operationId = requestHash = null; } }
}
