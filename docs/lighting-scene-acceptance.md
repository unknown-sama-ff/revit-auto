# Small natural-language lighting scene: acceptance boundary

`revit_room_lighting_preview` now accepts optional `circuit`, `wiring`, `newView`, `schedule`, explicit wall-hosted `switches`, titled `sheet`, and `panelSchedule` objects as well as explicit room grid inputs. For the inspected legacy WorkPlaneBased light family, the MCP layer adds `placementMode=legacyPoint` only after type inspection; this preserves the old point-only behavior without claiming a host.

A user can request: “在办公室1新增2行2列灯具，安装高度3000毫米、边距500毫米，使用当前300x1200类型；接入我指定的AL1配电箱，创建一条照明回路和照明平面图，先预览。”

The assistant must resolve the actual room and type IDs first. It must inspect the existing panel, wire type, and view family type rather than invent IDs. The generator can create four fixture operations, one circuit, three fixture-chain wires, a view and a schedule in one reference-valid transaction plan. Panel-to-first-light wiring is opt-in and requires a connector ID explicitly chosen from inspect; it is never guessed.

Every result remains a preview. The user must review the immutable plan and approve it in chat before `revit_plan_confirm`.

The axis-aligned grid checks point inclusion and center-to-boundary margin. It does not verify fixture physical extents, illuminance, ceiling hosting, code compliance, load capacity, or cable route optimality. Switches and sheet placements require explicit inspected hosts, faces, title blocks and paper coordinates; they are not inferred. These limitations must be included in the chat preview, not hidden behind a successful plan response.

SDK integration regressions use a simulated native host and exercise the actual MCP server/bridge/preview assembly. They prove interface compatibility and rejection behavior, not live Revit creation. Real creation, circuit association, wiring, diagram layout, PNG export and rollback remain gated by runtime loading and reviewed-plan approval.



## Prepare and verify the live scene

The assistant may run `D:\Desktop\revitt\revit-auto\mcp\lighting-acceptance.mjs` with `prepare --project TEST_COPY.rvt --input ASSISTANT_REVIEWED_INPUT.json --state NEW_RECORD.json` after native `lighting-evidence` is loaded. This reads current context, creates a pending preview, records the exact baseline, and never submits it.

Only after human chat approval does the assistant submit that SAME plan through the normal MCP. The `verify --state RECORD.json` action requires a committed receipt and compares inspected types, coordinates, hosts, switch labels, exact circuit members/panel, both wire endpoint references, views, schedule fields, title block and paper placements. It exports view/sheet PNGs without saving RVT. Unsupported or missing evidence is a verification failure, never guessed success.

Synthetic verifier/SDK tests are not live modeling acceptance. An expired or failed plan cannot pass verification. Legacy point-only fixtures intentionally do not gain a level or host association; the chosen level only supplies an absolute Z coordinate.
