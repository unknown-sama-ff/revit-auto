using System.Text.Json;
using Autodesk.Revit.DB;

namespace RevitAutoV27;

// Read-only Revit/CAD link inspection adapted selectively from bimwright/rvt-mcp
// commit b44ee0b8032f0603f8e52656bc05ab43aa599263 (ListLinkedModelsHandler,
// ListLinkedCadHandler, GetLinkElementsHandler; Apache-2.0). Never writes, saves,
// opens, reloads, or unloads linked documents; uses 8-corner rotated bounds transform.
internal static class LinksReadService
{
    public static object List(Document doc, JsonElement request, CancellationToken cancellation)
    {
        var input = LinksReadRules.ParseList(request);
        var warnings = new List<string>();

        var allRevitLinks = new List<object>();
        var totalRevitLinkInstances = 0;
        if (input.IncludeRevitLinks)
        {
            var types = new FilteredElementCollector(doc)
                .OfClass(typeof(RevitLinkType))
                .Cast<RevitLinkType>()
                .OrderBy(t => t.Id.Value)
                .ToList();
            var instancesByType = new FilteredElementCollector(doc)
                .OfClass(typeof(RevitLinkInstance))
                .Cast<RevitLinkInstance>()
                .OrderBy(i => i.Id.Value)
                .GroupBy(i => i.GetTypeId().Value)
                .ToDictionary(g => g.Key, g => g.ToList());

            foreach (var linkType in types)
            {
                cancellation.ThrowIfCancellationRequested();
                var isLoaded = RevitLinkType.IsLoaded(doc, linkType.Id);
                if (!isLoaded && !input.IncludeUnloaded) continue;

                var typeId = linkType.Id.Value;
                var attachmentType = "Unknown";
                var isNested = false;
                try
                {
                    attachmentType = linkType.AttachmentType.ToString();
                    isNested = linkType.IsNestedLink;
                }
                catch (OperationCanceledException) { throw; }
                catch (Exception ex)
                {
                    warnings.Add($"Could not read properties for link type {typeId}: {ex.Message}");
                }

                var (_, linkedFileStatus, path, absolutePath, pathType) = ReadExternalFile(doc, linkType.Id, isLoaded, warnings, $"Revit link type {typeId}");

                var instanceItems = new List<object>();
                if (input.IncludeInstances && instancesByType.TryGetValue(typeId, out var instances))
                {
                    foreach (var inst in instances)
                    {
                        cancellation.ThrowIfCancellationRequested();
                        totalRevitLinkInstances++;
                        Transform? transform = null;
                        try { transform = inst.GetTotalTransform(); }
                        catch (OperationCanceledException) { throw; }
                        catch (Exception ex)
                        {
                            warnings.Add($"Could not read transform for link instance {inst.Id.Value}: {ex.Message}");
                        }
                        instanceItems.Add(new
                        {
                            instanceId = inst.Id.Value,
                            uniqueId = inst.UniqueId,
                            name = inst.Name,
                            isLoaded,
                            transform = ConvertTransform(transform)
                        });
                    }
                }

                allRevitLinks.Add(new
                {
                    linkTypeId = typeId,
                    uniqueId = linkType.UniqueId,
                    name = linkType.Name,
                    isLoaded,
                    linkedFileStatus,
                    path,
                    absolutePath,
                    pathType,
                    isNested,
                    attachmentType,
                    instanceCount = instanceItems.Count,
                    instances = instanceItems
                });
            }
        }

