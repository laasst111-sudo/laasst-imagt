# PROJECT_STATE.md

# ST Image Plugin Gen2

> **Single Source of Truth**
>
> 本文件是整个项目唯一有效的当前状态。
>
> 所有 AI 在开始任何开发任务前，必须首先阅读本文件。
>
> 如果本文件与同级或更低等级文档(L3-L5)冲突，以本文件为准。高等级文档(L0-L2)始终保持优先。

---

# 1. Current Status

Project Status

Frozen (v2.3.1 阶段6/7 严格审查修复 + v2.3 生成管线 tab 深度优化 — 已冻结)

Current Version

v2.3.1 (Frozen)

Current Phase

冻结 — v2.3.1 阶段6/7 严格审查修复（十项静默缺陷 / 形态双轨收敛 / 段序语义纠正 / 死代码清理 / 管线预览）

Current Milestone

v2.3.1 — 阶段6/7 严格审查修复（见 CHANGELOG.md v2.3.1）

Project Health

✅ 静态 Gate 全过（tsc / eslint / dist）
✅ 离线断言全绿（严格格式 25/25 · 管线 17/17 · 柏宝书 38/38 · 链路 A/B/词库 B/P0 各 8/8 · v2.3 POV 18/18 · v2.3 阶段5 15/15 · **v2.3 阶段6/7 回归 23/23**）
✅ 阶段6/7 审查探针 30/30（一次性探针，覆盖回退路径与十项缺陷的修复前后对比）
✅ 运行时实测（真实 ST 127.0.0.1:8000 · 浏览器实测）：生成管线 tab 渲染（阶段6/7 模块树已按新结构呈现 · 标签预算编辑器就地挂载且回填 25 · 预览阶段5-7 按钮可用并返回预期提示）· 控制台无 image-st 报错
⚠️ 未做完整出图矩阵（三模式 × 审核开关）→ 沿用 v2.2 遗留项，留待后续复测

---

# 1.5 Version Card

## v2.3.1

| Field | Value |
|-------|-------|
| Version | v2.3.1 (Development) |
| Milestone | 阶段6/7 严格审查修复：**①** 标签预算截断对象错位（回退路径删环境行）**②** 景别冲突告警在标签链下恒不触发 **③** 自然语言语义分叉不可见 **④** 跨段去重吃掉描述段 + 删除 `resolve.dual_dedup` **⑤** 情绪/过程词对下划线多词标签失效（+词表与描述对齐）**⑥** 阶段7 诊断无归因/单位混用/未执行却显示已执行 **⑦** 前缀去重误删语义不同标签（默认关+收紧+告警）**⑧** 权重映射对别名归一失效 + 人数标签跳过 **⑨** 词库校验对自然语言段误报 **⑩** 句子段中文残留无告警 → 阶段8 归因报错 + 删除 v2.0 遗留死代码（`postProcessCommon` / `formatPromptExtTool`） + 预算可配 + `pp.budget`→`fmt.budget` + **管线预览**（阶段5-7 逐段产物，离线不调 LLM） |
| Current Task | ✅ 实现完成 — pipeline.ts（阶段6/7 重构：kind 分流 / 预算目标段 / fmt 逐模块报告 / 语义路径报告 / 迁移 id 归域 / 删 dual_dedup）/ promptPost.ts（kind 字段 / 形态归一 / 段内去重+跨段告警 / 标签原子性删除 / 场景形态归一 / 校验收窄 / 删死代码）/ index.ts（预算可配 / CJK 归因 / 抽取缓存 / 管线预览）/ ui.ts + settings.html（三态诊断 / 预算编辑器 / 预览区）|
| Current Proof | ✅ 静态 Gate 3/3（tsc + eslint + dist）✅ 离线断言全绿（新增 v2.3 阶段6/7 回归 23/23；严格格式 25/25）✅ 修复前后探针对比 30/30 ✅ 运行时实测（真实 ST 浏览器实测：管线 tab 渲染 / 预算编辑器回填 / 预览按钮可用 / 控制台无 image-st 报错） |
| Evidence | CHANGELOG.md v2.3.1 · docs/Definition of Done v2.3.1.md |
| Exit Condition | 静态 Gate 3/3 + 离线断言全绿 + 运行时面板实测 → 已达成（2026-10-20） |
| Frozen | Yes |

## v2.3

| Field | Value |
|-------|-------|
| Version | v2.3 (Frozen — 未单独发布，随 v2.3.1 一并冻结) |
| Milestone | 生成管线 tab 深度优化：模块树即入口（编辑器就地挂载） + 阶段1/2 只读状态徽标 + 单一开关原则（收敛 llm.review / review.format_guard / tagtool_enabled） + POV 开关接入运行 + **POV 判定重写（误判防护 / 不删错人 / 三态 / 可观测）** + **阶段5 解析分流重构（词库口径 / 段序 / 预算可见 / 段结构安全网）** + 移除 NSFW 适配块 + 词库按钮重排 |
| Current Task | ✅ 实现完成 — pipeline.ts（statusOnly + getModuleStatus + 一次性对齐 + 阶段5 重构 + fmt 阶段归位）/ settings.html（管线 tab 重构 + 5 个编辑器模板 + 诊断区）/ ui.ts（renderPipelineModules 重写 + 事件委托 + 词库逻辑归位 + showPipelineReports + 规则生成文案）/ promptBuilder.ts（触发词规则表 + 三态判定 + 剔除容错 + describePovTriggers）/ lexicon.ts（normTag 下划线还原 + 质量词白名单 + 阶段排序）/ promptPost.ts（isUsableTag + 校验告警放宽）/ promptPreset.ts + index.ts（NSFW 移除 + 审核/POV 开关接入 + POV 阶段报告） |
| Current Proof | ✅ 静态 Gate 3/3（tsc + eslint + dist）✅ 离线断言 6 套全绿（含 v2.3 POV 18/18 · v2.3 阶段5 14/14）✅ 运行时实测（真实 ST 内管线 tab 渲染 / 交互 / 诊断区 / 规则文案 / 无报错 / 旧预设占位符兼容）✅ POV 误判复测：真实聊天 12 条由 12/12 误判 → 0/12 ✅ 阶段5 复测：质量词保留 + 段序恢复 Anima 规范 + 预算告警可见 + 段结构不塌陷 |
| Evidence | CHANGELOG.md v2.3 |
| Exit Condition | 静态 Gate 3/3 + 离线断言全绿 + 运行时面板实测（已达成）→ **随 v2.3.1 一并冻结**（v2.3 从未单独发布/提交） |
| Frozen | Yes |

## v2.2

| Field | Value |
|-------|-------|
| Version | v2.2 (Frozen) |
| Milestone | 统一生成管线：单链路 + 统一中间表示 TagDoc + 35 模块开关体系 + 双解析链（描述/标签）+ Anima Hybrid 严格对齐（段序/句式/校正层）+ 第二阶段 LLM 审核 + 提示词可编辑（契约固定）+ MCP 标签工具（真 function calling）+ 生成管线独立 tab + 四源注入格式统一 |
| Current Task | ✅ 完成并冻结 — src/pipeline.ts / src/promptPreset.ts / src/tagTool.ts / src/mcpClient.ts + promptPost 模块化（TagDoc 句子段）+ index.ts 接入管线与审核 + ui.ts 管线面板 + settings.html 新 tab + 严格格式测试 + Civitai 提示词集工具 |
| Current Proof | ✅ 静态 Gate 4/4 + 离线断言 5 套全绿 + 运行时（MCP 连通 / 真实 LLM 工具调用 / 真实 LLM 端到端合规）；完整出图矩阵未做（留 v2.3） |
| Evidence | CHANGELOG.md v2.2, docs/design-pipeline-v2.2.md, docs/Definition of Done v2.2.md, docs/archive/proofs/v2.2-proof.md |
| Exit Condition | 6 Gate（5 PASS + 1 未做，按用户指示冻结） |
| Frozen | **Yes（2026-10-20，按用户指示；运行时核心链路已验证）** |

## v2.1

| Field | Value |
|-------|-------|
| Version | v2.0 (Implemented) |
| Milestone | 双链路生成 + 词库层 + 公共后处理 + 取消生成 |
| Current Task | ✅ 实现完成 — lexicon.ts / lexiconStore.ts / defaultLexicon.ts / promptPost.ts / builtinDict.ts + index.ts 双链路分支 + ui.ts 链路与词库 UI + api.ts formatLLMError + comfy.ts signal/轮询超时 + promptBuilder species + nameMatcher 收紧 |
| Current Proof | ⏳ 静态 Gate 4/4 PASS（tsc + eslint + dist + 离线 A/B）；运行时 G5 待执行 → 未冻结 |
| Evidence | CHANGELOG.md v2.0, docs/Definition of Done v2.0.md, docs/v2.0-proof.md |
| Exit Condition | 5 Gate（4 PASS — 4 static/offline + 1 runtime pending） |
| Frozen | No（G5 运行时未执行，Rule 21/22） |

## v1.9

| Field | Value |
|-------|-------|
| Version | v1.9 (Development) |
| Milestone | 工作流优化适配 + 本地角色库特征结构简化 + NSFW 适配 |
| Current Task | ✅ 实现完成 — promptBuilder.ts 规则引擎 + 本地库核心DNA/服装DNA 固定槽位 + NSFW 槽位 + POV 判定泛化 + jsonMode |
| Current Proof | ⏳ 静态 Gate 3/3 PASS（tsc+eslint+dist）；运行时 Capability 验证待执行 |
| Evidence | CHANGELOG.md v1.9, docs/Definition of Done v1.9.md |
| Exit Condition | 静态 3 Gate + 运行时 4 Gate（JSON→buildPrompt 端到端 / 固定槽位注入 / NSFW 切换 / POV 剔除） |
| Frozen | No |

