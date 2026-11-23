# Controlled rebar creation (Revit 2027.3)

Status: implemented source and offline tests; native Revit acceptance is still pending. The loaded add-in must advertise `controlled-rebar-creation` before a write plan is requested. A successful build or feature advertisement does not establish native acceptance.

Use the ordinary preview, review and single-execution plan workflow. The executor owns the transaction and rollback. These operations do not save the project, change host properties or resize a selected shape. Native readback is repeated immediately after creation, before commit and after commit using the same document/element binding.

Selected hosts, bar types and explicit shapes cannot be changed/deleted in the same plan, and family loading cannot be mixed with this creation. Source changes need a separate reviewed plan; matching native UniqueIds alone do not certify unchanged source parameters.

## Coordinates and identities

All points require all three finite numeric fields `{xMm,yMm,zMm}` in millimeters relative to Revit's internal origin. Z is an absolute coordinate and is never projected onto a level or horizontal plane. Absolute input values may not exceed 100,000,000. Direction vectors use dimensionless `{x,y,z}`, must already have unit length within `1e-9`, and are passed to Revit without normalization. Input basis directions must be orthogonal within `1e-9`.

`hostElementId`, `barTypeId` and `shapeId` identify existing native elements in the active project. Obtain these IDs from the current document; IDs in the examples are illustrative. IDs must be positive JavaScript-safe integers. Deferred references, type names, inferred/default types, null fields, duplicate raw JSON properties and undeclared fields are refused. Optional `id`/`dependencies` metadata follows the shared plan convention and is also checked for null, duplicates and self dependency.

The host must currently be a valid native rebar host. The adapter does not make a host structural, replace its material, alter cover or establish engineering suitability.

## Straight rebar: `create_rebar_set`

Required fields are `hostElementId`, `barTypeId`, `start`, `end`, `normal` and `layout`. The complete XYZ line must be at least 1 mm long and exceed Revit's current short-curve tolerance. An explicit near-unit `normal` must be perpendicular to that complete line. Vertical and sloping lines are supported by the input contract.

```json
{
  "operationType": "create_rebar_set",
  "hostElementId": 10,
  "barTypeId": 20,
  "start": {"xMm": 0, "yMm": 0, "zMm": 3000},
  "end": {"xMm": 2000, "yMm": 0, "zMm": 4200},
  "normal": {"x": 0, "y": 1, "z": 0},
  "allowNewShape": false,
  "layout": {"rule": "Single"}
}
```

The style is `Standard`, without hooks, cranks or end treatments. `allowNewShape` is the only optional creation policy field and is valid only for this operation. It must be an explicit boolean when supplied and defaults to `false`. Revit always attempts to reuse a matching loaded shape. With `false`, creation fails if none matches. With explicit `true`, `Rebar.CreateFromCurves` may also create a new `RebarShape`; preview discloses this possible additional project element. Its actual ID/UniqueId is read back, while type creation is recorded separately in the executor's native change receipt. The main operation-created IDs alone are not a complete list of every native side effect.

## Existing default shape: `create_rebar_stirrup`

Required fields are `hostElementId`, `barTypeId`, `shapeId`, `origin`, `xDirection`, `yDirection` and `layout`. The exact loaded shape must be a compatible `StirrupTie` shape. `origin` places the lower-left corner of the default shape bounds. The shape's local X and Y directions map to the explicit project basis. This is not a request to fit or scale the shape to a host bounding box.

```json
{
  "operationType": "create_rebar_stirrup",
  "hostElementId": 10,
  "barTypeId": 20,
  "shapeId": 30,
  "origin": {"xMm": 100, "yMm": 200, "zMm": 3000},
  "xDirection": {"x": 1, "y": 0, "z": 0},
  "yDirection": {"x": 0, "y": 0, "z": 1},
  "layout": {
    "rule": "FixedNumber",
    "quantity": 5,
    "arrayLengthMm": 1000,
    "barsOnNormalSide": false,
    "includeFirstBar": true,
    "includeLastBar": true
  }
}
```

The current supported slice is closed planar segmented shapes with 3–32 straight driving segments, including general polygons. The source browser curves may include one bounded tangent circular fillet between adjacent driving lines. The source default polygon is recovered analytically and mapped through the requested origin/X/Y. Source shape identity, default parameter values/formulas and browser curves are preserved and rechecked; every instantiated shape parameter must match its source default.

