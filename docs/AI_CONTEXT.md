# AI_CONTEXT.md

# ST Image Plugin Gen2

> **AI Context Guide**
>
> 本文件不是项目介绍，也不是开发规范。
>
> 它用于告诉 AI 如何理解整个仓库，并规定 AI 在参与开发时必须遵循的阅读顺序、思考方式和执行流程。
>
> 所有 AI（包括 Claude Code、Gemini CLI、Codex、Cursor 等）在开始任何任务前，必须先阅读本文件。

---

# 1. Purpose

本文件用于帮助 AI 快速建立正确的项目上下文。

目标不是介绍项目，而是确保不同 AI 对项目保持一致理解，避免因上下文缺失导致：

* 擅自扩大开发范围
* 引入不必要的架构
* 修改已冻结的设计
* 重复开发已有功能
* 偏离当前版本目标

---

# 2. Required Reading Order

AI 必须严格按照以下顺序阅读项目文档：

1. `PRODUCT.md`
2. `DEV_RULES.md`
3. `PROJECT_STATE.md`
4. `ARCHITECTURE.md`

禁止跳过前三个文档。

如果文档之间存在冲突，以阅读顺序靠前的文档为准。

---

# 3. Single Source of Truth

项目任何时刻只有一个真实状态来源：

`PROJECT_STATE.md`

AI 不得根据：

* CHANGELOG
* Git Commit
* 历史文档
* 临时记录
* 推测

判断项目当前状态。

所有开发均以 `PROJECT_STATE.md` 为准。

---

# 4. Frozen Documents

以下文档默认被冻结：

* PRODUCT.md
* DEV_RULES.md

AI 不得主动修改。

只有项目负责人明确要求时，才允许更新。

---

# 5. Allowed Modification Scope

AI 默认允许修改：

* `src/`
* `tests/`
* `TODO.md`
* `CHANGELOG.md`
* `PROJECT_STATE.md`（仅在规定场景下）

默认禁止修改：

* PRODUCT.md
* DEV_RULES.md
* ROADMAP.md
* ARCHITECTURE.md

除非获得明确授权。

---

# 6. Development Boundary

AI 必须始终围绕当前版本目标工作。

任何需求都必须回答：

* 是否属于当前版本？
* 是否属于当前阶段？
* 是否直接服务于核心工作流？

如果任意一个答案为 **否**，应停止开发，并说明原因。

---

# 7. Standard Workflow

每次开发必须遵循以下流程：

1. 阅读项目文档
2. 确认当前版本
3. 确认当前阶段
4. 明确本次唯一目标
5. 分析影响范围
6. 编写代码
7. 更新必要文档
8. 执行 Smoke Test
9. 更新 `PROJECT_STATE.md`

不得跳过流程。

---

# 8. AI Behavior Principles

AI 在整个项目中承担执行者角色，而不是产品设计者。

AI 不应：

* 主动扩大需求范围
* 引入未来版本设计
* 擅自优化架构
* 增加抽象层
* 创建未经批准的新模块

如果认为存在更优方案，应先提出建议，而不是直接实现。

---

# 9. Decision Priority

当多个信息来源发生冲突时，优先级如下：

1. PRODUCT.md
2. DEV_RULES.md
3. PROJECT_STATE.md
4. 用户当前指令
5. 其它项目文档

AI 必须遵循优先级更高的内容。

---

# 10. Final Principle

AI 的职责是帮助项目按计划推进，而不是改变项目方向。

任何未被授权的扩展、重构或架构升级，都应视为超出当前任务范围，并默认拒绝执行。
