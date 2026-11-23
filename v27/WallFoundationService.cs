using System.Text.Json;
using Autodesk.Revit.DB;

namespace RevitAutoV27;

// Selectively adapted from bimwright/rvt-mcp b44ee0b, CreateFoundationWallHandler.cs
// (Apache-2.0). See THIRD_PARTY_NOTICES.md. Transactions belong to the existing executor.
internal sealed class WallFoundationService
{
    private sealed record Binding(long ElementId,string UniqueId,string TypeUniqueId,JsonElement Reviewed,WallFoundationHostState Host);
    private readonly List<Binding> completed=[];
    private Document? capturedDocument;
    private static BridgeException Invalid(string message)=>WallFoundationRules.Invalid(message);
    private static T Existing<T>(Document doc,JsonElement op,string field)where T:Element =>
        doc.GetElement(new ElementId(WallFoundationRules.Id(op,field)))as T??throw Invalid($"{field} is not an existing {typeof(T).Name}.");
    public static void Validate(Document doc,JsonElement op)
    {
        WallFoundationRules.Validate(op);var wall=Existing<Wall>(doc,op,"hostElementId");var type=Existing<WallFoundationType>(doc,op,"foundationTypeId");
        if(type.Category?.Id.Value!=(long)BuiltInCategory.OST_StructuralFoundation)throw Invalid("Select an existing native structural WallFoundationType.");
        _=ReadHost(wall);
        if(new FilteredElementCollector(doc).OfClass(typeof(WallFoundation)).Cast<WallFoundation>().Any(item=>item.WallId==wall.Id))
            throw Invalid("The selected wall already owns a native wall foundation; it will not be duplicated or replaced.");
    }
    public static object Preview(Document doc,JsonElement op)
    {
        Validate(doc,op);var type=Existing<WallFoundationType>(doc,op,"foundationTypeId");
        return new {operationType="create_wall_foundation",host=ReadHost(Existing<Wall>(doc,op,"hostElementId")),foundationTypeId=type.Id.Value,
            foundationTypeUniqueId=type.UniqueId,typeName=type.Name,nativeFactory="WallFoundation.Create",hostGeometrySource="existing-native-wall",
            typeSelectionInferred=false,levelOrPositionInferred=false,engineeringComplianceVerified=false,allModelSideEffectsVerified=false};
    }
    private void Bind(Document doc)
    {
        if(capturedDocument is null)capturedDocument=doc;
        else if(!capturedDocument.IsValidObject||!capturedDocument.Equals(doc))throw Invalid("Wall foundation readback belongs to another document.");
    }
    public OperationReceipt Create(Document doc,JsonElement op)
    {
        Bind(doc);Validate(doc,op);var host=ReadHost(Existing<Wall>(doc,op,"hostElementId"));var type=Existing<WallFoundationType>(doc,op,"foundationTypeId");
        var foundation=WallFoundation.Create(doc,type.Id,new ElementId(host.ElementId))??throw Invalid("Revit did not return a wall foundation.");
        var binding=new Binding(foundation.Id.Value,foundation.UniqueId,type.UniqueId,op.Clone(),host);doc.Regenerate();
        var evidence=Verify(doc,binding);completed.Add(binding);
        return new([foundation.Id.Value],[]){Evidence=evidence};
    }
    private static object Verify(Document doc,Binding binding)
    {
        var foundation=doc.GetElement(new ElementId(binding.ElementId))as WallFoundation??throw Invalid("Created wall foundation disappeared or changed class.");
        var native=ReadFoundation(foundation);var host=ReadHost(doc.GetElement(foundation.WallId)as Wall??throw Invalid("Native wall foundation host is unavailable."));
        WallFoundationRules.Require(binding.Reviewed,native,binding.UniqueId,binding.TypeUniqueId,binding.Host,host);
        return new {elementId=binding.ElementId,reviewedOperation=binding.Reviewed,native,host,nativeReadbackVerified=true,
            hostProfileAndIdentityVerified=true,typeMutationRequested=false,exactFoundationSolidVerified=false,
            sideEffectsVerified=false,persistenceVerified=false,visualVerified=false,engineeringComplianceVerified=false};
    }
    public object VerifyCompleted(Document doc,string phase)
    {
        Bind(doc);var elements=completed.Select(item=>Verify(doc,item)).ToArray();
        return new {phase,verifiedElementCount=elements.Length,nativeReadbackVerified=true,elements,sideEffectsVerified=false,
            persistenceVerified=false,visualVerified=false,engineeringComplianceVerified=false};
    }
    public static object? Inspect(Element element)
    {
        if(element is not WallFoundation foundation)return null;
        try{return NativeReadSnapshot.Freeze(new {supported=true,native=ReadFoundation(foundation),host=ReadHost(foundation.Document.GetElement(foundation.WallId)as Wall??throw Invalid("Unknown wall foundation host.")),exactFoundationSolidVerified=false});}
        catch(OperationCanceledException){throw;}
        catch(Exception error){return new {supported=false,errorType=error.GetType().Name,error=error.Message,exactFoundationSolidVerified=false};}
    }
    private static WallFoundationState ReadFoundation(WallFoundation foundation)
    {
        var type=foundation.Document.GetElement(foundation.GetTypeId())as WallFoundationType??throw Invalid("Native WallFoundationType is unknown.");
        return new(foundation.Id.Value,foundation.UniqueId,type.Id.Value,type.UniqueId,foundation.WallId.Value,
            foundation.Category?.Id.Value??throw Invalid("Native foundation category is unavailable."),foundation.GetType().Name);
    }
    private static WallFoundationHostState ReadHost(Wall wall)
    {
        if(wall.WallType.Kind!=WallKind.Basic||wall.Location is not LocationCurve location||location.Curve is not(Line or Arc)||!location.Curve.IsBound)
            throw Invalid("Wall foundation host requires a native Basic wall with a bounded straight or circular-arc location curve.");
        var curve=location.Curve;var level=wall.Document.GetElement(wall.LevelId)as Level??throw Invalid("Host wall native level is unknown.");
        object Point(XYZ p)
        {
            if(!double.IsFinite(p.X)||!double.IsFinite(p.Y)||!double.IsFinite(p.Z))throw Invalid("Host wall location contains non-finite geometry.");
            return new {xMm=JsonDefaults.InternalToMm(p.X),yMm=JsonDefaults.InternalToMm(p.Y),zMm=JsonDefaults.InternalToMm(p.Z)};
        }
        var samples=new[]{0d,.25,.5,.75,1d}.Select(value=>Point(curve.Evaluate(value,true))).ToArray();
        var geometry=JsonSerializer.Serialize(new {curveKind=curve.GetType().Name,lengthMm=JsonDefaults.InternalToMm(curve.Length),samples,
            arc=curve is Arc arc?new {center=Point(arc.Center),radiusMm=JsonDefaults.InternalToMm(arc.Radius),normal=new{x=arc.Normal.X,y=arc.Normal.Y,z=arc.Normal.Z},xDirection=new{x=arc.XDirection.X,y=arc.XDirection.Y,z=arc.XDirection.Z},yDirection=new{x=arc.YDirection.X,y=arc.YDirection.Y,z=arc.YDirection.Z}}:null},JsonDefaults.Options);
        return new(wall.Id.Value,wall.UniqueId,wall.GetTypeId().Value,wall.WallType.UniqueId,level.Id.Value,level.UniqueId,
            JsonDefaults.InternalToMm(wall.Width),wall.Flipped,curve is Line?"Line":"Arc",geometry);
    }
}
