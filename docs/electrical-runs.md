# Controlled electrical runs

`mep.electrical_runs` exposes `create_cable_tray` and `create_conduit` inside the shared reviewed transaction group. They selectively adapt `CreateCableTrayHandler` and `CreateConduitHandler` from bimwright/rvt-mcp (`b44ee0b8032f0603f8e52656bc05ab43aa599263`, Apache-2.0) and require the `controlled-electrical-runs` native feature.

## Operations

- `create_cable_tray`: Requires existing positive `cableTrayTypeId`, `levelId`, full millimeter `start` and `end` (`{ xMm, yMm, zMm }`, length `>= 1` mm), and explicit `widthMm` and `heightMm` (`1..10000`).
- `create_conduit`: Requires existing positive `conduitTypeId`, `levelId`, full millimeter `start` and `end`, and explicit `diameterMm` (`1..2000`).
- No default types or nearest-level inference are performed. Read-only dimension parameters cause transaction rollback, and 3-phase readback records endpoints, cross-section dimensions, and end-connector snapshots without certifying routing or clearance.
- Same-plan `set_parameter`/`delete_element` against referenced types or levels and `load_family` mixing are rejected.

Status: offline implementation compiled for Revit 2027.3; native creation, rollback, and visual/clearance acceptance remain pending. See [capability status](capability-status.md).
