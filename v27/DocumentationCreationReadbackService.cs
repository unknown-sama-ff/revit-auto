// Selected tag association extraction adapted from bimwright/rvt-mcp (Apache-2.0).
// Modified for Revit 2027 typed APIs and strict before/after readback validation.
// Source, modifications and license: ../THIRD_PARTY_NOTICES.md.
using System.Text.Json;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Electrical;
using Autodesk.Revit.DB.Architecture;

namespace RevitAutoV27;

internal sealed class DocumentationCreationReadbackService
{
    private sealed record SheetBinding(ViewSheet Sheet, DocumentationSheetCreationReadback Expected, bool WritePerformed);
    private sealed record ViewportBinding(Element Placement, DocumentationPlacementReadback Expected, bool WritePerformed);
    private readonly List<SheetBinding> sheets = new();
    private readonly List<ViewportBinding> viewports = new();
    private readonly List<TagTargetReadback> tagTargets = new();
    private readonly List<TagLeaderReadback> tagLeaders = new();
    private readonly DimensionCreationReadbackService dimensions = new();
    private Document? tagDocument;

    private static BridgeException Invalid(string message) => new("invalid_documentation_readback", message);
    internal OperationReceipt RememberDimensionCreation(Document doc, Dimension dimension, DimensionCreationReadback expected) =>
        dimensions.Remember(doc, dimension, expected);
    internal OperationReceipt RememberTagCreation(Document doc, Element tag, TagTargetReadback expected, JsonElement op)
    {
        if (tagDocument is null) tagDocument = doc;
        RequireTagDocument(doc);
        if (!tag.Document.Equals(doc)) throw new BridgeException("invalid_tag_target", "Created tag belongs to another native document.");
        doc.Regenerate();
        var target = VerifyTagTarget(doc, expected, "immediate-after-creation");
        tagTargets.Add(expected);
        var leader = TagLeaderRules.Requested(op).HasValue
            ? RememberTagLeader(doc, tag, expected.ViewId, op).Evidence : null;
        return OperationReceipt.New(tag.Id.Value) with { Evidence = new { target, leader } };
    }

    // Adapted from rvt-mcp FindUntaggedElementsHandler's local-target extraction.
    // Use typed 2027 APIs; never turn a failed/linked/orphaned read into an empty success.
    private static TagTargetReadback ReadTagTarget(Element tag)
    {
        bool orphaned;
        ICollection<LinkElementId> references;
        switch (tag)
        {
            case RoomTag room:
                var nativeRoom = room.Room;
                if (room.IsTaggingLink || nativeRoom is null || !nativeRoom.IsValidObject ||
                    room.TaggedLocalRoomId != nativeRoom.Id || room.TaggedRoomId.HostElementId != nativeRoom.Id)
                    throw new BridgeException("invalid_tag_target", "Created room tag has no consistent local room association.");
                orphaned = room.IsOrphaned;
                references = new[] { room.TaggedRoomId };
                break;
            case IndependentTag independent:
                orphaned = independent.IsOrphaned;
                references = independent.GetTaggedElementIds();
                break;
            default:
                throw new BridgeException("invalid_tag_target", "Created element is not a supported native tag.");
        }
        if (references.Count != 1)
            throw new BridgeException("invalid_tag_target", "Created tag must reference exactly the one requested local element.");
        return new(tag.Id.Value, tag.GetType().Name, tag.OwnerViewId.Value, tag.GetTypeId().Value, orphaned,
            references.Select(reference => new TagTargetReference(reference.HostElementId.Value,
                reference.LinkInstanceId.Value, reference.LinkedElementId.Value)).ToArray());
    }

    private static object VerifyTagTarget(Document doc, TagTargetReadback expected, string phase)
    {
        if (expected.Targets is null || expected.Targets.Count != 1 ||
            doc.GetElement(new ElementId(expected.Targets[0].HostElementId)) is not { IsValidObject: true })
            throw new BridgeException("invalid_tag_target", "The requested local tag target disappeared before verification.");
        var tag = doc.GetElement(new ElementId(expected.TagId)) ??
            throw new BridgeException("invalid_tag_target", "Created tag disappeared before verification.");
        return TagTargetRules.Receipt(expected, ReadTagTarget(tag), phase);
    }

    internal static object? TagSnapshot(Element element)
    {
        if (element is not (RoomTag or IndependentTag)) return null;
        try
        {
            var native = ReadTagTarget(element);
            TagTargetRules.Require(native, native);
            return new { supported = true, scope = "single-local-target", native };
        }
        catch (Exception error)
        {
            return new { supported = false, scope = "single-local-target",
                code = error is BridgeException bridge ? bridge.Code : "tag_target_unavailable", reason = error.Message };
        }
    }