## v1.8

| Field | Value |
|-------|-------|
| Version | v1.8 (Implemented) |
| Milestone | 本地角色库 — 世界书提取、分段策略、构建+持久化 |
| Current Task | ✅ Complete — localLib.ts 世界书条目选择/分段/LLM 提取/合并/持久化/注入 |
| Current Proof | ✅ Verified（tsc+eslint 静态验证，git 提交 77ed464 + 8ae3e22） |
| Evidence | src/localLib.ts, design-local-library-v1.8.md |
| Exit Condition | 静态 Gate PASS |
| Frozen | Yes |

## v1.0.8

| Field | Value |
|-------|-------|
| Version | v1.0.8 (Frozen) |
| Milestone | 技术债清理 — 设置面板 UI 构建器提取（TD-004 + TD-005） |
| Current Task | ✅ Complete — rebuildLoraUI/rebuildRegexRulesUI/ensureValidLoraSlots 提取至 src/settingsUi.ts（index.ts 1711→1467 行，-244） |
| Current Proof | ✅ Verified (Kimi WebBridge 运行时实测，永嘉风流 chid=8) |
| Evidence | CHANGELOG.md v1.0.8, docs/Definition of Done v1.0.8.md, docs/v1.0.8-proof.md, webbridge-tests/v108-proof-final.jpg |
| Exit Condition | 11 Gate (11 PASS — 3 static + 8 runtime) |
| Frozen | Yes |

## v1.1

| Field | Value |
|-------|-------|
| Version | v1.1 (Frozen) |
| Milestone | index.ts UI 职责提取 — 拆分 ui.ts（TD-001 + TD-003） |
| Current Task | ✅ Complete — ui.ts 创建（1336 行）+ settingsUi.ts 合并删除 + 事件监听分离（bindLoraEvents/bindRegexEvents）；index.ts 1467→466 行；验证期修复 1 处 onCopyGalleryPath 残留 |
| Current Proof | ✅ Verified (Kimi WebBridge 运行时实测，永嘉风流 chid=8，1 次真实生成 1分38秒) |
| Evidence | CHANGELOG.md v1.1, docs/Definition of Done v1.1.md, docs/v1.1-proof.md, webbridge-tests/v11-proof-final.jpg |
| Exit Condition | 12 Gate (12 PASS — 3 static + 7 runtime + 2 static-structure) |
| Frozen | Yes（12/12 Gate PASS，用户确认冻结 2026-07-27） |

## v1.1.2

| Field | Value |
|-------|-------|
| Version | v1.1.2 (Frozen) |
| Milestone | 自定义提示词标签系统 |
| Current Task | ✅ Complete — PromptTag 数据类型 + ComfyUI tab UI（全局开关/标签列表/事件委托）+ onGenerate 拼接逻辑 + 持久化 |
| Current Proof | ✅ Verified (tsc+eslint 静态验证，12/12 Gate PASS) |
| Evidence | CHANGELOG.md v1.1.2, docs/Definition of Done v1.1.2.md, docs/v1.1.2-proof.md |
| Exit Condition | 12 Gate (12 PASS — 2 static + 10 code review) |
| Frozen | Yes（12/12 Gate PASS，2026-07-27） |

## v1.2

| Field | Value |
|-------|-------|
| Version | v1.2 (Frozen) |
| Milestone | iOS 移动端专项优化 |
| Current Task | ✅ Complete — ui.ts: 浮动按钮 touch 事件三件套 + CSS 触屏覆盖层 + activateTab scrollTop 重置 + 输入框 focus scrollIntoView；index.ts: 行内进度/生成结果 scrollIntoView；文档同步冻结 |
| Current Proof | ✅ Verified（tsc+eslint 静态验证 + 用户 iOS Safari 真机实测 + Windows Chrome 回归，9/9 Gate PASS） |
| Evidence | CHANGELOG.md v1.2, docs/Definition of Done v1.2.md, docs/v1.2-proof.md |
| Exit Condition | 9 Gate (9 PASS — 2 static + 1 baseline + 6 iOS/PC 实测) |
| Frozen | Yes（9/9 Gate PASS，2026-07-28） |

## v1.5

| Field | Value |
|-------|-------|
| Version | v1.5 (Frozen) |
| Milestone | 角色信息注入排版优化 + 段顺序可配置 |
| Current Task | ✅ Complete — 【正文】标签添加 + `injection_order` 段顺序配置（角色信息前置/正文前置）+ MVU/数据库角色信息多行排版 + settings.html 注入段顺序下拉框 + UI 绑定 |
| Current Proof | ✅ Verified（tsc 静态验证） |
| Evidence | CHANGELOG.md v1.5, docs/Definition of Done v1.5.md, docs/v1.5-proof.md |
| Exit Condition | 1 static Gate (1 PASS — tsc) |
| Frozen | Yes（2026-07-30） |

## v1.6

| Field | Value |
|-------|-------|
| Version | v1.6 (Frozen) |
| Milestone | UI 信息密度优化 — 渐进披露与折叠收纳 |
| Current Task | ✅ Complete — ComfyUI `<details>` 折叠（二次采样/LoRA/标签）+ 角色库 MVU/数据库 折叠 header + 状态栏精简 + 标签条目/正则条目折叠冻结 |
| Current Proof | ✅ Verified（tsc+eslint 静态验证，2/2 Gate PASS） |
| Evidence | CHANGELOG.md v1.6, docs/Definition of Done v1.6.md, docs/v1.6-proof.md |
| Exit Condition | 2 static Gate (2 PASS — tsc + eslint) |
| Frozen | Yes（2026-07-30） |

## v1.4

| Field | Value |
|-------|-------|
| Version | v1.4 (Frozen) |
| Milestone | 数据库树形面板 + 姓名匹配增强 + 生成链路稳定性 |
| Current Task | ✅ Complete — 数据库扁平列表→三态级联树 + `DbTableSelection` 结构化选择格式 + 旧格式自动迁移 + DB/段组合输出截断 + nameMatcher 注解剥离/名单字别名 + autoGenerate GENERATION_ENDED 事件 + 生成散射保护 |
| Current Proof | ✅ Verified（tsc+eslint 静态验证，静态 Gate PASS） |
| Evidence | CHANGELOG.md v1.4, docs/Definition of Done v1.4.md, docs/v1.4-proof.md |
| Exit Condition | 2 static Gate (2 PASS — tsc + eslint) |
| Frozen | Yes（2026-07-30） |

## v1.3

| Field | Value |
|-------|-------|
| Version | v1.3 (Frozen) |
| Milestone | MVU UX 全面升级 — 选择模型升级 + 三态树 + 字段矩阵 + 面板体验 |
| Current Task | ✅ Complete — P1(选择模型/三态树/回退链) + P2(字段矩阵) + P3(状态汇总/已选清单/失效检测/搜索) 全部实现并验证 |
| Current Proof | ✅ Verified（tsc+eslint 静态验证 + WebBridge 实测《道渊》v5.2 六场景 + P3 代码审查，12/12 Gate PASS） |
| Evidence | CHANGELOG.md v1.3-P1/P2, docs/Definition of Done v1.3.md, docs/v1.3-p1-proof.md, docs/v1.3-p2-proof.md, docs/v1.3-p3-proof.md |
| Exit Condition | 12 Gate (12 PASS — 2 static + 4 P1 WebBridge + 2 P2 WebBridge + 4 P3 审查) |
| Frozen | Yes（12/12 Gate PASS，2026-07-28） |

## v1.1.3

| Field | Value |
|-------|-------|
| Version | v1.1.3 (Frozen) |
| Milestone | LLM 配置优化：temperature/top_p 参数 + DeepSeek 官方 API 适配优化 |
| Current Task | ✅ Complete — api.ts: EFFORT_MAP + callLLM temperature/top_p 参数；prompt.ts: 签名透传；index.ts: loadSettings + onGenerate 透传；settings.html: UI 控件；ui.ts: 绑定 + 思考模式 hint 联动 |
| Current Proof | ✅ Verified (tsc+eslint 静态验证，8/8 Gate PASS，3-agent code review) |
| Evidence | CHANGELOG.md v1.1.3, docs/Definition of Done v1.1.3.md, docs/v1.1.3-proof.md |
| Exit Condition | 8 Gate (8 PASS — 2 static + 6 code review) |
| Frozen | Yes |

## v1.1.1

| Field | Value |
|-------|-------|
| Version | v1.1.1 (Frozen) |
| Milestone | LLM 响应清洗 + thinking 字段 + 空提示词保护 |
| Current Task | ✅ Complete — api.ts: stripPrefillContent() 前导文本剥离 + thinking 字段联动 + SSE processPayload 重构 + reasoning_content 兜底；index.ts: 空提示词保护；git 跟踪清理 |
| Current Proof | ✅ Verified (tsc+eslint 静态验证，12/12 Gate PASS) |
| Evidence | CHANGELOG.md v1.1.1, docs/Definition of Done v1.1.1.md, docs/v1.1.1-proof.md |
| Exit Condition | 12 Gate (12 PASS — 2 static + 10 code review) |
| Frozen | Yes（12/12 Gate PASS，2026-07-27） |

## v1.0.7

| Field | Value |
|-------|-------|
| Version | v1.0.7 (Frozen) |
| Milestone | 基础设置 Bug 修复 — 图片显示/定位/行内进度 |
| Current Task | ✅ Complete — B1 对齐/大小 CSS 双根因修复 + B2 数据层锚点匹配 + B3 行内进度条件放宽 |
| Current Proof | ✅ Verified (Kimi WebBridge 运行时实测，3 次真实生成) |
| Evidence | CHANGELOG.md v1.0.7, docs/Definition of Done v1.0.7.md, docs/v1.0.7-proof.md, webbridge-tests/v107-proof-final.jpg |
| Exit Condition | 11 Gate (11 PASS — 3 static + 8 runtime) |
| Frozen | Yes |