        var allCadItems = new List<object>();
        var cadLinksCount = 0;
        var cadImportsCount = 0;
        if (input.IncludeCad)
        {
            var imports = new FilteredElementCollector(doc)
                .OfClass(typeof(ImportInstance))
                .Cast<ImportInstance>()
                .OrderBy(i => i.Id.Value)
                .ToList();

            foreach (var inst in imports)
            {
                cancellation.ThrowIfCancellationRequested();
                var isLinked = inst.IsLinked;
                if (isLinked && !input.IncludeCadLinks) continue;
                if (!isLinked && !input.IncludeCadImports) continue;

                if (isLinked) cadLinksCount++; else cadImportsCount++;

                var instId = inst.Id.Value;
                var typeId = inst.GetTypeId();
                var typeElement = typeId != ElementId.InvalidElementId ? doc.GetElement(typeId) : null;
                var name = typeElement?.Name ?? inst.Name;
                string linkedFileStatus = isLinked ? "Unknown" : "Imported";
                string? path = null;
                string? absolutePath = null;
                string? pathType = null;

                if (typeElement is not null)
                {
                    var ext = ReadExternalFile(doc, typeElement.Id, isLinked, warnings, $"CAD type {typeElement.Id.Value}", expectExternal: isLinked);
                    if (ext.hasRef)
                    {
                        linkedFileStatus = ext.status;
                        path = ext.path;
                        absolutePath = ext.absolutePath;
                        pathType = ext.pathType;
                    }
                    else if (isLinked)
                    {
                        linkedFileStatus = "Missing";
                    }
                }

                long? ownerViewId = null;
                string? ownerViewName = null;
                var viewSpecific = inst.ViewSpecific;
                if (viewSpecific && inst.OwnerViewId != ElementId.InvalidElementId)
                {
                    ownerViewId = inst.OwnerViewId.Value;
                    ownerViewName = (doc.GetElement(inst.OwnerViewId) as View)?.Name;
                }

                Transform? transform = null;
                try { transform = inst.GetTransform(); }
                catch (OperationCanceledException) { throw; }
                catch (Exception ex)
                {
                    warnings.Add($"Could not read transform for CAD instance {instId}: {ex.Message}");
                }

                allCadItems.Add(new
                {
                    instanceId = instId,
                    uniqueId = inst.UniqueId,
                    typeId = typeId != ElementId.InvalidElementId ? typeId.Value : (long?)null,
                    name,
                    isLinked,
                    kind = isLinked ? "cad_link" : "cad_import",
                    linkedFileStatus,
                    path,
                    absolutePath,
                    pathType,
                    ownerViewId,
                    ownerViewName,
                    viewSpecific,
                    transform = ConvertTransform(transform)
                });
            }
        }

        var (pagedRevit, revitLinksHasMore) = LinksReadRules.Paginate(allRevitLinks, input.Offset, input.Limit);
        var (pagedCad, cadHasMore) = LinksReadRules.Paginate(allCadItems, input.Offset, input.Limit);

        return NativeReadSnapshot.Freeze(new
        {
            documentIdentity = RevitCommandRouter.Identity(doc),
            documentRevision = RevitCommandRouter.Revision(doc),
            readOnly = true,
            coordinateFrame = "Revit internal/project origin, millimeters",
            offset = input.Offset,
            limit = input.Limit,
            totalRevitLinkTypes = allRevitLinks.Count,
            totalRevitLinkInstances,
            revitLinksHasMore,
            revitLinks = pagedRevit,
            totalCadItems = allCadItems.Count,
            cadLinksCount,
            cadImportsCount,
            cadHasMore,
            cadItems = pagedCad,
            warnings
        });
    }

    public static object Elements(Document doc, JsonElement request, CancellationToken cancellation)
    {
        var input = LinksReadRules.ParseElements(request);
        if (doc.GetElement(new ElementId(input.LinkInstanceId)) is not RevitLinkInstance linkInstance || !linkInstance.IsValidObject)
            throw LinksReadRules.Invalid($"Revit link instance {input.LinkInstanceId} was not found in the active document.");

        var linkDoc = linkInstance.GetLinkDocument()
            ?? throw new BridgeException("link_not_loaded", $"Link instance {input.LinkInstanceId} is unloaded or its linked document is unavailable.");

