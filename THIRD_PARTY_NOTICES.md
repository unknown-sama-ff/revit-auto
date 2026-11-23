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

## Structural beam and isolated foundation creation adapted from rvt-mcp

`v27/StructuralElementService.cs` selectively adapts the native curve-based `NewFamilyInstance(..., StructuralType.Beam)` factory and point-based `NewFamilyInstance(..., StructuralType.Footing)` factory, family activation and foundation rotation from `src/shared/Handlers/Structural/CreateStructuralBeamHandler.cs` and `CreateFoundationIsolatedHandler.cs` in bimwright/rvt-mcp.

- Reviewed commit: `b44ee0b8032f0603f8e52656bc05ab43aa599263`; source Git blobs: `6b90312df39697f17b01be5bdaa7543a4ac75d3e` and `b8770e085e252901dbcbadef25327017dade8b75`.
- Apache License, Version 2.0; full license retained at `third_party/licenses/rvt-mcp-APACHE-2.0.txt`. No upstream NOTICE was present in the reviewed tree.
- Modifications: require existing explicit native symbol/level IDs and complete absolute XYZ millimeters; restrict supported family categories and placement modes; preserve the existing transaction-group/preview/authorization owner. Add cross-section rotation, immutable per-element bindings, immediate/precommit/postcommit readback, explicit unknown state and matching JavaScript/C# input contracts. Do not import automatic type/level selection, default Z, standalone transactions, brace/joist aliases, automatic elevation compensation, saves or restarts.
- Tests and SDK compilation establish staged implementation only. Native write/rollback, persistence, joint behavior, analysis and visual acceptance remain separate.

## Wall foundations, rebar and ceiling creation adapted from rvt-mcp

The additional module adapters use the same reviewed `bimwright/rvt-mcp` commit `b44ee0b8032f0603f8e52656bc05ab43aa599263` (Apache License, Version 2.0). Full license is retained at `third_party/licenses/rvt-mcp-APACHE-2.0.txt`.

- `v27/WallFoundationService.cs` adapts `WallFoundation.Create` from `src/shared/Handlers/Structural/CreateFoundationWallHandler.cs`, Git blob `c42a9b9904b354f2be05478370f6d31cf5069611`. Modifications require explicit existing wall/type IDs, inspect actual host/type relationships, prevent duplicate foundations/source mutation in one plan, and repeat readback under the existing transaction-group owner. Automatic type/name selection and upstream transactions are excluded.
- `v27/RebarCreationService.cs` adapts the Revit 2027 `BarTerminationsData` / `Rebar.CreateFromCurves` path and shape-driven layout methods from `src/shared/Handlers/Structural/CreateRebarSetHandler.cs`, blob `189898101cd91ca0bb51750985f3731e750f3ddf`, and `Rebar.CreateFromRebarShape` from `CreateRebarStirrupHandler.cs`, blob `be1441b17f99c578616f36dfcb027968223c7dd2`. Modifications require explicit host/type/directions/layout, remove bounding-box and count-hint layout heuristics, and add bounded actual geometry/identity/layout readback. Shape and termination support follows the published local contract; this is not arbitrary reinforcement design.
- `v27/CeilingCreationService.cs` adapts the `CurveLoop` / `Ceiling.Create` pattern from `src/shared/Handlers/Elements/CreateSurfaceBasedElementHandler.cs`, blob `e8b66e4b089bd913bd183bbba70e2b91d1923e74`. Modifications require explicit native type/level and complete absolute XYZ boundary, calculate and disclose level offset, and compare the actual owned native Sketch before/after commit. Existing floor code is preserved; upstream has no roof implementation in this handler and none is claimed.

All modules retain the existing native transaction owner, preview/authorization and single-dispatch boundary. No upstream arbitrary-code runner, automatic defaults, standalone commit, save, restart or external-file write is imported. Local pure/simulated tests and SDK compilation are separate from native creation, failure restoration, persistence, visual and engineering acceptance.

## Material graphics, duplication and quantities

`v27/MaterialCreationService.cs` adapts native material factories and graphics setters from bimwright/rvt-mcp commit `b44ee0b8032f0603f8e52656bc05ab43aa599263`. The source files are `src/shared/Handlers/Materials/CreateMaterialHandler.cs` (blob `e18c6e18a1a711b385900859a2f1c34afcae4171`) and `DuplicateMaterialHandler.cs` (blob `7e0e406a0b1e5c59664ab5ff2fe83b28411c708f`). The local implementation requires exact native source IDs, validates graphics and names, and verifies the result and source within the existing transaction.

