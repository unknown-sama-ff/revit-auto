# Read-only MEP disconnects diagnostic

`revit_mep_disconnects` scans `MEPCurve` elements (ducts, pipes, cable trays, conduits) and MEP `FamilyInstance` elements for open physical `ConnectorType.End` connectors. It selectively adapts `FindMepDisconnectsHandler` from bimwright/rvt-mcp (`b44ee0b8032f0603f8e52656bc05ab43aa599263`, Apache-2.0) and requires the `readonly-mep-disconnects` native feature.

## Contract

- Required fields: `documentIdentity`, `expectedRevision`.
- Optional fields: `domain` (`all`, `hvac`, `piping`, `electrical`, `cableTrayConduit`; default `all`), `viewId` (explicit graphical model `View` ID; never defaults to `ActiveView`), `offset` (`>= 0`, default `0`), `limit` (`1..200`, default `50`).
- Connectors whose `IsConnected` or `Domain` read fails are counted under `unknownConnectorElements` / `unknownConnectorCount` and are never reported as open connectors. Logical/curve pseudo-connectors are excluded.

Status: offline implementation compiled for Revit 2027.3; native diagnostic acceptance against active MEP models remains pending. See [capability status](capability-status.md).
