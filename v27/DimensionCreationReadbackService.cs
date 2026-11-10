using Autodesk.Revit.DB;
using System.Text.Json;

namespace RevitAutoV27;

internal static class DimensionNativeEvidence
{
    internal sealed record ResolvedReferences(Reference[] Native, DimensionReferenceReadback[] Evidence);
    private static DimensionReferenceReadback ReferenceEvidence(Document doc, Reference reference) =>
        new(reference.ConvertToStableRepresentation(doc), reference.ElementId.Value, reference.LinkedElementId.Value, reference.ElementReferenceType.ToString());
    internal static DimensionAxis Axis(Line line) => new(
        new(JsonDefaults.InternalToMm(line.Origin.X), JsonDefaults.InternalToMm(line.Origin.Y), JsonDefaults.InternalToMm(line.Origin.Z)),
        new(line.Direction.X, line.Direction.Y, line.Direction.Z));

    internal static ResolvedReferences Resolve(Document doc, JsonElement op)
    {
        if (doc.IsFamilyDocument)
            throw new BridgeException("project_document_required", "create_dimension uses project NewDimension; family dimension creation is not exposed.");
        var native = JsonDefaults.Array(op, "references").Select(value => Reference.ParseFromStableRepresentation(doc,
            value.GetString() ?? throw new BridgeException("invalid_dimension_reference", "A native stable reference string is required."))).ToArray();
        var evidence = native.Select(reference => ReferenceEvidence(doc, reference)).ToArray();
        try { DimensionCreationReadbackRules.RequireReferences(evidence); }
        catch (BridgeException error) { throw new BridgeException("invalid_dimension_reference", error.Message); }
        return new(native, evidence);
    }

    internal static DimensionCreationReadback Read(Document doc, Dimension dimension)
    {
        if (!dimension.IsValidObject || !dimension.Document.Equals(doc) ||
            (dimension.GetType() != typeof(Dimension) && dimension.GetType() != typeof(LinearDimension)))
            throw new BridgeException("invalid_dimension_readback", "Expected a linear dimension in the bound native document.");
        using var curve = dimension.Curve;
        if (curve is not Line line) throw new BridgeException("dimension_axis_unavailable", "Native dimension does not expose a linear axis.");
        using var references = dimension.References;
        if (references is null || references.Size > DimensionCreationReadbackRules.MaxReferences)
            throw new BridgeException("dimension_references_unavailable", "Native dimension reference collection is missing or exceeds the evidence limit.");
        var result = new DimensionCreationReadback(dimension.Id.Value, dimension.UniqueId, dimension.GetType().Name,
            dimension.OwnerViewId.Value, dimension.GetTypeId().Value, dimension.AreReferencesAvailable, Axis(line),
            references.Cast<Reference>().Select(reference => ReferenceEvidence(doc, reference)).ToArray(), line.IsBound);
        DimensionCreationReadbackRules.RequireStructure(result);
        return result;
    }

    internal static object? Snapshot(Element element)
    {
        if (element is not Dimension dimension) return null;
        try { return new { supported = true, scope = "linear-dimension-identity-axis-reference-observations", native = Read(element.Document, dimension),
            requestedGeometryVerified = false, measurementVerified = false, sideEffectsVerified = false }; }
        catch (Exception error) when (error is not (OperationCanceledException or OutOfMemoryException))
        { return new { supported = false, scope = "linear-dimension-identity-axis-reference-observations",
            code = error is BridgeException bridge ? bridge.Code : "dimension_evidence_unavailable", errorType = error.GetType().Name }; }
    }
}

internal sealed class DimensionCreationReadbackService
{
    private readonly List<DimensionCreationReadback> bindings = new();
    private Document? document;
    private void RequireDocument(Document doc)
    {
        if (document is null || !document.IsValidObject || !document.Equals(doc))
            throw new BridgeException("invalid_dimension_readback", "Dimension evidence belongs to another native document.");
    }
    internal OperationReceipt Remember(Document doc, Dimension dimension, DimensionCreationReadback expected)
    {
        document ??= doc; RequireDocument(doc);
        if (!dimension.Document.Equals(doc)) throw new BridgeException("invalid_dimension_readback", "Created dimension belongs to another document.");
        doc.Regenerate();
        var receipt = DimensionCreationReadbackRules.Receipt(expected, DimensionNativeEvidence.Read(doc, dimension), "immediate-after-creation");
        bindings.Add(expected with { References = expected.References.ToArray() });
        return OperationReceipt.New(dimension.Id.Value) with { Evidence = receipt };
    }
    internal object[] VerifyCompleted(Document doc, string phase)
    {
        if (bindings.Count == 0) return [];
        RequireDocument(doc);
        return bindings.Select(expected =>
        {
            var dimension = doc.GetElement(new ElementId(expected.DimensionId)) as Dimension ??
                throw new BridgeException("invalid_dimension_readback", "Created dimension disappeared before verification.");
            return DimensionCreationReadbackRules.Receipt(expected, DimensionNativeEvidence.Read(doc, dimension), phase);
        }).ToArray();
    }
}
