# Wall foundations

The `wallFoundations` array in `structure.build` selectively adapts `WallFoundation.Create` from bimwright/rvt-mcp at commit `b44ee0b8032f0603f8e52656bc05ab43aa599263` (Apache-2.0). This is staged source, not native acceptance on the recipient's machine.

Each row needs `hostElementId` and `foundationTypeId`, both existing positive native IDs resolved from the current document. The underlying operation is `create_wall_foundation`. The host is an existing Basic wall with a bounded straight or circular-arc native location curve. The type must be an actual `WallFoundationType`; a footing family symbol or foundation slab type cannot substitute for it. No default type, wall, level, position or family loading is inferred.

The host must not already own a native wall foundation. Only one new wall foundation per host may appear in a plan. Changing/deleting that wall or selected type in the same plan is refused; a separately reviewed plan is required. This avoids mixing source modification with this creation check.

Preview discloses the real host's native identity, type, level, width, flipped state and complete straight/arc location signature. Creation uses the existing transaction owner. Immediate, precommit and postcommit checks preserve the new foundation's identity, native type and WallId, and the reviewed host signature. Inspection reports `wallFoundation` separately. This verifies the native host/type relationship, not the exact foundation solid, bearing, reinforcement, structural design, hidden net effects, persistence or visual quality.

Both `controlled-structural-elements` and `controlled-wall-foundation` must be loaded for the registered workflow. Raw wall-foundation preview forwarding also requires its exact `controlled-wall-foundation` flag. An earlier beam-only structural build does not satisfy this new branch. No automatic save or Revit restart occurs.

See [structural elements](structural-elements.md), [capability status](capability-status.md) and the [agent modeling guide](agent-modeling-guide.md). Resolve all IDs and document pins anew before preview; documentation contains no transferable execution grant.
