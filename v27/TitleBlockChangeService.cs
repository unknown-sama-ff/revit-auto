using System.Text.Json;
using Autodesk.Revit.DB;

namespace RevitAutoV27;

internal static class TitleBlockChangeService
{
    private const int EvidenceLimit=1000;
    private sealed record State(FamilyInstance Instance,ViewSheet Sheet,FamilySymbol Target,long OldTypeId,XYZ Position,double Rotation,long[] Dependents,long[] SheetInstances,bool NoOp);
    internal sealed record ReadbackBinding(long OriginalInstanceId,long ResultingInstanceId,long SheetId,long OldTypeId,long TargetTypeId,
        XYZ Position,double Rotation,long[] Dependents,long[] SheetInstances,bool NoOp,bool Replaced);
    private static BridgeException Invalid(string message,object? details=null)=>new("invalid_titleblock_change",message,details);
    private static bool IsTitleBlock(Element element)=>element.Category?.Id.Value==(long)BuiltInCategory.OST_TitleBlocks;
    private static object Point(XYZ value)=>new{xMm=JsonDefaults.InternalToMm(value.X),yMm=JsonDefaults.InternalToMm(value.Y),zMm=JsonDefaults.InternalToMm(value.Z)};
    private static object DependencyEvidence(TitleBlockDependencyPreservation check)=>new
    {
        requiredDependentElementIds=check.RequiredDependentElementIds,
        exemptOriginalSelfReferenceIds=check.ExemptOriginalSelfReferenceIds,
        missingDependentElementIds=check.MissingDependentElementIds,
        verified=check.Verified
    };
    private static long[] Bounded(IEnumerable<ElementId> ids,string description)
    {
        var values=ids.Select(id=>id.Value).Order().ToArray();
        if(values.Length>EvidenceLimit||values.Any(id=>id<=0)||values.Distinct().Count()!=values.Length)
            throw Invalid(description+" must be complete, unique and bounded to 1000 positive IDs.");
        return values;
    }
    private static long[] SheetInstances(Document doc,ElementId sheetId)=>Bounded(new FilteredElementCollector(doc,sheetId)
        .OfCategory(BuiltInCategory.OST_TitleBlocks).WhereElementIsNotElementType().Select(element=>element.Id),"Sheet titleblocks");
    private static LocationPoint Location(FamilyInstance instance)
    {
        if(instance.Location is not LocationPoint location||!double.IsFinite(location.Point.X)||!double.IsFinite(location.Point.Y)||
            !double.IsFinite(location.Point.Z)||!double.IsFinite(location.Rotation))throw Invalid("Titleblock native point and rotation are unavailable or non-finite.");
        return location;
    }
    private static Element Required(Document doc,JsonElement op,string field)=>doc.GetElement(new ElementId(TitleBlockChangeRules.ExistingId(op,field)))??throw Invalid(field+" is not an existing element.");
    private static State Capture(Document doc,JsonElement op)
    {
        TitleBlockChangeRules.Validate(op);
        var instance=Required(doc,op,"titleBlockInstanceId") as FamilyInstance??throw Invalid("titleBlockInstanceId must identify an existing FamilyInstance.");
        var sheet=Required(doc,op,"sheetId") as ViewSheet??throw Invalid("sheetId must identify an existing ViewSheet.");
        var target=Required(doc,op,"targetTypeId") as FamilySymbol??throw Invalid("targetTypeId must identify an existing FamilySymbol.");
        if(!IsTitleBlock(instance)||instance.OwnerViewId!=sheet.Id||!IsTitleBlock(instance.Symbol)||instance.Symbol.Family.FamilyPlacementType!=FamilyPlacementType.ViewBased)
            throw Invalid("The existing instance must be a native ViewBased titleblock on the reviewed sheet.");
        if(!IsTitleBlock(target)||target.Family.FamilyPlacementType!=FamilyPlacementType.ViewBased)
            throw Invalid("The target must be a native ViewBased titleblock FamilySymbol.");
        if(instance.Pinned||doc.IsReadOnly)throw Invalid("Pinned or read-only titleblocks cannot change type.");
        if(!target.IsActive)throw Invalid("The target symbol must already be active; implicit type activation is not permitted.");
        var valid=Bounded(instance.GetValidTypes(),"Native valid titleblock types");
        if(!valid.Contains(target.Id.Value)||!instance.IsValidType(target.Id))throw Invalid("The native instance rejects the target type.");
        var location=Location(instance);
        var dependents=Bounded(instance.GetDependentElements(null),"Titleblock dependents");
        var sheetInstances=SheetInstances(doc,sheet.Id);
        if(!sheetInstances.Contains(instance.Id.Value))throw Invalid("The instance is absent from its native sheet titleblock membership.");
        return new(instance,sheet,target,instance.GetTypeId().Value,location.Point,location.Rotation,dependents,sheetInstances,instance.GetTypeId()==target.Id);
    }
    public static object? Inspect(Document doc,Element element)
    {
        if(!IsTitleBlock(element))return null;
        if(element is not FamilySymbol&&element is not FamilyInstance)return null;
        var result=TitleBlockReadPolicy.Read<object>(()=>
        {
            if(element is FamilySymbol symbol)return new{supported=true,typeId=symbol.Id.Value,categoryId=symbol.Category!.Id.Value,
                familyPlacementType=symbol.Family.FamilyPlacementType.ToString(),isActive=symbol.IsActive};
            var instance=(FamilyInstance)element;var location=Location(instance);
            return new{supported=true,instanceId=instance.Id.Value,sheetId=instance.OwnerViewId.Value,typeId=instance.GetTypeId().Value,
                pinned=instance.Pinned,isReadOnly=doc.IsReadOnly,position=Point(location.Point),rotationRadians=location.Rotation,
                familyPlacementType=instance.Symbol.Family.FamilyPlacementType.ToString(),
                validTypeIds=Bounded(instance.GetValidTypes(),"Native valid titleblock types"),validTypesComplete=true,
                dependentElementIds=Bounded(instance.GetDependentElements(null),"Titleblock dependents"),dependenciesComplete=true,
                sheetTitleBlockInstanceIds=SheetInstances(doc,instance.OwnerViewId),sheetTitleBlocksComplete=true};
        },error=>error is Autodesk.Revit.Exceptions.InvalidOperationException or Autodesk.Revit.Exceptions.ArgumentException or Autodesk.Revit.Exceptions.InvalidObjectException);
        return result.Supported?result.Value:new{supported=false,errorCode=result.ErrorCode,error=result.Error,partial=false};
    }
    public static void Validate(Document doc,JsonElement op)=>_=Capture(doc,op);
    internal static object VerifyReadback(Document doc, ReadbackBinding binding, string phase, bool writePerformed)
    {
        var instance=doc.GetElement(new ElementId(binding.ResultingInstanceId)) as FamilyInstance ?? throw Invalid("Resulting titleblock instance disappeared before final verification.");
        var sheet=doc.GetElement(new ElementId(binding.SheetId)) as ViewSheet ?? throw Invalid("Titleblock owner sheet disappeared before final verification.");
        if(!IsTitleBlock(instance)||instance.OwnerViewId!=sheet.Id||instance.GetTypeId()!=new ElementId(binding.TargetTypeId)||instance.Pinned)
            throw Invalid("Native titleblock class, owner, target type or pin state differs from the reviewed operation; roll back.");
        var originalPresent=doc.GetElement(new ElementId(binding.OriginalInstanceId)) is not null;
        var expectedReadback=new TitleBlockChangeReadback(binding.OriginalInstanceId,binding.ResultingInstanceId,binding.SheetId,binding.TargetTypeId,binding.Replaced);
        var dependencyPreservation=TitleBlockChangeReadbackRules.InspectDependencies(expectedReadback,binding.Dependents,
            id=>doc.GetElement(new ElementId(id)) is not null);
        TitleBlockChangeReadbackRules.Require(
            expectedReadback,
            new(binding.OriginalInstanceId,instance.Id.Value,binding.SheetId,binding.TargetTypeId,binding.Replaced),
            originalPresent,dependencyPreservation.Verified);
        if(binding.Replaced&&originalPresent)
            throw Invalid("Native replacement left the original titleblock instance present; roll back.");
        var location=Location(instance);var ids=SheetInstances(doc,sheet.Id);
        var expected=binding.SheetInstances.Select(id=>id==binding.OriginalInstanceId?binding.ResultingInstanceId:id).Order().ToArray();
        if(!ids.SequenceEqual(expected)||location.Point.DistanceTo(binding.Position)>UnitUtils.ConvertToInternalUnits(1,UnitTypeId.Millimeters)||Math.Abs(location.Rotation-binding.Rotation)>1e-6)
            throw Invalid("Native titleblock membership, position or rotation differs from the reviewed operation; roll back.");
        return new { phase,titleBlockInstanceId=binding.OriginalInstanceId,resultingTitleBlockInstanceId=instance.Id.Value,sheetId=sheet.Id.Value,targetTypeId=binding.TargetTypeId,
            reviewedDependentsStillExist=dependencyPreservation.AllOriginalDependentIdsStillExist,
            dependencyPreservation=DependencyEvidence(dependencyPreservation),
            nativeReadbackVerified=true,sideEffectsVerified=false,persistenceVerified=false,visualVerified=false,writePerformed };
    }
    public static object Preview(Document doc,JsonElement op)
    {
        var state=Capture(doc,op);
        return new{titleBlockInstanceId=state.Instance.Id.Value,sheetId=state.Sheet.Id.Value,oldTypeId=state.OldTypeId,targetTypeId=state.Target.Id.Value,
            noOp=state.NoOp,position=Point(state.Position),rotationRadians=state.Rotation,
            dependentElementIds=state.Dependents,dependenciesComplete=true,sheetTitleBlockInstanceIds=state.SheetInstances,
            nativeMayReplaceInstance=!state.NoOp,replacementElementIdKnown=false,dependentDeletionAllowed=false,
            nativeReadbackVerified=false,sideEffectsVerified=false};
    }
    public static OperationReceipt Apply(Document doc,JsonElement op)
    {
        var state=Capture(doc,op);var oldId=state.Instance.Id.Value;
        var nativeReturnedId=ElementId.InvalidElementId;
        if(!state.NoOp){nativeReturnedId=state.Instance.ChangeTypeId(state.Target.Id);doc.Regenerate();}
        var newId=nativeReturnedId==ElementId.InvalidElementId?oldId:nativeReturnedId.Value;
        var result=doc.GetElement(new ElementId(newId)) as FamilyInstance??throw Invalid("Native ChangeTypeId did not return a readable titleblock instance.");
        if(!IsTitleBlock(result)||result.OwnerViewId!=state.Sheet.Id||result.GetTypeId()!=state.Target.Id||result.Pinned)
            throw Invalid("Native titleblock class, owner sheet, type or pin state differs from the preview; roll back.");
        var afterLocation=Location(result);
        if(afterLocation.Point.DistanceTo(state.Position)>UnitUtils.ConvertToInternalUnits(0.001,UnitTypeId.Millimeters)||Math.Abs(afterLocation.Rotation-state.Rotation)>1e-9)
            throw Invalid("Native titleblock position or rotation changed without approval; roll back.");
        var replaced=newId!=oldId;
        if(replaced&&doc.GetElement(new ElementId(oldId)) is not null)throw Invalid("Native replacement left the original titleblock instance present; roll back.");
        var expectedIds=state.SheetInstances.Select(id=>id==oldId?newId:id).Order().ToArray();
        var actualIds=SheetInstances(doc,state.Sheet.Id);
        if(!actualIds.SequenceEqual(expectedIds))throw Invalid("The sheet titleblock membership changed beyond the one reviewed instance; roll back.");
        var afterDependents=Bounded(result.GetDependentElements(null),"Post-change titleblock dependents");
        var dependencyPreservation=TitleBlockChangeReadbackRules.InspectDependencies(
            new(oldId,newId,state.Sheet.Id.Value,state.Target.Id.Value,replaced),state.Dependents,
            id=>doc.GetElement(new ElementId(id)) is not null);
        if(!dependencyPreservation.Verified)throw Invalid("Native type change deleted reviewed dependent elements; dependent deletion was not approved.",
            new{removedDependentElementIds=dependencyPreservation.MissingDependentElementIds});
        var binding=new ReadbackBinding(oldId,newId,state.Sheet.Id.Value,state.OldTypeId,state.Target.Id.Value,state.Position,state.Rotation,
            state.Dependents,state.SheetInstances,state.NoOp,replaced);
        return new(replaced?[newId]:[],state.NoOp?[]:[newId]){ResultingElementId=newId,ReadbackBinding=binding,Evidence=new{
            titleBlockInstanceId=oldId,resultingTitleBlockInstanceId=newId,sheetId=state.Sheet.Id.Value,oldTypeId=state.OldTypeId,targetTypeId=state.Target.Id.Value,
            noOp=state.NoOp,typeWritePerformed=!state.NoOp,outcome=state.NoOp?"no_change":"write_performed",
            replacementOccurred=replaced,nativeReturnedElementId=nativeReturnedId.Value,deletedOriginalInstanceIds=replaced?new[]{oldId}:Array.Empty<long>(),
            beforePosition=Point(state.Position),afterPosition=Point(afterLocation.Point),beforeRotationRadians=state.Rotation,afterRotationRadians=afterLocation.Rotation,
            beforeDependentElementIds=state.Dependents,afterDependentElementIds=afterDependents,dependenciesComplete=true,
            reviewedDependentsStillExist=dependencyPreservation.AllOriginalDependentIdsStillExist,
            dependencyPreservation=DependencyEvidence(dependencyPreservation),
            addedDependentElementIds=afterDependents.Except(state.Dependents).ToArray(),
            sheetTitleBlockInstanceIds=actualIds,nativeReadbackVerified=true,sideEffectsVerified=false}};
    }
}
