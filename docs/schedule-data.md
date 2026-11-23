# Read-only schedule data

`revit_schedule_data` reads the rendered tabular content (column headings, body rows, row kinds, and optional cell metadata) of an explicitly identified `ViewSchedule`. It selectively adapts `GetScheduleDataHandler` from bimwright/rvt-mcp (`b44ee0b8032f0603f8e52656bc05ab43aa599263`, Apache-2.0) and requires the `readonly-schedule-data` native feature.

## Contract

- Required fields: `documentIdentity`, `expectedRevision`, `scheduleId` (explicit existing positive safe integer; name lookup and schedule templates are rejected).
- Optional fields: `startRow` (`>= 0`, default `0`), `maxRows` (`1..200`, default `100`), `includeCellMeta` (`boolean`, default `false`).
- Row kinds: `blank`, `header`, `text`, `data`, and `partial`. Cells whose native text cannot be rendered are returned as `null` (never replaced with `""`), increment `cellRenderErrors`, set `complete: false`, and classify the row as `partial`.

Status: offline implementation compiled for Revit 2027.3; native acceptance against live schedules remains pending. See [capability status](capability-status.md).
