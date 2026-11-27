using System.Text.Json;
using Autodesk.Revit.DB;

namespace RevitAutoV27;

// Native Revit JoinGeometryUtils adapter (join / unjoin / switch_order).
// Transactions belong to ModelExecutor / RevitCommandRouter; never saves or creates sub-transactions.
internal sealed class GeometryJoinService
{
    private sealed record Binding(long FirstId, long SecondId, string Action, bool WasJoinedBefore, bool? FirstWasCuttingBefore, bool NoOp, bool SkippedUnjoinable, string? SkippedReason, JsonElement Reviewed);
    private readonly List<Binding> completed = [];
    private Document? capturedDocument;

    private static BridgeException Invalid(string message) => GeometryJoinRules.Invalid(message);

    public static void ValidateExisting(Document doc, JsonElement op, Element? first, Element? second)
    {
        _ = GeometryJoinRules.Validate(op);
        if (first is not null) RequireJoinableElement(first, "firstElementId");
        if (second is not null) RequireJoinableElement(second, "secondElementId");
        if (first is not null && second is not null && first.Id == second.Id)
            throw Invalid("join_geometry requires two distinct native elements.");
    }

    public static object Preview(Document doc, JsonElement op)
    {
        var input = GeometryJoinRules.Validate(op);
        var first = input.FirstId is long fid ? doc.GetElement(new ElementId(fid)) : null;
        var second = input.SecondId is long sid ? doc.GetElement(new ElementId(sid)) : null;
        bool? currentlyJoined = null;
        if (first is not null && second is not null)
        {
            RequireJoinableElement(first, "firstElementId");
            RequireJoinableElement(second, "secondElementId");
            currentlyJoined = JoinGeometryUtils.AreElementsJoined(doc, first, second);
        }
        return new
        {
            operationType = "join_geometry",
            firstElement = input.FirstRef,
            secondElement = input.SecondRef,
            action = input.Action,
            ignoreAlreadyJoined = input.IgnoreAlreadyJoined,
            currentlyJoined,
            nativeApi = "JoinGeometryUtils",
            engineeringComplianceVerified = false
        };
    }

    public OperationReceipt Apply(Document doc, JsonElement op, Element first, Element second)
    {
        Bind(doc);
        var input = GeometryJoinRules.Validate(op);
        RequireJoinableElement(first, "firstElementId");
        RequireJoinableElement(second, "secondElementId");
        if (first.Id == second.Id)
            throw Invalid("join_geometry requires two distinct native elements.");

        var wasJoined = JoinGeometryUtils.AreElementsJoined(doc, first, second);
        bool? firstWasCutting = wasJoined ? SafeIsCutting(doc, first, second) : null;
        var noOp = false;
        var skippedUnjoinable = false;
        string? skippedReason = null;

        switch (input.Action)
        {
            case "join":
                if (wasJoined)
                {
                    if (!input.IgnoreAlreadyJoined)
                        throw Invalid($"Elements {first.Id.Value} and {second.Id.Value} are already joined.");
                    noOp = true;
                }
                else
                {
                    try
                    {
                        JoinGeometryUtils.JoinGeometry(doc, first, second);
                    }
                    catch (Exception ex) when (input.SkipIfUnjoinable &&
                        ex is Autodesk.Revit.Exceptions.ArgumentException or Autodesk.Revit.Exceptions.InvalidOperationException)
                    {
                        skippedUnjoinable = true;
                        skippedReason = ex.Message;
                        noOp = true;
                    }
                }
                break;

            case "unjoin":
                if (!wasJoined)
                {
                    if (!input.IgnoreAlreadyJoined)
                        throw Invalid($"Elements {first.Id.Value} and {second.Id.Value} are not currently joined.");
                    noOp = true;
                }
                else
                {
                    JoinGeometryUtils.UnjoinGeometry(doc, first, second);
                }
                break;

            case "switch_order":
                if (!wasJoined)
                {
                    if (input.SkipIfUnjoinable)
                    {
                        skippedUnjoinable = true;
                        skippedReason = "Elements are not joined; switch_order skipped.";
                        noOp = true;
                        break;
                    }
                    throw Invalid($"Elements {first.Id.Value} and {second.Id.Value} must already be joined before switch_order.");
                }
                try
                {
                    JoinGeometryUtils.SwitchJoinOrder(doc, first, second);
                }
                catch (Exception ex) when (input.SkipIfUnjoinable &&
                    ex is Autodesk.Revit.Exceptions.ArgumentException or Autodesk.Revit.Exceptions.InvalidOperationException)
                {
                    skippedUnjoinable = true;
                    skippedReason = ex.Message;
                    noOp = true;
                }
                break;

            default:
                throw Invalid($"Unsupported join_geometry action '{input.Action}'.");
        }

        if (!noOp) doc.Regenerate();

        var binding = new Binding(first.Id.Value, second.Id.Value, input.Action, wasJoined, firstWasCutting, noOp, skippedUnjoinable, skippedReason, op.Clone());
        var evidence = Verify(doc, binding);
        completed.Add(binding);

        return noOp
            ? new OperationReceipt([], []) { Evidence = evidence }
            : new OperationReceipt([], [first.Id.Value, second.Id.Value]) { Evidence = evidence };
    }