`v27/MaterialQuantitiesService.cs` follows the native non-paint material ID, area and volume calls in `GetMaterialQuantitiesHandler.cs` (blob `ea8f1a4665e2ce9d14d912b5274bbc197f270078`) at the same commit. The local implementation takes bounded explicit element IDs, reports unknown quantities separately from zero, and preserves native material IDs.

The upstream code is licensed under Apache-2.0. See `third_party/licenses/rvt-mcp-APACHE-2.0.txt`.

The instance assignment path adapts the targeted Revit material parameter setter from `src/shared/Handlers/Materials/AssignMaterialToElementHandler.cs` (blob `3d7e379826bbdee814d94076cb7c9e3c0a7941f9`) at the same commit. The local path uses the native material parameter spec, an exact instance/parameter selection, and before/after readback. It omits compound-layer writes and implicit type or parameter selection.

## Links, schedule data, 2D annotations, electrical runs and MEP disconnects adapted from rvt-mcp

The following offline-compiled modules selectively adapt handlers from [bimwright/rvt-mcp](https://github.com/bimwright/rvt-mcp) at commit `b44ee0b8032f0603f8e52656bc05ab43aa599263` (Apache License, Version 2.0; full license retained at `third_party/licenses/rvt-mcp-APACHE-2.0.txt`, no upstream `NOTICE` file present):

- `v27/LinksReadService.cs` and `v27/LinksReadRules.cs`: selectively adapt `src/shared/Handlers/Links/ListLinkedModelsHandler.cs` (blob `c52b5f580582b03784d6ebb66bc848f4b7f97fd4`), `ListLinkedCadHandler.cs` (blob `885eddb6e58ffca7ef3944e4659393659a4fa053`), and `GetLinkElementsHandler.cs` (blob `991bf1fbc7e9a722461e0f260f95d99498320b20`). Modifications enforce explicit `documentIdentity` and `expectedRevision` pins, bounded `offset`/`limit` pagination, full-precision transforms, `ExternalFileUtils.IsExternalFileReference` safety checks, and 8-corner rotated host-space bounding box transformation via `ElementBoundsRules.FromCorners`. No link load, reload, unload, save, or close behavior is imported.
- `v27/ScheduleDataService.cs` and `v27/ScheduleDataRules.cs`: selectively adapt `src/shared/Handlers/Schedules/GetScheduleDataHandler.cs` (blob `5b10c5db87938669dd54ae931daee0c93ae76e2d`). Modifications enforce explicit `scheduleId` selection, reject templates and name guesses, bound pagination to `1..200` rows, and return `null` (with `partial` row kind and `cellRenderErrors` counts) rather than masking cell-render exceptions as empty strings.
- `v27/AnnotationCreationService.cs` and `v27/AnnotationCreationRules.cs`: selectively adapt `src/shared/Handlers/Annotations/CreateTextNoteHandler.cs` (blob `07d7e6cda28919bc12d4ece21acedcb3f9c644f7`) and `CreateDetailLineHandler.cs` (blob `6da5aa5ba998a2cfcb2d2d6f6b07c7756425852c`). Modifications remove implicit `ActiveView` and default type/style selection, enforce `1.0` mm view-plane distance tolerance and native width bounds, integrate the shared preview/authorization/transaction-group owner with same-plan source protection, and add 3-phase readback verification.
- `v27/ElectricalRunService.cs` and `v27/ElectricalRunRules.cs`: selectively adapt `src/shared/Handlers/Mep/CreateCableTrayHandler.cs` (blob `ed5f08c261be0325960a36745d0fe0c2da222245`) and `CreateConduitHandler.cs` (blob `acb309184b9cc187d47e08bc3c32c78fa63c81c6`). Modifications require explicit type, level, endpoints, and cross-section dimensions, reject read-only dimension parameters, integrate the shared transaction-group owner with same-plan source protection, and capture 3-phase readback plus physical end connectors.
- `v27/MepDisconnectsService.cs` and `v27/MepDisconnectsRules.cs`: selectively adapt `src/shared/Handlers/Mep/FindMepDisconnectsHandler.cs` (blob `349d7bb5c157d7ac3fff9d1879aaff9fd8448e70`). Modifications require explicit document pins and explicit graphical `viewId` (no `ActiveView` fallback), add bounded pagination, and separate unreadable/failed `IsConnected` or `Domain` reads into `unknownConnectorElements`/`unknownConnectorCount` rather than treating unknown reads as disconnected.

These adaptations are offline-tested and compiled for Revit 2027.3; native Revit acceptance, failure rollback, visual checks, and persistence remain pending.
