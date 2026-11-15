# Third-party notices

Original project source code and documentation are licensed under Apache-2.0 unless otherwise stated; see LICENSE and NOTICE. Third-party components retain the copyrights, licenses, and attribution recorded below. The project license does not replace or remove those third-party terms.

## Argument-name diagnostics adapted from rvt-mcp

`mcp/argument-diagnostics.mjs` adapts the `Normalize`, `Suggest`, `Clip` and bounded key-only diagnostic patterns from `src/server/Mcp/ToolArgumentGuard.cs` in [bimwright/rvt-mcp](https://github.com/bimwright/rvt-mcp).

- Reviewed upstream commit: `4affa2aaae3f6e7b798d1067ce7e324ad92f0f91`.
- Source Git blob: `f51da5dc58b2fc340242004274ae2d54796137b6`.
- Related upstream test Git blob: `c43800b74652d901ea7e9642e67c398f43f8aefa` (`tests/RvtMcp.Tests/Server/Mcp/ToolArgumentGuardTests.cs`). The source and tests were reviewed; the upstream test suite was not run here.
- License: Apache License, Version 2.0. The complete upstream license is retained in [rvt-mcp-APACHE-2.0.txt](third_party/licenses/rvt-mcp-APACHE-2.0.txt). No upstream NOTICE file was present in the reviewed tree.
- Modifications: ported selected logic from C# to JavaScript; report only unambiguous normalized-name matches; preserve case-sensitive strict rejection; retain no argument values; expose clipping/truncation counts; use surrogate-safe clipping. No upstream model execution, automatic correction or ignore-unknown-key behavior is included.

Sources reviewed for research/design are not included-code claims unless separately listed here. This notice is self-contained and does not claim upstream complete functionality has been validated.

## Local tag association extraction adapted from rvt-mcp

`v27/DocumentationCreationReadbackService.cs` adapts the local `HostElementId` extraction and `RoomTag.Room` association pattern from `src/shared/Handlers/Annotations/FindUntaggedElementsHandler.cs` in [bimwright/rvt-mcp](https://github.com/bimwright/rvt-mcp/blob/4affa2aaae3f6e7b798d1067ce7e324ad92f0f91/src/shared/Handlers/Annotations/FindUntaggedElementsHandler.cs).

- Reviewed commit: `4affa2aaae3f6e7b798d1067ce7e324ad92f0f91`; source Git blob: `48b13f993fe9bc66b8565e39c984b56b967465bc`.
- Apache License, Version 2.0; complete license retained in [rvt-mcp-APACHE-2.0.txt](third_party/licenses/rvt-mcp-APACHE-2.0.txt).
- Modifications: use typed Revit 2027 APIs, preserve all three LinkElementId components, require exactly one requested local target, reject orphaned/unknown/linked results and verify before/after transaction commit. No reflection fallback, swallowed creation errors, automatic type choice or bulk tagging loop is included. Read-only inspection reports unsupported cases explicitly. Upstream was reviewed, not executed; local rules and compilation are verified separately from real Revit acceptance.

## Tag head getter selection adapted from rvt-mcp

`v27/TagHeadPositionSnapshotService.cs` adapts the RoomTag/IndependentTag `TagHeadPosition` getter selection from [TagElementsHandler.cs](https://github.com/bimwright/rvt-mcp/blob/4affa2aaae3f6e7b798d1067ce7e324ad92f0f91/src/shared/Handlers/Annotations/TagElementsHandler.cs).

- Reviewed commit: `4affa2aaae3f6e7b798d1067ce7e324ad92f0f91`; source Git blob: `d3125814426e4d3ccbc351bf4d3de842cb41cfe4`.
- Apache License, Version 2.0; complete license retained in [rvt-mcp-APACHE-2.0.txt](third_party/licenses/rvt-mcp-APACHE-2.0.txt).
- Modifications: query existing tags through the current read-only inspect service; retain full native precision, record head and generic LocationPoint separately, report getter errors/nonfinite/missing points explicitly and preserve known false versus unknown leader state. No creation, rounding, bulk transaction or type fallback from that handler is included. Upstream was reviewed, not run; compilation and unit tests do not constitute native acceptance of the new getter.

## Diagnostic result handles adapted from RevitMCP

`mcp/diagnostic-results.mjs` adapts the UUID result-handle, retained-record and compact-output patterns in `lib/RevitMCP_ExternalServer/core/result_store.py` from [oakplank/RevitMCP](https://github.com/oakplank/RevitMCP).

- Pinned source Git blob: `29276a4a0f4492fdbaf68765b7c6801ab494ad67`.
- Pinned license Git blob: `b16640608fc2a73b61bc99f9bde4b514aa8cbf21`.
- Copyright (c) 2026 OakPlank. MIT License retained in [RevitMCP-MIT.txt](third_party/licenses/RevitMCP-MIT.txt).
- Modifications: ported the selected storage pattern to JavaScript; use full UUID handles, immutable JSON snapshots and same-process storage; require document state/revision and plugin MVID/PID equality; add five-minute monotonic expiry, FIFO/byte limits, actual MCP output budgets and explicit distinction between captured pages and native search completeness. No Python runtime, pyRevit route, name-based lookup or model-write code is included.
- The upstream source was reviewed, not installed or run. Local tests cover this adapted implementation; this is not a stability claim about the entire upstream repository.

## Grid element reference construction adapted from rvt-mcp

`v27/DimensionCreationReadbackService.cs` adapts the Grid-specific `new Reference(grid)` construction from [CreateDimensionsHandler.cs](https://github.com/bimwright/rvt-mcp/blob/e49c7961441a306490e1da1dc99ea179c3f31035/src/shared/Handlers/Annotations/CreateDimensionsHandler.cs).

- Reviewed commit: `e49c7961441a306490e1da1dc99ea179c3f31035`; source Git blob: `3d310c80f2df30def218bce6f2a5c63d33ab5efd`.
- Apache License, Version 2.0; complete license retained in [rvt-mcp-APACHE-2.0.txt](third_party/licenses/rvt-mcp-APACHE-2.0.txt). The reviewed upstream LICENSE blob is `9db8701179dfb8b92d9e67850cf26be39df754eb`.
- Modifications: require exact agreement with the caller's observed native element-level stable reference; preserve input evidence; bind the expected dimension readback to the same Grid's native, independently parsed curve reference. Other references keep exact matching. No inferred geometry, ignored failed references, automatic type choice, transaction loop or second write channel is imported. The upstream was inspected, not run on this workstation; local compilation/tests and native acceptance are recorded separately.

## Native deadline transport grace adapted from rvt-mcp

`mcp/bridge.mjs` adapts the five-second `TransportGrace` and native-deadline/transport-wait separation from [ToolGateway.cs](https://github.com/bimwright/rvt-mcp/blob/e49c7961441a306490e1da1dc99ea179c3f31035/src/server/Gateway/ToolGateway.cs).

- Reviewed commit: `e49c7961441a306490e1da1dc99ea179c3f31035`; source Git blob: `cea7bad962b9bdd9c28c803a81a53c345e312378`.
- Apache License, Version 2.0; complete license retained in [rvt-mcp-APACHE-2.0.txt](third_party/licenses/rvt-mcp-APACHE-2.0.txt).
- Modifications: ported the bounded transport wait to JavaScript TCP without extending the native `deadlineUnixMs`; retain the existing protocol and native error receipts. Added local structured transport failure metadata and the original plan's read-only recovery-query hint. No target switching, remote script execution, automatic recovery query, retry, reconnect, save or restart code is imported. Tests use a local fake TCP host; the read-only live handshake is recorded separately from simulated fault coverage.

## Two-sided fitting connection verification adapted from rvt-mcp

`v27/FittingConnectionReadbackService.cs` adapts the single-fitting physical bridge pattern from `ConnectMepElementsHandler.HasPhysicalConnection` in [bimwright/rvt-mcp](https://github.com/bimwright/rvt-mcp/blob/e49c7961441a306490e1da1dc99ea179c3f31035/src/shared/Handlers/Mep/ConnectMepElementsHandler.cs).

- Reviewed commit: `e49c7961441a306490e1da1dc99ea179c3f31035`; source Git blob: `3a39d63885542e1e4b8f0a19187a269279f9eb1c`. The companion native factory handler was checked at blob `0e867261ad98a0b7b402a8928c722e17ab576b2d`.
- License: Apache License, Version 2.0; full license retained in [rvt-mcp-APACHE-2.0.txt](third_party/licenses/rvt-mcp-APACHE-2.0.txt).
- Modifications: restrict the path to the exact newly created fitting; preserve both original endpoint owner UniqueIds/connector IDs; require two distinct physical ports and reciprocal native `IsConnectedTo` evidence. Reacquire endpoints and repeat after later operations and after transaction commit inside the rollback-capable group. Missing or unreadable native evidence fails verification. No arbitrary-path search, automatic connector choice, disconnect-as-false fallback or upstream transaction code is imported. Unit tests and compilation do not constitute native fitting acceptance.

## Controlled lighting translation adapted from rvt-mcp

v27/LightingMoveService.cs selectively adapts the bounded-selection, refusal of pinned/grouped/type elements, native MoveElements and reversible post-commit placement-check pattern from src/shared/Handlers/Elements/TransformElementsHandlers.cs in bimwright/rvt-mcp.

- Reviewed commit: b44ee0b8032f0603f8e52656bc05ab43aa599263; Git blob: 108dff151d0fd3be829a11520c624c7f9a0c82d1.
- License: Apache License, Version 2.0; retained at third_party/licenses/rvt-mcp-APACHE-2.0.txt. No upstream NOTICE was present in the reviewed tree.
- Modifications: only existing unhosted point lighting fixtures; explicit current positions/type and bounded XY translation; preserve captured electrical connector/circuit/panel/member evidence; integrate the existing local preview, authorization and transaction-group owner. No upstream command runner, rotation feature or nested transaction wrapper is included. Local native acceptance is scenario-specific; upstream tests were not executed here.

## Multiport fitting factories and selected-port system resolution adapted from rvt-mcp

`v27/ModelExecutor.cs` selectively adapts the ordered `NewTeeFitting` / `NewCrossFitting` native factory calls from `src/shared/Handlers/Mep/CreateMepFittingHandler.cs` in bimwright/rvt-mcp at commit `b44ee0b8032f0603f8e52656bc05ab43aa599263`, Git blob `0e867261ad98a0b7b402a8928c722e17ab576b2d`.

`v27/UnassignedEquipmentConnectionService.cs` and `v27/UnassignedEquipmentConnectionRules.cs` adapt selected connector `MEPSystem` resolution and pipe-system-parameter fallback from `src/shared/Handlers/Mep/MepConnectionSystemType.cs` at the same commit, Git blob `417577a44ddf298df3c17a2a53b01a61d3a52f92`; the associated `ConnectMepElementsHandler.cs` is blob `3a39d63885542e1e4b8f0a19187a269279f9eb1c`.

- Apache License, Version 2.0; full license retained at `third_party/licenses/rvt-mcp-APACHE-2.0.txt`. No upstream NOTICE was present in the reviewed tree.
- Modifications: preserve the caller's exact connector order and transaction owner, reserve all three/four endpoints, verify a reciprocal bijection onto the exact created fitting's physical ports before and after transaction commit. The explicit `allowUnassignedEquipmentPort` option applies only to existing inspected MechanicalEquipment/Pipe endpoints; failed or unknown native reads are refused. Preserve the original preconnection proof and verify actual assigned type/class and reciprocal connection afterward. No nearest-port guessing, automatic end reordering, arbitrary path traversal, nested transactions, automatic saves or restarts are imported.
- These new branches are tested and SDK-compiled but not yet accepted in a real Revit model. Native API success in upstream source is not a local geometry, routing, hydraulic, persistence or visual acceptance claim.
