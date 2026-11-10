# DEV_RULES.md

# ST Image Plugin Gen2 Development Rules

Version: v1.2

Status: Frozen

---

# Rule 0 - Highest Priority

本文件高于所有 AI 自动建议。

如果 AI 提出的方案违反本规则，应直接拒绝。

---

# Rule 1 - Version First

任何开发任务开始前，必须明确：

* 当前版本
* 当前阶段
* 当前唯一目标

如果无法回答，则禁止开始开发。

例如：

Current Version

v0.2

Current Phase

MVP

Current Goal

调用 ComfyUI API

---

# Rule 2 - One Goal Only

每个版本只允许一个核心目标。

禁止：

一个版本同时开发：

Prompt

缓存

历史记录

模板

配置系统

UI 优化

这些必须拆分到不同版本。

---

# Rule 3 - MVP First

优先完成可以工作的最小版本。

不要提前：

优化

重构

抽象

封装

扩展

能够运行永远优先于代码优雅。

---

# Rule 4 - Rule of Three

重复代码：

第一次

保留

第二次

保留

第三次

允许考虑抽取

第四次

建议抽取

严禁提前建立公共框架。

---

# Rule 5 - Simplicity First

默认采用最简单方案。

如果存在：

方案 A

100 行

方案 B

300 行

默认选择方案 A。

除非方案 B 能明显解决当前问题。

---

# Rule 6 - No Future Design

禁止为了未来需求而开发。

以下理由无效：

以后可能需要

以后方便扩展

行业最佳实践

保持灵活性

提前支持

只有当前版本真正需要时才能实现。

---

# Rule 7 - File Budget

默认不新增文件。

新增文件前必须说明：

为什么现有文件不能承担该职责。

如果不能说明，则禁止新增。

---

# Rule 8 - Complexity Budget

每次开发任务：

允许：

新增少量逻辑

允许：

修改已有逻辑

禁止：

同时：

新增框架

新增模块

新增抽象层

新增系统

如果必须增加复杂度，应明确说明原因。

---

# Rule 9 - Architecture Freeze

未经批准，不允许新增：

Provider

Factory

Manager

Runtime

Pipeline Framework

Engine

Dispatcher

Registry

IOC

DDD

Event Bus

Plugin Loader

Middleware

这些默认全部禁止。

---

# Rule 10 - Documentation

任何开发完成后，只更新：

CHANGELOG

TODO

必要时更新 ROADMAP

禁止创建新的开发记录文档。

---

# Rule 11 - Task Size

每次开发任务建议：

30~200 行修改。

如果预计：

超过 500 行

必须拆分任务。

---

# Rule 12 - Refactor Rule

禁止：

开发过程中顺便重构。

重构只能发生在：

Refactor Phase。

其它阶段禁止整理代码。

---

# Rule 13 - Bug Fix

修 Bug 时：

禁止：

顺便：

优化架构

修改目录

调整命名

增加功能

Bug 修复只修 Bug。

---

# Rule 14 - Before Coding

AI 在开始编码前必须输出：

当前版本：

当前阶段：

当前目标：

影响文件：

新增文件：

删除文件：

完成标准：

不做什么：

得到确认后才能开始。

---

# Rule 15 - After Coding

完成开发后必须说明：

完成了什么

没有完成什么

是否增加复杂度

是否影响旧功能

是否需要 Smoke Test

禁止输出与本次任务无关的建议。

---

# Rule 16 - Document Authority

文档权限等级如下（从高到低）：

| Level | Document | 修改频率 | 职责 |
|-------|----------|----------|------|
| L0 | PRODUCT.md | 基本禁止 | 定义项目目标 |
| L1 | DEV_RULES.md | 极少修改 | 定义 AI 行为规范 |
| L2 | ARCHITECTURE.md | 极少修改 | 定义系统约束 |
| L3 | PROJECT_STATE.md | 经常更新 | 定义当前状态 |
| L3A | EVOLUTION_RULES.md | 极少修改 | 定义代码演进约束 |
| L4 | ROADMAP.md | 偶尔更新 | 定义未来版本 |
| L5 | CHANGELOG.md | 每次开发 | 记录历史 |

