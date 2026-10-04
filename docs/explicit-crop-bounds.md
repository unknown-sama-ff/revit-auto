# v0.3.10：显式局部矩形裁剪

## 用法
使用 configure_view，读取当前模型与目标/参考视图后再生成预览：

```json
{
  "operationType": "configure_view",
  "viewId": 2295843,
  "referenceViewId": 770350,
  "settings": [
    "viewRange",
    "crop",
    "discipline",
    "displayStyle",
    "detailLevel"
  ],
  "discipline": "Mechanical",
  "cropBounds": {
    "min": {
      "xMm": 32000,
      "yMm": 16000
    },
    "max": {
      "xMm": 38000,
      "yMm": 22000
    }
  }
}
```

本例中的元素ID来自当前测试副本，其他项目不可复用。必须使用执行时读取的新 documentIdentity/expectedRevision。当前运行的0.3.9不支持此参数；MCP会在计划转发前拒绝。

## 行为
- 项目原点XY毫米坐标；只接受min/max点和xMm/yMm。
- 矩形宽高至少1毫米，执行前还检查原生短曲线容差。
- 只支持项目轴对齐FloorPlan；非矩形/分段/旋转/镜像视图拒绝。
- 原生坐标框架有平移时将输入XY转换到现有局部框架，不猜旋转；保留CropBox原生Z。
- 显式裁剪启用目标裁剪并隐藏边界，不复制参考裁剪。未提供cropBounds时保留原复制模式。
- 原生执行后回读XY，误差超过1毫米则整个计划回滚。
- 不修改参考770350、不新建设备/管道/风管、不自动保存、不增加Revit二次确认。

## 实机验收状态（2026-10-04）
代码已编译，57核心与130MCP测试通过；清单指向独立0310目录。实际运行仍是0.3.9，不能宣称已经修好显示。

保存后手动重启Revit，确认bridge.info带explicit-crop-bounds能力，再重新展示有效预览；聊天批准后只修改AI-V041，导出PNG检查泵、管道与风管。开发批准不是该计划的执行批准。

## 诊断边界
目标裁剪原先关闭，旧裁剪框坐标不能证明裁剪掉元素。已知风管高度2500毫米高于默认视图顶部2300毫米。不能只改变XY范围而忽略高度。
族类型connectors为空不证明实例没有连接器；必须另行读取实际泵实例。当前inspect断连问题尚未修复，不把计划的管径/系统值冒充原生参数核验。
