# 受控只读元素依赖证据

## 问题与授权范围

柱类型复制已单次提交，保存及关闭重开的完整已读范围核验通过。原生事件还记录了一个无类别的附加 Element；本设计提出时 inspect 字段不能证明其用途或与新类型的关联。原功能对等迁移计划包含类型审计、完整原生核验和受控只读接口，本项补齐这些证据，不增加模型写入权限。下述最新实载查询已取得原生逻辑关联证据，附加元素用途仍未证实。

本设计只收集原生逻辑依赖和族类型成员。依赖关系不等于附加元素无害，不填补复制前不存在的附加元素基线，不认证回滚、全模型副作用或完整功能验收。

## 方案选择

采用独立 `revit.element.dependencies` 查询及只读 MCP 工具，保留现有 inspect 快照 schema。这便于将新关系证据与既有完整快照独立复核。扩充 inspect 会改变已有验收格式；通过删除预览探测关系会把只读审计带入写入规划，两者均不用于本项。

## 请求

请求严格包含 `documentIdentity`、`expectedRevision`、`elementIds`。identity 为非空字符串；revision 为非负安全整数；elementIds 为 1..20 个唯一正安全整数，拒绝未知字段、重复 ID、字符串 ID 和越界数值。查询固定在当前活动项目的原生 UI 线程上下文执行。

## 原生响应

响应包含 `documentIdentity`、`documentRevision` 和按请求顺序返回的 `items`。每项包含 `elementId`、`exists`、`summary`、`dependencies` 和 `familySymbols`。

存在项的 summary 返回原生 id、uniqueId、name、className、typeId、ownerViewId、levelId；后面三项允许有效的原生负值，例如 -1。category/categoryId 原生未知时保留缺失或 null，不造默认类别。summary getter 的未知异常传播。缺失项明确 summary=null、exists=false，不认证其读取完整。

dependencies 只读取 `GetDependentElements(null)`；familySymbols 仅对原生 Family 读取 `GetFamilySymbolIds()`。每集包含 supported、complete、ids、count、truncated=false，可附非空 reason；familySymbols 另有 applicable。完整列表排序且 ID 唯一，保留 API 返回的自引用，不过滤缺失或非法 ID。有效空集合必须 supported=true、complete=true、count=0；缺失项、已知不支持、非 Family 不得用空列表宣称完整，返回 supported=false、complete=false、ids=[]、count=null 和明确原因。

每列表最多 4096 ID，一个请求的全部 dependencies 与 familySymbols 列表长度合计最多 16384，跨列表重复仍计数，不递归扩展依赖图。完整原生成功响应封装含 CRLF 最多 2 MiB UTF-8；超限直接拒绝，不截断。原生另有 20 秒协作读取预算检查，不承诺硬中断每个 API 调用。未知异常与取消传播，只有明确 NotSupportedException 可以降级为不支持。显式 summary/count null 用本接口专用序列化字段保留，不改变全局 JSON 选项。

返回固定 `relationshipScope=native-logical-dependents-and-family-symbol-membership`、`modelWritesRequested=false`、`automaticSave=false`、`allModelSideEffectsVerified=false`。该响应不表示全依赖图、净模型差异或安全结论。

## 稳定性与接口门禁

原生查询前后检查活动文档等价、identity、revision、路径、isModified、isReadOnly 和原生可修改状态；失败或取消不返回成功。UI 线程内将所有原生数据冻结为 JSON，桥接线程不再枚举 Revit 对象。

MCP 同样检查请求与前后 context 的 identity/revision/path/isModified/readOnly，并严格验证响应结构、列表完整性、数量、顺序与固定只读声明。新能力门禁为 `bounded-element-dependencies`；未加载该能力的旧插件在查询发送前拒绝，不创建计划。MCP 工具声明 readOnlyHint=true、destructiveHint=false；不提供任意脚本、事务、删除探测、激活、计划创建/确认、保存或文档打开路径。

## 验证与推进

