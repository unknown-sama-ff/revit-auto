namespace RevitAutoV27;

internal sealed record DocumentChangeRecord(long Revision, DateTimeOffset TimestampUtc, string Operation, string[] TransactionNames, long[] AddedElementIds, long[] ModifiedElementIds, long[] DeletedElementIds, int AddedCount, int ModifiedCount, int DeletedCount, bool ElementIdsTruncated);
// Keep the history response as a named DTO instead of an anonymous object.  The
// bridge serializes responses on a different boundary from the Revit UI thread;
// a concrete contract makes the empty-history/no-op shape deterministic for every
// client, including Claude Code and Codex.
internal sealed record DocumentChangeHistory(
    long SinceRevision,
    long CurrentRevision,
    bool HistoryComplete,
    DocumentChangeRecord[] Changes,
    bool HasMore,
    long RetainedFromRevision,
    string Note);
internal sealed class DocumentChangeJournal(int capacity = 128, int elementLimit = 500)
{
    private readonly Queue<DocumentChangeRecord> records = new();
    public void Record(long revision, string operation, IEnumerable<string> names, IEnumerable<long> added, IEnumerable<long> modified, IEnumerable<long> deleted)
    {
        var a=added.Distinct().ToArray();var m=modified.Distinct().ToArray();var d=deleted.Distinct().ToArray();
        records.Enqueue(new(revision,DateTimeOffset.UtcNow,operation,names.ToArray(),a.Take(elementLimit).ToArray(),m.Take(elementLimit).ToArray(),d.Take(elementLimit).ToArray(),a.Length,m.Length,d.Length,a.Length>elementLimit||m.Length>elementLimit||d.Length>elementLimit));
        while(records.Count>capacity)records.Dequeue();
    }
    public object Since(long sinceRevision, long currentRevision, int limit=40)
    {
        if(sinceRevision<0||sinceRevision>currentRevision)throw new ArgumentOutOfRangeException(nameof(sinceRevision));
        var matching=records.Where(r=>r.Revision>sinceRevision&&r.Revision<=currentRevision).ToArray();
        var first=records.TryPeek(out var record)?record.Revision:currentRevision+1;
        var historyComplete=sinceRevision==currentRevision || first<=sinceRevision+1 && matching.LongLength==currentRevision-sinceRevision;
        return new DocumentChangeHistory(
            sinceRevision,
            currentRevision,
            historyComplete,
            matching.Take(limit).ToArray(),
            matching.Length > limit,
            first,
            "Any document transaction still invalidates a preview. History explains the rejection; it does not bypass validation.");
    }
}
