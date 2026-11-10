# Architecture Primary Readback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add strict native readback rules for the existing wall, floor, and hosted door/window placement operations without changing their supported input scope.

**Architecture:** Keep operation validation and Revit execution in the existing `ModelExecutor` boundary. Add a small pure rule module that compares captured native snapshots to the reviewed operation, then return evidence only after the comparison passes; any mismatch raises the existing bridge error so the surrounding transaction can roll back. MCP workflow contracts remain unchanged except for regression coverage of the readback evidence shape.

**Tech Stack:** C#/.NET 10, Revit 2027.3 API, Node.js built-in test runner.

**Spec:** Existing architecture scope in `docs/legacy-feature-matrix.md`, `docs/development-flow.md`, and queue task `architecture.primary-elements`.

## Global Constraints

- Preserve broad Revit basic-modeling scope; do not add inferred hosts, types, levels, geometry, or parameters.
- A write acceptance remains one explicit capability and one native transaction scope.
- Readback must fail closed on missing, non-finite, unsupported, or mismatched native evidence.
- No model mutation, plugin registration, save, restart, or reuse of historical identity/revision/plan IDs in this implementation task.
- Preserve unrelated dirty worktree changes.

---

### Task 1: Add failing pure readback tests

**Files:**
- Create: `tests/CoreTests/ArchitecturePrimaryReadbackRulesTests.cs`
- Modify: `tests/CoreTests/Program.cs`

- [x] Add tests for wall type/level/height/offset/line comparison, floor type/level/boundary edge comparison, and hosted door/window type/host/level/point/rotation comparison.
- [x] Add mismatch cases for missing evidence, non-finite geometry, reversed or changed edges, wrong host/type/level, and rotation drift.
- [x] Run `dotnet run --project tests/CoreTests/CoreTests.csproj --no-restore`; reproduce the failing reversed-wall and repeated-closing-point regression assertions before fixing them.

### Task 2: Implement minimal readback rules

**Files:**
- Create: `v27/ArchitecturePrimaryReadbackRules.cs`

- [x] Define immutable snapshot records for wall, floor, and hosted family placement evidence.
- [x] Implement finite-value checks, tolerance-bounded line/point comparison, cyclic boundary edge comparison, and wrapped rotation comparison.
- [x] Throw `BridgeException("invalid_operation", ...)` for every uncertified comparison.
- [x] Re-run CoreTests and confirm the new tests pass without changing existing behavior.

### Task 3: Integrate wall/floor execution evidence

**Files:**
- Modify: `v27/ModelExecutor.cs`
- Modify: `v27/OperationReceipt.cs` only if an evidence helper is required.

- [x] After creating a wall, read its native type, level, location curve, height, base offset, flip, and structural flag and compare them to the reviewed operation.
- [x] After creating a floor, read its native type, level, and ordered boundary edges and compare them to the reviewed boundary within the explicit geometry tolerance.
- [x] Return bounded evidence with `nativeReadbackVerified=true`, `sideEffectsVerified=false`, and `engineeringComplianceVerified=false`; do not claim visual or save persistence.
- [x] Keep transaction failure behavior unchanged so a readback mismatch aborts the current plan.
- [x] Verify all existing wall-hosted door/window placements, including existing types, with resolved IDs and native initial rotation plus the explicit relative rotation.
- [x] Verify before and after Transaction.Commit while the surrounding group can still roll back; expose final verification separately from immediate operation evidence.
- [x] Add read-only inspect snapshots and a pure offline, run-bound full-scope rollback verifier; test missing, stale, unknown and truncated evidence.

### Task 4: Regression and isolated compile

**Files:**
- Verify: `mcp/tests/*.test.mjs`, `tests/CoreTests/*.cs`, `v27/RevitAutoV27.csproj`
- Modify: `docs/capability-task-queue.json` only after verification, updating `architecture.primary-elements` to the highest code gate reached.

- [x] Run focused architecture MCP tests.
- [x] Run all CoreTests.
- [x] Run the full MCP suite.
- [x] Compile the plugin to a fresh versioned output directory without installing it.
- [x] Run `git diff --check` and record that native Revit acceptance remains pending.

## Verification record — 2026-10-15

- CoreTests: 280 passed; focused offline verifier/comparison: 29 passed.
- Full MCP: 909 tests, 908 passed, 0 failed, 1 skipped. Final log: `bin/Release/architecture-primary-readback-20261015T152625Z/mcp-tests-verified.log`.
- Isolated Revit 2027.3 compile: 0 warnings, 0 errors. DLL SHA-256: `5C1A2E120D0AE9F506031CE168C5D245C848596B355EC92DD64BEE09D96A9B20`.
- Independent review's real uncommitted-receipt finding was fixed and re-reviewed; incomplete event ID coverage stays false while independent scope restoration is verified.
- Highest state: `compiled`. No plugin registration, native plan creation, confirmation, model write, save or restart was performed. Native acceptance remains pending.
