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
2. **Inspect the CAD drawing before modeling**: Read the CAD drawing first (layers, text notes, dimensions, grids, levels, blocks, geometry, and parser warnings/unknown entities) via `revit_cad_preflight` (`tools/inspect-cad-preflight.ps1`). The preflight pass automatically streams a complete read-only `geometry.jsonl` sidecar (`sourceEvidence.geometryJsonlPath`) alongside `preflight.json`; reuse `geometry.jsonl` directly during modeling rather than hand-writing ad-hoc `.lsp`/`.scr` scripts or spawning `accoreconsole.exe` a second time. Do not jump straight into generating Revit operations.
3. **Evaluate drawing completeness**: Explicitly assess whether the drawing contains sufficient engineering information to model, listing what is verified and what is missing or ambiguous.
4. **Pause for two-branch user confirmation**:
   - **Complete**: Present the completeness judgment and ask the user to confirm **Yes, start modeling** before creating Revit modeling plans.
   - **Incomplete**: Clearly report that the drawing is incomplete along with concrete missing items, and ask the user to choose whether to **proceed with modeling anyway** (with explicit assumptions or reduced scope) or **supplement the drawings** first.
   - Scoped `AgentReview` installation grants apply only after the user confirms starting modeling; they never bypass the skills-install confirmation or the CAD completeness gate.

## Plan from measured context

Confirm the active project is the user's intended target. Record its identity and revision. Read the relevant elements, existing type catalog, geometry and constraints before constructing operations. `@id` references can refer only to earlier operations in the same plan where supported; they are not predicted native element or connector IDs. Always match the real CAD structural/architectural families: never substitute default template steel families for reinforced-concrete columns or beams (or vice versa); when the required structural or architectural family is missing from the active template, load native `.rfa` families via `load_family` first and verify `architectureGeometryAudit.structuralFamilyMismatchTotalCount === 0` with `revit_audit_run`.

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

Inspect the resulting native elements and relationships. Verify the user's geometric and engineering goal using bounded read tools and, where useful, an explicitly selected view/image export. For multi-story buildings, model in staged phases with pilot-floor zoomed verification (levels/grids → CAD-true structural skeleton → one pilot floor verified via zoomed core/corridor/stairwell plan views + `revit_audit_run` checking zero structural family mismatches, zero floating hosted walls, zero opening collisions, zero isolated short stubs, zero close parallel double-wall boxes, zero wall-to-wall endpoint gaps, and zero undersized stairs → propagate to remaining floors). When reconstructing walls and openings from CAD double-line plans, always use **interval-subtraction face pairing** (never greedy 1-to-1 line matching that drops T-junction segments), read **both partition/masonry wall layers and structural concrete/shear-wall double-line layers** without hardcoding coarse rectangular outer polygons across terraces/step-backs, bridge collinear wall gaps **only** across verified 1D opening/column/perpendicular-wall coverage spans (never across empty recessed door alcoves), auto-detect multi-line glazing/curtain-wall clusters from opening layers, duplicate exact CAD-measured opening widths (including narrow door sidelights, line-drawn non-block doors, and wide atrium windows), and use selective wall-join hygiene (`disallowJoin: false` on normal solid walls with nearest-only, non-clobbering perpendicular-wall-priority centerline snapping so a closer outer wall is never pulled backward by an adjacent parallel wall, letting Revit miter all L/T/Z-jog corners cleanly with zero wall-to-wall endpoint gaps or overlapping `#` corner boxes, and `disallowJoin: true` with outer-face endpoint trim only on curtain walls, tight short chase caps, and close-parallel pier stubs so Revit never fails with `Cannot keep elements joined`). Every floor slab boundary MUST match that floor's actual CAD structural perimeter (structural perimeter beams and slab-outline curves, including corner setbacks and cantilevered terraces — never reuse an oversized coarse rectangle across step-backs), cut native `floor_profile` openings (`create_opening`) for double-height atrium/shaft voids, and enclose open-air outdoor terraces and void perimeters with both facade cladding return walls and code-height balustrades/low parapets along CAD railing lines. A returned success status or primary ID list alone cannot certify placement, type, connector/system membership, dimensions, view visibility, native side effects or saved-file persistence.

