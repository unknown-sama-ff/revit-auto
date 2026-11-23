# Agent modeling guide

## Connect and discover

Install/build using the package root README, open the intended document in Revit manually, and connect the local `revit-custom` stdio server. A server can list tools without Revit; that does not demonstrate a working native connection.

Read `revit-custom://safety` and `revit-custom://operation-guide`. Then use:

| MCP tool | Purpose |
| --- | --- |
| `revit_context_get` | Active document identity/revision, view, levels, types and selection |
| `revit_operations_list` | Exact accepted operations, fields and unit convention |
| `revit_workflow_list` | Workflow inputs, read prerequisites, status and restrictions |
| `revit_type_resolve` | Resolve a named native family/type/category without guessing |
| `revit_inspect`, `revit_search` | Inspect actual native elements using the live schema |
| `revit_plan_create` | Validate explicit operations and create a non-mutating preview |
| `revit_plan_get` | Recover the same plan's status and receipt |
| `revit_plan_confirm` | Execute the same authorized plan once |

Tool schemas are authoritative. Do not invent parameters from this table. The logical native API names use dots, while the MCP server advertises underscores.

## Pre-modeling CAD review gate

Current priority focuses on Agent-driven MCP automated modeling rather than built-in AI API integration. Before driving Revit MCP modeling from CAD reference drawings:

1. **Confirm required skills first**: Check what CAD inspection/parsing skills or local tools are needed. If any skill needs to be installed or enabled, confirm with the user before installing.
2. **Inspect the CAD drawing before modeling**: Read the CAD drawing first (layers, text notes, dimensions, grids, levels, blocks, geometry, and parser warnings/unknown entities). Do not jump straight into generating Revit operations.
3. **Evaluate drawing completeness**: Explicitly assess whether the drawing contains sufficient engineering information to model, listing what is verified and what is missing or ambiguous.
4. **Pause for two-branch user confirmation**:
   - **Complete**: Present the completeness judgment and ask the user to confirm **Yes, start modeling** before creating Revit modeling plans.
   - **Incomplete**: Clearly report that the drawing is incomplete along with concrete missing items, and ask the user to choose whether to **proceed with modeling anyway** (with explicit assumptions or reduced scope) or **supplement the drawings** first.
   - Scoped `AgentReview` installation grants apply only after the user confirms starting modeling; they never bypass the skills-install confirmation or the CAD completeness gate.

## Plan from measured context

Confirm the active project is the user's intended target. Record its identity and revision. Read the relevant elements, existing type catalog, geometry and constraints before constructing operations. `@id` references can refer only to earlier operations in the same plan where supported; they are not predicted native element or connector IDs.

All ordinary XYZ model coordinates use millimeters at Revit's internal origin and absolute Z. Do not substitute display units, project-base-point coordinates, survey coordinates or level-relative height silently. Sheet/view operations may declare a different coordinate space; follow that operation's live guide.

For a small demonstration on a user-approved disposable project, an operation may create a level with `operationType: "create_level"`, an explicit unused name and `elevationMm`. Obtain the full `revit_plan_create` envelope from its current schema and pin the context identity/revision. The same sequence applies to more complex operations; a successful level example does not verify electrical, host, connector or stair behavior.

Use a registered workflow when its exact inputs fit. For ambiguous pump workflows, `planningMode: "ask"` creates questions without a plan. Assisted mode requires explicit assumptions and permission to infer. Candidate image/DWG geometry remains candidate data: review calibration, origin/rotation/scale, layer mapping and geometry before creating any native plan. The bridge supplies no vision model or engineering judgment. The DWG adapter reads an already open matching AutoCAD drawing; it does not start AutoCAD or open/save drawings automatically.

For `create_fitting`, `fittingType: "tee"` requires the ordered `first`, `second` and `third` endpoint fields; `"cross"` also requires `fourth`. Each prefix has an explicit `ElementId` and exactly one `ConnectorId` or `Connector` criteria selector. Native factory calls retain that declared order. Inspect and choose it deliberately; the bridge does not infer a branch order. Endpoint owners must be distinct, and unused extra endpoint fields are rejected.

`allowUnassignedEquipmentPort: true` is an explicit `connect_elements` exception for an existing, inspected MechanicalEquipment port and an existing Pipe. The equipment port must be successfully read as unassigned, and the pipe must provide a known compatible system type/classification. An unknown or failed read is not an unassigned port. Deferred `@id` creations cannot use the exception, and tee/cross fitting operations cannot inherit it. The corrected readback preserves both original port identities and requires reciprocal physical connection plus the pipe's concrete type/class; equipment can remain explicitly known-unassigned. System membership is reported separately and needs matching positive native system-instance IDs from both selected ports. Keep the flag absent/false for ordinary strict connections. This correction is offline only; check the loaded version rather than assuming it is active.