## v1.0.6

| Field | Value |
|-------|-------|
| Version | v1.0.6 (Frozen) |
| Milestone | LLM 交互优化 — 思考模式控制 + 提示词透明化 + 缓存命中感知 + CORS 修复 |
| Current Task | ✅ Complete — reasoning_effort 参数 + 提示词标题 + 缓存命中检测 + CORS 代理回退 + toastr 计时修复 |
| Current Proof | ✅ Verified (User manual test, DEV_RULES Rule 22 exception — MCP skipped) |
| Evidence | CHANGELOG.md v1.0.6, docs/Definition of Done v1.0.6.md, docs/v1.0.6-proof.md |
| Exit Condition | 13 Gate (13 PASS — 3 static + 10 user verified) |
| Frozen | Yes |

## v1.0.5

| Field | Value |
|-------|-------|
| Version | v1.0.5 (Frozen) |
| Milestone | LLM 请求超时 + 链路打点 + 输出长度控制 |
| Current Task | ✅ Complete — callLLM 超时/取消/耗时日志 + max_tokens + 并行刷新 + ReDoS 防护 |
| Current Proof | ✅ Verified (User manual test, DEV_RULES Rule 22 exception — MCP skipped) |
| Evidence | CHANGELOG.md v1.0.5, docs/Definition of Done v1.0.5.md, docs/v1.0.5-proof.md |
| Exit Condition | 12 Gate (12 PASS — 2 static + 10 user verified) |
| Frozen | Yes |

## v1.0.4

| Field | Value |
|-------|-------|
| Version | v1.0.4 (Frozen) |
| Milestone | 文本锚点定位 + 生成耗时显示 + LoRA 选择持久化修复 |
| Current Task | ✅ Complete — 锚点定位 + 生成耗时 + LoRA 持久化 + Code Review 缺陷修复 |
| Current Proof | ✅ Verified (tsc+eslint PASS, 4-agent code review, user verified runtime) |
| Evidence | CHANGELOG.md v1.0.4, docs/v1.0.4-proof.md |
| Exit Condition | 12 Gate (12 PASS) |
| Frozen | Yes |

## v1.0.3

| Field | Value |
|-------|-------|
| Version | v1.0.3 (Frozen) |
| Milestone | 图片展示体验优化 |
| Current Task | ✅ Complete — image_align + image_size + progress_in_chat + 图片显示设置 Bug 修复 |
| Current Proof | ✅ Verified (tsc+eslint PASS, user verified runtime) |
| Evidence | CHANGELOG.md v1.0.3, docs/v1.0.3-proof.md |
| Exit Condition | 14 Gate (14 PASS — 12 static + 2 user verified) |
| Frozen | Yes |

## v1.0.2

| Field | Value |
|-------|-------|
| Version | v1.0.2 (Frozen) |
| Milestone | 系统提示词职责重构 |
| Current Task | ✅ Complete — Phase -1 职责边界文档 + Phase 0 Header + Phase 1/2 提示词压缩80% + 5模块结构 + 插件默认值 |
| Current Proof | ✅ Verified (tsc PASS) |
| Evidence | CHANGELOG.md v1.0.2, docs/SYSTEM_PROMPT_RESPONSIBILITY.md |
| Exit Condition | 提示词 35,223→6,801 字符，5 职责分离模块，零配置默认值 |
| Frozen | Yes |

## v1.0.1

## v0.9.9

| Field | Value |
|-------|-------|
| Version | v0.9.9 (Frozen) |
| Milestone | 自动生成 + 悬浮按钮 + 实时进度 + 图库入口 |
| Current Task | ✅ Complete — index.ts 扩展（进度系统/悬浮按钮/自动生成/图库）、基础设置 tab、文档同步 |
| Current Proof | ✅ Verified (User override per DEV_RULES Rule 22 exception: tsc+eslint PASS, runtime gates waived) |
| Evidence | archive/Definition of Done v0.9.9.md, archive/v0.9.9-proof.md |
| Exit Condition | 12 Gate (12 PASS — 11 static + 1 runtime waived by user override) |
| Frozen | Yes |

## v0.9.8

| Field | Value |
|-------|-------|
| Version | v0.9.8 (Frozen — User override on runtime gates) |
| Milestone | MVU ObjectPath Selector |
| Current Task | ✅ Complete — characterLib.ts 重写、index.ts MVU UI 重构、settings.html 更新、文档同步 |
| Current Proof | ✅ Verified (User override per DEV_RULES Rule 22 exception: static gates 5/5 PASS, runtime gates waived) |
| Evidence | archive/Definition of Done v0.9.8.md, archive/v0.9.8-proof.md |
| Exit Condition | 10 Gate (5 static PASS + 5 runtime waived by user override) |
| Frozen | Yes |

## v0.9.7

| Field | Value |
|-------|-------|
| Version | v0.9.7 (Frozen) |
| Milestone | Alias 非精确姓名匹配系统 |
| Current Task | ✅ Complete — nameMatcher.ts、characterLib/databaseLib 匹配升级、确定性 Alias 生成、称谓裁剪、冲突检测 |
| Current Proof | ✅ Verified (Node.js test, 22 gates PASS) |
| Evidence | archive/Definition of Done v0.9.7.md, archive/v0.9.7-proof.md |
| Exit Condition | ✅ Satisfied (8 Gate PASS, tsc+eslint clean) |
| Frozen | Yes |

## v0.9.6

| Field | Value |
|-------|-------|
| Version | v0.9.6 (Frozen) |
| Milestone | 角色库信息源统一注入 |
| Current Task | ✅ Complete — 对称 UI、正文角色名匹配过滤、可读块标题、注入预览、非阻塞初刷、scanMvuCharacters 修正 |
| Current Proof | ✅ Verified (User manual verification, 14 gates PASS) |
| Evidence | archive/Definition of Done v0.9.6.md, archive/v0.9.6-proof.md |
| Exit Condition | ✅ Satisfied |
| Frozen | Yes |

## v0.9.5

| Field | Value |
|-------|-------|
| Version | v0.9.5 (Frozen) |
| Milestone | Database Source Basic Integration |
| Current Task | ✅ Complete — 角色库 tab 内数据库区块、数据刷新、点选注入、segment 模式组装 |
| Current Proof | ✅ Verified (User manual verification, 12 gates PASS) |
| Evidence | archive/Definition of Done v0.9.5.md, archive/v0.9.5-proof.md |
| Exit Condition | ✅ Satisfied |
| Frozen | Yes |

## v0.9.4

| Field | Value |
|-------|-------|
| Version | v0.9.4 (Frozen) |
| Milestone | MVU Character Library Integration |
| Current Task | ✅ Complete — 角色库 tab, MVU data refresh, field scanning, character info injection into LLM prompt |
| Current Proof | ✅ Verified (Playwright MCP runtime + tsc/eslint, 12 gates PASS) |
| Evidence | archive/Definition of Done v0.9.4.md, archive/v0.9.4-proof.md |
| Exit Condition | ✅ Satisfied |
| Frozen | Yes |

## v0.9.3

| Field | Value |
|-------|-------|
| Version | v0.9.3 (Frozen) |
| Milestone | ComfyUI Connection Fix & UI Polish |
| Current Task | CORS proxy fallback for ComfyUI requests, total steps UI reposition, test tool char count |
| Current Proof | ✅ Verified (Code review + tsc/eslint, 12 gates PASS) |
| Evidence | archive/Definition of Done v0.9.3.md §6, archive/v0.9.3-proof.md |
| Exit Condition | ✅ Satisfied |
| Frozen | Yes |

## v0.9.2

| Field | Value |
|-------|-------|
| Version | v0.9.2 (Frozen) |
| Milestone | Text Cleaning Enhancement |
| Current Task | Floor extraction (1-5 assistant messages), length truncation (direction + percent + sentence boundary), text cleaning test tool |
| Current Proof | ✅ Verified (Playwright MCP, 16 gates PASS) |
| Evidence | archive/Definition of Done v0.9.2.md §6, archive/v0.9.2-proof.md |
| Exit Condition | ✅ Satisfied |
| Frozen | Yes |

## v0.9.1

| Field | Value |
|-------|-------|
| Version | v0.9.1 (Frozen) |
| Milestone | ComfyUI Configuration Enhancement |
| Current Task | ComfyUI connection test, built-in workflow (remove upload), dual-sampling control, LoRA system rewrite (4 slots + mode + dual strength), UNETLoader model list, fix placeholder mismatch |
| Current Proof | ✅ Verified (Playwright MCP, 20 gates PASS) |
| Evidence | archive/Definition of Done v0.9.1.md §6, archive/v0.9.1-proof.md |
| Exit Condition | ✅ Satisfied |
| Frozen | Yes |

## v0.7.0

| Field | Value |
|-------|-------|
| Version | v0.7.0 (Verified) |
| Milestone | Chat Content Cleaning Capability |
| Current Task | Add regex cleaning rules UI + single-message extraction + cleanChatContent (Done, verified) |
| Current Proof | ✅ Verified (Playwright MCP) |
| Evidence | archive/Definition of Done v0.7.md §6 |
| Exit Condition | ✅ Satisfied |
| Frozen | Yes |

## v0.7.1 (Patch)

| Field | Value |
|-------|-------|
| Version | v0.7.1 (Verified) |
| Milestone | UI Template Separation & Standardization |
| Current Task | Extract settings UI to standalone template, replace inline styles with ST CSS classes, add range sliders, add Font Awesome icons (Done, verified) |
| Current Proof | ✅ Verified (Playwright MCP) |
| Evidence | archive/Definition of Done v0.7.1.md §6 |
| Exit Condition | ✅ Satisfied |
| Frozen | Yes |

