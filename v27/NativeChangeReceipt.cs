namespace RevitAutoV27;

internal sealed record NativeReceiptEvent(long Revision, string Operation, string[] TransactionNames,
    long AddedCount, long ModifiedCount, long DeletedCount, bool MetadataTruncated);
internal sealed record NativeChangeEvidence(string DocumentIdentity, long StartRevision, long EndRevision,
    string ExecutionOutcome, string EvidenceKind, int ObservedEventCount, NativeReceiptEvent[] Events,
    long[] ObservedAddedElementIds, long[] ObservedModifiedElementIds, long[] ObservedDeletedElementIds,
    long[] AdditionalAddedElementIds, long[] UnreportedModifiedElementIds, long[] ObservedThenDeletedElementIds,
    bool ElementIdsTruncated, bool EventMetadataTruncated, bool RevisionCoverageComplete,
    bool ElementEvidenceComplete, bool CaptureComplete, bool NetModelDiffVerified, bool SideEffectsVerified, string Note);

// Independent of the bounded user-facing document journal. It records only the native
// session/command lifetime, never labels unknown native elements as harmless or predicts a net diff.
internal sealed class NativeChangeReceipt
{
    private readonly HashSet<long> added = [], modified = [], deleted = [];
    private readonly List<NativeReceiptEvent> events = [];
    private int eventCount;
    private readonly string documentIdentity;
    private readonly long startRevision;
    private readonly int elementLimit, eventLimit;
    private long lastRevision;
    internal NativeChangeReceipt(string documentIdentity, long startRevision, int elementLimit = 10000, int eventLimit = 128)
    {
        if (string.IsNullOrWhiteSpace(documentIdentity)) throw new ArgumentException("A document identity is required.", nameof(documentIdentity));
        if (startRevision < 0) throw new ArgumentOutOfRangeException(nameof(startRevision));
        if (elementLimit is < 1 or > 100000) throw new ArgumentOutOfRangeException(nameof(elementLimit));
        if (eventLimit is < 1 or > 1024) throw new ArgumentOutOfRangeException(nameof(eventLimit));
        this.documentIdentity = documentIdentity; this.startRevision = startRevision;
        this.elementLimit = elementLimit; this.eventLimit = eventLimit; lastRevision = startRevision;
    }
    private bool idsTruncated, metadataTruncated, invalidEvidence;
    private bool sequentialRevisions = true;
    public void Record(string identity, long revision, string operation, IEnumerable<string> names,
        IEnumerable<long> addedIds, IEnumerable<long> modifiedIds, IEnumerable<long> deletedIds)
    {
        if (identity != documentIdentity) return;
        eventCount++;
        if (revision != lastRevision + 1) sequentialRevisions = false;
        lastRevision = revision;
        long a = Merge(added, addedIds), m = Merge(modified, modifiedIds), d = Merge(deleted, deletedIds);
        var labels = names.ToArray();
        var bounded = labels.Take(3).Select(n => n.Length > 500 ? n[..500] : n).ToArray();
        bool truncated = labels.Length > 3 || labels.Any(n => n.Length > 500) || operation.Length > 120;
        metadataTruncated |= truncated || events.Count >= eventLimit;
        if (events.Count < eventLimit) events.Add(new(revision, operation.Length > 120 ? operation[..120] : operation, bounded, a, m, d, truncated));
    }
    private long Merge(HashSet<long> target, IEnumerable<long> ids)
    {
        long count = 0;
        foreach (var id in ids)
        {
            count++;
            if (id <= 0) { invalidEvidence = true; continue; }
            if (target.Contains(id)) continue;
            if (target.Count >= elementLimit) { idsTruncated = true; continue; }
            target.Add(id);
        }
        return count;
    }
    internal NativeChangeEvidence Snapshot(long endRevision, string outcome, IEnumerable<long> primaryCreated, IEnumerable<long> primaryChanged)
    {
        var created = primaryCreated.ToHashSet(); var changed = primaryChanged.ToHashSet();
        bool revisionCoverage = sequentialRevisions && lastRevision == endRevision && endRevision >= startRevision
            && eventCount == endRevision - startRevision;
        bool primaryEvidenceCovered = created.All(added.Contains) && changed.All(id => modified.Contains(id) || deleted.Contains(id));
        bool elementComplete = revisionCoverage && primaryEvidenceCovered && !idsTruncated && !invalidEvidence;
        bool complete = elementComplete && !metadataTruncated;
        return new(documentIdentity, startRevision, endRevision, outcome, "document-changed-event-union", eventCount, events.ToArray(),
            added.Order().ToArray(), modified.Order().ToArray(), deleted.Order().ToArray(),
            added.Except(created).Order().ToArray(), modified.Except(created).Except(changed).Order().ToArray(),
            added.Intersect(deleted).Order().ToArray(), idsTruncated, metadataTruncated, revisionCoverage,
            elementComplete, complete, false, false,
            "Primary receipt IDs are operation results only. This is a bounded union of native DocumentChanged events during this execution, including automatic systems/centerlines/internal elements and rollback events. It is not a verified final net model diff. Unreported modifications and unknown side effects require review; capture completeness does not certify safety or rollback. No model was saved by the plugin.");
    }
}
