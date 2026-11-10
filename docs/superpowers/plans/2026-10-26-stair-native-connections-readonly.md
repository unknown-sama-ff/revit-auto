# 楼梯原生连接只读查询实施计划

设计：`../specs/2026-10-26-stair-native-connections-readonly-design.md`。
批准来源：`request_user_input_async call_93d3349d600140e0aee9ae57d70aabdc item0`，用户回复“批准该只读连接设计并实施”。

1. 冻结设计调查、现有组件读取和当前加载DLL/保存模型证据，保留全部旧楼梯结论。
2. 先写纯核心请求/有界读取/未知与互认测试，以及实际SDK的旧主机拒绝/新只读接口测试，保留红测。
3. 实现独立纯规则和原生GetConnections服务，在UI线程逐项检查pin、取消及预算；冻结所有原生记录，不去重或推断反向边。
4. 接入router/独立feature、Node严格输入输出、SDK工具和readonly-batch允许表；不改原创建/事务逻辑。
5. 跑CoreTests、定向及全量MCP，使用新版本目录编译Revit2027.3、CheckOnly和源码自审；修复后仅重跑受影响检查。
6. 冻结DLL SHA/MVID、来源、日志和限制；准备可审核的具体注册材料，但不执行注册。批准范围不包括新的模型计划、Confirm、保存或重启。
7. 日后具体构建获准注册并手动加载后，才在既有楼梯上完成真实只读验收。当前不把编译或mock当作实机通过。

验收重点：known空与unknown不同；原始重复/异常关系保留；完整图双向ID/端点互认，部分图unknown；只有声明范围的只读关系合同，不提升整楼梯物理、栏杆/支撑、副作用或工程认证。
