using System.Text.Json;
using System.Text.Json.Serialization;
using Autodesk.Revit.DB;

namespace RevitAutoV27;

// Read-only rendered schedule table extraction adapted selectively from bimwright/rvt-mcp
// commit b44ee0b8032f0603f8e52656bc05ab43aa599263 (GetScheduleDataHandler; Apache-2.0).
// Preserves explicit scheduleId selection and distinguishes render failures (null) from empty strings.
internal static class ScheduleDataService
{
    private sealed record MergeAnchor(int Row, int Col);
    private sealed record CellMeta(
        [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? CellType,
        bool IsMerged,
        MergeAnchor? MergeAnchor);

    public static object Read(Document doc, JsonElement request, CancellationToken cancellation)
    {
        var input = ScheduleDataRules.Parse(request);
        if (doc.GetElement(new ElementId(input.ScheduleId)) is not ViewSchedule schedule || !schedule.IsValidObject)
            throw ScheduleDataRules.Invalid($"Element {input.ScheduleId} is not a ViewSchedule in the active document.");
        if (schedule.IsTemplate)
            throw ScheduleDataRules.Invalid($"Schedule {input.ScheduleId} is a view template and has no rendered table data.");

        TableData tableData;
        try { tableData = schedule.GetTableData(); }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex) { throw ScheduleDataRules.Invalid($"Failed to read schedule table data: {ex.Message}"); }
        if (tableData is null)
            throw ScheduleDataRules.Invalid("Schedule returned no table data.");

        TableSectionData? headerSection = null;
        TableSectionData? bodySection = null;
        try { headerSection = tableData.GetSectionData(SectionType.Header); } catch { }
        try { bodySection = tableData.GetSectionData(SectionType.Body); } catch { }
        if (bodySection is null)
            throw ScheduleDataRules.Invalid("Schedule body section is unavailable.");

        var nCols = bodySection.NumberOfColumns;
        var nRows = bodySection.NumberOfRows;
        var headerRows = 0;
        if (headerSection is not null)
        {
            try { headerRows = headerSection.NumberOfRows; } catch { headerRows = 0; }
        }

        var warnings = new List<string>();
        var columns = new string[nCols];
        var definition = schedule.Definition;
        IList<ScheduleFieldId>? fieldOrder = null;
        try { fieldOrder = definition?.GetFieldOrder(); } catch { fieldOrder = null; }

        for (var c = 0; c < nCols; c++)
        {
            cancellation.ThrowIfCancellationRequested();
            var colText = string.Empty;
            try
            {
                if (definition is not null && fieldOrder is not null && c < fieldOrder.Count)
                {
                    var field = definition.GetField(fieldOrder[c]);
                    colText = field.ColumnHeading;
                    if (string.IsNullOrEmpty(colText)) colText = field.GetName();
                }
                if (string.IsNullOrEmpty(colText) && headerSection is not null && headerRows > 0)
                {
                    colText = headerSection.GetCellText(headerRows - 1, c) ?? string.Empty;
                }
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex)
            {
                colText = string.Empty;
                warnings.Add($"Failed to resolve heading for column {c}: {ex.Message}");
            }
            columns[c] = colText ?? string.Empty;
        }

        var window = ScheduleDataRules.ComputeWindow(nRows, input.StartRow, input.MaxRows);
        var rows = new List<string?[]>(window.ReturnedRows);
        var rowKinds = new List<string>(window.ReturnedRows);
        var cellMeta = input.IncludeCellMeta ? new List<CellMeta[]>(window.ReturnedRows) : null;
        var cellRenderErrors = 0;
        var cellTypeWarningAdded = false;

        for (var r = window.AbsStart; r < window.AbsEndExclusive; r++)
        {
            cancellation.ThrowIfCancellationRequested();
            var rowCells = new string?[nCols];
            var allTextCells = true;
            var metaRow = input.IncludeCellMeta ? new CellMeta[nCols] : null;

            for (var c = 0; c < nCols; c++)
            {
                string? cellText;
                try
                {
                    cellText = schedule.GetCellText(SectionType.Body, r, c) ?? string.Empty;
                }
                catch (OperationCanceledException) { throw; }
                catch (Exception)
                {
                    cellText = null;
                    cellRenderErrors++;
                }
                rowCells[c] = cellText;

                string? cellTypeName = null;
                try
                {
                    var ct = bodySection.GetCellType(r, c);
                    cellTypeName = ct.ToString();
                    if (ct != CellType.Text) allTextCells = false;
                }
                catch (OperationCanceledException) { throw; }
                catch (Exception ex)
                {
                    allTextCells = false;
                    if (!cellTypeWarningAdded)
                    {
                        cellTypeWarningAdded = true;
                        warnings.Add($"Some schedule cell types could not be read: {ex.Message}");
                    }
                }

                if (metaRow is not null)
                {
                    var isMerged = false;
                    MergeAnchor? anchor = null;
                    try
                    {
                        var merged = bodySection.GetMergedCell(r, c);
                        if (merged is not null && (merged.Bottom > merged.Top || merged.Right > merged.Left))
                        {
                            isMerged = true;
                            if (r == merged.Top && c == merged.Left)
                                anchor = new(merged.Top, merged.Left);
                        }
                    }
                    catch (OperationCanceledException) { throw; }
                    catch { }
                    metaRow[c] = new(cellTypeName, isMerged, anchor);
                }
            }

            rows.Add(rowCells);
            rowKinds.Add(ScheduleDataRules.ClassifyRow(rowCells, allTextCells, columns));
            if (cellMeta is not null && metaRow is not null)
                cellMeta.Add(metaRow);
        }

        if (cellRenderErrors > 0)
            warnings.Add($"{cellRenderErrors} schedule cell(s) failed to render and were returned as null.");

        return NativeReadSnapshot.Freeze(new
        {
            documentIdentity = RevitCommandRouter.Identity(doc),
            documentRevision = RevitCommandRouter.Revision(doc),
            readOnly = true,
            scheduleId = schedule.Id.Value,
            uniqueId = schedule.UniqueId,
            scheduleName = schedule.Name,
            isTitleblockRevisionSchedule = schedule.IsTitleblockRevisionSchedule,
            columns,
            totalRows = nRows,
            startRow = input.StartRow,
            returnedRows = window.ReturnedRows,
            hasMore = window.HasMore,
            complete = cellRenderErrors == 0 && warnings.Count == 0,
            cellRenderErrors,
            rows = rows.ToArray(),
            rowKinds = rowKinds.ToArray(),
            cellMeta = cellMeta?.ToArray(),
            warnings
        });
    }
}