        var warnings = new List<string>();
        var collector = new FilteredElementCollector(linkDoc).WhereElementIsNotElementType();
        var filteredByNativeCategory = false;

        if (input.Category is { } category)
        {
            if (category.StartsWith("OST_", StringComparison.Ordinal))
            {
                if (!Enum.TryParse<BuiltInCategory>(category, out var bic) || !Enum.IsDefined(bic))
                    throw LinksReadRules.Invalid($"Unknown BuiltInCategory '{category}'.");
                collector = collector.OfCategory(bic);
                filteredByNativeCategory = true;
            }
            else
            {
                var matchedCategory = linkDoc.Settings.Categories.Cast<Category>()
                    .FirstOrDefault(c => string.Equals(c.Name, category, StringComparison.OrdinalIgnoreCase));
                if (matchedCategory is not null)
                {
                    collector = collector.OfCategoryId(matchedCategory.Id);
                    filteredByNativeCategory = true;
                }
            }
        }

        List<Element> collected;
        try
        {
            collected = collector.OrderBy(e => e.Id.Value).ToList();
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            throw LinksReadRules.Invalid($"Failed to collect elements from linked document: {ex.Message}");
        }

        if (input.Category is { } requestedCategory && !filteredByNativeCategory)
        {
            collected = collected
                .Where(e => e.Category is not null && string.Equals(e.Category.Name, requestedCategory, StringComparison.OrdinalIgnoreCase))
                .ToList();
            if (collected.Count == 0)
                warnings.Add($"Category '{requestedCategory}' did not match any category in linked document '{linkDoc.Title}'.");
        }

        var (paged, hasMore) = LinksReadRules.Paginate(collected, input.Offset, input.Limit);

        Transform? totalTransform = null;
        try
        {
            totalTransform = linkInstance.GetTotalTransform();
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            warnings.Add($"Could not retrieve transform for link instance {linkInstance.Id.Value}: {ex.Message}");
        }

        if (input.IncludeBounds && totalTransform is null)
            warnings.Add("Host-space bounds were omitted because the link transform could not be read.");

        var items = new List<object>(paged.Count);
        foreach (var element in paged)
        {
            cancellation.ThrowIfCancellationRequested();
            string? categoryName = null;
            try { categoryName = element.Category?.Name; } catch { }

            string? familyName = null;
            try
            {
                if (element is FamilyInstance fi && fi.Symbol is not null)
                    familyName = fi.Symbol.FamilyName;
            }
            catch { }

            string? typeName = null;
            try
            {
                var typeId = element.GetTypeId();
                if (typeId != ElementId.InvalidElementId)
                    typeName = linkDoc.GetElement(typeId)?.Name;
            }
            catch { }

            ElementBoundsGeometry? hostBoundsMm = null;
            if (input.IncludeBounds && totalTransform is not null)
            {
                try
                {
                    var bbox = element.get_BoundingBox(null);
                    if (bbox is not null)
                    {
                        var minMm = PointMm(bbox.Min);
                        var maxMm = PointMm(bbox.Max);
                        hostBoundsMm = LinksReadRules.TransformBoundsMm(minMm, maxMm, cornerMm =>
                        {
                            var localFeet = new XYZ(
                                UnitUtils.ConvertToInternalUnits(cornerMm.XMm, UnitTypeId.Millimeters),
                                UnitUtils.ConvertToInternalUnits(cornerMm.YMm, UnitTypeId.Millimeters),
                                UnitUtils.ConvertToInternalUnits(cornerMm.ZMm, UnitTypeId.Millimeters));
                            return PointMm(totalTransform.OfPoint(localFeet));
                        });
                    }
                }
                catch (OperationCanceledException) { throw; }
                catch (Exception ex)
                {
                    warnings.Add($"Could not transform bounding box for linked element {element.Id.Value}: {ex.Message}");
                }
            }

            items.Add(new
            {
                linkedElementId = element.Id.Value,
                linkedUniqueId = element.UniqueId,
                name = element.Name,
                category = categoryName,
                family = familyName,
                type = typeName,
                hostBoundsMm
            });
        }