核心原则：

低等级文档不得推翻高等级文档。

例如：

- PROJECT_STATE.md 不能修改 PRODUCT.md 的目标
- ROADMAP.md 不能绕过 ARCHITECTURE.md 增加新架构
- CHANGELOG.md 只记录，不参与决策

---

# Rule 17 - Decision Levels

AI 在向用户提问前，必须首先判断问题所属等级：

| Level | 定义 | 行为 |
|-------|------|------|
| L1 | 现在必须决定 | 可以提问 |
| L2 | 出现需求再决定 | 不提问，采用默认方案 |
| L3 | 永远不提前决定 | 不提问，直接忽略 |

L2 例子：缓存方案、测试框架、历史记录、模板引擎
L3 例子：Provider、Runtime、DDD、IOC、Event Bus、Factory Framework

属于 L2/L3 的问题，AI 禁止提问。

---

# Rule 18 - State-Driven Development

AI 每次完成任务后，禁止问：

"接下来做什么？"

必须读取 PROJECT_STATE.md 的 Next Task 字段：

- 如果已定义下一步 → 直接执行
- 如果未定义下一步 → 才允许询问用户

AI 不得凭推断自行决定开发路线。

---

# Rule 19 - Project Budget

每个版本开始前必须声明预算：

预算维度：

- 新增文件：≤ N
- 新增模块：≤ N
- 新增公开 API：≤ N
- 新增依赖：≤ N
- 新增文档：0（除 CHANGELOG）

如果开发过程中超出预算，必须立即停止并报告。

Budget 在 Definition of Done 中声明。

---

# Rule 20 - Version Card

每个版本维护一张版本卡片，放入 PROJECT_STATE.md：

```
Version:       v0.1
Milestone:     Prompt Generation Capability
Current Task:  Create prompt.ts
Current Proof: None / Verified
Exit Condition: Defined (see Definition of Done)
Frozen:        No / Yes
```

版本卡片是唯一的状态摘要。任何 AI 应在 30 秒内理解当前版本状态。

---

# Rule 21 — No Proof, No Release

写完代码 ≠ 完成。
编译成功 ≠ 完成。
Lint 通过 ≠ 完成。

Capability Verified = 完成。

每个版本必须通过 Capability Gate 才能发布。

Capability Verification 必须通过 opencode 配置的 Playwright MCP 执行全量实际测试。
仅代码审查、编译通过、Lint 通过均不视为 Capability Verified。
测试结果必须记录在 Proof 文档中。

Playwright MCP 测试标准：
- 覆盖 Definition of Done 中定义的全部 End-to-End 场景
- 所有 Gate 条件必须标记 PASS
- 测试结果写入 Proof 文档后，方可进入冻结流程

---

# Rule 22 — Freeze Window

版本冻结前置条件：

冻结前必须满足：
- 当前版本的 Rule 21 (No Proof, No Release) 已通过 Playwright MCP 全量实际测试验证
- Proof 文档的 Gate 全部标记 PASS
- 上述条件不满足时，禁止标记版本为 Frozen

版本冻结后：

允许：
- Bug 修复
- 文档错误修正
- 注释修正

禁止：
- 重构
- 优化
- 命名调整
- 架构调整
- 功能增强
- 代码整理

例外：

若 Bug 修复会改变已通过 Proof 的能力或行为，
必须创建 Patch Version（例如 v0.1.1），
不得直接修改已冻结版本。

---

# Rule 23 — Controlled Evolution

代码结构演进必须遵守 EVOLUTION_RULES.md。

禁止：
- 因代码长度随意拆分
- 为未来需求提前抽象
- 创建未被证明需要的层级

文件拆分必须满足 Evolution Rules 定义。

---

# Anti-Patterns

禁止出现：

- 为未来需求设计
- 为可能变化抽象
- 为代码美观重构
- 为统一风格整理
- 为提高扩展性增加层级
- 为一次性方便建立框架

---

# Final Principle

AI 不是项目设计者。

AI 只是当前任务的执行者。

任何超出当前任务范围的建议，都应视为未授权开发。
