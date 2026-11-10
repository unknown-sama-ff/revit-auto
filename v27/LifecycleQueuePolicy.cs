namespace RevitAutoV27;

// The policy is shared by enqueue and dispatch. It does not claim control of
// native commands started by a person or another add-in.
internal static class LifecycleQueuePolicy
{
    public static bool IsControlRead(string method) => method is
        "revit.bridge.info" or "revit.lifecycle.get";

    public static bool IsLifecycle(string method) => method is
        "revit.lifecycle.prepare" or "revit.lifecycle.get" or "revit.lifecycle.verify_scope" or
        "revit.lifecycle.save_once" or "revit.lifecycle.post_exit_once" or
        "revit.lifecycle.open_saved_copy_once" or "revit.lifecycle.stop";

    public static bool Allowed(string method, bool leaseActive, bool exitPosted, bool shuttingDown)
    {
        if (shuttingDown) return false;
        if (exitPosted) return IsControlRead(method) || method is "revit.lifecycle.stop" or
            "revit.lifecycle.save_once" or "revit.lifecycle.post_exit_once" or "revit.lifecycle.open_saved_copy_once";
        if (!leaseActive) return true;
        return IsControlRead(method) || IsLifecycle(method) && method != "revit.lifecycle.prepare";
    }

    public static bool CountsAsPendingDocumentCommand(string method) => !IsControlRead(method);
}
