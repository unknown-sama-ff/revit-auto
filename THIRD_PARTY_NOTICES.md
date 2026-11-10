# Third-party notices

Original new material is subject to the RevitAuto Noncommercial Source License 1.0; see LICENSE and LICENSING.md for historical Apache-2.0 boundaries. Third-party components retain the copyrights, licenses, and attribution recorded below. The project license does not replace or remove those third-party terms.

## Argument-name diagnostics adapted from rvt-mcp

`mcp/argument-diagnostics.mjs` adapts the `Normalize`, `Suggest`, `Clip` and bounded key-only diagnostic patterns from `src/server/Mcp/ToolArgumentGuard.cs` in [bimwright/rvt-mcp](https://github.com/bimwright/rvt-mcp).

- Reviewed upstream commit: `4affa2aaae3f6e7b798d1067ce7e324ad92f0f91`.
- Source Git blob: `f51da5dc58b2fc340242004274ae2d54796137b6`.
- Related upstream test Git blob: `c43800b74652d901ea7e9642e67c398f43f8aefa` (`tests/RvtMcp.Tests/Server/Mcp/ToolArgumentGuardTests.cs`). The source and tests were reviewed; the upstream test suite was not run here.
- License: Apache License, Version 2.0. The complete upstream license is retained in [rvt-mcp-APACHE-2.0.txt](third_party/licenses/rvt-mcp-APACHE-2.0.txt). No upstream NOTICE file was present in the reviewed tree.
- Modifications: ported selected logic from C# to JavaScript; report only unambiguous normalized-name matches; preserve case-sensitive strict rejection; retain no argument values; expose clipping/truncation counts; use surrogate-safe clipping. No upstream model execution, automatic correction or ignore-unknown-key behavior is included.

Other sources in `docs/revit-mcp-open-source-review-2026-10-28.md` are research/design references unless separately listed here. This notice does not claim their code is included or their complete functionality has been validated.

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