    internal OperationReceipt RememberTagLeader(Document doc, Element tag, long expectedViewId, JsonElement op)
    {
        var requested = TagLeaderRules.Requested(op) ?? throw Invalid("No explicit tag leader was supplied.");
        if (tagDocument is null) tagDocument = doc;
        RequireTagDocument(doc);
        var actual = ReadTagLeader(tag);
        var expected = new TagLeaderReadback(tag.Id.Value, actual.ClassName, expectedViewId, requested);
        var receipt = TagLeaderRules.Receipt(expected, actual, "immediate-after-creation");
        tagLeaders.Add(expected);
        return OperationReceipt.New(tag.Id.Value) with { Evidence = receipt };
    }
    private void RequireTagDocument(Document doc)
    {
        if (tagDocument is null || !tagDocument.IsValidObject || !tagDocument.Equals(doc))
            throw new BridgeException("invalid_tag_leader", "Tag leader evidence belongs to another native document.");
    }
    private static TagLeaderReadback ReadTagLeader(Element tag) => tag switch
    {
        RoomTag room => new(room.Id.Value, nameof(RoomTag), room.OwnerViewId.Value, room.HasLeader),
        IndependentTag independent => new(independent.Id.Value, nameof(IndependentTag), independent.OwnerViewId.Value, independent.HasLeader),
        _ => throw new BridgeException("invalid_tag_leader", "The created element is not a supported native tag.")
    };

    internal void RememberSheet(Document doc, ViewSheet sheet, JsonElement op, bool writePerformed)
    {
        var titleBlocks = TitleBlocks(doc, sheet.Id);
        var expectedTitleBlockTypeId = JsonDefaults.Has(op, "titleBlockId") ? JsonDefaults.Int64(op, "titleBlockId") : null;
        var expected = new DocumentationSheetCreationReadback(
            sheet.Id.Value,
            nameof(ViewSheet),
            JsonDefaults.String(op, "number") ?? throw Invalid("Created sheet number is missing from the reviewed operation."),
            JsonDefaults.String(op, "name") ?? throw Invalid("Created sheet name is missing from the reviewed operation."),
            expectedTitleBlockTypeId,
            titleBlocks.Select(x => x.Item1).ToArray(),
            titleBlocks.Select(x => x.Item2).ToArray());
        sheets.Add(new(sheet, expected, writePerformed));
    }

    internal void RememberViewport(ViewSheet sheet, View view, Element placement, JsonElement op, bool writePerformed)
    {
        var relationship = Relationship(placement);
        var point = CurrentPoint(placement);
        var expected = new DocumentationPlacementReadback(
            placement.Id.Value,
            DocumentationCreationReadbackRules.ExpectedPlacementClass(view.GetType().Name),
            sheet.Id.Value,
            view.Id.Value,
            PlanRules.Number(op, "xMm"),
            PlanRules.Number(op, "yMm"),
            0);
        var actual = new DocumentationPlacementReadback(
            placement.Id.Value,
            placement.GetType().Name,
            relationship.SheetId,
            relationship.ViewId,
            JsonDefaults.InternalToMm(point.X),
            JsonDefaults.InternalToMm(point.Y),
            JsonDefaults.InternalToMm(point.Z));
        DocumentationCreationReadbackRules.RequireViewport(expected, actual);
        viewports.Add(new(placement, expected, writePerformed));
    }

    internal object VerifyCompleted(Document doc, string phase)
    {
        var sheetChecks = sheets.Select(binding => VerifySheet(doc, binding, phase)).ToArray();
        var viewportChecks = viewports.Select(binding => VerifyViewport(doc, binding, phase)).ToArray();
        var dimensionChecks = dimensions.VerifyCompleted(doc, phase);
        if (tagTargets.Count > 0 || tagLeaders.Count > 0) RequireTagDocument(doc);
        var tagTargetChecks = tagTargets.Select(expected => VerifyTagTarget(doc, expected, phase)).ToArray();
        var tagLeaderChecks = tagLeaders.Select(expected => TagLeaderRules.Receipt(expected,
            ReadTagLeader(doc.GetElement(new ElementId(expected.TagId)) ??
                throw new BridgeException("invalid_tag_leader", "Created tag disappeared before final verification.")), phase)).ToArray();
        return new
        {
            phase,
            completedSheetCount = sheetChecks.Length,
            completedViewportCount = viewportChecks.Length,
            sheetChecks,
            viewportChecks,
            completedDimensionCount = dimensionChecks.Length,
            dimensionChecks,
            completedTagTargetCount = tagTargetChecks.Length,
            tagTargetChecks,
            completedTagLeaderCount = tagLeaderChecks.Length,
            tagLeaderChecks,
            nativeReadbackVerified = true,
            sideEffectsVerified = false,
            persistenceVerified = false,
            visualVerified = false
        };
    }