This is not complete support for arbitrary rebar shapes. Driving arcs/spirals, multiplanar shapes, open shapes, unresolved default parameters and shapes whose browser geometry cannot prove the lower-left placement convention are refused. A conservative circular envelope is used to prove fillet bounds; this can reject additional shapes whose actual arc extent would be smaller. Hooks, cranks and end treatments are refused because this contract contains no terminal design and the native shape factory can otherwise choose applicable terminal types arbitrarily. Unsupported shapes require another adaptation and native acceptance; they are not silently reshaped into a rectangle or flattened to XY.

## Layouts

Rule names and field sets are exact and case sensitive. Layout fields never move to the operation's top level.

| Rule | Required fields | Meaning |
| --- | --- | --- |
| `Single` | `rule` only | One actual bar; all other layout fields are rejected. |
| `FixedNumber` | `rule`, `quantity`, `arrayLengthMm`, `barsOnNormalSide`, `includeFirstBar`, `includeLastBar` | `quantity` is an integer from 2 through 1000 **potential positions**. Endpoint exclusion reduces actual native `Quantity`. |
| `MaximumSpacing` | `rule`, `spacingMm`, `arrayLengthMm`, `barsOnNormalSide`, `includeFirstBar`, `includeLastBar` | Positive maximum spacing and explicit positive array length. Expected positions are `ceil(arrayLengthMm / spacingMm) + 1`, at most 1000. |

Array length and spacing are finite positive millimeter values no greater than 100,000,000. All three booleans are required for array rules. Both endpoints may be excluded only if at least one actual bar remains. `quantity` and `spacingMm` are mutually exclusive. Array lengths are never inferred from host geometry or multiplied from an unrequested quantity hint.

The distribution normal is the explicit `normal` for a straight bar and `xDirection × yDirection` for a stirrup. `barsOnNormalSide:false` reverses the distribution direction. Readback requires the expected number of positions, actual quantity, all individual inclusion flags, side, first/last flags, array length and maximum spacing where applicable.

## Native evidence and limits

The service binds the document, created ID/UniqueId, host ID/UniqueId, exact bar type ID/UniqueId, actual shape ID/UniqueId and original input. It compares complete geometry to that reviewed input/source; the immediate geometry snapshot is only an additional invariant between phases.

Evidence uses `ComputeDrivingCurves`, `GetDistributionPath`, `GetBarPositionTransform`, `GetCenterlineCurves` and, for every included bar, `GetTransformedCenterlineCurves`. The final-position API includes individual moved-bar transforms, so an individually moved or geometrically varying bar does not pass merely because its parent set has the expected ID or layout. Every native position transform must be the expected translation with identity bases. Shape-driven direction and position evidence is checked at each phase.

Native curves must be bounded lines or bounded circular arcs. Evidence includes endpoints, midpoint, length and, for arcs, center, radius, normal and sweep. Unknown curve classes, full circles, empty curve arrays, more than 64 curve segments or more than 1000 positions fail closed rather than returning truncated or invented evidence. Position/length tolerance is 0.01 mm, native direction comparison tolerance `1e-6`, and arc sweep comparison tolerance `1e-8` radians. Source parameter defaults use native scalar comparison tolerance `1e-8`.

Inspection returns `null` for unrelated elements. Unsupported rebar readback returns `supported:false` with a reason. A supported read snapshot alone sets `reviewedInputVerified:false`; it is not an execution acceptance statement. Successful creation/readback also leaves side effect completeness, persistence, visual quality and engineering compliance explicitly unverified unless independently established by their owning workflow.

## Source and license

Selectively adapted from `bimwright/rvt-mcp`, Apache-2.0, fixed commit `b44ee0b8032f0603f8e52656bc05ab43aa599263`, `CreateRebarSetHandler.cs` and `CreateRebarStirrupHandler.cs`. Reused pieces are Revit 2027 `BarTerminationsData`/`CreateFromCurves`, `CreateFromRebarShape` and native `SetLayoutAsSingle`, `SetLayoutAsFixedNumber`, `SetLayoutAsMaximumSpacing` calls. See `THIRD_PARTY_NOTICES.md` and the bundled upstream license.

Type guessing, normal guessing, silent vector normalization, bounding-box array estimation, swallowed failures and independent transactions were not carried over. This adapter adds strict input validation, source/identity binding and repeated native geometric readback. Upstream implementation and offline SDK compilation are not substitutes for native acceptance.
