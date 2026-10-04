using Autodesk.Revit.DB.Events;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Events;
using System.Reflection;

namespace RevitAutoV27;

public sealed class App : IExternalApplication
{
    private RevitCommandHandler? handler;
    private TcpCommandServer? server;
    private ExternalEvent? externalEvent;
    public static string ConnectionMessage { get; private set; } = "插件等待 Revit 初始化。";
    public Result OnStartup(UIControlledApplication application)
    {
        application.ControlledApplication.ApplicationInitialized += Initialize;
        application.ControlledApplication.DocumentChanged += DocumentChanged;
        application.ControlledApplication.DocumentClosed += DocumentClosed;
        application.Idling += Idling;
        var panel = application.CreateRibbonPanel("Revit AI");
        panel.AddItem(new PushButtonData("RevitAutoStatus", "AI 连接状态", Assembly.GetExecutingAssembly().Location, typeof(ConnectionStatus).FullName!));
        return Result.Succeeded;
    }
    private void Initialize(object? sender, ApplicationInitializedEventArgs e)
    {
        try
        {
            handler = new RevitCommandHandler();
            externalEvent = ExternalEvent.Create(handler);
            handler.Attach(externalEvent);
            server = new TcpCommandServer(handler);
            server.Start();
            ConnectionMessage = "安全执行引擎 v0.3.20 已启动。localhost + 私有令牌；模型写入只需聊天确认，不再弹 Revit 二次确认窗口。";
        }
        catch (Exception ex) { ConnectionMessage = "插件连接失败：" + ex.Message; handler?.Dispose(); server?.Dispose(); externalEvent?.Dispose(); Log.Write("Initialization failed: " + ex); }
    }
    private void DocumentChanged(object? sender, DocumentChangedEventArgs e) => RevitCommandRouter.Changed(e);
    private void DocumentClosed(object? sender, DocumentClosedEventArgs e) => RevitCommandRouter.Closed(e.Status == RevitAPIEventStatus.Succeeded);
    private void Idling(object? sender, IdlingEventArgs e) => handler?.Wake();
    public Result OnShutdown(UIControlledApplication application)
    {
        application.ControlledApplication.ApplicationInitialized -= Initialize;
        application.ControlledApplication.DocumentChanged -= DocumentChanged;
        application.ControlledApplication.DocumentClosed -= DocumentClosed;
        application.Idling -= Idling;
        handler?.Dispose(); server?.Dispose(); externalEvent?.Dispose();
        return Result.Succeeded;
    }
}
