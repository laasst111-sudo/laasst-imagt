# PRODUCT.md

# ST Image Plugin Gen2

> **Project Constitution（项目宪法）**
>
> Version: v1.0
>
> Status: Frozen
>
> Last Updated: 2026-07-23

---

# 1. Product Vision

ST Image Plugin Gen2 是一个**仅供个人使用**的 SillyTavern 生图插件。

它的唯一职责是：

> 将 SillyTavern 聊天内容转换为适用于本地生图工作流的 Prompt，并自动调用 ComfyUI 生成图片。

除此之外，本项目不承担任何职责。

任何新增需求，必须首先证明它直接服务于上述目标，否则不属于本项目范围。

---

# 2. Target User

唯一目标用户：

项目作者本人。

本项目不考虑：

* 多用户
* 社区用户
* 企业用户
* 第三方开发者
* 通用插件市场

所有设计均以个人使用效率最高为第一目标，而不是通用性。

---

# 3. Product Goal

本项目希望解决的问题只有一个：

将目前需要人工完成的流程：

聊天

↓

整理描述

↓

复制 Prompt

↓

打开 ComfyUI

↓

提交生成

↓

等待图片

变成：

聊天

↓

点击一次按钮

↓

自动完成全部流程

↓

获得图片

整个过程尽量不需要人工复制任何内容。

---

# 4. Core Workflow

当前版本允许存在的核心流程：

SillyTavern

↓

读取聊天内容

↓
文本清洗

↓

Prompt 生成

↓

调用 ComfyUI API

↓

获取图片

↓

返回聊天界面

除此之外，不允许增加新的主流程。

---

# 5. MVP Definition

第一阶段（MVP）必须完成：

* 获取聊天内容
* 生成 Prompt
* 调用 ComfyUI API
* 返回图片

除此之外全部属于非 MVP。

MVP 完成以前禁止新增任何其它功能。

---

# 6. Success Criteria

当满足以下条件时，即认为项目成功：

用户阅读小说聊天。

点击一次按钮。

插件自动完成：

聊天读取

↓

Prompt 生成

↓

图片生成

↓

图片返回

整个过程中无需人工复制 Prompt。

如果能够稳定完成上述流程，则项目达到目标。

---

# 7. Explicit Non Goals

当前项目明确不会开发：

* 通用 Prompt 平台
* 通用 AI 平台
* 多模型统一管理
* Provider Framework
* Plugin Framework
* Workflow Framework
* 多工作流切换
* 云同步
* 用户系统
* 权限管理
* 数据库系统
* Web 后台
* 多设备同步
* 企业级部署
* 中间件框架
* IOC
* DDD
* CQRS
* Event Bus
* Service Locator
* Factory Framework
* 自动脚本平台
* 插件市场
* 在线配置中心
* 高可用集群
* 微服务
* 通用 SDK

如果未来需要这些能力，应建立新的项目，而不是继续扩展本项目。

---

# 8. Development Principles

## Principle 1

功能优先。

不要为了未来而设计今天不存在的问题。

---

## Principle 2

先完成。

再优化。

不要提前优化。

---

## Principle 3

简单优先。

能够使用简单方案解决的问题，不允许采用复杂方案。

---

## Principle 4

重复少于三次，禁止抽象。

只有当同一逻辑重复出现三次以上时，才允许考虑提取公共模块。

---

## Principle 5

任何新增复杂度都必须证明其必要性。

如果不能明显提升当前版本目标，则拒绝实现。

---

## Principle 6

任何版本都必须可以冻结。

每个版本结束后，应能够停止开发并继续长期使用。

---

# 9. Version Strategy

本项目采用版本驱动开发。

每个版本只允许一个核心目标。

例如：

v0.1

Prompt 生成

完成后立即冻结。

v0.2

ComfyUI 调用

完成后立即冻结。

v0.3

人物缓存

完成后立即冻结。

禁止多个核心目标同时开发。

---

# 10. Scope Control

任何新需求，在进入开发之前，都必须回答：

1. 是否直接服务于当前版本目标？

2. 是否可以推迟到未来版本？

3. 是否增加新的复杂度？

4. 是否存在更简单方案？

5. 删除该功能后，插件是否仍能完成核心目标？

如果第五个问题回答为：

"可以。"

则说明该功能不是当前版本必须开发。

---

# 11. Architecture Constraints

项目架构必须保持最小化。

禁止为了未来扩展而建立：

* Provider
* Runtime Framework
* Pipeline Engine
* Manager Tree
* Service Framework
* Plugin Loader
* Registry Framework
* Executor Framework
* Event Framework

只有在当前版本已经出现明确需求时，才允许增加新的模块。

---

# 12. Documentation Rules

整个项目文档保持最小数量。

允许长期维护：

* PRODUCT.md
* README.md
* ROADMAP.md
* DEV_RULES.md
* CHANGELOG.md
* TODO.md
* ARCHITECTURE.md

除非必须，否则禁止新增文档。

---

# 13. Final Principle

任何人（包括 AI）都不得为了：

未来可能需要

保持扩展性

行业最佳实践

企业级架构

通用平台

而扩大当前版本范围。

如果一个设计不能帮助用户更快完成：

聊天

↓

Prompt

↓

ComfyUI

↓

图片

则默认拒绝。

本项目始终遵循：

> 一个用户、一个目标、一个版本、一件事情。

以上原则高于其它所有开发建议。
