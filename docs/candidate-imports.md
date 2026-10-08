# DWG/图片候选导入工作流

统一入口：`revit.workflow.run`。

- `name: "imports.dwg_candidate"`：读取本地 DWG 或已提取的受控实体 JSON；如传入 DWG，只能读取用户已经在 AutoCAD 中打开的活动图纸，适配器不会启动 AutoCAD、打开图纸、保存图纸或修改图纸。
- `name: "imports.image_candidate"`：接收助手视觉能力人工审阅后的候选实体；桥接层没有内置视觉模型，也不会把图片自动发送给第三方。

两者都是 `read-only` / `candidateOnly`，不创建 `planId`，不能调用 `revit.import.commit` 直接提交。候选审核后必须重新读取当前 Revit context，再把人工批准后的具体操作转换成新的显式 Revit 预览计划；候选本身的 hash 不能代替聊天批准。

## 必须提供的标定

```json
{
  "scaleMmPerUnit": 100,
  "origin": {"x": 0, "y": 0},
  "offsetMm": {"x": 0, "y": 0, "z": 0},
  "rotationDegrees": 0,
  "levelId": 311,
  "sourcePlaneZ": 0,
  "sourceYAxis": "up"
}
```

`sourceYAxis` 对图片像素坐标必须明确为 `up` 或 `down`；不接受默认猜测。`sourcePlaneZ` 只可作为已审阅二维实体的显式 Z，未知 Z 不填 0。

## 图层/实体映射

候选映射只允许创建型操作：墙、楼板、轴网、族实例、管道或风管。不能映射删除、参数写入、加载族、任意脚本、宿主洞口或隐藏参数表。类型、族、系统、楼层和尺寸都必须显式提供；弧线、填充、曲线 bulge、非 XY 平面、缩放/镜像块、未知坐标系和自交轮廓保留为 `issues`，不会被强行变成直线或默认坐标。

每个返回操作都带来源实体 `provenance`；文本只作为未受信任证据返回，绝不是执行指令。返回 `candidateDigestSha256`、`candidateConsistency`、源实体数量、未映射数量、文本截断和问题列表，便于聊天中复核。

## 安全边界

- 默认导入根目录是仓库根目录，可用 `REVIT_AI_IMPORT_ROOTS` 配置本地目录；网络路径、URL、runtime 凭据、目录本身和超过 20 MB 的文件被拒绝。
- DWG 临时提取 JSON 在读取后删除，且输出目录必须位于包内 `imports`。
- 候选几何不是 native plan，不是工程合规证明，不是比例/楼层/族匹配成功证明。
- Revit 文档在候选转换前后必须保持 identity、revision、路径和 `isModified` 一致；变化则丢弃候选结果，不自动重试。

## 当前候选工作流状态

已完成候选解析边界、标定校验、候选来源 provenance、candidate-only 统一注册和图片人工视觉入口。尚未完成 AutoCAD 实机提取、真实图片视觉候选和后续 Revit 原生落模验收；发布状态保持“已实现但未验收”。

## 当前验证证据

本轮已通过固定 AutoCAD 提取脚本语法检查和 SDK/stdio 模拟契约，覆盖文档/版本变化、图片 Y 轴、2D 多段线原生高度、块缩放/旋转、曲率/坐标平面未知、局部文件根目录及 source text 不可信。实际 MCP 已对当前 Revit 使用合成 DWG 实体和合成图片实体返回候选；identity/revision/isModified/路径/元素统计不变，没有 planId、写入或自动保存。

这些合成输入不代表实际 DWG 提取成功或真实图片识别验收；它们的测试坐标未获批准用于模型执行。当前尚未在 AutoCAD 中运行提取器，也没有提交任何候选为 Revit 原生计划。所有真实工程标定/落模、完整回滚/副作用和图像识别验收仍单独完成。

标定先翻转明确的源 Y 轴，再绕 Z 旋转、缩放并偏移。块 rotation 以源弧度为输入；向下源 Y 轴会相应反向旋转，但未知原生法向或非单位缩放/镜像仍拒绝，不能把位置转换当作完整族几何转换。候选指纹只用于记录这次标定/映射/结果和证据内容，不是原始文件稳定性校验，也不是用户批准令牌。

AutoCAD 活动文件名、DBMOD 和实体数复查是有限的一致性证据，不是事务锁、内容哈希或磁盘重开验证；修改后的图纸若这些值碰巧相同，仍可能无法被检测。真实 DWG 验收须在用户保持图纸静止时完成，并核对标定和源实体。候选工作流的 Revit context 复查也不验证 DWG 原文件持久性。
