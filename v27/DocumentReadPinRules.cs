using System.Text.Json;

namespace RevitAutoV27;

internal static class DocumentReadPinRules
{
    private const long MaxSafeInteger = 9007199254740991;

    public static void Validate(JsonElement request, string currentIdentity, long currentRevision)
    {
        if (request.ValueKind != JsonValueKind.Object)
            throw Invalid("Read pins must be supplied as an object.");

        if (request.TryGetProperty("documentIdentity", out var identity))
        {
            if (identity.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(identity.GetString()) || identity.GetString()!.Length > 200)
                throw Invalid("documentIdentity must be a nonblank document session identity.");
            var expected = identity.GetString()!;
            if (expected != currentIdentity)
                throw new BridgeException("document_changed", "The active document differs from the reviewed read request.", new { expectedDocumentIdentity = expected, currentDocumentIdentity = currentIdentity });
        }

        if (request.TryGetProperty("expectedRevision", out var revision))
        {
            if (revision.ValueKind != JsonValueKind.Number || !revision.TryGetInt64(out var expected) || expected < 0 || expected > MaxSafeInteger)
                throw Invalid("expectedRevision must be a nonnegative safe integer.");
            if (expected != currentRevision)
                throw new BridgeException("document_revision_changed", "The active document revision differs from the reviewed read request.", new { expectedRevision = expected, currentRevision });
        }
    }

    private static BridgeException Invalid(string message) => new("invalid_document_read_pin", message);
}