## v0.9.0

| Field | Value |
|-------|-------|
| Version | v0.9.0 (Frozen) |
| Milestone | LLM Configuration Enhancement |
| Current Task | LLM URL configurable, model selection improved, connection test, system prompt hardening |
| Current Proof | ✅ Verified (Playwright MCP, 18 gates PASS) |
| Evidence | archive/Definition of Done v0.9.md §6, archive/v0.9-proof.md |
| Exit Condition | ✅ Satisfied |
| Frozen | Yes |

## v0.8.0

| Field | Value |
|-------|-------|
| Version | v0.8.0 (Frozen) |
| Milestone | Tab-based Settings UI |
| Current Task | Restructure single inline-drawer settings panel into fixed header + 5 tab pages (Done, frozen) |
| Current Proof | ❌ Skipped (user override) |
| Evidence | archive/Definition of Done v0.8.md §6 |
| Exit Condition | ✅ Satisfied |
| Frozen | Yes |

## v0.7.2 (Patch)

| Field | Value |
|-------|-------|
| Version | v0.7.2 (Verified) |
| Milestone | UI Code Quality & Consistency Patch |
| Current Task | Replace remaining inline styles in dynamic DOM with ST CSS classes, extract populateSelect() helper, centralize DEFAULTS constants, fix right_menu_button misuse, correct budget (Done, verified) |
| Current Proof | ✅ Verified (Playwright MCP) |
| Evidence | archive/Definition of Done v0.7.2.md §6 |
| Exit Condition | ✅ Satisfied |
| Frozen | Yes |

---

# 2. Current Goal

v2.2 **已冻结**（2026-10-20，按用户指示）。当前版本能力：