Read `nativeChanges` when provided, including extra IDs, unknown modifications, deletions and truncation. Missing evidence means unknown. For stairs and other edit scopes, inspect `rollbackStatus` and `cleanupEvidence` where present. `scope-commit-returned-unverified`, cancellation, or an exception does not establish model restoration. Stop dependent writes while uncertain; do not hide unknowns as successful cleanup.

Report what was created/changed, what native checks passed, remaining warnings/unknowns and whether anything was saved. Ordinary plans never automatically save the model. A native in-session check and a later persistence check are different results.

## Stall detection, bounded self-healing and circuit breakers

`revit-auto` enforces tiered stall detection and safe recovery across CAD preflight and the Revit bridge:

1. **CAD Core Console watchdog & orphan cleanup**: `tools/inspect-cad-preflight.ps1` cleans only verified stale owned `accoreconsole.exe` orphans (`/isolate cad-pf-* /readonly` with a dead supervisor parent or expired age; GUI `acad.exe` and active unrelated processes are never touched). During execution it polls CPU delta, output file growth, and interactive prompt hang signatures (`(_>`, `Press ENTER`, font/recovery prompts) to terminate stalled consoles early instead of waiting for total timeout.
2. **Bounded degraded CAD fallback & circuit breaker**: `revit_cad_preflight` performs at most one automatic summary-only fallback retry (skipping `geometry.jsonl`) on recoverable progress/size budget stalls, attaching a structured `stallRecovery` receipt. Two consecutive unrecovered stalls of the same reason on the same DWG trip the circuit breaker (`cad_preflight_circuit_open`).
3. **Revit bridge stall probe & write verification**: Read-only native queries perform at most one bounded reconnect retry after a transient mid-flight socket drop. On `bridge_timeout`, `mcp/bridge.mjs` runs a bounded read-only `revit.bridge.info` liveness probe plus read-only Windows process/modal-dialog inspection to distinguish modal dialogs (`revit_modal_dialog`), unresponsive UI (`revit_ui_unresponsive`), or exited Revit (`revit_process_not_running`). When a write commit (`revit.plan.confirm` / `revit.import.commit`) times out while the bridge responds, it runs read-only `revit.plan.get` verification and **never retries or recreates the write**.
4. **Structured `stallReceipt` contract**: Errors and degraded recoveries include `stallReceipt` (`stallDetected`, `stallReason`, `autoRecoveryAttempted`, `recoveryActions`, `recoveryOutcome`, `automaticRetryAllowed`, `nextSafeAction`). Whenever `automaticRetryAllowed` is `false` or `circuitState.open` is `true`, agents must stop retrying and report the diagnosis to the user.

## Capability status

The workflow registry is a discovery and limitation contract, not a per-release acceptance database. Recheck the loaded host features and exact operation notes. Selected prior native checks cover architecture/annotation readback, room geometry, electrical, pipe/connector and failure rollback paths, with scope-specific limits. Portable tests cover data validation, planners, mock transport/protocol and native-independent safety rules; they do not run Revit.

Selected tee/cross fixtures passed native reciprocal topology and focused-image checks; disk persistence and unrestricted effects remain unaccepted. The opt-in unassigned-equipment connection correction is **offline only**, even when compiled. RTE metadata remains **unaccepted**: attempted files were refused before opening because of stored references. RFA reads and family load modes are separate branches with asset-specific results. Unknown connectors, unavailable native geometry, absent features and truncated responses remain explicit limitations. See the [capability status](capability-status.md).

The package includes no project-specific model, catalog, credentials, standing grant or private acceptance evidence. Set up and verify your own environment and disposable test assets before production use. Preserve [LICENSE](../LICENSE), [NOTICE](../NOTICE) and [third-party notices](../THIRD_PARTY_NOTICES.md) when adapting source.
