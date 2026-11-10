> 发布副本说明：本机路径、模型名称及运行标识已匿名化。原始私有证据未随源码发布；历史验收不代表当前会话授权或完整业务认证。

# Read-Only Document Version Diff Implementation Plan

> **For agentic workers:** Follow this plan inline with test-first changes.

**Goal:** Expose a bounded, read-only native Revit version-difference query pinned to the active document identity and revision.

**Architecture:** The caller supplies a base version GUID. Revit validates that GUID against the active document and returns created/modified IDs plus deletion availability. The MCP adapter enforces strict response contracts and stable before/after document state. No arbitrary file paths, plans, transactions, entity reads, saves, or writes are introduced.

**Tech Stack:** Revit 2027.3 API, C# core rules/service, MCP Node.js/Zod, native and MCP tests.

**Spec:** Approved 2026-10-20 read-only Document.GetChangedElements investigation.

## Task 1: Native bounded diff

Files: new `v27/DocumentVersionDiffRules.cs`, `v27/DocumentVersionDiffService.cs`; modify router, project, CoreTests project/runner; add `tests/CoreTests/DocumentVersionDiffRulesTests.cs`.

- [x] Test strict GUID parsing, identity/revision requirements, sorted unique ID sets, empty valid sets, response limits, and deletion-unavailable semantics.
- [x] Verify tests fail before implementation.
- [x] Implement the native API call with cancellation, active-document/session/revision/path/save-state pinning, response freeze, and no element dereference.
- [x] Run focused and full CoreTests (302 passed).

## Task 2: MCP contract and gate

Files: new `mcp/document-version-diff.mjs`, `mcp/tests/document-version-diff.test.mjs`; modify `mcp/revit-custom.mjs`, `mcp/bridge.mjs`, `mcp/tests/bridge.test.mjs`.

- [x] Test the read-only MCP tool, required pins/GUID, malformed or truncated responses, drift, deletion availability, and missing feature gate.
- [x] Verify tests fail before implementation.
- [x] Implement strict contract and document-state recheck.
- [x] Run focused bridge and MCP tests; all passed.

## Task 3: Queue and documentation

Files: `docs/capability-task-queue.json`, `docs/goal-progress.md`, `mcp/README.md`, this plan.

- [x] Register the foundation read-only version-diff capability with code/test status only.
- [x] Document that non-workshared deleted IDs are unavailable and ID differences do not explain property-level causality.
- [x] Run full MCP tests, CoreTests, isolated Revit 2027.3 compile, and diff hygiene.
- [x] After manual restart, the loaded MVID `51ec430d-e749-4205-ac99-d4217aead546` exposed `document-version-diff`; the current document was pinned afresh at identity `6a31e4b3b31b93ca54eca8916b0d91bc`, revision 0.
- [x] Build an isolated DLL without replacing the loaded add-in: `v27/bin/Release/document-version-diff-20261020/RevitAutoV27.dll`, MVID `51ec430d-e749-4205-ac99-d4217aead546`, SHA-256 `A0A27AFBAF6E22448FF57F4EEF0F9A97EACE99CD424900BA57B92525349C548A`.
- [x] Verify the approved base provenance and run one native query. Revit `BasicFileInfo.GetDocumentVersion()` on `.0024.rvt` returned GUID `8b2c9938-1fa0-41d2-a8ff-423898411749`, save count 51, and file SHA-256 `0F5180F55F02AA5EDEAF09ECB3720A9BF2F909AAEAD1B79ECEEC60F000B838CE`. Current document returned version GUID `756d4e46-dcc0-45cc-ac42-93a1e92971cc`, save count 52; diff was complete and read-only.
- [x] Archive native evidence in run `cb2e5c1f-8255-41a9-a8ab-76002a264a01`. The result contains created IDs `2296041..2296048` and modified IDs `86962,293247`; it does not establish property-level causality, so `architecture.primary-elements` remains blocked.
