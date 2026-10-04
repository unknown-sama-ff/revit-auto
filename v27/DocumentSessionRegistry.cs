namespace RevitAutoV27;

// Match native document sessions, not managed wrapper references or paths.
// Delegates keep this registry testable without starting Revit.
internal sealed class DocumentSessionRegistry<TDocument>(Func<TDocument, TDocument, bool> sameDocument, Func<TDocument, bool> isValid) where TDocument : class
{
    internal sealed class Session
    {
        public string Id { get; } = Guid.NewGuid().ToString("N");
        public long Revision { get; internal set; }
    }
    private readonly object gate = new();
    private readonly List<(TDocument Document, Session State)> sessions = [];
    public Session Get(TDocument document)
    {
        lock (gate) return GetLocked(document);
    }
    public bool Same(TDocument? first, TDocument? second)
    {
        lock (gate) return first is not null && second is not null && isValid(first) && isValid(second) && sameDocument(first, second);
    }
    public void Changed(TDocument document)
    {
        lock (gate) GetLocked(document).Revision++;
    }
    public void Closed(bool succeeded)
    {
        // DocumentClosed also fires when closing is cancelled or fails.
        if (!succeeded) return;
        lock (gate) sessions.RemoveAll(entry => !isValid(entry.Document));
    }
    private Session GetLocked(TDocument document)
    {
        if (!isValid(document)) throw new InvalidOperationException("The document session is no longer valid.");
        sessions.RemoveAll(entry => !isValid(entry.Document));
        foreach (var entry in sessions)
            if (sameDocument(entry.Document, document)) return entry.State;
        var state = new Session();
        sessions.Add((document, state));
        return state;
    }
}