- 单链路（9 阶段）+ 统一中间表示（TagDoc，逗号/空格/**句子**三种节型）+ 35 模块开关体系（v2.1 旧键幂等迁移）
- 两条内部解析链（自然语言链 / Danbooru·词典链）+ **Anima Hybrid 严格对齐**（段序：Hard Tags 在前；Natural Language 为完整英文句子；规则引擎降级为校正层：人数补全 / 镜头词置句首 / 景别兼容性裁剪）
- **MCP 在线标签工具**（`https://sakizuki-danboorusearch.hf.space/mcp/mcp`，真 function calling，两阶段可用；本地词库兜底，不用本地端口地址）
- 第二阶段 LLM 审核（最终 prompt 位置，默认关闭，模板可自定义，失败不阻断）
- 提示词可编辑（预设 + 自定义 + 契约块强制，解析格式不可被破坏）
- 四源注入格式统一 + POV 叙述者按块剔除
- 严格格式验证（`prompt_format_test.mjs` 23 项逐节点）+ 回归 4 套

设计依据与决策记录：`docs/design-pipeline-v2.2.md`（含 A 方案决策）。

下一版本（v2.3）候选：完整出图矩阵复测（三模式 × 审核开关）、管线预览升级、信息源统一 Provider（门控/优先级/同名冲突消解）、词库解码 Worker 化、Civitai 提示词集填充（需 Civitai API Token）。

v1.5 已冻结：1 static Gate PASS（tsc）— 角色信息注入排版优化 + 段顺序可配置。

v1.4 已冻结：2/2 static Gate PASS（tsc+eslint）— 数据库树形面板 + 姓名匹配增强 + 生成链路稳定性。

v1.3 已冻结：12/12 Gate PASS（tsc+eslint 静态验证 + WebBridge 实测《道渊》v5.2 + P3 代码审查）— MVU UX 全面升级：选择模型升级 + 三态级联树 + 字段矩阵 + 面板体验增强。

v1.2 已冻结：9/9 Gate PASS（tsc+eslint + iOS 真机 + PC 回归）— iOS 移动端专项优化。

下一版本候选：待 v1.9 冻结后确定（TD-002 comfy.ts Node ID 硬编码 仍为候选）。

---

# 3. Current Scope

v0.7.0：已验证冻结（范围不变）。

v0.7.1 (Frozen)：已验证冻结。

v0.7.2 (Frozen)：已验证冻结。

v0.8 (Frozen)：已验证冻结。

v0.9 (Frozen)：已验证冻结

v0.9.1 (Frozen)：已验证冻结

v0.9.2 (Frozen)：已验证冻结

v0.9.3 (Frozen)：已验证冻结

v0.9.4 (Frozen)：已冻结

- 「测试工具」tab →「角色库」tab（data-tab="charlib"，移除 data-disabled）
- 角色库 UI（MVU 开关、状态行、扫描按钮、字段 checkbox 列表）
- `src/characterLib.ts` — 6 个公开 API（refreshMvuData, injectCharacterInfo, scanMvuFields, clearMvuCache, isMvuAvailable, getMvuStatus）
- `CHAT_CHANGED` 事件 + onGenerate 步骤 0 刷新 MVU 缓存
- 角色信息注入 pipeline（候选名收集 → 正文匹配 → 字段提取 → 格式化）
- 设置持久化：mvu_enabled（bool）、mvu_fields（Record<string, boolean>）
- version 0.9.3 → 0.9.4

v0.9.5 (Frozen)：已冻结

- 角色库 tab 内「数据库」区块（开关、状态行、扫描按钮、表格列表容器）
- `src/databaseLib.ts` — 6 个公开 API（refreshDatabaseData, scanDatabaseTables, extractDatabaseInfoSegment, injectDatabaseInfo, clearDatabaseCache, getDatabaseStatus）
- `CHAT_CHANGED` 事件扩展 + `onGenerate` 步骤 0b 数据库缓存刷新
- 数据库信息注入 pipeline（行×列点选 → 格式化 → MVU段 + 数据库段 + 清洗正文拼接）
- 设置持久化：db_enabled（bool, 默认 false）、db_selection（Record）
- version 0.9.4 → 0.9.5
- CSS 选择器作用域限定 + inline style 提取为 CSS 类
- extractDatabaseInfoSegment 纯 segment 模式注入

v0.9.9 (Frozen)：已冻结

- 基础设置 tab 激活（原 `data-disabled="true"`）
- 自动生成：`MESSAGE_RECEIVED` 事件监听，角色回复后自动触发生成，30s 冷却
- 运行锁：`isGenerating` 全局锁，阻止并发生成
- 悬浮按钮：`#movingDivs` 注入，可拖拽，localStorage 位置持久化，光晕显示进度
- 进度系统：状态机 Idle → Prompting → Rendering → Done/Failed → Idle
- 统一进度出口 `setProgress()`：同时控制 toastr + 悬浮按钮
- 图库入口：按钮复制 `user/images/{角色名}/` 到剪贴板
- 状态恢复在 `finally` 块，任何异常不卡锁
- 事件监听每次读取实时设置，不缓存
- 防重复注册（`autoGenRegistered` 标志位）
- version 0.9.8 → 0.9.9

v1.0.8 (Frozen)：已冻结

- 新建 src/settingsUi.ts（职责：设置面板动态 UI 构建器，3 个导出）
- 提取 rebuildLoraUI（TD-004）+ rebuildRegexRulesUI（TD-005）+ ensureValidLoraSlots，行为零变化
- populateLoraDropdowns 归属判定（T3）：保留在 index.ts（被 init 与刷新按钮调用）
- .api-baseline.json 同步（含 v1.0.6 遗漏补登 getLastCacheInfo / REASONING_EFFORT_OPTIONS）
- index.ts 1711 → 1467 行（-244）；version 1.0.7 → 1.0.8

v1.0.7 (Frozen)：已冻结

- 仅修改 src/index.ts，不修改 settings.html 和底层模块
- B1: 图片显示设置修复 — 对齐 `justify-content + text-align` 双写 `!important`（wrapper 实测为 flex 容器）；内层容器 `inline-block !important`；大小全 `!important` + 解除 ST `max-height` 限制
- B2: 锚点定位修复 — 新增 `getMesRawText()` 数据层原文匹配（HTML 标签形态锚点在 DOM textContent 中被解析吞掉）；document.contains 保护 + 有限重试
- B3: 行内进度显示修复 — 取消 `anchor_text` 非空条件，无锚点时在 mes_text 之后显示进度，完成/失败后自动移除
- version 1.0.6 → 1.0.7

v1.0.5 (Frozen)：已完成

- P0: callLLM 180s 超时 — AbortController + fallback timeout，请求超时自动中止
- P0: 请求链路三段打点 — console.log 输出 [image_st] LLM timing: request start / headers received / parsed
- P0: AbortSignal 透传 — onGenerate → generateLLMPrompt → callLLM，finally 统一清理
- P1: MVU/DB 并行刷新 — Promise.all 替代串行 await，消除前置等待
- P1: max_tokens 输出限制 — 新增设置项，仅 >0 时写入请求体
- P1: ReDoS 正则安全 — 嵌套量词模式跳过并 console.warn
- version 1.0.4 → 1.0.5

v1.0.4 (Frozen)：已完成

- 文本锚点定位：新增 anchor_text（用户定义锚点字符串）、anchor_position（above/below，默认 above）
- 基础设置 tab 新增锚点文本输入 + 位置下拉控件
- 生成耗时记录：genTiming 对象记录各阶段时间戳，toastr 进度显示耗时，生成完成后面板展示详细耗时
- LoRA 持久化修复：populateLoraDropdowns 改用 settings 读取，绕过 select 中间态 value 丢失
- Code Review 修复：mesBlock 引用保护、nextElementSibling、定时器取消标记、输入校验、trim 匹配、formatDuration 增强、超时保护
- 仅重新定位 .mes_media_wrapper 在父级中的位置，不移除 ST 原始节点
- version 1.0.3 → 1.0.4

v1.0.3 (Frozen)：已完成

- 图片展示：新增 image_align（左/中/右）、image_size（小300px/中500px/大全宽）
- 设置持久化：image_align（默认 center）、image_size（默认 medium）、progress_in_chat（默认 true）
- 增强悬浮按钮：生成中图标变旋转 spinner + pulse 动画光晕，完成/失败短暂显示 check/xmark 后恢复
- progress_in_chat 控制图标动画开关，关闭时保持原行为（纯 glow 变色）
- 不进 mes DOM，不移除 ST 原始节点
- version 1.0.2 → 1.0.3

v1.0.1 (Frozen)：已冻结

- P0 发布阻塞修复：死代码清理（`scanDatabaseTables`/`DatabaseTableInfo`）、6 个死 export 清理、Toast 顺序误导修复、AbortSignal 共享修复、Workflow 节点校验
- P1 质量改进：3 处迁移代码清理、MVU 树 emoji→FA icon、settings inline style→class、重复字符修复、空路径防御
- 文档同步：DoD v0.9.9 `downloading` 状态残留清理、v0.9.8-proof PENDING→WAIVED、PROJECT_STATE.md 补充缺失 proof 条目 + PRODUCT.md 文件名修正
- 新增治理：TECHNICAL_DEBT.md、`.api-baseline.json`
- version 0.9.9 → 1.0.1

v0.9.8 (Frozen)：已冻结

- `src/characterLib.ts` 重写 ~80%：移除旧字段/角色扫描 + 自动匹配，新增树构建 + ObjectPath 解析/格式化 API
- `buildMvuTree()` — 递归构建仅含 branch/leaf 两种节点的树结构
- `extractMvuInfoSegment(text, paths)` — 手动筛选路径 + nameMatcher 角色名匹配 + 格式化输出
- `resolveObjectPath(obj, segments)` — 纯 key 遍历路径解析（UI leaf 渲染用）
- 空对象/空数组始终为 branch（可勾选）
- 展平深度 `MAX_DEPTH=3`，总输出 `MAX_OUTPUT=2000`
- 保存 `mvu_paths: string[][]`（Path Segments 数组），非 JSONPath 字符串
- UI 树选择器：branch（checkbox 可勾选）/ leaf（点击复制路径）
- MVU 使用 nameMatcher.ts（buildAliasMap/trimHonorifics）与 databaseLib 同一套匹配
- pipeline 段标题仍为 `【角色信息·MVU】`
- 数据库功能完全不受影响
- version 0.9.7 → 0.9.8

v0.9.7 (Frozen)：已冻结

- `src/nameMatcher.ts` — 新模块：Character Name Normalizer → Alias Builder → Matcher
- `buildAliasMap(characters)` — 确定性 Alias 生成，`Map<string, string | null>`
- `trimHonorifics(text)` — CJK 边界 regex 裁剪称谓前缀/后缀
- 复姓最长优先解析（`MAX_SURNAME_LEN=4`，`for len=4; len>=2; len--`）
- 单字姓 Alias 排除
- Canonical Name 优先于 Alias
- 冲突 Alias 标记为 null，不删除，console.debug 记录
- `src/characterLib.ts` — extractCharacterInfoSegment 内匹配升级为 Alias
- `src/databaseLib.ts` — extractDatabaseInfoSegment 内匹配升级为 Alias
- `index.ts` 接口完全不变
- version 0.9.6 → 0.9.7
- 8 Gate 验证 (22/22 PASS)，tsc + eslint 零错误

v0.9.6 (Frozen)：已冻结

- 角色库 tab UI 重构为对称结构：MVU + 数据库两区块（角色名只读列表 + 字段勾选列表）
- 数据库 UI 合并去重：两表合并为统一角色名列表 + 全局字段列表
- MVU UI 增加角色名显示：「可匹配角色 N 个」
- `src/databaseLib.ts` — +2 新函数（scanDatabaseCharacters, scanDatabaseFields）、extractDatabaseInfoSegment 改签名（+text 参数做正文名匹配）、移除 injectDatabaseInfo
- `src/characterLib.ts` — +1 新函数 scanMvuCharacters
- `src/index.ts` — +previewInjectionPipeline，onGenerate 改为可读块标题拼接
- 可读块标题格式：`【角色信息·MVU】` / `【角色信息·数据库】`
- 注入预览工具：预览按钮 + 只读 textarea，展示与 LLM 发送完全一致的内容
- DB 持久化简化：`db_selection` 从 Record 改为 `{ cols: string[] }`
- `init()` 非阻塞初刷：打开聊天后自动刷新 MVU/DB 状态行（setTimeout 0）
- `scanMvuCharacters()` 改用 `collectCandidates()` 解决角色名误识别
- version 0.9.5 → 0.9.6

v0.9.3 开发范围：
- `comfyFetch()` 包装函数 — CORS/TypeError 自动回退到 ST 服务器代理
- 所有 6 处 ComfyUI fetch 调用替换为 comfyFetch（连接测试、模型列表、LoRA 列表、工作流提交、轮询、下载图片）
- 代理不可用时显示包含修复指南的清晰错误信息
- `loadDefaultWorkflow()` 同源加载不受影响（不经过代理）
- 总采样步数 UI 上移至首次采样步数上方
- 文本清洗测试工具结果 textarea 执行后显示字符数 `(N 字符)`
- version 0.9.2 → 0.9.3

---

# 4. Document Status

| Document | Status | Authority |
|----------|--------|-----------|
| PRODUCT.md v1.0（项目宪法）.md | Frozen | L0 |
| DEV_RULES.md | Frozen (v1.2) | L1 |
| ARCHITECTURE.md | Frozen | L2 |
| archive/Definition of Done v0.1.md | Frozen | L3 |
| archive/v0.1-proof.md | Frozen | L3 |
| archive/Definition of Done v0.2.md | Frozen | L3 |
| archive/v0.2-proof.md | Frozen | L3 |
| archive/Definition of Done v0.3.md | Frozen | L3 |
| archive/v0.3-proof.md | Frozen | L3 |
| archive/Definition of Done v0.4.md | Frozen | L3 |
| archive/v0.4-proof | Merged into archive/Definition of Done v0.4.md §6 | L3 |
| archive/Definition of Done v0.5.md | Frozen | L4 |
| archive/v0.5-proof | Merged into archive/Definition of Done v0.5.md §6 | L3 |
| archive/Definition of Done v0.6.md | Frozen | L4 |
| archive/v0.6-proof.md | Frozen | L3 |
| archive/Definition of Done v0.7.md | Frozen | L4 |
| archive/v0.7-proof.md | Frozen | L3 |
| archive/Definition of Done v0.7.1.md | Frozen | L4 |
| archive/v0.7.1-proof.md | Frozen | L3 |
| archive/Definition of Done v0.7.2.md | Frozen | L4 |
| archive/v0.7.2-proof.md | Frozen | L3 |
| archive/Definition of Done v0.8.md | Frozen | L4 |
| archive/v0.8-proof.md | Verified (User override) | L3 |
| UI_STANDARD.md | Frozen | L2 |
| archive/Definition of Done v0.9.md | Frozen | L4 |
| archive/v0.9-proof.md | Verified | L3 |
| archive/Definition of Done v0.9.1.md | Frozen | L4 |
| archive/v0.9.1-proof.md | Verified | L3 |
| archive/Definition of Done v0.9.2.md | Frozen | L4 |
| archive/v0.9.2-proof.md | Verified | L3 |
| archive/Definition of Done v0.9.3.md | Frozen | L4 |
| archive/v0.9.3-proof.md | Verified | L3 |
| PROJECT_STATE.md | Active | L3 |
| EVOLUTION_RULES.md | Frozen | L3A |
| AI_CONTEXT.md | Active | L3 |
| ROADMAP.md | Not Created | L4 |
| CHANGELOG.md | Active | L5 |
| archive/Definition of Done v0.9.4.md | Frozen | L4 |
| archive/v0.9.4-proof.md | Verified | L3 |
| archive/Definition of Done v0.9.5.md | Frozen | L4 |
| archive/v0.9.5-proof.md | Verified | L3 |
| archive/Definition of Done v0.9.6.md | Frozen | L4 |
| archive/v0.9.6-proof.md | Verified | L3 |
| archive/Definition of Done v0.9.7.md | Frozen | L4 |
| archive/v0.9.7-proof.md | Verified | L3 |
| archive/Definition of Done v0.9.8.md | Frozen | L4 |
| archive/v0.9.8-proof.md | Verified (User override) | L3 |
| archive/Definition of Done v0.9.9.md | Frozen | L4 |
| archive/v0.9.9-proof.md | Verified (User override) | L3 |
| **Definition of Done v1.0.3.md** | **Frozen** | **L4** |
| **v1.0.3-proof.md** | **Verified** | **L3** |
| **Definition of Done v1.0.4.md** | **Frozen** | **L4** |
| **v1.0.4-proof.md** | **Verified** | **L3** |
| **Definition of Done v1.0.5.md** | **Frozen** | **L4** |
| **v1.0.5-proof.md** | **Verified (User manual test)** | **L3** |
| **Definition of Done v1.0.6.md** | **Frozen** | **L4** |
| **v1.0.6-proof.md** | **Verified (User manual test)** | **L3** |
| **Definition of Done v1.0.7.md** | **Frozen** | **L4** |
| **WEBBRIDGE_TESTING.md** | **Active** | **L3** |
| **Definition of Done v1.0.8.md** | **Frozen** | **L4** |
| **v1.0.8-proof.md** | **Verified (Kimi WebBridge runtime)** | **L3** |
| **v1.0.7-proof.md** | **Verified (Kimi WebBridge runtime)** | **L3** |
| **Definition of Done v1.1.md** | **Frozen** | **L4** |
| **v1.1-proof.md** | **Verified (Kimi WebBridge runtime)** | **L3** |
| **Definition of Done v1.1.1.md** | **Frozen** | **L4** |
| **v1.1.1-proof.md** | **Verified (tsc+eslint)** | **L3** |
| **Definition of Done v1.1.2.md** | **Frozen** | **L4** |
| **v1.1.2-proof.md** | **Verified (tsc+eslint)** | **L3** |
| Definition of Done v1.2.md | Frozen | L4 |
| settings.html | Active | — |
| TECHNICAL_DEBT.md | Active | L4 |
| .api-baseline.json | Active | L5 |
| Definition of Done v1.3.md | Frozen | L4 |
| v1.3-p1-proof.md | Verified | L3 |
| v1.3-p2-proof.md | Verified | L3 |
| v1.3-p3-proof.md | Verified | L3 |
| Definition of Done v1.4.md | Frozen | L4 |
| v1.4-proof.md | Verified | L3 |
| Definition of Done v1.6.md | Frozen | L4 |
| v1.6-proof.md | Verified | L3 |
| UI_ARCHITECTURE.md | Active | L3 |
| Definition of Done v2.0.md | Frozen | L4 |
| v2.0-proof.md | Verified (4/5 Gate, runtime pending) | L3 |
| Definition of Done v2.1.md | Pending | L4 |
| v2.1-proof.md | Pending | L3 |

---

# 5. Current Constraints

v2.2 开发中（统一生成管线）。

约束：

- 单一权威实现：生产路径只走 `runTagPipeline`；`postProcessCommon` / `formatPromptExtTool` 保留为离线回归的参考实现（oracle），不再被生产代码调用
- 统一中间表示：解析一次后只在标签数组上操作；逗号节（描述）与空格节（标签）可共存
- 提示词自由但格式固定：用户可改写预设/追加片段，**契约块永远最后追加**，解析格式不可被破坏
- 第二阶段审核位于「插件处理完成 → ComfyUI」之间；异常不阻断，保留审核前 prompt
- 信息源（MVU / 数据库 / 本地库 / 柏宝书）本版本行为完全不动，冲突消解放 v2.3
- **标签工具走 MCP 在线服务**（默认 `https://sakizuki-danboorusearch.hf.space/mcp/mcp`），不使用任何本地端口地址；本地词库仅作兜底
- 词库恢复在页面加载后台进行（240ms / 94MB），生成路径不等待；未就绪时降级内嵌精选

---

# 5.5 Current Budget

## v2.2 (Development)

```
新增文件：6（src/pipeline.ts, src/promptPreset.ts, src/tagTool.ts, src/mcpClient.ts, docs/Definition of Done v2.2.md, docs/v2.2-proof.md）
新增依赖：0
新增公开 API：56（pipeline 15 / promptPost 13 / tagTool 8 / promptPreset 6 / mcpClient 8 / api 6）
新增模块：4
修改文件：12（src/index.ts, src/ui.ts, src/api.ts, src/promptBuilder.ts, src/promptPost.ts, settings.html, prompt_quality_test.mjs, package.json, manifest.json, docs/.api-baseline.json, CHANGELOG.md, docs/PROJECT_STATE.md）
新增文档：3（design-pipeline-v2.2.md + DoD + proof）
净代码变化：~+1900 行
```

> 预算说明：纯新增管线层、MCP 客户端与面板，零架构层级扩张；信息源不动。

## v2.1

```
新增文件：2（src/baibaiLib.ts, docs/Definition of Done v2.1.md）
新增依赖：0
新增公开 API：≤ 12（baibaiLib 预计 8–10 + ui.ts 1 + index.ts 0）
新增模块：1（baibaiLib.ts — 读取 + 分档 + 树 + 抽取，与 characterLib/databaseLib 同粒度）
修改文件：5（src/ui.ts, settings.html, src/index.ts, docs/.api-baseline.json, CHANGELOG.md）
新增文档：2（Definition of Done v2.1.md, v2.1-proof.md — 除 CHANGELOG 外）
不修改文件：comfy.ts, api.ts, prompt.ts, promptBuilder.ts, promptPost.ts, lexicon.ts, lexiconStore.ts, defaultLexicon.ts, characterLib.ts, databaseLib.ts, localLib.ts, nameMatcher.ts
净代码变化：预计 ~+500 行
```

> 预算说明：纯新增信息源面板 + 注入段，零架构变更，不改既有三个面板行为。

## v2.0

```
新增文件：7（src/lexicon.ts, src/lexiconStore.ts, src/defaultLexicon.ts, src/promptPost.ts, src/builtinDict.ts, docs/Definition of Done v2.0.md, docs/v2.0-proof.md）
新增依赖：0
新增公开 API：49（lexicon 26 / defaultLexicon 6 / promptPost 10 / lexiconStore 3 / builtinDict 1 / api 1 / nameMatcher 1 / ui 1；移除 0）
新增模块：4（词库层 3 + 后处理层 1）
修改文件：10（src/index.ts, src/ui.ts, src/api.ts, src/comfy.ts, src/promptBuilder.ts, src/nameMatcher.ts, src/localLib.ts, settings.html, package.json, manifest.json）
新增文档：3（除 CHANGELOG 外）
净代码变化：~+1585/−47 行
```

> 预算说明：双链路 + 词库层 + 后处理层 + 取消生成；附带治理修复（eslint 归零 / 目录扁平化 / 内置工作流入库 / api-baseline 同步）。

## v0.7.0 (Frozen)

```
新增文件：2（archive/Definition of Done v0.7.md, archive/v0.7-proof.md）
新增依赖：0
新增公开 API：0（仅扩展已有接口）
新增文档：2（除 CHANGELOG 外）
```

## v0.7.1

```
新增文件：3（archive/Definition of Done v0.7.1.md, archive/v0.7.1-proof.md, settings.html）
新增依赖：0
新增公开 API：0
新增文档：2（除 CHANGELOG 外）
```

## v0.7.2

```
新增文件：2（archive/Definition of Done v0.7.2.md, archive/v0.7.2-proof.md）
新增依赖：0
新增公开 API：0
新增文档：2（除 CHANGELOG 外）
```

## v0.8 (Frozen)

```
新增文件：3（archive/Definition of Done v0.8.md, archive/v0.8-proof.md, UI_STANDARD.md）
新增依赖：0
新增公开 API：0
新增文档：3（除 CHANGELOG 外）
```

## v0.9

```
新增文件：2（archive/Definition of Done v0.9.md, archive/v0.9-proof.md）
新增依赖：0
新增公开 API：0（仅扩展函数签名）
新增文档：2（除 CHANGELOG 外）
```

## v0.9.1

```
新增文件：3（archive/Definition of Done v0.9.1.md, archive/v0.9.1-proof.md, （自用）Anima正式版-文生图工作流.json）
新增依赖：0
新增公开 API：0（仅扩展已有函数/接口）
新增文档：2（除 CHANGELOG 外）
```

备注：内置工作流 JSON 为本版本新增文件（替换原上传功能），Budget 超出声明 1 文件。此为有意识的设计决策——固定工作流 JSON 是 "Removed file upload" 的必要替代方案，不增加架构复杂度。

## v0.9.2

```
新增文件：2（archive/Definition of Done v0.9.2.md, archive/v0.9.2-proof.md）
新增依赖：0
新增公开 API：3（extractAssistantMessages, truncateByPercent, processTextPipeline）
新增文档：2（除 CHANGELOG 外）
```

## v0.9.3

```
新增文件：2（archive/Definition of Done v0.9.3.md, archive/v0.9.3-proof.md）
新增依赖：0
新增公开 API：1（comfyFetch — 内部函数，未导出）
新增文档：2（除 CHANGELOG 外）
```

## v0.9.4

```
新增文件：3（archive/Definition of Done v0.9.4.md, archive/v0.9.4-proof.md, src/characterLib.ts）
新增依赖：0
新增公开 API：6（refreshMvuData, injectCharacterInfo, scanMvuFields, clearMvuCache, isMvuAvailable, getMvuStatus）
新增文档：2（除 CHANGELOG 外）
```

## v0.9.5

```
新增文件：3（archive/Definition of Done v0.9.5.md, archive/v0.9.5-proof.md, src/databaseLib.ts）
新增依赖：0
新增公开 API：6（refreshDatabaseData, scanDatabaseTables, extractDatabaseInfoSegment, injectDatabaseInfo, clearDatabaseCache, getDatabaseStatus）
新增文档：2（除 CHANGELOG 外）
```

## v0.9.6

```
新增文件：2（archive/Definition of Done v0.9.6.md, archive/v0.9.6-proof.md）
新增依赖：0
新增公开 API：3（scanDatabaseCharacters, scanDatabaseFields, scanMvuCharacters）
移除公开 API：1（injectDatabaseInfo）
修改签名：1（extractDatabaseInfoSegment）
新增文档：2（除 CHANGELOG 外）
```

## v0.9.8

```
新增文件：2（archive/Definition of Done v0.9.8.md, archive/v0.9.8-proof.md）
重写文件：1（src/characterLib.ts ~80% 重写）
新增依赖：0
新增公开 API：3（buildMvuTree, extractMvuInfoSegment, resolveObjectPath）
移除公开 API：4（scanMvuCharacters, scanMvuFields, extractCharacterInfoSegment, injectCharacterInfo）
新增文档：1（除 CHANGELOG 外）
最大修改量：~+200 行（净增，扣除移除 ~-120 行）
```

## v0.9.7

```
新增文件：3（src/nameMatcher.ts, archive/Definition of Done v0.9.7.md, archive/v0.9.7-proof.md）
新增依赖：0
新增公开 API：2（buildAliasMap, trimHonorifics — 均在 nameMatcher.ts）
修改签名：0
修改接口：0
新增文档：2（除 CHANGELOG 外）
最大修改量：~+230 行（不含文档），~+370 行（含文档）
```

## v0.9.9

```
新增文件：2（archive/Definition of Done v0.9.9.md, archive/v0.9.9-proof.md）
新增依赖：0
新增公开 API：0（全部内部函数，不 export）
新增模块：0（零结构演进）
修改文件：5（src/index.ts, src/comfy.ts, settings.html, package.json, manifest.json）
新增文档：2（除 CHANGELOG 外）
不修改文件：characterLib.ts, databaseLib.ts, nameMatcher.ts, prompt.ts, api.ts
最大修改量：~+300 行（净增，全部在 index.ts）
```

> 预算说明：`comfy.ts` 的 SAMPLERS/SCHEDULERS 扩展 + MAX_POLL 提升是为 v0.9.9 自动生成功能的健壮性服务的（长耗时 ComfyUI 任务容错），属于 v0.9.9 范围的必要配套调整。零架构变更。`src/types.d.ts` 已合并回 `src/index.ts`，不计为新增文件。

## v1.0.3

```
新增文件：0
新增依赖：0
新增公开 API：0
新增模块：0
修改文件：4（src/index.ts, settings.html, package.json, manifest.json）
新增文档：2（Definition of Done v1.0.3.md, v1.0.3-proof.md — 除 CHANGELOG 外）
不修改文件：prompt.ts, comfy.ts, api.ts, characterLib.ts, databaseLib.ts, nameMatcher.ts
最大修改量：~+140 行（净增，全部在 index.ts）
```

> 预算说明：纯 UI 增强 + 已有系统（悬浮按钮）扩展。零架构变更。不进 mes DOM。

## v1.0.8

```
新增文件：2（src/settingsUi.ts, Definition of Done v1.0.8.md）
新增依赖：0
新增公开 API：3（rebuildLoraUI, rebuildRegexRulesUI, ensureValidLoraSlots — 自 settingsUi.ts 导出）
新增模块：1（settingsUi.ts）
修改文件：3（src/index.ts, docs/.api-baseline.json, package.json/manifest.json）
新增文档：2（除 CHANGELOG 外）
不修改文件：6 个底层模块 + settings.html
净代码变化：≈ 0 行（index.ts -244 行，settingsUi.ts 约 +250 行含模块头/导入）
```

> 实际说明：ensureValidLoraSlots 因同时被 index.ts loadSettings 使用而必须导出，较原预算 +1（DoD 已修订注记）。baseline 另补登 v1.0.6 遗漏的 getLastCacheInfo / REASONING_EFFORT_OPTIONS（事实补登，非本次新增）。

## v1.1 (Frozen)

```

```
新增文件：1（src/ui.ts — 消除 settingsUi.ts 过渡层，统一收拢全部 UI）
新增依赖：0
新增公开 API：（待定，按实际导出清单登记）
新增模块：1（ui.ts — 职责：设置面板 UI + 运行时 UI）
删除文件：1（src/settingsUi.ts — 功能合并入 ui.ts）
修改文件：3（src/index.ts, docs/.api-baseline.json, package.json/manifest.json）
新增文档：2（Definition of Done v1.1.md, v1.1-proof.md — 除 CHANGELOG 外）
不修改文件：6 个底层模块 + settings.html
净代码变化：≈ 0 行（index.ts -500~600 行，ui.ts +700~800 行，settingsUi.ts -250 行归于 ui.ts）
```

> 预算说明：纯代码搬运重构，零行为变更。满足 EVOLUTION_RULES §2 File Split Rule 全部条件：UI 能力已通过多个版本验证（Condition 1），UI 渲染与生成协调为独立职责（Condition 2），该职责长期存在（Condition 3）。settingsUi.ts 的删除是消除 v1.0.8 过渡层的计划动作，非倒退（该文件在 v1.0.8 已注明为过渡产物）。

## v1.1.2 (Frozen)

```
新增文件：0
新增依赖：0
新增公开 API：1（PromptTag 接口 — prompt.ts）
新增模块：0
修改文件：5（src/prompt.ts, src/index.ts, src/ui.ts, settings.html, package.json/manifest.json）
新增文档：3（Definition of Done v1.1.2.md, v1.1.2-proof.md — 除 CHANGELOG 外）
不修改文件：comfy.ts, characterLib.ts, databaseLib.ts, nameMatcher.ts, api.ts
净代码变化：~+130 行（prompt.ts +5, index.ts +10, ui.ts +108, settings.html +20）
```

> 预算说明：纯功能新增（自定义提示词标签系统），零架构变更。PromptTag 接口 + rebuildPromptTagsUI + bindPromptTagEvents + onGenerate 拼接逻辑。UI 交互对标正则规则，事件委托模式一致。不涉及底层模块修改。

## v1.1.1 (Frozen)

```
新增文件：0
新增依赖：0
新增公开 API：0（stripPrefillContent 为内部函数）
新增模块：0
修改文件：2（src/api.ts, src/index.ts）
新增文档：2（Definition of Done v1.1.1.md, v1.1.1-proof.md — 除 CHANGELOG 外）
不修改文件：comfy.ts, characterLib.ts, databaseLib.ts, nameMatcher.ts, prompt.ts, ui.ts, settings.html
净代码变化：~+60 行（api.ts +55, index.ts +6）
```

> 预算说明：纯 LLM 响应链路修复，零架构变更。stripPrefillContent + thinking 字段联动 + SSE 解析重构 均在 api.ts 内完成，空提示词保护在 index.ts onGenerate 内增加 6 行守卫。不涉及任何 UI 或底层模块修改。

## v1.1.3 (Development)

```

```
新增文件：0
新增依赖：0
新增公开 API：0（仅扩展已有函数参数）
新增模块：0
修改文件：5（src/api.ts, src/prompt.ts, src/index.ts, src/ui.ts, settings.html）
新增文档：3（Definition of Done v1.1.3.md, v1.1.3-proof.md — 除 CHANGELOG 外）
不修改文件：comfy.ts, characterLib.ts, databaseLib.ts, nameMatcher.ts
净代码变化：~+100 行
```

> 预算说明：纯功能新增（temperature/top_p 参数）+ DeepSeek 适配优化（EFFORT_MAP 值映射 + reasoning_effort 选项更新）。零架构变更。所有参数仅非默认值时写入请求体，保持向后兼容。

## v1.4 (Development)

```
新增文件：2（Definition of Done v1.4.md, v1.4-proof.md, UI_ARCHITECTURE.md）
新增依赖：0
新增公开 API：4（getDbSelections, migrateDbSelections, scanDatabaseTables — databaseLib.ts; refreshDbPanelExtras — ui.ts）
新增类型：3（DbTableSelection, DbTableInfo — databaseLib.ts; DbCheckboxRef — ui.ts）
修改文件：6（src/ui.ts, src/index.ts, src/databaseLib.ts, src/nameMatcher.ts, src/characterLib.ts, settings.html）
新增文档：4（UI_ARCHITECTURE.md, Definition of Done v1.4.md, v1.4-proof.md — 除 CHANGELOG 外）
不修改文件：4（api.ts, prompt.ts, comfy.ts）
净代码变化：~+370 行
```

> 预算说明：数据库面板树形重构（+276 行 ui.ts，+48 行 databaseLib.ts，+20 行 settings.html）+ nameMatcher 增强（+8 行）+ characterLib 并发防重（+8 行）+ index.ts DB 格式适配（+24 行）。零架构变更。DbTableSelection 替换旧的 `{ cols: string[] }` 格式，旧格式保留自动迁移兼容。

## v1.2 (Development)

```
新增文件：0
新增依赖：0
新增公开 API：0
新增模块：0
修改文件：2（src/ui.ts, src/index.ts）
新增文档：3（Definition of Done v1.2.md, v1.2-proof.md — 除 CHANGELOG 外）
不修改文件：7（api.ts, prompt.ts, comfy.ts, characterLib.ts, databaseLib.ts, nameMatcher.ts, settings.html）
净代码变化：~+133 行
```

> 预算说明：纯 UI 适配，零架构变更。所有改动为追加式（parallel touch handler + CSS @media overlay），不修改现有 mouse 逻辑或 PC 端 CSS。

## v1.0.7

```
新增文件：1（Definition of Done v1.0.7.md）
新增依赖：0
新增公开 API：0
新增模块：0
修改文件：1（src/index.ts）
新增文档：1（除 CHANGELOG 外）
不修改文件：6 个底层模块（comfy.ts, characterLib.ts, databaseLib.ts, nameMatcher.ts, prompt.ts, api.ts）
最大修改量：~+50 行
```

> 预算说明：纯 Bug 修复，仅修改 src/index.ts。B1 CSS 属性修正，B2 DOM 查询优化，B3 条件放宽。零架构变更。

## v1.0.6

```
新增文件：2（Definition of Done v1.0.6.md, v1.0.6-proof.md）
新增依赖：0
新增公开 API：1（getLastCacheInfo — 缓存命中查询）
新增模块：0
修改文件：4（src/api.ts, src/prompt.ts, src/index.ts, settings.html）
新增文档：2（除 CHANGELOG 外）
不修改文件：4 个底层模块（comfy.ts, characterLib.ts, databaseLib.ts, nameMatcher.ts）
最大修改量：~+90 行
```

> 预算说明：R1 思考模式（+4 行 api.ts + 1 行 settings.html + 5 行 index.ts），R2 提示词标题（+1 行 index.ts + 3 行 CSS），R3 缓存检测（+25 行 api.ts + 15 行 index.ts）。零架构变更。callLLM 返回类型保持不变。

## v1.0.5

```
新增文件：2（Definition of Done v1.0.5.md, v1.0.5-proof.md）
新增依赖：0
新增公开 API：2（LLM_TIMEOUT_MS, LLM_MAX_DURATION_MS — 超时控制常量）
新增模块：0
修改文件：6（src/api.ts, src/prompt.ts, src/index.ts, settings.html, package.json, manifest.json）
新增文档：2（除 CHANGELOG 外）
不修改文件：4 个底层模块（comfy.ts, characterLib.ts, databaseLib.ts, nameMatcher.ts）
最大修改量：~+140 行（api.ts 重写为流式 + 超时控制）
```

> 预算说明：P0 安全修复（超时/取消/打点）+ P1 优化（并行刷新 + max_tokens + ReDoS 防护）。零架构变更。callLLM 改为固定流式 SSE（非流式 JSON 热备降级），新增 LLM_TIMEOUT_MS/LLM_MAX_DURATION_MS 两个超时常量导出。

## v1.0.4

```
新增文件：2（Definition of Done v1.0.4.md, v1.0.4-proof.md）
新增依赖：0
新增公开 API：0（全部内部函数，不 export）
新增模块：0
修改文件：4（src/index.ts, settings.html, package.json, manifest.json）
新增文档：2（除 CHANGELOG 外）
不修改文件：6 个底层模块
最大修改量：~+188 行（净增，含 Code Review 修复项）
```

> 预算说明：纯功能新增（锚点定位）+ 用户体验增强（耗时显示）+ Bug 修复（LoRA 持久化 + Code Review 7 项修复）。最小 DOM 侵入，零架构变更。Code Review 修复净增 ~+26 行。

## v1.0.1

```
新增文件：2（docs/TECHNICAL_DEBT.md, docs/.api-baseline.json）
新增依赖：0
新增公开 API：0（仅清理死导出）
新增模块：0
修改文件：7（src/index.ts, src/comfy.ts, src/databaseLib.ts, src/prompt.ts, src/characterLib.ts, src/nameMatcher.ts, settings.html）
新增文档：2（除 CHANGELOG 外）
净修改量：~-80 行（删除死代码/迁移代码 > 新增逻辑）
```

---

# 6. Current Architecture

当前架构约束：

参见 `docs/ARCHITECTURE.md`。

Status: Frozen

不允许任何超出该文档范围的架构扩展。

---

# 7. Directory Rule

当前目录规则：**扁平结构，按演化拆分。**

```
docs/          (文档)
docs/archive/  (过时版本文档)
src/           (代码，平铺)
tests/         (测试，按需)
```

src/ 不建子目录。只有同一职责拥有 ≥3 个文件时才允许拆分。

---

# 8. Active Tasks

# 8. Active Tasks

| 任务 | 状态 |
|------|------|
| v2.0 双链路 + 词库层 + 公共后处理 + 取消生成 | ✅ 实现完成（未冻结） |
| v2.1 柏宝书信息源（面板 + 三段注入） | ✅ 实现完成（未冻结） |
| v2.2 统一生成管线（TagDoc / 35 模块 / 双解析链 / 校正层） | ✅ 完成并**冻结** |
| v2.2 Anima 严格对齐 + 四源格式统一 + POV 块剔除 | ✅ 完成 |
| v2.2 MCP 标签工具（真 function calling）+ 提示词可编辑 + 第二阶段审核 | ✅ 完成 |
| v2.2 静态 Gate + 离线断言 5 套 + 运行时核心验证 | ✅ 全绿 |
| v2.3 完整出图矩阵复测（三模式 × 审核开关） | ⏳ 待做（首轮） |
| v2.3 管线预览升级 / 信息源统一 Provider / 词库 Worker 化 | ⏳ 候选 |
| v2.3 Civitai 提示词集填充（需 Civitai API Token） | ⏳ 待用户提供 Token |

---

# 9. Blockers

当前阻塞：

无。

---

# 10. Next Task

v2.2 已冻结。下一版本 v2.3 的首轮任务（按优先级）：

1. **完整出图矩阵复测**（冻结时未做）：三种输出模式（description / tags / mixed）× 第二阶段审核开/关，各出图一次并核对格式与内容
2. **Civitai Anima 提示词集填充**：用户提供 Civitai API Token 后按 `data/README.md` 跑 `fetch_civitai_prompts.mjs`，用真实月榜 Top-20 提示词做回归基线
3. **管线预览升级**：用缓存的抽取结果逐阶段预览（阶段 4~9 的产物 + 告警）
4. **信息源统一 Provider**：统一门控口径、统一优先级、同名条目冲突消解、截断按优先级丢尾
5. **词库解码 Worker 化**：把 240ms 的解码 + 建索引移出主线程

v2.3 尚未立项，需用户确认后按 Rule 14 输出编码前清单。

实现要点回顾（供后续维护参考）：

- 单一权威实现：生产路径只走 `runTagPipeline`；`postProcessCommon` / `formatPromptExtTool` 仅为离线回归 oracle
- 统一中间表示 TagDoc：解析一次；三种节型（comma 自然语言 / space 标签 / sentence 英文句子）共存；句子段豁免标签化后处理
- 提示词自由但格式固定：契约块永远最后追加，解析格式不可被破坏
- 第二阶段审核位于「插件处理完成 → ComfyUI」之间；异常不阻断
- 柏宝书：只消费【角色】功能，不使用 vars；只认显式勾选；注入为单行紧凑格式；分档与插件同口径
- Anima 规范：段序 Hard Tags 在前、Natural Language 在后；标签段用下划线形式（空格分隔下无歧义）；规则引擎产出以「校正层」叠加而非替换
- 标签工具走 MCP 在线服务（默认 `https://sakizuki-danboorusearch.hf.space/mcp/mcp`），不使用本地端口地址

---

# 11. Frozen Decisions

以下决策已经冻结：

✅ 项目仅供个人使用

✅ 不考虑通用平台

✅ 不考虑多用户

✅ 不建立 Provider

✅ 不建立插件框架

✅ Version Driven Development

✅ 扁平目录原则（同一职责 ≥3 文件才拆分）

✅ 文档权限等级（低等级文档不得推翻高等级文档）

✅ 状态驱动开发（AI 不得在无下一步定义时自行决定）

✅ 每个版本只证明一件事（Version Proof Principle）

✅ 已证明的能力立即冻结，禁止重新讨论或重构

✅ 冻结前必须通过 Playwright MCP 全量实际测试（DEV_RULES.md v1.2 Rule 21/22，v0.2 及以下版本除外）

✅ 文件演进规则（Evolution Rules）

除非产品目标发生变化，否则不得修改。

---

# 12. AI Instructions

Before any development:

1. Current Version
2. Current Phase
3. Current Milestone
4. Current Constraints
5. Current Task
6. Does this task belong to current milestone?
   YES / NO

7. 如果当前版本需要冻结，是否已完成 Playwright MCP 全量实际测试验证？
   YES / NO / 不适用（v0.2 及之前版本）

如果问题 6 回答 NO，或问题 7 回答 NO（且适用），必须停止当前操作。

---

# 13. Update Rules

只有以下情况允许修改本文件：

完成一个阶段

进入新版本

冻结一个重要决策

其它情况不得修改。

禁止：

记录开发日志。

禁止：

记录历史。

历史统一进入 CHANGELOG。

---

# 14. Proof 文档载体规则

每个版本必须创建 Definition of Done（DoD）和 Proof 文档。

- DoD 路径：`docs/Definition of Done v<version>.md`
- Proof 路径：`docs/v<version>-proof.md`
- 此为新版本启动的前提条件

DoD 和 Proof 是**版本治理工件**，不属于 §13 禁止的"开发日志"。它们定义版本目标、验收标准和验证记录，不记录日常开发过程。

冻结后仅允许以下修改：
- Bug 修复（更新 Proof + CHANGELOG）
- 文档修正（拼写、格式、引用修正）
- 注释修正

禁止：
- 功能新增
- 结构重构
- 依赖变更

---

# Last Updated

2026-10-20 (v2.2 **冻结** — 统一生成管线：单链路 / 双解析链 / 模块化开关 / 两阶段 LLM / Anima Hybrid 严格对齐)

<!-- v2.2：新增 src/pipeline.ts（模块注册表 35 模块 + 旧键幂等迁移 + 标签层管线 + 段序修正 + 校正层）、src/promptPreset.ts（预设/自定义/契约块）、src/tagTool.ts（标签检索）、src/mcpClient.ts（MCP Streamable HTTP 客户端）；
     promptPost 引入统一中间表示 TagDoc（comma/space/sentence 三种节型）；promptBuilder 新增 buildCorrectionInfo（人数/镜头/景别结构化校正）；promptPreset 契约块改写为 Anima Hybrid 规范；
     新增严格格式验证 prompt_format_test.mjs（23 项逐节点）与 fetch_civitai_prompts.mjs（Anima 月榜 Top-N 提示词抓取 + 归一化，产物 data/）；
     修复：四源注入格式统一、POV 叙述者按块剔除、标签段下划线形式、景别裁剪正则、UI 精简（删已迁移显示/失效控件/死开关）、词库后台恢复（消除 240ms 阻塞）。
     验证：静态 Gate 4/4 + 离线断言 5 套全绿 + 运行时（MCP 连通、真实 LLM 4 次 tool_calls、真实 LLM 端到端 Anima 合规输出）。
     冻结说明：按用户指示冻结；完整出图矩阵（三模式 × 审核开关）未做，列为 v2.3 首轮复测。 -->
