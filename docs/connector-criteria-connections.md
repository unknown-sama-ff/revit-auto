# v0.3.17 连接器条件连接

## 目标

让 AI 在不手写连接器 ID 的情况下，使用当前模型查询结果生成可复核的连接预览；执行时再次使用同样的条件解析，避免预览和执行选到不同端口。

## 连接操作

`connect_elements` 和 `create_fitting` 的每一侧必须二选一：

- `firstConnectorId` / `secondConnectorId`：来自当前活动文档、已读取且稳定的原生连接器 ID；或
- `firstConnector` / `secondConnector`：
  - `domain`: `DomainPiping`、`DomainHvac` 或 `DomainElectrical`
  - `shape`: `Round`、`Rectangular`、`Oval` 或 `Invalid`
  - `point`: 当前项目坐标原点下的 `xMm/yMm/zMm`
  - `toleranceMm`: 正数且不超过 10000

不得同时提供 ID 和条件。条件匹配零个或多个连接器都会拒绝计划；不会自动取第一个。

## 新建元素引用

新建管道/风管的连接器不能使用预测的端口 ID。应使用：

```text
secondElementId: "@pipe1"
secondConnector: { domain, shape, point, toleranceMm }
```

预览阶段用明确的起终点检查唯一性；执行阶段在 Revit 中重新解析真实连接器。

## 执行安全

直接 `connect_elements` 还要同时满足：

- 域相同；
- 形状相同；
- 管道系统分类相同；
- 圆形连接器直径相同；
- 连接器轴线相反；
- 两端点在明确容差内；
- 两端没有被其他系统占用。

不满足时，应改为预览路线、转接管或 `create_fitting`，不强行连接。

## 当前泵房验收结论

水泵 `2295837` 的真实管道连接器已解析为 2、3；现有管道 `2295838` 的端点连接器可解析为 0、1。此前的现有管道计划使用 80 mm/K_CHWS，而水泵原生供回水管径为 100 mm/循环供水，因此不能直接连接。下一次重启加载 v0.3.17 后，先读取连接器方向、直径和系统分类，再生成兼容路线的预览。

所有写入仍必须遵守：查询 → 预览 → 聊天确认 → 同一 planId 提交；Revit 不二次弹窗，不自动保存。
