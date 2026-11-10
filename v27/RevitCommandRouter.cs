using System.Text.Json;
using System.Reflection;
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
    private static NativeChangeReceipt? activeReceiptCapture;
    // ExternalEvent uses one UI command queue. Keep this capture scoped to one execution,
    // and dispose it on every success/failure; it must not follow subsequent manual edits.
    private sealed class ReceiptCaptureScope : IDisposable
    {
        public NativeChangeReceipt Recorder { get; }
        public ReceiptCaptureScope(Document doc)
        {
            if (activeReceiptCapture is not null) throw new BridgeException("write_capture_busy", "Another native execution evidence capture is active.");
            Recorder = new NativeChangeReceipt(Identity(doc), Revision(doc));
            activeReceiptCapture = Recorder;
        }
        public void Dispose()
        {
            if (ReferenceEquals(activeReceiptCapture, Recorder)) activeReceiptCapture = null;
        }
    }

    internal static void Changed(DocumentChangedEventArgs args)
    {
        var doc=args.GetDocument();Documents.Changed(doc);var id=Identity(doc);
        if(!Changes.TryGetValue(id,out var journal))Changes[id]=journal=new DocumentChangeJournal();
        var added=args.GetAddedElementIds().Select(e=>e.Value).ToArray();
        var modified=args.GetModifiedElementIds().Select(e=>e.Value).ToArray();
        var deleted=args.GetDeletedElementIds().Select(e=>e.Value).ToArray();
        activeReceiptCapture?.Record(id,Revision(doc),args.Operation.ToString(),args.GetTransactionNames(),added,modified,deleted);
        journal.Record(Revision(doc),args.Operation.ToString(),args.GetTransactionNames(),added,modified,deleted);
        Log.Write($"Document change session={id}; revision={Revision(doc)}; operation={args.Operation}; transactions={string.Join("|",args.GetTransactionNames())}; added={added.Length}; modified={modified.Length}; deleted={deleted.Length}");
    }
    private static object ChangeDetails(Document doc,long sinceRevision,int limit=40)
        => (Changes.TryGetValue(Identity(doc),out var journal)?journal:new DocumentChangeJournal()).Since(sinceRevision,Revision(doc),limit);
    private static CommandResult StalePlan(ModelPlan plan,Document doc) => CommandResult.Failure("stale_plan","The project changed after preview; read the transaction history and create a new reviewed plan.",new {planId=plan.PlanId,previewDocumentIdentity=plan.DocumentIdentity,currentDocumentIdentity=Identity(doc),previewRevision=plan.DocumentRevision,currentRevision=Revision(doc),documentChanged=plan.DocumentIdentity!=Identity(doc),history=plan.DocumentIdentity==Identity(doc)&&plan.DocumentRevision<=Revision(doc)?ChangeDetails(doc,plan.DocumentRevision):null});
    internal static void Closed(bool succeeded) => Documents.Closed(succeeded);
    internal static bool HasPendingPlans()
    {
        foreach (var plan in Plans.Values.Where(plan => plan.Status == "pending" && plan.ExpiresAtUtc < DateTime.UtcNow))
            plan.Status = "expired";
        return Plans.Values.Any(plan => plan.Status is "pending" or "executing");
    }
    public static CommandResult Dispatch(UIApplication app, string method, JsonElement parameters, CancellationToken cancellation)
    {
        try
        {
            if (!DocumentLifecycleService.Allows(method))
                throw new BridgeException("lifecycle_busy", "A local test-copy lifecycle lease rejects this command.");
            if (method is "revit.search" or "revit.inspect" or "revit.type.resolve" or "revit.view.get" or "revit.room.get" or "revit.audit.run" or "revit.element.storage_schemas" or "revit.document.version_diff")
            {
                var readDocument = Active(app);
                DocumentReadPinRules.Validate(parameters, Identity(readDocument), Revision(readDocument));
            }
            if (LifecycleQueuePolicy.IsLifecycle(method))
                return CommandResult.Success(DocumentLifecycleService.Dispatch(app, method, parameters, cancellation)).PrepareBounded();
            return method switch
            {
                "revit.bridge.info" => CommandResult.Success(new { protocol = "revit-auto-2027-v2", version = "0.4.0", informationalVersion = typeof(App).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion, moduleVersionId = typeof(App).Module.ModuleVersionId.ToString(), features = new[] { "build-fingerprint", "readonly-query-pins", "document-change-history", "room-boundaries", "native-type-resolver", "view-image-export", "batch-view-image-export", "controlled-structural-columns", "architecture-type-copy", "architecture-primary-readback", "room-creation-readback", "grid-creation-readback", "opening-creation-readback", "opening-profile-failure-evidence", "opening-host-surface-readback", "explicit-grid-geometry", "controlled-titleblock-change", "legacy-point-placement", "lighting-evidence", "panel-schedule-naming", "plan-lifetime-policy", "view-settings", "view-configuration", "viewport-geometry", "drawing-placement-move", "viewport-label-offset", "tag-leader-readback", "tag-target-readback", "tag-head-position-snapshot", "room-tag-leader-geometry-snapshot", "annotation-input-contracts", "dimension-creation-readback", "grid-dimension-reference-snapshot", "explicit-crop-bounds", "connector-resolution", "connector-criteria-connections", "finite-parameter-values", "connector-orientation-evidence", "assigned-piping-classification", "connection-port-reservations", "assigned-system-type-evidence", "mechanical-port-audit-tristate", "ui-thread-audit-snapshot", "bounded-element-dependencies", "native-stair-connections", "family-text-notes", "family-text-known-empty-owner", "family-text-pagination-view-bounds", "element-storage-schema-audit", "document-version-diff", "sheet-layout-diagnostics", "local-test-copy-lifecycle", "native-opening", "electrical-circuit-audit", "collision-check", "collision-boolean-diagnostics", "flow-direction-diagnostic", "controlled-family-loading", "family-catalog-snapshot", "native-change-receipts", "parameter-noop-receipts", "stair-cleanup-evidence", "explicit-stair-geometry", "controlled-stairs-edit-scope" }, planLifetimeMinutes = RuntimeFiles.ReadSettings().PlanLifetimeMinutes, connectorInspectionPolicy = "capability-aware-v2", documentIdentityPolicy = "native-session-equality", confirmationMode = "chat", requiresRevitConfirmation = false, revitVersion = app.Application.VersionNumber, revitBuild = app.Application.VersionBuild, pid = Environment.ProcessId }),
                "revit.context.get" => CommandResult.Success(RevitQueryService.Context(app)),
                "revit.family.text_notes" => CommandResult.Success(FamilyTextService.Get(app, parameters, cancellation)),
                "revit.search" => CommandResult.Success(RevitQueryService.Search(app, parameters)),
                "revit.type.resolve" => CommandResult.Success(TypeService.Resolve(app,parameters)),
                "revit.view.export_image" => CommandResult.Success(ViewEvidenceService.ExportImage(app,parameters)),
                "revit.view.export_images" => CommandResult.Success(ViewEvidenceService.ExportImages(app,parameters,cancellation)),
                "revit.view.get" => CommandResult.Success(ViewConfigurationService.Get(app,parameters)),
                "revit.room.get" => CommandResult.Success(RoomService.Get(app, parameters)),
                "revit.changes.get" => GetChanges(app,parameters),
                "revit.inspect" => CommandResult.Success(RevitQueryService.Inspect(app, parameters)),
                "revit.sheet.layout" => CommandResult.Success(SheetLayoutService.Get(app, parameters, cancellation)),
                "revit.element.dependencies" => CommandResult.Success(ElementDependencyService.Get(app, parameters, cancellation)),
                "revit.stairs.connections" => CommandResult.Success(StairConnectionService.Get(app, parameters, cancellation)),
                "revit.element.storage_schemas" => CommandResult.Success(ElementStorageSchemaService.Get(app, parameters, cancellation)),
                "revit.document.version_diff" => CommandResult.Success(DocumentVersionDiffService.Get(app, parameters, cancellation)),
                "revit.connector.resolve" => CommandResult.Success(ConnectorResolutionService.Resolve(app, parameters)),
                "revit.collision.check" => CommandResult.Success(CollisionCheckService.Check(app, parameters, cancellation)),
                "revit.family.library.get" => CommandResult.Success(FamilyLibraryService.Catalog(app, parameters)),
                "revit.electrical.audit" => CommandResult.Success(ElectricalAuditService.Run(app, parameters, cancellation)),
                "revit.audit.run" => CommandResult.Success(RevitQueryService.Audit(app)),
                "revit.flow.diagnose" => CommandResult.Success(FlowDirectionDiagnostic.Diagnose(app, parameters)),
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
        var currentRevision = Revision(doc);
        var history = ChangeDetails(doc, since, (int)Math.Clamp(JsonDefaults.Int64(parameters,"limit") ?? 40, 1, 100));
        // Keep identity and current revision at the response root as well as in
        // the history DTO.  This is intentionally redundant: it makes the
        // contract self-describing for lightweight clients and prevents an
        // empty-history response from being mistaken for an empty JSON object.
        return CommandResult.Success(new { documentIdentity = Identity(doc), currentRevision, history });
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
        if (operations.Any(o => JsonDefaults.String(o, "operationType") == "create_stair") && operations.Count != 1)
            throw new BridgeException("invalid_stair", "create_stair must be the only operation in its plan; StairsEditScope is an atomic native scope.");
        var executor = new ModelExecutor(app, new Dictionary<string, ElementId>(StringComparer.Ordinal));
        foreach (var op in operations) executor.Validate(op);
        executor.ValidateArchitectureCopyPlan(operations);
        foreach (var p in Plans.Values.Where(p => p.Status == "pending" && p.ExpiresAtUtc < DateTime.UtcNow)) p.Status = "expired";
        if (Plans.Count >= 500) throw new BridgeException("plan_store_full", "Plan store is full. Restart the bridge in a new Revit session after completing/cancelling pending plans.");
        var plan = new ModelPlan
        {
            DocumentIdentity = Identity(doc), DocumentRevision = Revision(doc),
            Summary = JsonDefaults.StringOr(parameters, "summary", "AI 建模变更"),
            Source = JsonDefaults.StringOr(parameters, "source", "assistant"), Operations = operations,
            ExpiresAtUtc = PlanLifetimePolicy.Expires(DateTime.UtcNow, RuntimeFiles.ReadSettings().PlanLifetimeMinutes)
        };
        foreach(var op in operations.Where(op=>JsonDefaults.String(op,"operationType")=="create_stair"))
            plan.Warnings.Add("楼梯类型/踢面/踏面/平台预览："+JsonSerializer.Serialize(StairGeometryService.Preview(doc,op),JsonDefaults.Options));
        foreach (var op in operations.Where(op => JsonDefaults.String(op, "operationType") == "create_room"))
            plan.Warnings.Add("房间标高与点位预览：" + JsonSerializer.Serialize(executor.PreviewRoomCreation(op), JsonDefaults.Options) + "; room placement uses its native level and XY; boundaries and area are verified after creation, without predicting enclosure or accepting model side effects.");
        var familyPreviews = operations.Where(o => JsonDefaults.String(o, "operationType") == "load_family").Select(op => FamilyLibraryService.Validate(doc, op)).ToArray();
        foreach (var familyPreview in familyPreviews) plan.Warnings.Add("受控族加载影响预览：" + JsonSerializer.Serialize(familyPreview, JsonDefaults.Options));
        foreach(var op in operations.Where(o=>JsonDefaults.String(o,"operationType")=="create_opening"))
            plan.Warnings.Add("洞口宿主/范围影响预览："+JsonSerializer.Serialize(OpeningService.Preview(doc,op),JsonDefaults.Options)+"；结构、机电净距、防火与加固需人工审查，不是精确切割影响或合规认证。");
        foreach (var op in operations.Where(o => JsonDefaults.String(o, "operationType") == "move_drawing_placement"))
            plan.Warnings.Add("图纸放置实例移动预览：" + JsonSerializer.Serialize(DrawingPlacementService.Preview(doc, op), JsonDefaults.Options) + "；仅修改该实例纸面XY；图框、视图设置、标签与表定义保持独立，边界/相交/PNG版面仍需核验。");
        foreach (var op in operations.Where(o => JsonDefaults.String(o, "operationType") == "move_viewport_label"))
            plan.Warnings.Add("视口标签偏移预览：" + JsonSerializer.Serialize(ViewportLabelService.Preview(doc, op), JsonDefaults.Options) + "；仅修改该视口标签偏移/明确引线长度，视口内容、图纸、比例与图框保持独立，边界/相交/PNG版面仍需核验。");
        foreach (var op in operations.Where(o => JsonDefaults.String(o, "operationType") == "change_titleblock_type"))
            plan.Warnings.Add("Title-block type change preview: " + JsonSerializer.Serialize(TitleBlockChangeService.Preview(doc, op), JsonDefaults.Options) + "; native relationships, sheet boundaries and PNG layout still require independent verification.");
        foreach (var op in operations.Where(o => JsonDefaults.String(o, "operationType") == "create_structural_column"))
            plan.Warnings.Add("Structural column constraints and type activation preview: " + JsonSerializer.Serialize(executor.PreviewArchitectureColumn(op), JsonDefaults.Options) + "; structural design and all native side effects still require independent verification.");
        foreach (var op in operations.Where(o => JsonDefaults.String(o, "operationType") == "duplicate_architecture_type"))
            plan.Warnings.Add("Architecture type-copy source and dimension preview: " + JsonSerializer.Serialize(ArchitectureTypeCopyService.Preview(doc, op), JsonDefaults.Options) + "; copied type IDs are assigned only by native execution; source types are protected and final readback is required.");
        foreach (var op in operations.Where(o => JsonDefaults.String(o, "operationType") == "delete_element"))
        {
            var element = doc.GetElement(new ElementId(JsonDefaults.Int64(op, "elementId")!.Value));
            var dependentIds = element.GetDependentElements(null).Select(id => id.Value).ToArray();
            if (dependentIds.Length > 0) plan.Warnings.Add($"删除 {element.Id.Value} 可能影响 {dependentIds.Length} 个依赖元素，包括 {string.Join(",", dependentIds.Take(20))}。请在聊天预览中核对后确认该计划。");
        }
        var previewResult = CommandResult.Success(plan.View()).PrepareBounded();
        Plans.Add(plan.PlanId, plan);
        Log.Write($"Preview plan={plan.PlanId}; document={plan.DocumentIdentity}; revision={plan.DocumentRevision}; operations={operations.Count}; source={plan.Source}");
        return previewResult;
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
        executor.ValidateArchitectureCopyPlan(plan.Operations);
        if (doc.IsModifiable || doc.IsReadOnly) throw new BridgeException("document_busy", "Revit has another transaction or the document is read-only.");
        cancellation.ThrowIfCancellationRequested();
        // Re-check the native document immediately before every write path, including StairsEditScope.
        if (!Documents.Same(app.ActiveUIDocument?.Document, doc) || plan.DocumentRevision != Revision(doc))
            return StalePlan(plan,Active(app));
        executor.CaptureArchitectureCopySources(plan.Operations);
        using var capture = new ReceiptCaptureScope(doc);
        if (plan.Operations.Count == 1 && JsonDefaults.String(plan.Operations[0], "operationType") == "create_stair")
            return ConfirmStair(app, doc, plan, cancellation, executor, capture.Recorder);
        // The trusted MCP client calls Confirm only after approval of this preview in chat.
        // Do not add a second model confirmation dialog or another approval flag here.
        var created = new List<long>(); var changed = new List<long>();
        var operationEvidence = new List<object>();
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
                if (receipt.Evidence is not null) operationEvidence.Add(new { operationIndex = progress.CompletedOperationCount + 1, operationType = JsonDefaults.String(op, "operationType"), evidence = receipt.Evidence });
                if (JsonDefaults.String(op, "id") is { } key && receipt.Created.FirstOrDefault() > 0) references.Add(key, new ElementId(receipt.Created[0]));
                progress.Complete();
                failedOperationType=null;failedElementId=null;
            }
            doc.Regenerate();
            cancellation.ThrowIfCancellationRequested();
            executor.VerifyArchitectureCopiesBeforeCommit();
            executor.VerifyArchitecturePrimary("before-transaction-commit");
            executor.VerifyGridCreations("before-transaction-commit");
            executor.VerifyOpeningCreations("before-transaction-commit");
            executor.VerifyViewportLabels("before-transaction-commit");
            executor.VerifyDocumentationPlacements("before-transaction-commit");
            executor.VerifyDocumentationMetadata("before-transaction-commit");
            executor.VerifyDocumentationTitleBlocks("before-transaction-commit");
            executor.VerifyDocumentationCreations("before-transaction-commit");
            if (transaction.Commit() != TransactionStatus.Committed) throw new InvalidOperationException(string.Join("; ", failureCapture.Messages.Prepend("Revit rejected the transaction.")));
            // Commit runs native regeneration/failure processing. Verify its final result
            // while the containing group is still available for a complete rollback.
            var architectureCopyVerification = executor.VerifyArchitectureCopiesBeforeCommit();
            var architecturePrimaryVerification = executor.VerifyArchitecturePrimary("after-transaction-commit");
            var gridCreationVerification = executor.VerifyGridCreations("after-transaction-commit");
            var openingCreationVerification = executor.VerifyOpeningCreations("after-transaction-commit");
            var viewportLabelVerification = executor.VerifyViewportLabels("after-transaction-commit");
            var documentationVerification = executor.VerifyDocumentationPlacements("after-transaction-commit");
            var documentationMetadataVerification = executor.VerifyDocumentationMetadata("after-transaction-commit");
            var documentationTitleBlockVerification = executor.VerifyDocumentationTitleBlocks("after-transaction-commit");
            var documentationCreationVerification = executor.VerifyDocumentationCreations("after-transaction-commit");
            var createdIds = created.Distinct().ToArray(); var changedIds = changed.Distinct().ToArray();
            var resolvedReferences = references.ToDictionary(x => x.Key, x => x.Value.Value);
            var warnings = plan.Warnings.Concat(failureCapture.Messages).Distinct().ToArray();
            object Receipt(NativeChangeEvidence? nativeChanges) => new { planId = plan.PlanId, status = "committed", completedOperationCount = progress.CompletedOperationCount, createdElementIds = createdIds, changedElementIds = changedIds, references = resolvedReferences, operationEvidence, architectureCopyVerification, architecturePrimaryVerification, gridCreationVerification, openingCreationVerification, viewportLabelVerification, documentationVerification, documentationMetadataVerification, documentationTitleBlockVerification, documentationCreationVerification, nativeChanges, warnings, confirmationMode = "chat", saved = false };
            // The full business evidence and recoverable plan view are measured using the
            // real serializer. Reserve a proven upper bound for all native events through
            // group assimilation, rather than freezing an incomplete event capture.
            var prospectiveReceipt = Receipt(null);
            CommandResult.Success(prospectiveReceipt).PrepareBounded(capture.Recorder.ResponseSizeReservationBytes);
            CommandResult.Success(plan.ProspectiveCommittedView(prospectiveReceipt)).PrepareBounded(capture.Recorder.ResponseSizeReservationBytes);
            cancellation.ThrowIfCancellationRequested();
            if (group.Assimilate() != TransactionStatus.Committed) throw new InvalidOperationException("Unable to commit transaction group.");
            plan.Status = "committed";
            plan.Receipt = Receipt(capture.Recorder.Snapshot(Revision(doc), "committed", created, changed));
            var committedResult = CommandResult.Success(plan.Receipt).PrepareBounded();
            Log.Write($"Committed plan={plan.PlanId}; created={created.Count}; changed={changed.Count}; confirmation=chat");
            foreach (var warning in failureCapture.Messages.Distinct()) Log.Write($"Plan={plan.PlanId}; warning={warning}");
            return committedResult;
        }
        catch (Exception ex)
        {
            // A transport/serialization fault after a successful Assimilate must never
            // relabel a committed model as failed or claim that it was rolled back.
            if (group.GetStatus() == TransactionStatus.Committed)
            {
                plan.Status = "committed";
                Log.Write($"Committed plan={plan.PlanId}; receipt delivery failed; query this same plan, never retry; error={ex}");
                return CommandResult.Failure("committed_receipt_delivery_failed", "The model committed but its receipt could not be delivered. Query this same planId; do not recreate or retry the write.", new { planId = plan.PlanId, status = "committed", saved = false, causeCode = (ex as BridgeException)?.Code });
            }
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
            plan.Receipt = new { planId = plan.PlanId, status = plan.Status, rolledBack, completedOperationCount = progress.CompletedOperationCount, failedOperationIndex = progress.FailedOperationIndex, failedOperationType, failedElementId, createdElementIds = Array.Empty<long>(), nativeChanges = capture.Recorder.Snapshot(Revision(doc), "failed", created, changed), warnings = failureCapture.Messages, code = "execution_failed", causeCode = (ex as BridgeException)?.Code, causeDetails = (ex as BridgeException)?.Details, message = ex.Message };
            Log.Write($"Plan={plan.PlanId}; completed={progress.CompletedOperationCount}; failedOperationIndex={progress.FailedOperationIndex}");
            return CommandResult.Failure("execution_failed", ex.Message, plan.Receipt);
        }
    }
    private static CommandResult ConfirmStair(UIApplication app, Document doc, ModelPlan plan, CancellationToken cancellation, ModelExecutor executor, NativeChangeReceipt capture)
    {
        var operation = plan.Operations[0];
        var references = new Dictionary<string, ElementId>(StringComparer.Ordinal);
        var failedOperationType = JsonDefaults.String(operation, "operationType");
        try
        {
            plan.Status = "executing";
            cancellation.ThrowIfCancellationRequested();
            var receipt = executor.ExecuteStair(operation, cancellation);
            if (JsonDefaults.String(operation, "id") is { } key && receipt.Created.FirstOrDefault() > 0) references[key] = new ElementId(receipt.Created[0]);
            plan.Status = "committed";
            plan.Receipt = new { planId = plan.PlanId, status = "committed", completedOperationCount = 1, createdElementIds = receipt.Created.Distinct(), changedElementIds = receipt.Changed.Distinct(), references = references.ToDictionary(x => x.Key, x => x.Value.Value), operationEvidence = receipt.Evidence is null ? Array.Empty<object>() : new[] { new { operationIndex = 1, operationType = failedOperationType, evidence = receipt.Evidence } }, nativeChanges = capture.Snapshot(Revision(doc), "committed", receipt.Created, receipt.Changed), warnings = plan.Warnings.ToArray(), confirmationMode = "chat", saved = false, atomicScope = "StairsEditScope" };
            Log.Write($"Committed stair plan={plan.PlanId}; created={receipt.Created.Count}; confirmation=chat");
            return CommandResult.Success(plan.Receipt);
        }
        catch (Exception ex)
        {
            plan.Status = "failed";
            var cleanupEvidence = (ex as StairExecutionFailure)?.Cleanup ?? StairCleanupEvidence.Unknown();
            var original = ex is StairExecutionFailure failure ? failure.InnerException ?? ex : ex;
            plan.Receipt = new { planId = plan.PlanId, status = plan.Status, rollbackStatus = cleanupEvidence.RollbackStatus, rollbackVerified = false, cleanupEvidence, completedOperationCount = 0, failedOperationIndex = 1, failedOperationType, createdElementIds = Array.Empty<long>(), nativeChanges = capture.Snapshot(Revision(doc), "failed", [], []), warnings = plan.Warnings.Concat((ex as StairExecutionFailure)?.Warnings ?? []).Distinct().ToArray(), code = "execution_failed", causeCode = (ex as StairExecutionFailure)?.CauseCode ?? (original as BridgeException)?.Code, causeDetails = (ex as StairExecutionFailure)?.CauseDetails ?? (original as BridgeException)?.Details, message = ex.Message, atomicScope = "StairsEditScope" };
            Log.Write($"Failed stair plan={plan.PlanId}; rollbackStatus={cleanupEvidence.RollbackStatus}; rollbackVerified=false; error={ex}");
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