    public object VerifyCompleted(Document doc, string phase)
    {
        Bind(doc);
        var items = completed.Select(b => Verify(doc, b)).ToArray();
        return new
        {
            phase,
            verifiedJoinCount = items.Length,
            nativeReadbackVerified = true,
            joins = items,
            sideEffectsVerified = false,
            persistenceVerified = false,
            visualVerified = false,
            engineeringComplianceVerified = false
        };
    }

    private static object Verify(Document doc, Binding binding)
    {
        var first = doc.GetElement(new ElementId(binding.FirstId))
            ?? throw Invalid($"Joined element {binding.FirstId} disappeared before readback.");
        var second = doc.GetElement(new ElementId(binding.SecondId))
            ?? throw Invalid($"Joined element {binding.SecondId} disappeared before readback.");
        var isJoinedAfter = JoinGeometryUtils.AreElementsJoined(doc, first, second);
        bool? firstIsCuttingAfter = isJoinedAfter ? SafeIsCutting(doc, first, second) : null;
        var state = new GeometryJoinReadback(
            binding.FirstId, binding.SecondId, binding.Action,
            binding.WasJoinedBefore, isJoinedAfter,
            binding.FirstWasCuttingBefore, firstIsCuttingAfter, binding.NoOp,
            binding.SkippedUnjoinable, binding.SkippedReason);
        GeometryJoinRules.Require(state);
        return new
        {
            firstElementId = binding.FirstId,
            secondElementId = binding.SecondId,
            action = binding.Action,
            noOp = binding.NoOp,
            skippedUnjoinable = binding.SkippedUnjoinable,
            skippedReason = binding.SkippedReason,
            wasJoinedBefore = binding.WasJoinedBefore,
            isJoinedAfter,
            firstWasCuttingBefore = binding.FirstWasCuttingBefore,
            firstIsCuttingAfter,
            nativeReadbackVerified = true
        };
    }

    private static bool? SafeIsCutting(Document doc, Element first, Element second)
    {
        try { return JoinGeometryUtils.IsCuttingElementInJoin(doc, first, second); }
        catch { return null; }
    }

    public static void ValidatePredictedType(Type? predictedType, string field)
    {
        if (predictedType is null) return;
        if (typeof(ElementType).IsAssignableFrom(predictedType) ||
            typeof(View).IsAssignableFrom(predictedType) ||
            typeof(Level).IsAssignableFrom(predictedType) ||
            typeof(Grid).IsAssignableFrom(predictedType) ||
            typeof(Sketch).IsAssignableFrom(predictedType))
            throw Invalid($"{field} references a non-joinable deferred operation type ({predictedType.Name}).");
    }

    private static void RequireJoinableElement(Element element, string field)
    {
        if (element is ElementType or View or Level or Grid or Sketch)
            throw Invalid($"{field} ({element.Id.Value}, {element.GetType().Name}) is not a joinable 3D model element.");
    }

    private void Bind(Document doc)
    {
        if (capturedDocument is null) capturedDocument = doc;
        else if (!capturedDocument.IsValidObject || !capturedDocument.Equals(doc))
            throw Invalid("Geometry join readback belongs to a different native document.");
    }
}
