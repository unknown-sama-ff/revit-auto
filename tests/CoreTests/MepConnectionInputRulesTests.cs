using System.Text.Json;
using RevitAutoV27;
internal static class MepConnectionInputRulesTests
{
    private static JsonElement Op(string extra) => JsonDocument.Parse("{\"operationType\":\"create_fitting\",\"firstElementId\":1,\"firstConnectorId\":11,\"secondElementId\":2,\"secondConnectorId\":22"+extra+"}").RootElement.Clone();
    private static void Reject(JsonElement value) { try { MepConnectionInputRules.Validate(value); } catch (BridgeException) { return; } throw new Exception("Invalid topology was accepted."); }
    public static void Run(Action<string,Action> test)
    {
        test("MEP tee cross and old fittings preserve exact endpoint cardinality",()=>{
            foreach(var extra in new[]{"",",\"fittingType\":\"tee\",\"thirdElementId\":3,\"thirdConnectorId\":33",",\"fittingType\":\"cross\",\"thirdElementId\":3,\"thirdConnectorId\":33,\"fourthElementId\":4,\"fourthConnectorId\":44"})MepConnectionInputRules.Validate(Op(extra));
            foreach(var extra in new[]{",\"fittingType\":null",",\"fittingType\":\"wye\"",",\"thirdElementId\":3,\"thirdConnectorId\":33",",\"fittingType\":\"tee\"",",\"fittingType\":\"cross\",\"thirdElementId\":3,\"thirdConnectorId\":33",",\"fittingType\":\"tee\",\"thirdElementId\":1,\"thirdConnectorId\":33"})Reject(Op(extra));
        });
        test("unassigned native optin is boolean connect only and refuses deferred proof",()=>{
            foreach(var extra in new[]{",\"allowUnassignedEquipmentPort\":true",",\"allowUnassignedEquipmentPort\":false"})Reject(Op(extra));
            foreach(var value in new[]{"true","false"})MepConnectionInputRules.Validate(JsonDocument.Parse(Op(",\"allowUnassignedEquipmentPort\":"+value).GetRawText().Replace("create_fitting","connect_elements")).RootElement);
            Reject(JsonDocument.Parse(Op(",\"allowUnassignedEquipmentPort\":\"true\"").GetRawText().Replace("create_fitting","connect_elements")).RootElement);
            var deferred="{\"operationType\":\"connect_elements\",\"firstElementId\":1,\"firstConnectorId\":11,\"secondElementId\":\"@pipe\",\"secondConnectorId\":22,\"allowUnassignedEquipmentPort\":true}";Reject(JsonDocument.Parse(deferred).RootElement);
        });
    }
}
