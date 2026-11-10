using RevitAutoV27;

internal static class LifecycleQueuePolicyTests
{
    internal static void Run(Action<string, Action> test)
    {
        test("lifecycle lease admits fixed-scope verification while rejecting ordinary document commands", () =>
        {
            foreach (var method in new[] { "revit.bridge.info", "revit.lifecycle.get", "revit.lifecycle.verify_scope", "revit.lifecycle.save_once", "revit.lifecycle.post_exit_once", "revit.lifecycle.open_saved_copy_once", "revit.lifecycle.stop" })
                if (!LifecycleQueuePolicy.Allowed(method, true, false, false)) throw new Exception("Bound lifecycle control was rejected: " + method);
            foreach (var method in new[] { "revit.context.get", "revit.search", "revit.inspect", "revit.element.dependencies", "revit.plan.create", "revit.plan.confirm", "revit.lifecycle.prepare", "revit.view.export_image", "unknown" })
                if (LifecycleQueuePolicy.Allowed(method, true, false, false)) throw new Exception("Unbound command bypassed lifecycle lease: " + method);
        });
        test("posted exit allows status and stop but prevents another dispatch or new preview", () =>
        {
            foreach (var method in new[] { "revit.lifecycle.verify_scope", "revit.lifecycle.prepare", "revit.plan.confirm", "revit.context.get" })
                if (LifecycleQueuePolicy.Allowed(method, true, true, false)) throw new Exception("Exit-posted command was dispatched: " + method);
            if (!LifecycleQueuePolicy.Allowed("revit.lifecycle.get", true, true, false) ||
                !LifecycleQueuePolicy.Allowed("revit.bridge.info", true, true, false) ||
                !LifecycleQueuePolicy.Allowed("revit.lifecycle.stop", true, true, false)) throw new Exception("Read-only exit recovery is inaccessible.");
            foreach (var method in new[] { "revit.lifecycle.save_once", "revit.lifecycle.post_exit_once", "revit.lifecycle.open_saved_copy_once" })
                if (!LifecycleQueuePolicy.Allowed(method, true, true, false)) throw new Exception("Existing durable single-attempt receipt is inaccessible.");
        });
        test("shutdown rejects lifecycle controls and normal commands regardless of lease", () =>
        {
            foreach (var method in new[] { "revit.bridge.info", "revit.lifecycle.get", "revit.lifecycle.stop", "revit.lifecycle.save_once", "revit.plan.confirm" })
                foreach (var leased in new[] { false, true })
                    if (LifecycleQueuePolicy.Allowed(method, leased, leased, true)) throw new Exception("Command admitted during shutdown.");
        });
        test("prepare does not reserve a lease and pending queue distinguishes harmless status", () =>
        {
            if (!LifecycleQueuePolicy.Allowed("revit.plan.create", false, false, false) || !LifecycleQueuePolicy.Allowed("revit.lifecycle.prepare", false, false, false))
                throw new Exception("Preview altered ordinary queue availability.");
            foreach (var method in new[] { "revit.bridge.info", "revit.lifecycle.get" })
                if (LifecycleQueuePolicy.CountsAsPendingDocumentCommand(method)) throw new Exception("Status prevents lifecycle lease acquisition.");
            foreach (var method in new[] { "revit.plan.confirm", "revit.inspect", "revit.lifecycle.prepare", "revit.lifecycle.save_once" })
                if (!LifecycleQueuePolicy.CountsAsPendingDocumentCommand(method)) throw new Exception("Queued document work escaped acquisition precheck.");
        });
    }
}
