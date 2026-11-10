> 发布副本说明：本机路径、模型名称及运行标识已匿名化。原始私有证据未随源码发布；历史验收不代表当前会话授权或完整业务认证。

# 楼梯原生连接只读查询任务卡

- taskId：`architecture.stair-connections-readonly`
- 来源：既有楼梯两跑/平台连接证据缺口，不是新建楼梯任务。
- 依赖：`foundation.current-session-readonly-batch`；关联任务 `architecture.stairs-explicit`。
- 当前状态：readonly-accepted。新DLL原生只读验收及当前聊天直接工具入口均已通过；客户端入口阻塞已于2026-10-27解除，无需再重开Codex或重启Revit。
- 设计：[2026-10-26-stair-native-connections-readonly-design.md](superpowers/specs/2026-10-26-stair-native-connections-readonly-design.md)
- 当前调查：[current-stair-scope.json](../acceptance/preparations/stair-connections-20261026/current-stair-scope.json)

原调查确认Revit2027.3提供梯段/平台GetConnections及双端组件ID/端点类型，旧StairGeometryService回读和通用inspect缺该数据。现在已对当前副本的三个Stairs取得真实原生connection记录，原始响应和SDK对照见 `acceptance/runs/fc301d40-4fb4-40d2-affd-d4080d1f63b3/`。

实施批准来源：`request_user_input_async call_93d3349d600140e0aee9ae57d70aabdc item0`，回复“批准该只读连接设计并实施”。范围为独立只读查询、纯规则/SDK测试与版本化隔离编译；模型计划、Confirm、保存、自动重启和插件注册均不在此批准内。具体构建注册仍须独立批准。

阶段：登记/契约/核心实现/模拟测试/隔离编译及真实只读连接验收完成。Core365、相关MCP42和全量MCP1015通过/1可选OS smoke跳过是冻结的离线测试记录；本次另实际运行只读验收命令，3套楼梯与3类原生拒绝检查通过。新MVID6c6449ca/PID46340已实载，identityc6a16501/revision0/未修改；预览、写入、保存重开和视觉不适用本查询。

互认以组件端点ID配对，不假定原生记录第一端就是当前查询对象；同向或反向存储都要求两端各自真实枚举到该关系。未来未知端点类型保持unknown，原始记录不改写。原创建/事务代码未改变。

恢复时曾出现ECONNREFUSED且无Revit进程，旧状态保留为历史观察。用户随后手动启动并打开隔离副本，当时PID30568、identity763c4cab…/revision0/未修改、加载f89。该阶段100scope/623完整快照与旧公开范围一致；保存文件摘要08855662…不同于历史c99，原因未明，当时读期间大小/时间/摘要稳定。不覆盖旧文件证据，也不转移旧模型计划批准。

最终构建：`bin/Release/stair-native-connections-20261026T125434Z/`，MVID `b7b916fa-05da-4bf3-a8b9-0adf5cdcb1eb`；302项来源和8份日志已冻结，原创建/事务/生命周期代码未改变。注册申请 `f72e9c12cbf67ca6b761c71cefb590b9`、SHA256 `E00F42DC15BA51B84E8652776DF2BF8E078FC0BEAD45BD868269DABEDDAECCC0` 已获 `call_d45de4b004a74495ba516bbfc631f44d item0` 明确批准并单次执行，Confirm/attempt/receipt各1。回执REGISTERED_MANUAL_RESTART_PENDING只表示注册时状态，后续已手动载入6c；不得据此历史回执再次注册或要求重启Revit。

注册后只读复核：同PID30568/identity763c4cab/revision0/未修改，计数/活动视图/选择保持；模型磁盘08855662摘要/大小/mtime不变。注册阶段没有模型计划、写入、保存或重启动作。原申请及旧准备/审查记录不改写，后续不得再次调用本申请的注册执行器。

注册准备记录的sourceCount/logCount曾因PowerShell枚举生成计数数组，已用独立追加的 `registration-count-review.json` 更正为302/8；原准备文件、请求字节及SHA保持不变，不重建申请。

新只读query runId为fc301d40-4fb4-40d2-affd-d4080d1f63b3，不借用旧楼梯创建run。原6b871059计划不得重放。当前2296092两跑2296093/2296097与平台2296101原生互认，4条有向记录代表2对关系；2290014同样为2跑/1平台/4条记录；2295913无平台、两跑均返回known空连接，不把这种空集合称为物理连通。

100项既有范围和623份完整快照与注册前公开数据严格相等，原始raw/SDK/重复读取相等；错误identity、revision和非楼梯ID的原生拒绝通过。RVT08855662摘要/大小/mtime、当前文档状态均保持，所有模型计划/Confirm/写入/保存/重启/注册调用为0。只读证据补齐不解除旧楼梯PNG、支撑/栏杆、隐藏副作用及整体物理/工程认证限制。

当前会话只暴露39个revit_custom工具，新SDK会话暴露40个，唯一缺项为revit_stairs_connections；工具绑定函数也未提供。已确认客户端配置指向正确项目，没有改配置或终止MCP/Revit进程。建议完成本轮后完全退出并重开Codex以刷新当前会话工具清单；Revit保持打开，避免重复模型/插件操作。新SDK实际通过不能冒充当前聊天直接工具绑定已通过。

实际运行：`node .tmp/accept-stair-connections-loaded-20261026.mjs`，111次SDK工具调用及10次显式桥接逻辑调用；离线复算 `node .tmp/audit-stair-connections-native-20261026.mjs` 通过，128项产物已索引。一个低效只读审计进程被终止后改用线性请求绑定并成功复算，没有重读Revit或改写原始观察；错误identity注入能使绑定检查失败。


## 2026-10-27 当前聊天直接入口核验完成

用户重开Codex后，当前工具清单为40项，revit_stairs_connections已可直接调用。只读取一次楼梯2296092，当前新identity c3958b5184001320c6a643bf13703ace、revision0、isModified=false；两跑与平台共4条有向记录、2对互认关系，无issue。与旧报告在明确重绑定documentIdentity后逐字段严格一致，完整context前后相等，故解除本任务唯一的客户端入口blocker。

追加证据为同run目录的client-entry-observation-20261027.json、client-entry-verification-20261027.json及client-entry-evidence-index-20261027.json；原128项索引、summary和旧会话观察保持不变。本次没有复跑100scope/三楼梯验收，没有重查当前加载指纹，不把历史PID/MVID当本次测量；没有模型计划、Confirm、写入、保存、注册或重启。楼梯整体副作用/物理接触/支撑栏杆/PNG及失败回滚缺口保持。上文39项工具和重开建议仅为历史记录，已由本条追加核验闭环。
