# Read-only links inspection

`revit_links_list` and `revit_links_elements` expose bounded, strictly read-only inspection of linked Revit models, linked CAD files, and imported CAD instances. They selectively adapt `ListLinkedModelsHandler`, `ListLinkedCadHandler`, and `GetLinkElementsHandler` from bimwright/rvt-mcp (`b44ee0b8032f0603f8e52656bc05ab43aa599263`, Apache-2.0) and require the `readonly-links-audit` native feature.

## Tools

| Tool | Required fields | Optional fields | Limits |
| --- | --- | --- | --- |
| `revit_links_list` | `documentIdentity`, `expectedRevision` | `includeRevitLinks`, `includeCad`, `includeUnloaded`, `includeInstances`, `includeCadLinks`, `includeCadImports`, `offset` (`>= 0`), `limit` (`1..200`, default `100`) | Read-only inventory; does not load, reload, unload, or save links. |
| `revit_links_elements` | `documentIdentity`, `expectedRevision`, `linkInstanceId` | `category` (`OST_...` or exact category name), `offset` (`>= 0`), `limit` (`1..200`, default `50`), `includeBounds` | Target `RevitLinkInstance` must be loaded (`link_not_loaded` otherwise). `hostBoundsMm` transforms all 8 local bounding-box corners into host millimeter coordinates; elements without a native bounding box report `null`. |

Status: offline implementation compiled for Revit 2027.3; native acceptance against loaded Revit/CAD link fixtures remains pending. See [capability status](capability-status.md).
