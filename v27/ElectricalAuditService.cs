using System.Text.Json;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Electrical;
using Autodesk.Revit.UI;

namespace RevitAutoV27;

internal static class ElectricalAuditService
{
    public static object Run(UIApplication app,JsonElement parameters,CancellationToken cancellation)
    {
        var input=ElectricalAuditRules.Parse(parameters);
        var doc=app.ActiveUIDocument?.Document??throw new BridgeException("no_active_document","Open the reviewed project first.");
        var identity=RevitCommandRouter.Identity(doc);var revision=RevitCommandRouter.Revision(doc);
        if(input.DocumentIdentity!=identity)throw new BridgeException("document_changed","The active project differs from the reviewed electrical audit document.");
        if(input.ExpectedRevision is long expected&&expected!=revision)throw new BridgeException("document_revision_changed","The electrical audit model changed since the reviewed context.");
        var started=System.Diagnostics.Stopwatch.StartNew();
        void Check(){cancellation.ThrowIfCancellationRequested();if(started.Elapsed>TimeSpan.FromSeconds(20))throw new BridgeException("electrical_audit_timeout","Electrical audit exceeded its read-only time budget; no write was requested.");}
        Check();
        long[] circuitIds;
        if(input.CircuitIds.Length>0)
        {
            foreach(var id in input.CircuitIds){Check();if(doc.GetElement(new ElementId(id)) is not ElectricalSystem)throw new BridgeException("electrical_circuit_not_found",$"Element {id} is not an electrical circuit in this project.");}
            circuitIds=input.CircuitIds.Order().ToArray();
        }
        else circuitIds=new FilteredElementCollector(doc).OfClass(typeof(ElectricalSystem)).ToElementIds().Select(id=>{Check();return id.Value;}).Order().ToArray();
        var rows=new List<object>();var memberBudget=ElectricalAuditRules.TotalMemberBudget;var parameterBudget=ElectricalAuditRules.TotalParameterBudget;
        var rowReadsComplete=true;
        foreach(var circuitId in circuitIds.Take(input.MaxCircuits))
        {
            Check();var circuit=(ElectricalSystem)doc.GetElement(new ElementId(circuitId));
            var fields=new Dictionary<string,AuditValueEvidence>
            {
                ["circuitNumber"]=AuditValueEvidence.Read(()=>circuit.CircuitNumber),
                ["panelId"]=AuditValueEvidence.Read(()=>circuit.BaseEquipment?.Id.Value),
                ["panelName"]=AuditValueEvidence.Read(()=>circuit.PanelName),
                ["systemType"]=AuditValueEvidence.Read(()=>circuit.SystemType.ToString()),
                ["loadName"]=AuditValueEvidence.Read(()=>circuit.get_Parameter(BuiltInParameter.RBS_ELEC_CIRCUIT_NAME)?.AsString())
            };
            var members=new List<object>();int? memberCount=null;string? memberError=null;var memberUnknown=false;
            try
            {
                var set=circuit.Elements;memberCount=set.Size;
                var limit=Math.Min(input.MaxMembersPerCircuit,memberBudget);
                // Full ID ordering is UI-only; output sampling is deterministic for unchanged native membership.
                var ordered=set.Cast<Element>().Select(element=>{Check();return element.Id.Value;}).Order().Take(limit).ToArray();
                foreach(var id in ordered)
                {
                    Check();var element=doc.GetElement(new ElementId(id));
                    var memberFields=new Dictionary<string,AuditValueEvidence>
                    {
                        ["mark"]=AuditValueEvidence.Read(()=>element.get_Parameter(BuiltInParameter.ALL_MODEL_MARK)?.AsString()),
                        ["categoryId"]=AuditValueEvidence.Read(()=>element.Category?.Id.Value),
                        ["typeId"]=AuditValueEvidence.Read(()=>element.GetTypeId().Value),
                        ["family"]=AuditValueEvidence.Read(()=>element is FamilyInstance instance?instance.Symbol.FamilyName:null)
                    };
                    if(memberFields.Values.Any(value=>!value.Supported||value.Truncated)){memberUnknown=true;rowReadsComplete=false;}
                    members.Add(new{elementId=id,fields=memberFields});memberBudget--;
                }
            }
            catch(OperationCanceledException){throw;}
            catch(BridgeException){throw;}
            catch(Exception ex){memberError=ex.Message.Length>400?ex.Message[..400]:ex.Message;rowReadsComplete=false;}
            var parameterRows=new List<object>();int? parameterCount=null;string? parameterError=null;var parameterUnknown=false;
            try
            {
                var set=circuit.Parameters;parameterCount=set.Size;
                foreach(Parameter parameter in set)
                {
                    Check();if(parameterRows.Count>=input.MaxParametersPerCircuit||parameterBudget<=0)break;
                    var metadata=new Dictionary<string,AuditValueEvidence>
                    {
                        ["id"]=AuditValueEvidence.Read(()=>parameter.Id.Value),
                        ["name"]=AuditValueEvidence.Read(()=>parameter.Definition.Name),
                        ["storageType"]=AuditValueEvidence.Read(()=>parameter.StorageType.ToString()),
                        ["readOnly"]=AuditValueEvidence.Read(()=>parameter.IsReadOnly),
                        ["hasValue"]=AuditValueEvidence.Read(()=>parameter.HasValue),
                        ["dataTypeId"]=AuditValueEvidence.Read(()=>parameter.Definition.GetDataType().TypeId),
                        ["value"]=AuditValueEvidence.Read(()=>ParameterValue(parameter)),
                        ["formattedValue"]=AuditValueEvidence.Read(()=>parameter.AsValueString())
                    };
                    if(metadata.Values.Any(value=>!value.Supported||value.Truncated)){parameterUnknown=true;rowReadsComplete=false;}
                    parameterBudget--;parameterRows.Add(new{fields=metadata,numericUnitConvention="raw Revit internal value; formattedValue is native display evidence, not an input-unit guess"});
                }
            }
            catch(OperationCanceledException){throw;}
            catch(BridgeException){throw;}
            catch(Exception ex){parameterError=ex.Message.Length>400?ex.Message[..400]:ex.Message;rowReadsComplete=false;}
            var membersTruncated=memberCount is int m?m>members.Count:(bool?)null;
            var parametersTruncated=parameterCount is int p?p>parameterRows.Count:(bool?)null;
            var complete=fields.Values.All(v=>v.Supported&&!v.Truncated)&&memberError is null&&parameterError is null&&membersTruncated==false&&parametersTruncated==false&&!parameterUnknown&&!memberUnknown;
            if(!complete)rowReadsComplete=false;
            rows.Add(new{circuitId,fields,members,memberAudit=new{totalCount=memberCount,returnedCount=members.Count,truncated=membersTruncated,readError=memberError},parameters=parameterRows,parameterAudit=new{totalCount=parameterCount,returnedCount=parameterRows.Count,truncated=parametersTruncated,readError=parameterError},complete});
        }
        Check();
        if(app.ActiveUIDocument?.Document is not{} active||!active.Equals(doc)||RevitCommandRouter.Identity(active)!=identity)throw new BridgeException("document_changed","The electrical audit document changed during the native read.");
        if(RevitCommandRouter.Revision(doc)!=revision)throw new BridgeException("document_revision_changed","The electrical audit revision changed during the native read.");
        var warnings=doc.GetWarnings();
        Check();
        var snapshot=NativeReadSnapshot.Freeze(new{documentIdentity=identity,documentRevision=revision,snapshotPolicy="ui-thread-json-v1",readOnly=true,planCreated=false,
            scope=new{kind=input.CircuitIds.Length>0?"explicit-circuit-ids":"active-document-circuits",requestedCircuitIds=input.CircuitIds,totalCount=circuitIds.Length,returnedCount=rows.Count,truncated=circuitIds.Length>rows.Count},
            circuits=rows,complete=rowReadsComplete&&rows.Count==circuitIds.Length&&warnings.Count<=200,
            counts=RevitQueryService.Counts(doc),warningCount=warnings.Count,warningsTruncated=warnings.Count>200,
            warnings=warnings.Take(200).Select(w=>new{description=w.GetDescriptionText(),failingElementIds=w.GetFailingElements().Select(id=>id.Value).ToArray()}).ToArray(),
            limits=new{input.MaxCircuits,input.MaxMembersPerCircuit,input.MaxParametersPerCircuit,totalMemberBudget=ElectricalAuditRules.TotalMemberBudget,totalParameterBudget=ElectricalAuditRules.TotalParameterBudget,maxResponseBytes=ElectricalAuditRules.MaxResponseBytes,maxSeconds=20},engineeringComplianceVerified=false,
            note="Native terminal membership excludes the base panel. Missing/unassigned/unknown values remain distinct. No circuit creation, repair, saving or guessed capacity rules."});
        if(System.Text.Encoding.UTF8.GetByteCount(snapshot.GetRawText())>ElectricalAuditRules.MaxResponseBytes)throw new BridgeException("electrical_audit_response_too_large","Narrow circuit IDs or audit limits; the native electrical audit snapshot exceeded its bounded response size. No model change was requested.");
        Check();return snapshot;
    }
    private static object? ParameterValue(Parameter parameter)
    {
        if(!parameter.HasValue)return null;
        return parameter.StorageType switch
        {
            StorageType.String=>parameter.AsString(),StorageType.Integer=>parameter.AsInteger(),StorageType.Double=>parameter.AsDouble(),StorageType.ElementId=>parameter.AsElementId().Value,_=>null
        };
    }
}