    private static object VerifySheet(Document doc, SheetBinding binding, string phase)
    {
        var sheet = doc.GetElement(binding.Sheet.Id) as ViewSheet ?? throw Invalid("Created sheet disappeared before final verification.");
        var titleBlocks = TitleBlocks(doc, sheet.Id);
        var actual = new DocumentationSheetCreationReadback(sheet.Id.Value, nameof(ViewSheet), sheet.SheetNumber, sheet.Name,
            titleBlocks.Length == 1 ? titleBlocks[0].Item2 : null,
            titleBlocks.Select(x => x.Item1).ToArray(), titleBlocks.Select(x => x.Item2).ToArray());
        DocumentationCreationReadbackRules.RequireSheet(binding.Expected, actual);
        return new
        {
            phase,
            sheetId = actual.SheetId,
            className = actual.ClassName,
            number = actual.Number,
            name = actual.Name,
            requestedTitleBlockTypeId = actual.RequestedTitleBlockTypeId,
            titleBlockIds = actual.TitleBlockIds,
            titleBlockTypeIds = actual.TitleBlockTypeIds,
            sheetWritePerformed = binding.WritePerformed,
            nativeReadbackVerified = true,
            sideEffectsVerified = false,
            persistenceVerified = false,
            visualVerified = false
        };
    }

    private static object VerifyViewport(Document doc, ViewportBinding binding, string phase)
    {
        var placement = doc.GetElement(binding.Placement.Id) ?? throw Invalid("Created viewport placement disappeared before final verification.");
        var relationship = Relationship(placement);
        var point = CurrentPoint(placement);
        var actual = new DocumentationPlacementReadback(
            placement.Id.Value,
            placement.GetType().Name,
            relationship.SheetId,
            relationship.ViewId,
            JsonDefaults.InternalToMm(point.X),
            JsonDefaults.InternalToMm(point.Y),
            JsonDefaults.InternalToMm(point.Z));
        DocumentationCreationReadbackRules.RequireViewport(binding.Expected, actual);
        return new
        {
            phase,
            placementId = actual.PlacementId,
            className = actual.ClassName,
            sheetId = actual.SheetId,
            viewId = actual.ViewId,
            requestedPosition = new { xMm = binding.Expected.Xmm, yMm = binding.Expected.Ymm, zMm = binding.Expected.Zmm },
            actualPosition = new { xMm = actual.Xmm, yMm = actual.Ymm, zMm = actual.Zmm },
            viewportWritePerformed = binding.WritePerformed,
            nativeReadbackVerified = true,
            sideEffectsVerified = false,
            persistenceVerified = false,
            visualVerified = false
        };
    }

    private static (long Id, long TypeId)[] TitleBlocks(Document doc, ElementId sheetId)
    {
        var ids = new FilteredElementCollector(doc, sheetId)
            .OfCategory(BuiltInCategory.OST_TitleBlocks)
            .WhereElementIsNotElementType()
            .Select(element => (Id: element.Id.Value, TypeId: element.GetTypeId().Value))
            .Order()
            .ToArray();
        if (ids.Length > 1000 || ids.Any(id => id.Id <= 0 || id.TypeId <= 0) || ids.Select(id => id.Id).Distinct().Count() != ids.Length)
            throw Invalid("Native sheet title-block evidence is incomplete or unbounded.");
        return ids;
    }

    private static XYZ CurrentPoint(Element placement)
    {
        if (placement is Viewport viewport) return viewport.GetBoxCenter();
        if (placement is ScheduleSheetInstance schedule) return schedule.Point;
        if (placement.GetType().Name == "PanelScheduleSheetInstance")
        {
            var origin = placement.GetType().GetProperty("Origin")?.GetValue(placement) as XYZ;
            if (origin is not null) return origin;
        }
        throw Invalid("Created placement is not a supported viewport, schedule or panel placement.");
    }

    private static (long SheetId, long ViewId) Relationship(Element placement)
    {
        if (placement is Viewport viewport) return (viewport.SheetId.Value, viewport.ViewId.Value);
        if (placement is ScheduleSheetInstance schedule) return (schedule.OwnerViewId.Value, schedule.ScheduleId.Value);
        if (placement.GetType().Name == "PanelScheduleSheetInstance")
        {
            var owner = placement.GetType().GetProperty("OwnerViewId")?.GetValue(placement) as ElementId;
            var source = placement.GetType().GetProperty("ScheduleId")?.GetValue(placement) as ElementId;
            if (owner is not null && source is not null) return (owner.Value, source.Value);
        }
        throw Invalid("Created placement relationship is unavailable.");
    }
}
