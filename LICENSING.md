# 许可范围与商业授权

本项目当前源码快照采用 **RevitAuto 非商业源码许可协议 1.0**：非商业学习、研究、测试和个人求职展示免费；公司内部经营项目、收费建模/咨询、转售、商业集成和商业托管均须作者事先书面授权。免费非商业修改与传播可以进行，但须保留许可、署名、来源和修改说明。

这属于源码可查看的软件，不是符合 OSI 定义的开源软件。完整条款见 [LICENSE](LICENSE)。授权申请入口：[GitHub Issues](https://github.com/unknown-sama-ff/revit-auto/issues)，提交申请本身不构成同意。

## 已经公开的 Apache 内容

历史公开基线：[635e543eb87204b0f58993986121176419c7e58d](https://github.com/unknown-sama-ff/revit-auto/commit/635e543eb87204b0f58993986121176419c7e58d)。该提交及其祖先已经公开的相应内容继续适用原 Apache-2.0 授权；原文见 [licensing/Apache-2.0.txt](licensing/Apache-2.0.txt)。本次许可不禁止他人依旧许可使用、修改或商用这些旧内容，也不要求这些旧内容的合法使用者重新取得同意。

[licensing/scope.json](licensing/scope.json) 列出相对基线新增或修改的文件及基线 Git blob。对于已有文件，只有许可人拥有权利的原创新增/修改受新许可约束；旧内容、第三方代码和独立作品不因此被重新授权。使用 Git 对比本次快照与历史基线可以定位新增/修改边界；文件清单不是对整个文件全部内容的独占权利声明。

## 第三方与素材

第三方 MIT、Apache 等许可继续有效，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和 [third_party/licenses](third_party/licenses/)。本许可不会把第三方已有代码的版权转移给项目作者，也不限制第三方组件在其原许可下的独立使用。模型、族、工程图、私有配置、原始验收记录、Autodesk/Revit 及其 SDK 组件不包含在本次源码授权内。

## 发布与验证边界

本次发布是开发中的源码快照；保留文档中各项尚未完成的原生验收与副作用限制。发布文档中的本机路径、模型名称和运行标识可以是匿名化示例，不应当作可重放的当前模型指令。自动化测试和编译不等于 Revit 原生业务验收。
