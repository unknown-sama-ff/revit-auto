using System.Text.Json;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Events;
using Autodesk.Revit.UI;

namespace RevitAutoV27;

internal static class RevitCommandRouter
{
    // Document.Equals compares the underlying open Revit document across managed wrappers.
    private static readonly DocumentSessionRegistry<Document> Documents = new((a, b) => a.Equals(b), doc => doc.IsValidObject);
    private static readonly Dictionary<string, ModelPlan> Plans = new(StringComparer.Ordinal);
    internal static string Identity(Document doc) => Documents.Get(doc).Id;
    internal static long Revision(Document doc) => Documents.Get(doc).Revision;
    private static readonly Dictionary<string,DocumentChangeJournal> Changes=new(StringComparer.Ordinal);
    internal static void Changed(DocumentChangedEventArgs args)
    {
        var doc=args.GetDocument();Documents.Changed(doc);var id=Identity(doc);
        if(!Changes.TryGetValue(id,out var journal))Changes[id]=journal=new DocumentChangeJournal();
        var added=args.GetAddedElementIds().Select(e=>e.Value).ToArray();
        var modified=args.GetModifiedElementIds().Select(e=>e.Value).ToArray();
        var deleted=args.GetDeletedElementIds().Select(e=>e.Value).ToArray();
        journal.Record(Revision(doc),args.Operation.ToString(),args.GetTransactionNames(),added,modified,deleted);
        Log.Write($"Document change session={id}; revision={Revision(doc)}; operation={args.Operation}; transactions={string.Join("|",args.GetTransactionNames())}; added={added.Length}; modified={modified.Length}; deleted={deleted.Length}");
    }
    private static object ChangeDetails(Document doc,long sinceRevision,int limit=40)
        => (Changes.TryGetValue(Identity(doc),out var journal)?journal:new DocumentChangeJournal()).Since(sinceRevision,Revision(doc),limit);
    private static CommandResult StalePlan(ModelPlan plan,Document doc) => CommandResult.Failure("stale_plan","The project changed after preview; read the transaction history and create a new reviewed plan.",new {planId=plan.PlanId,previewDocumentIdentity=plan.DocumentIdentity,currentDocumentIdentity=Identity(doc),previewRevision=plan.DocumentRevision,currentRevision=Revision(doc),documentChanged=plan.DocumentIdentity!=Identity(doc),history=plan.DocumentIdentity==Identity(doc)&&plan.DocumentRevision<=Revision(doc)?ChangeDetails(doc,plan.DocumentRevision):null});
    internal static void Closed(bool succeeded) => Documents.Closed(succeeded);
    public static CommandResult Dispatch(UIApplication app, string method, JsonElement parameters, CancellationToken cancellation)
    {
        try
        {
            return method switch
            {
                "revit.bridge.info" => CommandResult.Success(new { protocol = "revit-auto-2027-v2", version = "0.3.23", features = new[] { "document-change-history", "room-boundaries", "native-type-resolver", "view-image-export", "legacy-point-placement", "lighting-evidence", "panel-schedule-naming", "plan-lifetime-policy", "view-settings", "view-configuration", "viewport-geometry", "explicit-crop-bounds", "connector-resolution", "connector-criteria-connections", "finite-parameter-values", "connector-orientation-evidence", "assigned-piping-classification", "connection-port-reservations", "assigned-system-type-evidence", "mechanical-port-audit-tristate", "collision-check", "collision-boolean-diagnostics" }, planLifetimeMinutes = RuntimeFiles.ReadSettings().PlanLifetimeMinutes, connectorInspectionPolicy = "capability-aware-v2", documentIdentityPolicy = "native-session-equality", confirmationMode = "chat", requiresRevitConfirmation = false, revitVersion = app.Application.VersionNumber, revitBuild = app.Application.VersionBuild, pid = Environment.ProcessId }),
                "revit.context.get" => CommandResult.Success(RevitQueryService.Context(app)),
                "revit.search" => CommandResult.Success(RevitQueryService.Search(app, parameters)),
                "revit.type.resolve" => CommandResult.Success(TypeService.Resolve(app,parameters)),
                "revit.view.export_image" => CommandResult.Success(ViewEvidenceService.ExportImage(app,parameters)),
                "revit.view.get" => CommandResult.Success(ViewConfigurationService.Get(app,parameters)),
                "revit.room.get" => CommandResult.Success(RoomService.Get(app, parameters)),
                "revit.changes.get" => GetChanges(app,parameters),
                "revit.inspect" => CommandResult.Success(RevitQueryService.Inspect(app, parameters)),
                "revit.connector.resolve" => CommandResult.Success(ConnectorResolutionService.Resolve(app, parameters)),
                "revit.collision.check" => CommandResult.Success(CollisionCheckService.Check(app, parameters, cancellation)),
                "revit.audit.run" => CommandResult.Success(RevitQueryService.Audit(app)),
                "revit.operations.list" => CommandResult.Success(new { operations = PlanRules.Supported.Order().ToArray(), units = "mm", references = "Use @operation-id for earlier created elements", confirmation = "User approval in chat", confirmationMode = "chat", requiresRevitConfirmation = false }),
                "revit.plan.create" => Create(app, parameters),
                "revit.workflow.run" or "revit.import.preview" => Create(app, parameters),
                "revit.plan.get" => CommandResult.Success(Find(parameters).View()),
                "revit.plan.confirm" or "revit.import.commit" => Confirm(app, parameters, cancellation),
                "revit.plan.cancel" => Cancel(parameters),
                _ => CommandResult.Failure("unknown_method", $"Unknown method '{method}'.")
            };
        }
        catch (BridgeException ex) { return CommandResult.Failure(ex.Code, ex.Message, ex.Details); }
        catch (Exception ex) { Log.Write(ex.ToString()); return CommandResult.Failure("revit_error", ex.Message); }
    }
    private static CommandResult GetChanges(UIApplication app,JsonElement parameters)
    {
        var doc=Active(app);
        if(JsonDefaults.String(parameters,"documentIdentity") is { } expected&&expected!=Identity(doc))return CommandResult.Failure("document_changed","The queried document is not active.");
        var since=JsonDefaults.Int64(parameters,"sinceRevision")??Math.Max(0,Revision(doc)-40);
        return CommandResult.Success(new {documentIdentity=Identity(doc),history=ChangeDetails(doc,since,(int)Math.Clamp(JsonDefaults.Int64(parameters,"limit")??40,1,100))});
    }
    private static Document Active(UIApplication app)
    {
        var doc = app.ActiveUIDocument?.Document ?? throw new BridgeException("no_active_document", "请先在 Revit 中打开项目。Open a Revit project first.");
        if (doc.IsFamilyDocument) throw new BridgeException("project_required", "The modeling bridge operates on project documents, not the family editor.");
        return doc;
    }
    private static CommandResult Create(UIApplication app, JsonElement parameters)
    {
        var doc = Active(app);
        if (doc.IsReadOnly) throw new BridgeException("read_only", "The current project is read-only.");
        if (JsonDefaults.String(parameters, "documentIdentity") is { } requested && requested != Identity(doc))
            throw new BridgeException("document_changed", "The active project changed while preparing this plan; read context again.");
        if (JsonDefaults.Int64(parameters, "expectedRevision") is long expectedRevision && expectedRevision != Revision(doc))
            return CommandResult.Failure("document_revision_changed", "The source model changed during planning. Re-read context and room data before previewing.", new { expectedRevision, currentRevision = Revision(doc) });
        var operations = PlanRules.Validate(JsonDefaults.Get(parameters, "operations"));
        var executor = new ModelExecutor(app, new Dictionary<string, ElementId>(StringComparer.Ordinal));
        foreach (var op in operations) executor.Validate(op);
        foreach (var p in Plans.Values.Where(p => p.Status == "pending" && p.ExpiresAtUtc < DateTime.UtcNow)) p.Status = "expired";
        if (Plans.Count >= 500) throw new BridgeException("plan_store_full", "Plan store is full. Restart the bridge in a new Revit session after completing/cancelling pending plans.");
        var plan = new ModelPlan
        {
            DocumentIdentity = Identity(doc), DocumentRevision = Revision(doc),
            Summary = JsonDefaults.StringOr(parameters, "summary", "AI 建模变更"),
            Source = JsonDefaults.StringOr(parameters, "source", "assistant"), Operations = operations,
            ExpiresAtUtc = PlanLifetimePolicy.Expires(DateTime.UtcNow, RuntimeFiles.ReadSettings().PlanLifetimeMinutes)
        };
        foreach (var op in operations.Where(o => JsonDefaults.String(o, "operationType") == "delete_element"))
        {
            var element = doc.GetElement(new ElementId(JsonDefaults.Int64(op, "elementId")!.Value));
            var dependentIds = element.GetDependentElements(null).Select(id => id.Value).ToArray();
            if (dependentIds.Length > 0) plan.Warnings.Add($"删除 {element.Id.Value} 可能影响 {dependentIds.Length} 个依赖元素，包括 {string.Join(",", dependentIds.Take(20))}。请在聊天预览中核对后确认该计划。");
        }
        Plans.Add(plan.PlanId, plan);
        Log.Write($"Preview plan={plan.PlanId}; document={plan.DocumentIdentity}; revision={plan.DocumentRevision}; operations={operations.Count}; source={plan.Source}");
        return CommandResult.Success(plan.View());
    }
    private static ModelPlan Find(JsonElement parameters)
    {
        var id = JsonDefaults.String(parameters, "planId") ?? throw new BridgeException("missing_plan_id", "planId is required.");
        if (!Plans.TryGetValue(id, out var plan)) throw new BridgeException("plan_not_found", "Plan is not available in this Revit session. Do not automatically recreate a possibly committed plan.");
        if (plan.Status == "pending" && plan.ExpiresAtUtc < DateTime.UtcNow) plan.Status = "expired";
        return plan;
    }
    private static CommandResult Cancel(JsonElement parameters)
    {
        var plan = Find(parameters);
        if (plan.Status == "committed") throw new BridgeException("already_committed", "A committed plan cannot be cancelled. Use Revit Undo if needed.");
        if (plan.Status == "executing") throw new BridgeException("executing", "A plan is executing.");
        plan.Status = "cancelled";
        return CommandResult.Success(plan.View());
    }
    private static CommandResult Confirm(UIApplication app, JsonElement parameters, CancellationToken cancellation)
    {
        var plan = Find(parameters);
        if (plan.Status == "committed")
        {
            var current = Active(app);
            if (Identity(current) != plan.DocumentIdentity) throw new BridgeException("document_changed", "Committed receipt belongs to another project. No changes were made.");
            return CommandResult.Success(plan.Receipt);
        }
        if (plan.Status != "pending") throw new BridgeException("plan_not_pending", $"Plan is {plan.Status}. Re-preview before trying again.");
        var doc = Active(app);
        if (plan.DocumentIdentity != Identity(doc) || plan.DocumentRevision != Revision(doc)) return StalePlan(plan,doc);
        PlanLifecycle.ValidateConfirmation(plan, Identity(doc), Revision(doc), DateTime.UtcNow);
        var references = new Dictionary<string, ElementId>(StringComparer.Ordinal);
        var executor = new ModelExecutor(app, references);
        foreach (var op in plan.Operations) executor.Validate(op);
        if (doc.IsModifiable || doc.IsReadOnly) throw new BridgeException("document_busy", "Revit has another transaction or the document is read-only.");
        cancellation.ThrowIfCancellationRequested();
        // The trusted MCP client calls Confirm only after approval of this preview in chat.
        // Do not add a second model confirmation dialog or another approval flag here.
        if (!Documents.Same(app.ActiveUIDocument?.Document, doc) || plan.DocumentRevision != Revision(doc))
            return StalePlan(plan,Active(app));
        var created = new List<long>(); var changed = new List<long>();
        var failureCapture = new TransactionFailures();
        var progress = new ExecutionProgress();
        string? failedOperationType=null;long? failedElementId=null;
        using var group = new TransactionGroup(doc, plan.Summary);
        using var transaction = new Transaction(doc, plan.Summary);
        try
        {
            plan.Status = "executing";
            if (group.Start() != TransactionStatus.Started || transaction.Start() != TransactionStatus.Started) throw new InvalidOperationException("Unable to start transaction.");
            transaction.SetFailureHandlingOptions(transaction.GetFailureHandlingOptions().SetFailuresPreprocessor(failureCapture).SetClearAfterRollback(true).SetForcedModalHandling(true));
            foreach (var op in plan.Operations)
            {
                progress.Begin(progress.CompletedOperationCount + 1);
                failedOperationType=JsonDefaults.String(op,"operationType");
                failedElementId=JsonDefaults.Int64(op,"elementId");
                cancellation.ThrowIfCancellationRequested();
                executor.Validate(op);
                var receipt = executor.Execute(op);
                created.AddRange(receipt.Created); changed.AddRange(receipt.Changed);
                if (JsonDefaults.String(op, "id") is { } key && receipt.Created.FirstOrDefault() > 0) references.Add(key, new ElementId(receipt.Created[0]));
                progress.Complete();
                failedOperationType=null;failedElementId=null;
            }
            doc.Regenerate();
            cancellation.ThrowIfCancellationRequested();
            if (transaction.Commit() != TransactionStatus.Committed) throw new InvalidOperationException(string.Join("; ", failureCapture.Messages.Prepend("Revit rejected the transaction.")));
            if (group.Assimilate() != TransactionStatus.Committed) throw new InvalidOperationException("Unable to commit transaction group.");
            plan.Status = "committed";
            plan.Receipt = new { planId = plan.PlanId, status = "committed", completedOperationCount = progress.CompletedOperationCount, createdElementIds = created.Distinct(), changedElementIds = changed.Distinct(), references = references.ToDictionary(x => x.Key, x => x.Value.Value), warnings = plan.Warnings.Concat(failureCapture.Messages).Distinct().ToArray(), confirmationMode = "chat", saved = false };
            Log.Write($"Committed plan={plan.PlanId}; created={created.Count}; changed={changed.Count}; confirmation=chat");
            foreach (var warning in failureCapture.Messages.Distinct()) Log.Write($"Plan={plan.PlanId}; warning={warning}");
            return CommandResult.Success(plan.Receipt);
        }
        catch (Exception ex)
        {
            bool rolledBack;
            try
            {
                if (transaction.GetStatus() == TransactionStatus.Started) transaction.RollBack();
                if (group.GetStatus() == TransactionStatus.Started) group.RollBack();
                rolledBack = group.GetStatus() == TransactionStatus.RolledBack || group.GetStatus() == TransactionStatus.Uninitialized;
            }
            catch { rolledBack = false; }
            plan.Status = "failed";
            Log.Write($"Failed plan={plan.PlanId}; rolledBack={rolledBack}; error={ex}");
            plan.Receipt = new { planId = plan.PlanId, status = plan.Status, rolledBack, completedOperationCount = progress.CompletedOperationCount, failedOperationIndex = progress.FailedOperationIndex, failedOperationType, failedElementId, createdElementIds = Array.Empty<long>(), warnings = failureCapture.Messages, code = "execution_failed", causeCode = (ex as BridgeException)?.Code, causeDetails = (ex as BridgeException)?.Details, message = ex.Message };
            Log.Write($"Plan={plan.PlanId}; completed={progress.CompletedOperationCount}; failedOperationIndex={progress.FailedOperationIndex}");
            return CommandResult.Failure("execution_failed", ex.Message, plan.Receipt);
        }
    }
    private sealed class TransactionFailures : IFailuresPreprocessor
    {
        public List<string> Messages { get; } = [];
        public FailureProcessingResult PreprocessFailures(FailuresAccessor accessor)
        {
            var failures = accessor.GetFailureMessages();
            Messages.AddRange(failures.Select(f => f.GetDescriptionText()));
            if (failures.Any(f => f.GetSeverity() == FailureSeverity.Error || f.GetSeverity() == FailureSeverity.DocumentCorruption))
                return FailureProcessingResult.ProceedWithRollBack;
            // Return ordinary transaction warnings in the execution receipt rather than opening Revit's warning dialog.
            // Errors are never dismissed or auto-resolved; they trigger rollback above.
            foreach (var failure in failures.Where(f => f.GetSeverity() == FailureSeverity.Warning))
                accessor.DeleteWarning(failure);
            return FailureProcessingResult.Continue;
        }
    }
}
