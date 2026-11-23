using System.Text.Json;
using Autodesk.Revit.DB;

namespace RevitAutoV27;

// Read-only MEP open-connector diagnostic adapted selectively from bimwright/rvt-mcp
// commit b44ee0b8032f0603f8e52656bc05ab43aa599263 (FindMepDisconnectsHandler; Apache-2.0).
// Never guesses ActiveView, separates unknown/failed connector reads from open connectors,
// and bounds paginated output under document identity/revision pins.
internal static class MepDisconnectsService
{
    public static object Read(Document doc, JsonElement request, CancellationToken cancellation)
    {
        var input = MepDisconnectsRules.Parse(request);
        View? scopeView = null;
        if (input.ViewId is long viewId)
        {
            if (doc.GetElement(new ElementId(viewId)) is not View { IsValidObject: true } view)
                throw MepDisconnectsRules.Invalid($"viewId ({viewId}) does not resolve to an existing View.");
            if (view.IsTemplate || view is ViewSchedule or ViewSheet ||
                view.ViewType is ViewType.Schedule or ViewType.PanelSchedule or ViewType.ColumnSchedule
                    or ViewType.DrawingSheet or ViewType.ProjectBrowser or ViewType.SystemBrowser
                    or ViewType.Report or ViewType.CostReport or ViewType.LoadsReport
                    or ViewType.PressureLossReport or ViewType.SystemsAnalysisReport or ViewType.Internal or ViewType.Undefined)
                throw MepDisconnectsRules.Invalid($"View type '{view.ViewType}' is not a graphical model view for MEP disconnect scanning.");
            scopeView = view;
        }

        var candidatesById = new SortedDictionary<long, Element>();
        FilteredElementCollector CurveCollector() => scopeView is null
            ? new FilteredElementCollector(doc)
            : new FilteredElementCollector(doc, scopeView.Id);

        foreach (var el in CurveCollector().OfClass(typeof(MEPCurve)).WhereElementIsNotElementType())
        {
            cancellation.ThrowIfCancellationRequested();
            if (el is not null && el.IsValidObject)
                candidatesById[el.Id.Value] = el;
        }

        foreach (var el in CurveCollector().OfClass(typeof(FamilyInstance)).WhereElementIsNotElementType())
        {
            cancellation.ThrowIfCancellationRequested();
            if (el is not FamilyInstance fi || !fi.IsValidObject) continue;
            var hasMep = false;
            try { hasMep = fi.MEPModel is not null; }
            catch (OperationCanceledException) { throw; }
            catch { hasMep = false; }
            if (hasMep) candidatesById[fi.Id.Value] = fi;
        }

        var disconnectedItems = new List<object>();
        var totalOpenConnectors = 0;
        var unknownConnectorElements = 0;
        var unknownConnectorCount = 0;

        foreach (var element in candidatesById.Values)
        {
            cancellation.ThrowIfCancellationRequested();
            var (observations, enumerationFailed) = ReadObservations(element);
            if (enumerationFailed)
            {
                unknownConnectorElements++;
                continue;
            }

            var summary = MepDisconnectsRules.EvaluateElement(observations, input.Domain);
            if (summary.UnknownConnectorCount > 0)
            {
                unknownConnectorElements++;
                unknownConnectorCount += summary.UnknownConnectorCount;
            }

            if (summary.OpenConnectors.Count == 0)
                continue;

            totalOpenConnectors += summary.OpenConnectors.Count;

            string? category = null;
            try { category = element.Category?.Name; } catch { }
            string? typeName = null;
            try
            {
                var typeId = element.GetTypeId();
                if (typeId != ElementId.InvalidElementId)
                    typeName = doc.GetElement(typeId)?.Name;
            }
            catch { }
            if (string.IsNullOrEmpty(typeName))
            {
                try { typeName = element.Name; } catch { }
            }

            disconnectedItems.Add(new
            {
                elementId = element.Id.Value,
                uniqueId = element.UniqueId,
                category,
                typeName,
                openConnectorCount = summary.OpenConnectors.Count,
                unknownConnectorCount = summary.UnknownConnectorCount,
                openConnectors = summary.OpenConnectors
            });
        }

        var (paged, hasMore) = LinksReadRules.Paginate(disconnectedItems, input.Offset, input.Limit);

        return NativeReadSnapshot.Freeze(new
        {
            documentIdentity = RevitCommandRouter.Identity(doc),
            documentRevision = RevitCommandRouter.Revision(doc),
            readOnly = true,
            coordinateFrame = "Revit internal/project origin, millimeters",
            scope = scopeView is null
                ? new { kind = "document", viewId = (long?)null, viewName = (string?)null }
                : new { kind = "view", viewId = (long?)scopeView.Id.Value, viewName = (string?)scopeView.Name },
            domainFilter = input.Domain,
            scannedElementCount = candidatesById.Count,
            elementsWithOpenConnectors = disconnectedItems.Count,
            totalOpenConnectors,
            unknownConnectorElements,
            unknownConnectorCount,
            offset = input.Offset,
            limit = input.Limit,
            returned = paged.Count,
            hasMore,
            items = paged
        });
    }

    private static (List<MepConnectorObservation> Observations, bool EnumerationFailed) ReadObservations(Element element)
    {
        var observations = new List<MepConnectorObservation>();
        ConnectorSet? connectorSet;
        try
        {
            var manager = element switch
            {
                MEPCurve curve => curve.ConnectorManager,
                FamilyInstance fi => fi.MEPModel?.ConnectorManager,
                _ => null
            };
            if (manager is null) return (observations, false);
            connectorSet = manager.Connectors;
            if (connectorSet is null) return (observations, false);
        }
        catch (OperationCanceledException) { throw; }
        catch
        {
            return (observations, true);
        }

        try
        {
            foreach (Connector connector in connectorSet)
            {
                try
                {
                    var isEnd = connector.ConnectorType == ConnectorType.End;
                    if (!isEnd)
                    {
                        observations.Add(new(null, false, null, null, null, null, false));
                        continue;
                    }

                    int? connectorId = null;
                    bool? isConnected = null;
                    string? domain = null;
                    string? shape = null;
                    MepPointMm? originMm = null;
                    var readError = false;

                    try { connectorId = connector.Id; } catch (OperationCanceledException) { throw; } catch { readError = true; }
                    try { isConnected = connector.IsConnected; } catch (OperationCanceledException) { throw; } catch { readError = true; }
                    try { domain = connector.Domain.ToString(); } catch (OperationCanceledException) { throw; } catch { readError = true; }
                    try { shape = connector.Shape.ToString(); } catch (OperationCanceledException) { throw; } catch { shape = null; }
                    try
                    {
                        var origin = connector.Origin;
                        if (origin is not null)
                            originMm = new(JsonDefaults.InternalToMm(origin.X), JsonDefaults.InternalToMm(origin.Y), JsonDefaults.InternalToMm(origin.Z));
                    }
                    catch (OperationCanceledException) { throw; }
                    catch { originMm = null; }

                    observations.Add(new(connectorId, true, isConnected, domain, shape, originMm, readError));
                }
                catch (OperationCanceledException) { throw; }
                catch
                {
                    observations.Add(new(null, null, null, null, null, null, true));
                }
            }
        }
        catch (OperationCanceledException) { throw; }
        catch
        {
            return (observations, true);
        }

        return (observations, false);
    }
}