## Review and authorize the preview

Review the summary and each operation's targets, types, hosts, route/geometry, dependencies, expected side effects and warnings. Check plan ID, identity/revision, expiry and fresh context. If scope or input changes, create a new preview and apply the user's authorization policy to the new plan.

For wall-face placement, inspect `familyHostGeometryPreflight` when the loaded add-in supplies it. An available entry distinguishes the requested point from the projected wall-face point and reports side, tolerance and projection distance. Deferred/unavailable entries do not predict future host geometry; a truncated list is incomplete. This is preview evidence only: it does not prove the final instance position, native level association or visible symbol bounds. Preserve the complete preview hash, then inspect the created instance after execution. Older loaded builds can omit this additive field.

The default policy is exact-plan chat approval. After explicit approval, confirm that unchanged plan once; the native add-in does not add a second confirmation dialog. During installation, the interactive default `-ModelApprovalMode Ask` can offer scoped agent self-review. A deliberate selection plus exact document scope is the one-time grant, recorded as installation authorization. Declining preserves exact-plan chat approval on a fresh installation. For noninteractive agent self-review, explicitly use `-ModelApprovalMode AgentReview` with the user's exact `-AuthorizedDocumentPath` scope and actual `-AuthorizationStatement`. That statement is the grant and does not trigger a second approval prompt. The setup handles local grant creation; do not hand-write JSON or invent consent.

Once deliberately configured and verified, that current private grant permits agent review of previews and one commit within its document/action scope without redundant per-plan chat approval. Existing grants must never be silently overwritten. Selecting ExactPlanChat does not silently disable an enabled grant; use the explicit revocation workflow reported by the installer. The agent still checks scope, identity/revision, expiry, operations and warnings before every commit. No grant is distributed here, and no authorization transfers from the developer or another model.

Do not automatically alter client policy, write an authorization file, save, close, restart, or widen scope to resolve an error. Local runtime configuration is private. The optional lifecycle tools have a separate fixed-preview, backup and supervision contract; ordinary modeling permission does not satisfy it.

## Execute once and verify

Call the matching confirm/commit tool once for the reviewed authorized plan. Preserve its receipt. If the request times out or its outcome is unknown, query `revit_plan_get` with **the same plan ID**. Do not resend confirmation or regenerate an equivalent plan automatically. A committed idempotency receipt also persists after Revit Undo; redoing work requires a new reviewed plan.

Inspect the resulting native elements and relationships. Verify the user's geometric and engineering goal using bounded read tools and, where useful, an explicitly selected view/image export. A returned success status or primary ID list alone cannot certify placement, type, connector/system membership, dimensions, view visibility, native side effects or saved-file persistence.

Read `nativeChanges` when provided, including extra IDs, unknown modifications, deletions and truncation. Missing evidence means unknown. For stairs and other edit scopes, inspect `rollbackStatus` and `cleanupEvidence` where present. `scope-commit-returned-unverified`, cancellation, or an exception does not establish model restoration. Stop dependent writes while uncertain; do not hide unknowns as successful cleanup.

Report what was created/changed, what native checks passed, remaining warnings/unknowns and whether anything was saved. Ordinary plans never automatically save the model. A native in-session check and a later persistence check are different results.

## Capability status

The workflow registry is a discovery and limitation contract, not a per-release acceptance database. Recheck the loaded host features and exact operation notes. Selected prior native checks cover architecture/annotation readback, room geometry, electrical, pipe/connector and failure rollback paths, with scope-specific limits. Portable tests cover data validation, planners, mock transport/protocol and native-independent safety rules; they do not run Revit.

Selected tee/cross fixtures passed native reciprocal topology and focused-image checks; disk persistence and unrestricted effects remain unaccepted. The opt-in unassigned-equipment connection correction is **offline only**, even when compiled. RTE metadata remains **unaccepted**: attempted files were refused before opening because of stored references. RFA reads and family load modes are separate branches with asset-specific results. Unknown connectors, unavailable native geometry, absent features and truncated responses remain explicit limitations. See the [capability status](capability-status.md).

The package includes no project-specific model, catalog, credentials, standing grant or private acceptance evidence. Set up and verify your own environment and disposable test assets before production use. Preserve [LICENSE](../LICENSE), [NOTICE](../NOTICE) and [third-party notices](../THIRD_PARTY_NOTICES.md) when adapting source.
