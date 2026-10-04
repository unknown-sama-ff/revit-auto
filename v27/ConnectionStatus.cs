using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace RevitAutoV27;
[Transaction(TransactionMode.ReadOnly)]
public sealed class ConnectionStatus : IExternalCommand
{
    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
    {
        TaskDialog.Show("Revit AI 连接状态", App.ConnectionMessage + "\n\n日志目录：" + RuntimeFiles.DirectoryPath + "\n当前项目：" + (commandData.Application.ActiveUIDocument?.Document.Title ?? "未打开项目") + "\n\n助手中先使用 revit.context.get；只查询不会改变模型。");
        return Result.Succeeded;
    }
}
