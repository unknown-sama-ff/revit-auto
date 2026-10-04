# v0.3.3：身份与连接器检查修复、真实写入／回滚验收

## 状态与信任边界
源码/编译/自动化回归已完成，不等于真实模型写入已验证。Revit 需要保存工作后手动重启才会加载新程序集。项目原文件不写入，测试不自动保存，聊天确认一次即可，无 Revit 二次弹窗。

补充修复：配电箱连接器可能不支持 IsConnected。连接状态、坐标、形状和域查询均返回明确的能力状态和原因，不猜测为未连接或零坐标，不丢弃其他数据。

修复覆盖不同托管包装对象的身份、当前文档比较、成功关闭/取消关闭、DocumentChanged revision。Document.IsModified 明确返回；revision=0 不是未保存状态保证。

## 固定测试副本
已准备文件：
D:\Desktop\revitt\revit-auto\acceptance\models\照明模型+方昱-验收-v031.rvt

这是原文件的磁盘副本，不包含未保存的内存修改。不得用保存副本的操作覆盖原项目。原文件：D:\Desktop\revitt\考生文件夹\照明模型+方昱.rvt。

## 阶段 1：只读身份检查
保存工作、重启并打开测试副本后：

~~~powershell
node D:\Desktop\revitt\revit-auto\mcp\identity-acceptance.mjs probe
~~~

必须识别新版、documentIdentityPolicy=native-session-equality；准备/核验还要求 connectorInspectionPolicy=capability-aware-v2（v0.3.3）。五次 context 的 identity/revision/路径/数量一致。不满足则停止，不跳过 identity 校验。

## 阶段 2：分别生成预览

~~~powershell
node D:\Desktop\revitt\revit-auto\mcp\identity-acceptance.mjs prepare write --project D:\Desktop\revitt\revit-auto\acceptance\models\照明模型+方昱-验收-v031.rvt --state D:\Desktop\revitt\revit-auto\acceptance\write-v031.json
~~~

核对灯具 2290242 的标记必须为 OFF1-01，读取注释原值，再预览将其写为 AI_WRITE_TEST。把预览展示给用户；聊天批准后助手提交原 planId，不重建计划、不额外弹窗。

~~~powershell
node D:\Desktop\revitt\revit-auto\mcp\identity-acceptance.mjs verify --state D:\Desktop\revitt\revit-auto\acceptance\write-v031.json
~~~

写入完成后才准备回滚测试，避免前一次修改导致另一份预览陈旧：

~~~powershell
node D:\Desktop\revitt\revit-auto\mcp\identity-acceptance.mjs prepare rollback --project D:\Desktop\revitt\revit-auto\acceptance\models\照明模型+方昱-验收-v031.rvt --state D:\Desktop\revitt\revit-auto\acceptance\rollback-v031.json
~~~

核对灯具 2290243 为 OFF1-02。三个计划步骤：修改注释 → 删除灯具及已展示的依赖项 → 再访问该灯具以触发执行期失败。用户核对影响清单并在聊天批准后提交。

~~~powershell
node D:\Desktop\revitt\revit-auto\mcp\identity-acceptance.mjs verify --state D:\Desktop\revitt\revit-auto\acceptance\rollback-v031.json
~~~

验收必须同时满足：failed/execution_failed、rolledBack=true、completedOperationCount=2、failedOperationIndex=3，且灯具 uniqueId、原注释、所有电气实例 ID 集合、回路成员/配电箱、导线和连接器与基线一致。预览拒绝不算回滚通过。计划 get 包含失败收据，超时后先查询，不自动重新提交。

验收脚本只做 probe/prepare/verify，不会自行 confirm/import_commit。记录文件写入使用新建模式，已有文件不覆盖。planId 15 分钟过期时重新生成并重新审核；不能给未展示的新计划套用旧授权。

成功写入不会自动恢复注释或自动保存。测试副本允许保留 AI_WRITE_TEST 供核验；清理也需要一个新的聊天批准计划。检查后可由用户不保存关闭测试副本。
