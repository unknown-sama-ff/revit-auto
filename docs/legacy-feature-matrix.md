# Legacy Feature Matrix — Revit 2027 Migration

This matrix tracks the migration of the Revit 2025-era scripts and `ModelBuilder.cs` capabilities into the controlled Revit 2027 MCP workflow layer.

## Status meanings

- **implemented-not-fully-migrated**: a controlled workflow is callable through the current structured plan engine, but the entire legacy source family still needs parity review.
- **legacy-source-registered-migration-pending**: the legacy source is catalogued, but the workflow is intentionally blocked from model writes until its adapter and acceptance evidence exist.

## Enabled controlled workflows

| Workflow | Legacy sources | Planning | Current boundary | Status |
|---|---|---|---|---|
| `lighting.full` | `place-lighting.csx`, circuits, wires, sheets, circuit naming | explicit | Structured operations, preview, chat confirmation, single transaction | implemented-not-fully-migrated |
| `lighting.place` | placement, electrical placement, wall hosting | explicit | Type/host/connector checks before plan creation | implemented-not-fully-migrated |
| `architecture.build` | `architecture.csx` | explicit | Levels, grids, walls, doors, windows, floors | implemented-not-fully-migrated |
| `pump_room.build` | `ModelBuilder.cs`, connector inspection | explicit / ask / assisted | Equipment, pipes, ducts, fittings and connections; assumptions required for assisted mode | implemented-not-fully-migrated |
| `audit` | audit scripts | explicit | Read-only audit; unknown states are retained | implemented-not-fully-migrated |

## Registered but blocked pending adapters

The following legacy sources are discoverable through `revit_workflow_list` but cannot create a model plan yet:

- Electrical specialization: circuits, wires, sheets.

The first electrical parity slice now enables `electrical.circuit`, `electrical.wire`, and `electrical.sheet` through the same structured operation validator. These are enabled for preview generation, not yet marked fully migrated until a dedicated Revit acceptance copy confirms native circuits, wire peers, schedules, sheets and rollback.
- Architecture specialization: openings, stairs, documentation.
- Pump-room specialization: route, connect, audit, collision, clearance.
- Families: loading and family/type audits.
- Imports: parameter tables, DWG candidates, image candidates.
- Verification and diagnostics: saved-file verification and legacy probes.

A pending workflow returns `workflow_migration_pending`; it does not expose a script path, execute `.csx`, or run arbitrary C#.

## Shared adapter contract

Every enabled adapter must:

1. Read current document identity and revision.
2. Resolve types, levels, hosts, units and connectors from the active document.
3. Return a structured plan or an explicit clarification response.
4. Mark assumptions and candidate-only results.
5. Use the same `revit.plan.create` → chat approval → `revit.plan.confirm` path.
6. Keep deletion/replacement dependencies visible.
7. Verify native elements, connections, categories and side effects after commit.
8. Never auto-save the RVT.

The registry is source metadata and a safety boundary, not permission to execute legacy scripts directly.


## First architecture parity slice

- \`architecture.rooms\`: enabled as a controlled preview adapter for \`create_room\`, with explicit level/point/number/name inputs; room tags and documentation remain separate operations.
- \`architecture.openings\`, \`architecture.stairs\`, and \`architecture.documentation\`: remain registered and blocked until their Revit 2027-specific adapters and native acceptance copies are complete.


## Second architecture parity slice

- \`architecture.openings\`: enabled for explicit hosted door/window instances, with current type/host/level validation and the shared preview/transaction path.
- Stair and documentation migrations remain blocked until dedicated Revit 2027 adapters and native acceptance evidence exist.
