using Autodesk.Revit.DB;

namespace RevitAutoV27;

// Keep element and curve references separate; neither observation certifies dimension suitability.
internal static class GridDimensionReferenceService
{
    private static DimensionReferenceReadback Read(Document doc, Reference reference) => new(
        reference.ConvertToStableRepresentation(doc), reference.ElementId.Value,
        reference.LinkedElementId.Value, reference.ElementReferenceType.ToString());

    private static DimensionPoint Point(XYZ value)
    {
        var point = new DimensionPoint(JsonDefaults.InternalToMm(value.X), JsonDefaults.InternalToMm(value.Y), JsonDefaults.InternalToMm(value.Z));
        if (!double.IsFinite(point.Xmm) || !double.IsFinite(point.Ymm) || !double.IsFinite(point.Zmm))
            throw new BridgeException("grid_curve_unavailable", "Native grid curve contains non-finite coordinates.");
        return point;
    }
    private static object ModelCurve(Grid grid)
    {
        try
        {
            using var curve = grid.Curve;
            if (curve is not Line line || !line.IsBound)
                return new { supported = false, reason = "grid-model-curve-is-not-a-bounded-line" };
            object curveReferenceEvidence;
            try
            {
                using var curveReference = curve.Reference;
                if (curveReference is null)
                    curveReferenceEvidence = new { supported = false, reason = "grid-model-curve-reference-unavailable" };
                else
                {
                    var nativeCurveReference = Read(grid.Document, curveReference);
                    using var parsed = Reference.ParseFromStableRepresentation(grid.Document, nativeCurveReference.StableReference);
                    var parsedEvidence = Read(grid.Document, parsed);
                    var roundTripVerified = false;
                    string? validationCode = null;
                    try
                    {
                        GridDimensionReferenceRules.RequireCurveReference(grid.Id.Value, nativeCurveReference, parsedEvidence);
                        roundTripVerified = true;
                    }
                    catch (BridgeException error) { validationCode = error.Code; }
                    curveReferenceEvidence = new
                    {
                        supported = roundTripVerified,
                        scope = "grid-model-curve-reference-observation",
                        referenceSource = "Grid.Curve.Reference",
                        native = nativeCurveReference,
                        parsed = parsedEvidence,
                        roundTripVerified,
                        validationCode,
                        dimensionSuitabilityVerified = false
                    };
                }
            }
            catch (Exception error) when (error is not (OperationCanceledException or OutOfMemoryException))
            {
                curveReferenceEvidence = new { supported = false, reason = error is BridgeException bridge ? bridge.Code : "grid-model-curve-reference-unavailable", errorType = error.GetType().Name };
            }
            return new { supported = true, kind = "bounded-line", units = "mm", start = Point(line.GetEndPoint(0)), end = Point(line.GetEndPoint(1)), dimensionReferenceCandidate = curveReferenceEvidence };
        }
        catch (Exception error) when (error is not (OperationCanceledException or OutOfMemoryException))
        { return new { supported = false, reason = "native-grid-model-curve-read-failed", errorType = error.GetType().Name }; }
    }

    internal static object? Snapshot(Element element)
    {
        if (element is not Grid grid) return null;
        var doc = grid.Document;
        try
        {
            if (doc.IsFamilyDocument || !grid.IsValidObject)
                throw new BridgeException("project_document_required", "Grid dimension references require an existing project datum.");
            using var reference = new Reference(grid);
            var native = Read(doc, reference);
            using var parsed = Reference.ParseFromStableRepresentation(doc, native.StableReference);
            GridDimensionReferenceRules.Require(grid.Id.Value, native, Read(doc, parsed));
            return new
            {
                supported = true,
                scope = "local-grid-element-stable-reference",
                documentIdentity = RevitCommandRouter.Identity(doc),
                documentRevision = RevitCommandRouter.Revision(doc),
                gridId = grid.Id.Value,
                uniqueId = grid.UniqueId,
                native,
                modelCurve = ModelCurve(grid),
                roundTripVerified = true,
                referenceSource = "Autodesk.Revit.DB.Reference(Grid)",
                dimensionSuitabilityVerified = false,
                viewVisibilityVerified = false,
                modelWritesRequested = false
            };
        }
        catch (Exception error) when (error is not (OperationCanceledException or OutOfMemoryException))
        {
            return new { supported = false, scope = "local-grid-element-stable-reference",
                code = error is BridgeException bridge ? bridge.Code : "grid_dimension_reference_unavailable",
                errorType = error.GetType().Name, dimensionSuitabilityVerified = false };
        }
    }
}
