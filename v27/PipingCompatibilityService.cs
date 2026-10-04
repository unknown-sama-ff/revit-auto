using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Plumbing;
namespace RevitAutoV27;

internal static class PipingCompatibilityService
{
    public static PipingClassEvidence Evidence(Connector connector, long? expectedSystemTypeId = null)
    {
        var owner=connector.Owner;string? raw=null;string? error=null;PipingSystemType? assigned=null;
        try{raw=connector.PipeSystemType.ToString();}catch(Autodesk.Revit.Exceptions.InvalidOperationException ex){error=ex.Message;}
        // For a plan-created pipe, the operation's native systemTypeId is authoritative;
        // Connector.PipeSystemType can remain UndefinedSystemType until it joins a system.
        if(expectedSystemTypeId is > 0)assigned=owner.Document.GetElement(new ElementId(expectedSystemTypeId.Value)) as PipingSystemType;
        if(assigned is null && owner is Pipe)
        {
            var param=owner.get_Parameter(BuiltInParameter.RBS_PIPING_SYSTEM_TYPE_PARAM);
            if(param is {StorageType:StorageType.ElementId,HasValue:true})assigned=owner.Document.GetElement(param.AsElementId()) as PipingSystemType;
        }
        if(assigned is null && owner is MEPCurve curve && curve.MEPSystem is { } system)
            assigned=owner.Document.GetElement(system.GetTypeId()) as PipingSystemType;
        return new(owner.Id.Value,connector.Id,raw,assigned?.Id.Value,assigned?.SystemClassification.ToString(),error);
    }
    public static object Snapshot(Element element)
    {
        if(element is Pipe pipe)
        {
            var type=pipe.Document.GetElement(pipe.get_Parameter(BuiltInParameter.RBS_PIPING_SYSTEM_TYPE_PARAM)?.AsElementId()??ElementId.InvalidElementId) as PipingSystemType;
            var diameter=pipe.get_Parameter(BuiltInParameter.RBS_PIPE_DIAMETER_PARAM);
            return new {systemTypeId=type?.Id.Value,systemTypeName=type?.Name,systemClassification=type?.SystemClassification.ToString(),diameterMm=diameter is null?null:ParameterReadPolicy.Normalize(JsonDefaults.InternalToMm(diameter.AsDouble())).Value};
        }
        if(element is PipingSystemType system)return new {systemTypeId=system.Id.Value,systemClassification=system.SystemClassification.ToString()};
        if(element is PipeType pipeType)
        {
            var groups=new[]{RoutingPreferenceRuleGroupType.Elbows,RoutingPreferenceRuleGroupType.Transitions};
            var manager=pipeType.RoutingPreferenceManager;
            return new {routingPreferences=groups.Select(group=>new {group=group.ToString(),rules=Enumerable.Range(0,manager.GetNumberOfRules(group)).Select(index=>{
                using var rule=manager.GetRule(group,index);var part=pipeType.Document.GetElement(rule.MEPPartId);
                return new {index,partTypeId=rule.MEPPartId.Value,partName=part?.Name,family=(part as FamilySymbol)?.FamilyName,rule.Description,criterionCount=rule.NumberOfCriteria};
            }).ToArray()}).ToArray()};
        }
        return new {applicable=false};
    }
}