实现包含原生纯规则测试、MCP 请求/响应正反测试、旧插件门禁、取消和文档变化测试及 SDK 工具契约。使用安装的 Revit 2027.3 API 隔离编译，保留当前运行 DLL 和注册。源码/模拟通过不能当作原生关系已读取。

准备具体隔离 DLL、保存后完整模型基线及只改变 Assembly 的注册申请，独立复审后由用户批准具体注册；用户手动重新加载插件后再验证模块、能力及全部已读范围。随后只读查询源类型、源族、新类型和附加元素的四个方向，两轮复核关系、完整快照及文件摘要。即使显式关系得到证明，整体验收的限制仍保留。

## 2026-10-10 实际加载及原生关系结果

源码双审、CoreTests 233/233、MCP 全量 714/714 通过。首次隔离编译因默认 API 路径不存在失败；纠正为本机实际 Revit 2027.3 API 后编译 0 警告、0 错误，CheckOnly 通过，首次失败保留为历史。具体申请经只读独立复审和本次用户批准后只注册一次；用户手动重启后，实际模块指纹与获准构建一致，`bounded-element-dependencies` 已加载。

私有证据 `runtime/element-dependencies-loaded-1791644043265.json` 的状态为 `ELEMENT_DEPENDENCIES_LOADED_SAVED_SCOPES_AND_NATIVE_RELATION_READS_VERIFIED`。新会话 revision=0、isModified=false，文档状态与已保存文件摘要前后稳定；完整 134 项范围、29 项柱/轴网、236 个实例、24 个旧类型、源族、新类型及附加元素两轮读回与已保存基线一致，AL1 保存位置 X≈398.5/Y≈568 mm 不变。`loadedModuleVerified=true`、`savedReadScopesVerified=true`、`readScopePersistenceVerified=true` 只限实际模块和已读取范围。

依赖响应和33项关系范围的两轮原始结构一致；134项完整范围与236项实例范围存在原生无序列表的读取顺序差异，使用既有完整规范化排序参数、连接器/peers、电气 systemIds/memberIds 并将 -0 规范化为0后一致。比较保留全部字段、重复项、未知状态、有序几何与其它数组，不以剔除字段或原始 JSON 字节相等宣称范围通过。

四个显式根的两轮原生依赖响应一致且完整、未截断：源类型列表为 2 项（含自身及一个既有元素）；源族列表为 33 项，族类型成员为 6 个 FamilySymbol 并包含源类型与新复制类型；新复制类型与附加 Element 的列表各为 2 项，均包含自身与对方。33 项关系范围另作两轮完整 inspect，前后一致。非 Family 的 familySymbols 仍 applicable=false、reason=not_family、count=null，不解释为零类型。

`dependencyEvidenceComplete=true`、`nativeRelationshipVerified=true`、familyIncludesSourceAndCopy=true，证明此次明确原生逻辑关联和族成员关系。附加元素仍是无类别的 Element，typeId/ownerViewId/levelId 为原生 -1；`additionalElementPurposeVerified=false`、baselineAvailable=false、classification=unresolved。已存在同名元素及关系模式也不能证明其用途或无害性，缺失的复制前附加元素基线不能由本次读取补出。

本次探针 modelWritesRequested=false、confirmationCalls=0、planCreationCalls=0、automaticSave=false、automaticRetry=false，没有重复提交或自动保存。`typeCopyExecutionAccepted=false`、`allModelSideEffectsVerified=false`、全局 `closeReopenPersistenceVerified=false`，rollbackVerification 仍 pending；已读范围持久化与关系核验不代表完整副作用、回滚或模型验收。PNG 整图版面仍 `wholeSheetLayoutAccepted=false`，禁止重复移动 AL1。

用户随后选择允许仅当前本地测试副本的自动保存/重启流程，该受限流程尚未实现或执行；此次实载来自手动重启。该选择不扩展至任意项目，不改变本独立依赖查询的只读契约，也不能记录为自动保存或重启的实机验收。
