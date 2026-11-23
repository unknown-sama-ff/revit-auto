# Controlled 2D annotations

`documentation.annotations` exposes `create_text_note` and `create_detail_line` inside the shared reviewed transaction group. They selectively adapt `CreateTextNoteHandler` and `CreateDetailLineHandler` from bimwright/rvt-mcp (`b44ee0b8032f0603f8e52656bc05ab43aa599263`, Apache-2.0) and require the `controlled-2d-annotations` native feature.

## Operations

- `create_text_note`: Requires existing positive `viewId`, `textTypeId`, nonblank `text` (`1..4000` chars, no control characters except `\n`/`\r\n`), and explicit `point` (`{ xMm, yMm, zMm }`). Optional `widthMm` (`1..50000`, also bounded by native `TextElement.GetMinimumAllowedWidth`/`GetMaximumAllowedWidth`) and `rotationDegrees` (`-360..360`).
- `create_detail_line`: Requires existing positive `viewId`, explicit `start`/`end` (`{ xMm, yMm, zMm }`, length `>= 1` mm), and optional Projection `OST_Lines` `lineStyleId`.
- Target points must lie within `1` mm of the target view plane (or `zMm` within `1` mm of `0` on sheets/drafting views). View templates, 3D views, schedules, legends, and browsers are rejected.
- Same-plan `set_parameter`/`delete_element` against referenced views, text types, or line styles and `load_family` mixing are rejected.

Status: offline implementation compiled for Revit 2027.3; native creation, rollback, and visual layout acceptance remain pending. See [capability status](capability-status.md).
