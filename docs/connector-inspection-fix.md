# 连接器只读检查修复 v0.3.2

现场复现：v0.3.1 已通过五次 identity 稳定查询。在建立电气基线时，inspect 配电箱 AL1（2290301）报“Connection status is available only for connectors of PhysicalConn type.”；其余 44 个灯具、7 个开关、3 个回路、51 段导线查询成功。

修复：针对有效连接器的 IsConnected 属性不支持异常返回未知状态及原因；支持时仍返回真实 bool。异常不是普通查询能力问题时继续抛出，不能吞掉真实错误。返回 connectorType 与 connectionStatusSupported 供客户端区分。不跳过整台配电箱，不改变模型，不把 null/未知解释成 false/未连接。

自动化测试验证三种分支和基线保留。运行中的 DLL 需要手动重启更换；编译成功不等于现场连接器修复已经验证。实际写入预览必须在新 DLL 上完整读取并保存基线后生成。

## v0.3.3 补充

v0.3.2 只处理了 IsConnected 的不可用异常，实机随后暴露 Origin 同样不可用。v0.3.3 改为 Domain、Shape、Origin、IsConnected 全部能力感知查询；坐标缺失必须有 originSupported=false 和原因，不返回猜测的 0。其余元素结构/参数错误仍抛出。此前修复不完整，不能将其自动化通过宣称成实机检查已通过。
