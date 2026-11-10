> 发布副本说明：本机路径、模型名称及运行标识已匿名化。原始私有证据未随源码发布；历史验收不代表当前会话授权或完整业务认证。

# 标准写入验收记录契约

本契约延续既有“预览 → 聊天批准 → 单次提交 → 原生回读 → 人工保存/重开 → 归档”流程，只统一证据字段。新增共享生产函数位于 `mcp/acceptance-evidence.mjs`，也从 `mcp/acceptance-run.mjs` 导出；JSON 形状见 `mcp/run-evidence.schema.json`，完整绑定检查见 `mcp/acceptance-archive.mjs`。

这些函数只生成普通 JSON 对象，不读写文件、不连接 Revit、不验证聊天身份、不创建执行许可，也不会 Confirm、保存、重启或升级验收状态。调用方仍须先核实真实聊天批准，并在发送 Confirm 前用 `wx` 持久化独立 attempt；函数返回一个 attempt 对象并不构成排他锁或发送授权。

## 固定字段

| 记录 | 必须使用的字段及语义 |
| --- | --- |
| manifest | 预览取得 planId 后，在请求用户批准之前绑定同一 planId、基线文档和模块；初始化时仍允许为空，不虚构计划。 |
| preview | `preview` 保存完整原生计划；`previewSha256` 是 `SHA-256(JSON.stringify(nativePreview, null, 2))`，不加末尾换行；`previewDigestScope` 固定为 `native-preview-pretty-json-v1`。 |
| confirmation | 原样记录 `approvedText`，同一 run/task/plan/文档和 `previewSha256`，`confirmCalls=1`；不能从摘要、测试报告或另一次批准推断许可。 |
| attempt | 新记录使用 `artifactType=attempt`、明确 attemptId、相同预览摘要与文档、`reservedAction=revit.plan.confirm`、`confirmCalls=1`。旧版 `artifactType=execution` 仍由归档器按原有绑定规则检查，不补写历史内容。 |
| execution | `documentBefore` 保存提交前会话；`receipt` 保存完整实际原生回执；`sideEffectCounters.confirmCalls=1`，attemptId 绑定原独占标记。失败回执按实际保存，不能用 committed 归档模板冒充失败回滚验收。 |
| visual.images | 每项包含相对 run 的 `file`、实际 `bytes`、`sha256`、`widthPixels`、`heightPixels`；字节数和尺寸从归档 PNG 读取，不手填。文件头核验不代表完整像素解码或视觉验收。 |
| summary | 已提交写入 profile 使用 `acceptance.confirmCalls=1`；其余验收布尔值和 currentState 必须来自独立判断，不能因哈希或格式正确自动通过。所有源文件摘要在归档完成后索引。 |

整份 `preview.json` 文件的摘要可另记为 artifact 摘要；它与原生预览 payload 摘要不是同一数值。两者不能默默换用。历史四墙 run 使用了整份文件摘要及另一套字段位置，保持原始审计失败与追加说明，不能为使检查通过而更改当时的批准绑定。

## 共享生产函数

```js
import {
  createPreviewEvidence, createConfirmationEvidence, createAttemptEvidence,
  createExecutionEvidence, describeEvidencePng, createSummaryEvidence
} from '../mcp/acceptance-run.mjs';

// nativePreview 来自当前实际 Revit 预览；这里不会创建任何原生计划。
const bound = createPreviewEvidence({ manifest, baseline, nativePreview });
// 调用方先归档 bound.manifest / bound.preview，再展示具体计划请求批准。

// 下列调用只应在真实用户批准该计划后进行。
const confirmation = createConfirmationEvidence({ preview: bound.preview, approvedText });
const attempt = createAttemptEvidence({ preview: bound.preview, confirmation, attemptId });
// 先将 attempt 写入排他的 wx 文件，复核原计划，再由原有受控客户端单次 Confirm。

// receipt 必须是已经获得的完整真实回执；此调用不执行模型操作。
const execution = createExecutionEvidence({ preview: bound.preview, attempt, documentBefore, receipt });

const image = describeEvidencePng({ file: 'visual/fixture.png', content: actualPngBytes });
const summary = createSummaryEvidence({ execution, currentState, acceptance, sourceArtifactHashes });
```

共享生产函数拒绝 unknown/未保存基线、过期或改动的预览、错位 identity/revision、模块不一致、阶段时间倒置、重复确认计数、非法文件引用和非有限 JSON。`createSummaryEvidence` 仅适用于已 committed 的标准写入归档，保留调用者提供的验收结论；失败/回滚 run 继续按对应验收任务记录，不能套用该 committed profile。

原生回读、保存和重开仍须归档完整原始结果，分别比较模型字段、会话字段、界面状态及磁盘文件摘要；文件版本不同不能被模型字段一致性掩盖。函数也不能恢复缺失的历史前值、解释系统元素修改或认证工程合规。

## 验证范围

- 模拟端到端：真实调用 run 初始化和这些生产函数，生成阶段 JSON/PNG 元数据，通过 JSON Schema 2020-12 和严格归档绑定检查。
- 失败路径：错计划/错会话、过期/改动预览、倒置时间、模块变化、重复确认、缺关键字段、非法 PNG/相对路径及伪造 summary 计数均被拒绝。
- 历史只读回放：四墙 run `b836c349-e3c4-46fd-acf9-d3d5532f0db8` 原文件与摘要不变，严格 audit 继续报告原有 11 项；原生系统项阻塞及限定持久化/视觉结论保持。

本轮为离线编排契约修复，不包含 DLL 编译、插件注册、Revit 会话、计划或模型写入。模拟通过只能进入 `core-tested`，不能代替下一次真实能力验收。