        return NativeReadSnapshot.Freeze(new
        {
            documentIdentity = RevitCommandRouter.Identity(doc),
            documentRevision = RevitCommandRouter.Revision(doc),
            readOnly = true,
            coordinateFrame = "Revit internal/project origin, millimeters",
            linkInstance = new
            {
                elementId = linkInstance.Id.Value,
                uniqueId = linkInstance.UniqueId,
                name = linkInstance.Name,
                typeId = linkInstance.GetTypeId().Value
            },
            linkedDocument = new
            {
                title = linkDoc.Title,
                path = linkDoc.PathName,
                isReadOnlyContext = true
            },
            transformToHost = ConvertTransform(totalTransform),
            totalMatched = collected.Count,
            offset = input.Offset,
            limit = input.Limit,
            returned = items.Count,
            hasMore,
            elements = items,
            readLimitations = new[]
            {
                "Linked documents are read-only in this query and are never modified, saved, loaded, or closed.",
                "Non-empty link element results require a loaded linked Revit model in the active project."
            },
            warnings
        });
    }

    private static (bool hasRef, string status, string? path, string? absolutePath, string? pathType) ReadExternalFile(
        Document doc, ElementId elementId, bool isLoaded, List<string> warnings, string label, bool expectExternal = true)
    {
        try
        {
            if (!ExternalFileUtils.IsExternalFileReference(doc, elementId))
            {
                if (expectExternal)
                    warnings.Add($"No external file reference found for {label}.");
                return (false, isLoaded ? "Loaded" : "Unloaded", null, null, null);
            }

            var extRef = ExternalFileUtils.GetExternalFileReference(doc, elementId);
            if (extRef is null)
                return (false, isLoaded ? "Loaded" : "Unloaded", null, null, null);

            var status = extRef.GetLinkedFileStatus().ToString();
            string? path = null;
            string? absolutePath = null;
            string? pathType = null;

            var modelPath = extRef.GetPath();
            if (modelPath is not null)
            {
                path = ModelPathUtils.ConvertModelPathToUserVisiblePath(modelPath);
                if (modelPath.ServerPath)
                {
                    pathType = "server";
                }
                else
                {
                    try { pathType = extRef.PathType.ToString().ToLowerInvariant(); }
                    catch { pathType = "unknown"; }
                }
            }

            try
            {
                var abs = extRef.GetAbsolutePath();
                if (abs is not null)
                    absolutePath = ModelPathUtils.ConvertModelPathToUserVisiblePath(abs);
            }
            catch
            {
                absolutePath = null;
            }

            return (true, status, path, absolutePath, pathType);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            warnings.Add($"Could not read external file reference for {label}: {ex.Message}");
            return (false, isLoaded ? "Loaded" : "Unloaded", null, null, null);
        }
    }

    private static ElementBoundsPoint PointMm(XYZ p) =>
        new(JsonDefaults.InternalToMm(p.X), JsonDefaults.InternalToMm(p.Y), JsonDefaults.InternalToMm(p.Z));

    private static object? ConvertTransform(Transform? transform)
    {
        if (transform is null) return null;
        return new
        {
            originMm = new
            {
                xMm = JsonDefaults.InternalToMm(transform.Origin.X),
                yMm = JsonDefaults.InternalToMm(transform.Origin.Y),
                zMm = JsonDefaults.InternalToMm(transform.Origin.Z)
            },
            basisX = new { x = transform.BasisX.X, y = transform.BasisX.Y, z = transform.BasisX.Z },
            basisY = new { x = transform.BasisY.X, y = transform.BasisY.Y, z = transform.BasisY.Z },
            basisZ = new { x = transform.BasisZ.X, y = transform.BasisZ.Y, z = transform.BasisZ.Z }
        };
    }
}
