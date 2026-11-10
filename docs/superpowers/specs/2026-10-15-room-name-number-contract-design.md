# Room Name and Number Contract

## Goal

Require every `create_room` operation to provide an explicit room name and number. The legacy `rooms.csx` workflow already supplies both, and the registered `architecture.rooms` contract describes both fields. This change aligns the shared operation validator and native executor with that contract without changing room geometry or boundary behavior.

## Design

The MCP operation validator and native `PlanRules.Validate` will both require `name` and `number` as JSON strings containing non-whitespace text. The shared contract follows .NET `Char.IsWhiteSpace`/`string.IsNullOrWhiteSpace` semantics, including U+0085 as whitespace and excluding U+FEFF. Values with leading or trailing whitespace will be rejected rather than silently normalized. The executor will assign both accepted values to the created Revit room without optional-field branches.

Room placement continues to use the existing explicit level and XY point. Revit continues to derive the room boundary from the surrounding model. This contract does not add caller-supplied boundary polygons, automatic room numbering, inferred names, duplicate-number prequeries, tags, schedules, or other operations.

## Validation

- MCP tests cover missing, null, empty, whitespace-only, non-string, and padded `name`/`number` values, plus valid explicit values and valid earlier-level references.
- CoreTests apply equivalent malformed and valid cases to the native plan validator.
- Existing room workflow and architecture tests must remain green.
- Cross-runtime edge cases cover U+0085 and U+FEFF so MCP and native validation cannot disagree.
- No Revit model mutation, plugin registration, save, or restart is part of this code change. Revit acceptance remains a separate later gate.

## Scope

Expected implementation files are `mcp/workflows.mjs`, `mcp/tests/validation.test.mjs`, `v27/ProtocolTypes.cs`, `v27/ModelExecutor.cs`, and `tests/CoreTests/Program.cs`. The capability queue's real-Revit acceptance state remains unchanged.
