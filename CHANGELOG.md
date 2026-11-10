# CHANGELOG

## v2.3.1-opt — 三模式专用规范重构 + Review增强 + JSON契约统一 (2026-10-26)

> 来源：对 mixed/tags/description 三种输出模式的**专用规范缺失、Review基准薄弱、JSON格式契约不一**三大系统性问题进行全链路重构。

### Added
- **`FIELD_CONTRACT` 单一事实源**：13 字段完整契约（职责/必填/默认来源/去重关系），消除 Schema/提示词/解析三处脱节
- **三模式专用规范**：
  - `TAGS_MODE_DESCRIPTION_RULES` —— tags 模式极简短语增量（空间/光影/动作状态/画面文字，同行渲染）
  - `DESCRIPTION_MODE_RULES` —— description 模式三层结构（主体姿态→互动空间→环境光影收束）+ 隐性字段一致性（optics/mainSubject 强约束）
- **三模式专用 Review 基准**（含 Few-shot 示例）：
  - `REVIEW_TAGS_CHECKS`：同义归一（pov+male pov→pov 等 4 组）、缺失标签语义单选（faceless/head out of frame/male face out of frame/solo focus 四选一）、description 增量检查
  - `REVIEW_DESCRIPTION_CHECKS`：三层结构强制、隐性字段一致性、身份/外观密度控制、Few-shot 输入输出对比
  - `REVIEW_MIXED_CHECKS`：跨层去重强制、三层结构、镜头词不重复
- **JSON 格式契约统一**：
  - 抽取阶段：必须 `<thinking>` + `<json>` 双标签，`parseJson` 自动提取
  - 审核阶段：直接输出合法 JSON（无标签），`REVIEW_CONTRACT` 明确
  - `buildSchemaContract` 从 `FIELD_CONTRACT` 自动生成字段说明

### Fixed
- **tags 模式 description 被丢弃**：现解析为 phrase section，渲染时追加到 tags 行尾（`explicit, 1girl, ..., between his knees, warm lamplight`）
- **description 模式无结构约束**：现强制三层句子 + 必填 `mainSubject/optics` 供程序校正景别/镜头/人数
- **跨层重复仅告警**：Review 现按规范强制清理（tags 模式删 description 留 tags / description 模式密度控制）
- **缺失标签过度使用**：四种表达语义区分（faceless/head out of frame/male face out of frame/solo focus），强制四选一，有身体在画面仅 faceless
- **同义词冗余**：Review 强制归一（pov+male pov→pov、chastity belt组合词、服装状态词合并）
- **JSON 解析脆弱**：`parseJson` 支持双标签/无标签/Markdown围栏兼容，错误信息含切片前200字

### Changed
- `buildModeRules` / `MODE_OUTPUT_ROLE`：三模式差异化注入专用规范与职责描述
- `renderTagDoc(mode?)`：新增 mode 参数，tags 模式同行合并 description 增量
- `TagPipelineInput.corrections`：新增 `opticsWordsV2` 结构化镜头词（subjectDirection/cameraAngle/distance/focusTarget/depthOfField/composition/perspective/intent）
- `CROSS_LAYER_DUPES`：新增 7 个镜头词去重规则；`CROSS_LAYER_CONFLICTS`：新增近景与下半身冲突检查
- `REVIEW_CONTRACT`：明确审核阶段直接输出 JSON 对象（无 `<thinking>`/`<json>` 标签）
- 版本号：`package.json` `2.3.1` → `2.3.1-opt`

### Removed
- 旧版 `REVIEW_TAGS_CHECKS` / `REVIEW_DESCRIPTION_CHECKS` 泛泛基准（已被三模式专用版本替代）
- `COMMON_RULES` 中混合模式通用的「动作链」措辞 → 改为「静态交互关系」

### Migration Notes
- 用户自定义预设无需修改（三层结构：可编辑层/固定层/契约层，固定层自动追加）
- `llm.review` 模块建议开启（默认已改为 `true`，见 `pipeline.ts`），以获得跨层清理/同义归一/结构强制的完整收益
- `fmt.prefix_dedup` 默认开启（收紧匹配规则后安全）

---

## v2.3.1 — 阶段6/7 严格审查修复：十项静默缺陷 + 死代码清理 + 管线预览 (2026-10-20)

> 来源：对阶段6（标签层后处理）与阶段7（格式化）逐模块的严格审查（多维度风险 / 价值 / 维护成本评估），随后**逐项全量执行**。
> 审查结论：阶段6/7 的**注册表完备、文档齐全、静态 Gate 全绿**，但存在 **3 项高危静默失效 + 2 项高危语义错配**；根因不是某个模块写错，而是三条系统性债 —— ① **形态双轨**（空格/下划线两种表示使 `\b` 词边界规则在标签链下集体失效）② **段序债**（v2.0 的「截断最后一段」规则在 v2.2 段序反转后语义已倒置）③ **路径分叉债**（同一段自然语言按「句子」还是按「标签」处理，取决于 LLM 是否返回 `description`，而该分叉此前完全不可见）。
> 静态 Gate：`tsc --noEmit` 零错误 · `eslint src/` 零错误 · 离线断言全绿（链路 A/B 8/8 · 词库链路 8/8 · P0 8/8 · 柏宝书 38/38 · 管线 17/17 · 注入格式 8/8 · v2.3 POV 18/18 · v2.3 阶段5 15/15 · **v2.3 阶段6/7 回归 23/23**）· 严格格式 **25/25**。

### Fixed
- **① 标签预算截断对象错位（高危静默）**：`modBudget` 取「最后一个非句子段」截断，而 v2.2 已把 Hard Tags 调到段首 → 回退路径（LLM 未返回 `description`）下**截断的是自然语言/环境行，标签段完全不受限**；实测 `budgetMax=10` 时环境行被整段删掉，而「标签预算」名不副实
  - 修复：预算目标段显式化为 **Hard Tags 段**（`kind==="tags"`）；告警列出**被删标签名**（`标签超预算（上限 8），已从尾部截断 3 条: standing, office, sunlight`）；无标签段时预算不生效（不再动任何段）
- **② 景别冲突告警在标签链下恒不触发（高危静默）**：Hard Tags 是下划线形式（`close_up` / `black_shoes`），而 `\b{word}\b` 遇 `_` 不成立 → 「近景 + 下半身词」告警**形同虚设**（只在逗号描述段偶发触发）
  - 修复：匹配前做形态归一（下划线/连字符→空格）；实测 `close_up + large_breasts/black_shoes` 现可正常告警
- **③ 自然语言语义分叉不可见（高危语义错配）**：阶段6/7 对自然语言段是按**完整句子**（LLM 直出 description）还是按**逗号短语**（回退规则引擎产物）处理，取决于 LLM 是否返回 `description` —— 同一版本不同用户的出图差异无法归因
  - 修复：新增报告行「自然语言语义」，显式写明本次走的是哪条路径（诊断区与管线预览均可见）
- **④ 跨段去重吃掉自然语言段 + 与阶段5 重复互斥**：`resolve.dual_dedup`（删标签段）与 `pp.dedup` 跨段去重（删描述段）是同一规则的两份实现，受害者相反 → 关掉其中一个开关，描述段会被整个吃空（实测 `1girl, black hair, white shirt, standing.` → `standing.`）
  - 修复：**删除 `resolve.dual_dedup`**（失效开关清理）；`pp.dedup` 改为**段内去重 + 跨段重复只告警不删**（列出重复词）
- **⑤ 情绪/过程词对下划线多词标签失效（形态依赖）**：切词按空白切 → `big_smile` / `mid_thrust` / `running_shoes` 全部放行；且 `EMOTION_LIST` 里没有 `smiling/smile`，模块描述却在承诺剔除
  - 修复：匹配前把下划线视为分隔符；Hard Tags 段按**标签原子性**整条删除（不留 `big` / `mid` 这种无意义碎片），短语段沿用「删词留段」；情绪词表补齐 `smiling/smile/blushing/blush/grinning/grin`（与模块描述对齐）
- **⑥ 阶段7 诊断无归因、单位混用、未执行却显示「已执行」**：四个 fmt 模块挤在一个函数里跑 → 报告里 in/out 完全相同；`fmt.render` 的 out 是**字符数**而其余是**标签条数**（同一列两种量纲）；无标签段时仍标「已执行」
  - 修复：四个模块拆成独立函数并逐个执行 → 逐模块报告；报告新增 `applied` 字段与 `unit` 字段；界面改为**三态**（已跳过 / 未执行 / 已执行），条数与字符数分列
- **⑦ 前缀去重误删语义不同的标签**：`blue_hair + blue_hair_ribbon` → 只剩后者（**发色丢失**），且零告警
  - 修复：收紧匹配（仅当更长标签 = 短标签 + **身体部位词**时才删：`pov` + `pov_crotch` ✓ / `blue_hair` + `blue_hair_ribbon` ✗）；删除时告警；**默认关闭**（一次性对齐 `pipeline_prefix_dedup_aligned`）
- **⑧ 权重映射对别名归一后的标签失效**：用户写 `silver hair=1.3`，标签被别名归一成 `grey_hair` → 权重不生效且无提示；人数标签（`1girl`）被无差别加权（破坏 Anima 计数 token 语义）
  - 修复：查表同时支持原始键 / 下划线键 / 空格键 / **别名归一后**的键；人数标签跳过并告警
- **⑨ 词库校验对自然语言段误报**：英文散文（`a graceful woman, elegant posture`）被判「模型可能不识别」→ 稀释告警可信度
  - 修复：校验范围收窄到 **Hard Tags 段**（自然语言段不参与词库校验）
- **⑩ 句子段中文残留无告警 → 最终报「提示词为空」**：句子段的中文不能整句删（会破坏句子），此前**静默保留**，阶段8 兜底把整段剥光 → 最终提示词为空 → 用户看到的是相隔 4 个阶段的错误信息
  - 修复：阶段6 产出可归因告警（「自然语言段残留中文」）；阶段8 兜底后为空时直接给出归因报错，而不是笼统的「提示词为空」
- **模块描述与实现不符**：`pp.emotion` 描述承诺剔除 `smiling` 但词表里没有 → 随 ⑤ 一并对齐

### Removed
- **删除 v2.0 的两套遗留实现（死代码 ≈ 200 行）**：`postProcessCommon`（公共后处理）与 `formatPromptExtTool`（外部工具格式链路）
  - 它们是阶段6/7 规则的第一份副本，已与管线实现漂移（遗留版仍带「权重映射命中不了」「景别告警在标签链下失效」等已修 bug），却仍被离线测试断言（含 `legacy === modern` 等价性断言）→ 制造「已覆盖」的错觉
  - 规则唯一实现在 `pipeline.ts`；离线测试改为直接跑生产管线
- **删除 `resolve.dual_dedup` 模块**（与 `pp.dedup` 重复且互斥，见 ④）
- **删除 `TagPipelineInput.weightEnabled` 死字段**（写入从不读取，与 `modules["fmt.weight"]` 构成双开关源）

### Changed
- **`pp.budget` → `fmt.budget`**（id 归域）：旧 id 属 `pp.*` 命名域却挂在阶段7，易被误认为阶段6；迁移时自动改名（`pipeline_modules` 每次迁移都做一次 id 归一）
- **`TagSection` 新增 `kind`（`tags` / `phrase` / `sentence`）**：阶段6/7 规则按语义分流 —— 标签段按「标签原子性」处理，短语段按短语处理，句子段不做破坏性处理；这是消除 ③⑤ 两类分叉的结构性手段
- **标签预算上限改为可配置**（`budget_max`，默认 25，此前硬编码不可调）→ 阶段7「标签预算」模块下方就地编辑
- **删除 `stage` 与 `id` 命名域错位**：阶段6 = `pp.*`、阶段7 = `fmt.*`

### Added
- **管线预览（阶段5-7 逐段产物）**：用**缓存的最近一次抽取结果**离线重跑管线并逐段展示 + 阶段报告 —— **不额外调用 LLM、不消耗额度**
  - 收口设计文档 P10「预览链路残缺」：此前预览只到 `llmInput`，看不到阶段5-7 到底把提示词改成了什么样，也无法在不生图的情况下验证开关效果
  - 生成管线 tab 新增「预览阶段5-7」按钮 + 结果区（需先执行一次生成以填充缓存）
- **阶段报告新增 `applied` / `unit` 字段**（`applied`=本次是否真的执行；`unit`=tags|chars），界面三态显示
- **跨段重复告警**（`modDedupCrossCheck`）：列出标签段与描述段重复的词，**只提示不删**
- **离线回归矩阵「v2.3 阶段6/7 回归」23/23**：覆盖此前**完全没有测试覆盖**的回退路径（LLM 未返回 description）与上述十项缺陷 —— 旧的「与 v2.1 postProcessCommon 等价」断言把「截断环境行」的旧行为锁死了，现改为**固定快照 + 语义断言**（快照变更须在 PR 说明原因）

## v2.3 — 生成管线 tab 深度优化：模块即入口 · 单一开关 · 移除 NSFW 适配块 (2026-10-20)

> 目标：把「生成管线」tab 从「开关清单 + 分散设置区」改成「模块即入口」——开关与它的编辑区在同一处，阶段1/2 只读显示状态；并修复 POV 判定的系统性误判。
> 静态 Gate：`tsc --noEmit` 零错误 · `eslint src/` 零错误 · 离线断言 6 套全绿（P0 8/8 · 柏宝书 38/38 · 管线 16/16 · 注入格式 8/8 · **v2.3 POV 健壮性 18/18** · **v2.3 阶段5 14/14**）· 严格格式 23/23。
> 运行时实测：真实 ST（127.0.0.1:8000）内打开生成管线 tab —— 9 阶段 / 7 状态徽标 / 5 就地编辑器 / 词库双按钮同行等高对齐；POV 说明文案由规则表生成且正确标出被忽略的触发词；诊断区渲染逐阶段状态与告警；控制台无 image-st 报错；用户已存提示词模板（含 `{nsfw_section}` 占位符）组装正常、无残留占位符。
> POV 误判复测：用户真实聊天最近 12 条 AI 回复（触发词 `晁大棒,你`）—— **修复前 12/12 误判 POV → 修复后 0/12**。
> 阶段5 复测：真实 LLM 形态输入（完整词库 · mixed）→ 质量词保留、段序恢复为 Anima 规范（画风/质量 → 主体 → 动作 → 背景）、预算截断可见、段结构不塌陷。

### Changed
- **阶段5「解析分流」重构（词库口径 / 段结构 / 段序 / 预算可见性）**
  - **「未收录」判定口径修正**：此前用「标签分类.tsv」（画什么的分类表）当门槛 → 导入完整词库后 `masterpiece / best_quality / highres / 4k / official art` 等**质量词被系统性剔除**，与 Anima 契约（Hard Tags 含质量/年代/分级）直接冲突；现改为 **词库收录 ∪ 分类表收录 ∪ 质量词白名单**，两套词库判定一致，质量词不再被误杀
  - **词库查询统一用空格形式**：此前先转下划线（`black_hair`）再查库，而词库键是空格形式 → 分类/共现/别名/阶段查询**全部落空**；现改为「先查库（空格）→ 输出时才转下划线」
    - 连带修复：分类排序退化为字母序（Anima 段序失效）→ 现按真实分类排 `画风/质量 → 主体 → 动作 → 背景`
    - 连带修复：共现联想只剩单词种子（多词标签查不到邻居）
  - **权重映射此前从未命中**：用户写的是空格形式键（`black hair=1.2`），标签段是下划线形式 → 查找恒为空；现两种写法都查
  - **标签预算截断告警不再被吞**：`step()` 对同一 doc 求值两次，告警函数看到的是已截断结果 → 永远为空（60 标签截到 25 毫无提示）；现改为单次求值，告警与报告行均可见
  - **段结构安全网**：全部标签被判未收录时标签段会塌陷（Anima 双段结构只剩自然语言段）→ 现保留原标签并告警（提示导入完整词库或关闭剔除）
  - **景别裁剪规则补全**：`waist up`（`upper body` 的规范值）此前无规则 → waist-up 景别的下半身裁剪从未生效；现已补齐
  - **阶段分组与执行顺序对齐**：`fmt.prefix_dedup / fmt.enrich / fmt.category_sort / fmt.weight` 此前在阶段5 内部执行 → 已移回阶段7；「标签预算」移到阶段7 末尾（截断的是最终标签列表）
  - **词库校验告警不再误报插件自己注入的词**（如 `medium shot` 此前被判「模型可能不识别」）
  - **共现联想默认关闭**（一次性对齐 `pipeline_enrich_aligned`）：它凭 2 个种子补出最多 12 个邻居（如 `police uniform+office` → `office_lady / pencil_skirt / pantyhose`，甚至凭空改发色），与插件自己的「无出处一律省略、严禁臆造」硬约束冲突；面板描述同步标注「会新增可能与原文不符的标签」
- **POV 判定 / 叙述者剔除重写（误判防护 + 不删错人 + 可观测）**
  - **触发词只匹配【正文】，不再匹配角色信息** —— 此前只要注入了该角色的档案（本地角色库 / MVU / 数据库），任何场景都会被判 POV
  - **触发词命中必须与第一人称同句共现**（去引号后同句出现「我/咱/俺」）才算 POV；仅被提及 → 判 **uncertain**（保守按第三人称处理，**不删任何角色档案**）
  - **触发词规则表**（判定与界面文案同源）：≥ 2 字、不得为代词/常用词（你/我/他/她/自己/大家/主角/视角…）、英文按整词匹配（Al 不命中 Albus）、中文按子串匹配、全角/大小写归一
  - **兜底路径不再猜人**：第一人称密度超阈值时，只有角色信息里**候选唯一**才确定叙述者；候选缺失或不唯一 → **不剔除任何角色档案**（宁多给信息，不删错人）
  - **剔除容错与告警**：方块名与叙述者名不完全一致时（`晁大棒(男主)` ↔ `晁大棒`）可容错匹配；匹配不到时不再静默，改为在诊断报告里记「未找到匹配条目」
  - **判定三态化**：`pov` / `third` / `uncertain`；uncertain 一律按第三人称渲染提示词（视角段走保守分支）
  - **判定进诊断报告**：新增「本次运行诊断」区（生成管线 tab），逐阶段显示「POV 判定 / 解析分流 / 标签后处理 / 格式化」的执行状态、长度变化与告警（此前 `lastPipelineReports` 只写不读、UI 从不展示）
  - **界面提示由规则表生成**（`describePovTriggers`）：实时显示生效规则、当前有效触发词、被忽略的触发词及原因 —— 文案与判定逻辑同源，不会再出现「界面在骗人」
  - 实测（用户真实聊天「在暗网买到了高岭之花」最近 12 条 AI 回复，触发词 `晁大棒,你`）：**修复前 12/12 误判为 POV → 修复后 0/12**；第一人称样本仍正确判定
- **管线模块树重构（同一功能放在一起）**：`settings.html` 的「生成管线」tab 由 6 个并列分区收敛为 2 段（输出模式 + 管线模块），编辑器改为 `<template>` 就地挂载到对应模块下方
  - POV 判定 → POV 叙述者触发词（紧贴开关，编辑时即可看到作用对象）
  - 第一阶段 LLM 抽取 → 提示词模板（预设 + 自定义 + 恢复默认预设）
  - 标签工具调用 → 词库来源 / MCP 端点 / 候选上限 / 往返轮数 / 状态 + **词库管理**
  - 格式化 → 权重映射（`tag=N` 编辑区）
  - 第二阶段 LLM 审核 → 审核模板 + 审核选项
  - 事件改为**委托绑定**（模块树整体重绘不丢事件），重绘后自动回填设置值与上次探测结果
- **阶段1（清洗）/ 阶段2（信息源注入）改为只读状态**：不再提供开关，只显示「已激活 / 未激活」徽标 + 状态摘要 + 去哪儿改（在「文本清洗」/「角色库」tab 调整）
  - 依据：这两段的开关从未参与运行（`clean.*` / `src.*` 的开关值在生成路径中无任何读取点），真实状态由「文本清洗」的楼层数/正则规则/截断百分比与各信息源自己的启用开关决定
  - 阶段1 状态：楼层选取=取最近 N 楼；正则清洗=N 条启用规则；百分比截断=截取 N%
  - 阶段2 状态：MVU / 神·数据库 / 本地角色库 / 柏宝书 各自的启用开关
- **移除 NSFW 激活适配块（经调查后判定无留存必要）**
  - 调查结论：它不是独立链路，而是命中关键词后向 LLM-1 系统提示词追加的一段 ~50 行词库与硬约束；当前管线是单一链路，无需为 NSFW 单独适配
  - 误报风险：默认词表含 `breast / ass / bra / underwear / lingerie / thong / stockings / cum` 等 → 正常画面（角色穿内衣、提到胸部）也会命中，进而把 `spread legs / erection / handjob` 等词与「峰值优先」约束注入提示词，反而污染非露骨出图
  - 漏报风险：中文常见委婉表达未覆盖 → 真正的露骨段落反而不激活，行为不可预期
  - 基础规则已可表达露骨内容（`sexWith` 字段、pose/action 取值、`large breasts`、focus 部位聚焦等），单链路按「所见即所得」如实描写即可
  - 移除项：`promptBuilder.ts` 的 `NSFW_SECTION` / `matchNsfw` / `DEFAULT_NSFW_KEYWORDS`、系统提示词中的 NSFW 分支、`{nsfw_section}` 占位符、设置项 `nsfw_keywords` 与对应输入框
  - 兼容：旧版保存过的预设里若残留 `{nsfw_section}` / `{nsfw}`，组装时替换为空串（不会把占位符原样送进提示词）
- **收敛重复开关（一个功能只留一个开关）**
  - 第二阶段 LLM 审核：删除「启用审核」复选框，统一由模块开关 `llm.review` 决定（此前模块开关 + 隐藏复选框双重把关，任一为关都不生效）
  - 审核格式守卫：删除独立复选框，统一由模块开关 `review.format_guard` 决定
  - 标签工具：删除无效复选框「允许 LLM 使用标签检索工具挑选标签」（`tagtool_enabled` 从未被运行路径读取），统一由模块开关 `tagtool.call` 决定
  - 一次性对齐（旧设置折算进模块开关，`pipeline_switch_aligned`）：`review_enabled=true` → `llm.review=true`；`review_format_guard=false` → `review.format_guard=false`
- **词库导入 / 移除按钮重排**：`menu_button` 原本在 flex 容器内被压缩变形、上下各占一行；改为 `flex-wrap:nowrap` + `flex:0 0 auto` + `white-space:nowrap` + 图标化短标签（导入词库 / 移除持久化），实测同行等高（29px）左对齐

### Fixed
- **阶段5 两个开关从未参与运行（死开关）**
  - `resolve.natural`（自然语言解析链）：v2.2 起自然段由 LLM 直出，开关在全代码库**无任何读取点** → 关闭不生效；已删除（语义并入「解析模式」）
  - `resolve.count_tags`（Danbooru 计数标签）：实际由校正层提供，该开关在 LLM 句子路径下**恒空转**（段头是整句，永远不以性别词结尾）→ 已删除，人数标签改为常驻逻辑（校正层 → 主体头统计兜底）
- **阶段5 段结构/排序/预算三处静默失效**：分类排序退化字母序、预算截断无告警、标签段可能被剔空 → 见上「阶段5 重构」
- **权重映射从未命中**（空格键 vs 下划线标签）→ 见上
- **POV 判定系统性误判（首要问题）**：原实现把「名字被提及」当成「这个人是叙述者」—— 正文提到触发名即判 POV（角色信息命中更甚），导致主角被当成相机从画面中剔除、人数标签被抑制、提示词被改写为主观视角，且**完全静默不可查**
  - 根因：① 触发词匹配范围含角色信息 ② 无「第一人称证据」佐证 ③ 兜底路径把「角色信息里第一个方块」当叙述者 → 删掉在场可见角色的档案 ④ 短名/代词型触发词子串误命中 ⑤ 判定结果不进入任何诊断输出
  - 修复：见上「POV 判定 / 叙述者剔除重写」；失败方向由「疑罪从有」翻转为「疑罪从无」（证据不足时宁多给信息，不删错人）
- **「我」计数兜底路径误删在场角色**：候选不唯一时旧实现取第一个方块（实测会删掉沈曼云而留下真正的叙述者）→ 现改为不猜人
- **叙述者剔除静默失败**：方块标题与触发词不完全一致时剔除无效，叙述者外观泄漏进提示词（v2.2 修过的 bug 在触发词路径复现）→ 现为容错匹配 + 告警
- **POV 判定 / 叙述者剔除开关此前未接入运行**：`pov.detect` / `pov.strip` 的开关值在生成路径中无读取点（关闭不生效）。现接入 `buildInjectionInput`（默认值均为开，行为不变）
- **模块开关状态与实际行为脱节**：阶段1/2 的开关显示「关闭」但功能实际在跑（反之亦然）。现改为按真实来源显示只读状态
- **模块依赖置灰**：`pov.strip` 依赖 `pov.detect`、审核与标签工具依赖 `llm.extract`，依赖未满足时开关置灰并提示

### Removed
- 设置项 `nsfw_keywords`（含设置面板输入框）、`review_enabled` / `review_format_guard` 的界面复选框、`tagtool_enabled` 界面复选框
- 失效模块开关 `resolve.natural`（自然语言解析链）、`resolve.count_tags`（Danbooru 计数标签）—— 迁移时自动从设置中清除
- 旧的独立分区：视角与内容过滤 / 权重映射 / 第一阶段 LLM 提示词 / 第二阶段 LLM 审核 / Danbooru 标签工具（内容已就地并入模块树）

## v2.2 — 统一生成管线：单链路 · 双解析链 · 模块化开关 · 两阶段 LLM · Anima Hybrid 严格对齐 (2026-10-20)【已冻结】

> 方案与决策记录：`docs/design-pipeline-v2.2.md`（含 A 方案决策）
> 冻结说明：静态 Gate 4/4 + 离线断言 5 套全绿 + 运行时（MCP 连通 / 真实 LLM 工具调用 / 真实 LLM 端到端 Anima 合规输出）；**完整出图矩阵未做**（三模式 × 审核开关），列为 v2.3 首轮复测。
> 证明归档：`docs/archive/proofs/v2.2-proof.md`；DoD：`docs/Definition of Done v2.2.md`

### Added
- **Civitai Anima 提示词集抓取工具**（新 `fetch_civitai_prompts.mjs` + `data/`）
  - 抓取 `civitai.red` 上 **baseModel=Anima**（自动排除 AnimateDiff / Animagine / anima_pencil-XL）的月排行（`period=Month` + `sort=Most Reactions`）Top-N 提示词
  - 跨 Anima 全部 8 个版本（turbo/aesthetic/base/preview）收集并按内容去重
  - 整理为插件可直接消费的 Anima Hybrid 结构：`tags`（Hard Tags，多词保留下划线）+ `sentences`（Natural Language 完整英文句子）
  - 双运行方式：Node 直跑（需 `CIVITAI_TOKEN`）/ 浏览器同源执行（绕过站点对脚本指纹的 403）
  - 产物：`data/anima_prompt_set.json`（结构与过滤规则见 `data/README.md`）
- **Anima Hybrid 严格对齐（A 方案）**
  - **段序修正**：Hard Tags 段在前，Natural Language 段在后（规范「第一层 Hard Tags → 第二层 Natural Language」）
  - **职责重划**：`tags` = 通用标签（质量/年代/分级、人数/性别/物种/作品、@画师、发色/发型/体型、服装、饰品、**场景/表情/动作**、精确场景焦点）；`description` = **完整英文句子**（2~3 句；单人物首句「画面位置 + 肤色/发色 + 关键体征」，末句交代主光源/阴影/肤色层次；多人每角色一句）
  - **句子级解析**（`parseSentenceDoc`）：Natural Language 段按句号切分，不再被逗号切碎；句子段豁免标签化后处理（sanitize / dedup / 情绪 / 过程词 / CJK / 预算）
  - **规则引擎降级为「校正层」**（`buildCorrectionInfo`）：LLM 直出时不再丢弃规则引擎产物，而是叠加确定性要素 —— 人数标签补全（Anima Hard Tags 形式，缺失才补）、镜头/构图词补入（置句首）、景别兼容性裁剪（close-up 排除胸部/腿部，upper body 排除下半身）
- **严格格式验证测试**（`prompt_format_test.mjs`，23 项）：逐节点校验最终 prompt —— 分段结构、段序、标签形态（大小写/标点/重复）、句子完整性（主谓宾/句末标点/句数区间/逗号流水检测）、质量词与人数标签存在性、景别与标签兼容性；含 4 项负向用例（逗号流水、标签含逗号、缺质量词、段序颠倒必须被判不合规）
- **MCP 在线标签工具 + 真·function calling**（新 `src/mcpClient.ts`）
  - MCP Streamable HTTP 客户端（initialize → tools/list → tools/call，JSON/SSE 双解析）
  - 默认端点 `https://sakizuki-danboorusearch.hf.space/mcp/mcp`（DanbooruSearch，已验证 CORS 直连）；**不再使用任何本地端口地址**
  - 开放工具：`search_tags`（自然语言→Danbooru 标签）、`get_related_tags`（共现）、`get_anima_format`（Anima 格式规范）
  - `api.ts` 支持 `tools` 参数并收集流式 `delta.tool_calls`；抽取与审核两阶段均可发起**多轮工具往返**（默认 3 轮）
  - 服务不支持 tools 时自动降级为「候选预注入」形态
- **Anima Hybrid 双表示与职责分离提示词**（默认输出模式改为 **mixed**）
  - `tags` = Hard Tags：只放外观与身份（质量/人数/性别/物种/作品/@画师/发色/发型/瞳色/肤色/体型/服装/配饰/场景焦点）
  - `description` = Natural Language：只放动作与关系（动作/视线/交互/姿态/构图/镜头/光照/空间关系），自然语言小句
  - 严格互斥：外观不写进 description，动作与视线不写进 tags（契约块同步写明）
- **统一中间表示 TagDoc**（`promptPost.ts`）：`TagSection{ tags[], sep }`；解析一次后所有环节只操作数组，消除重复清洗、预算口径错位与格式混排
- **模块注册表与统一开关体系**（新 `pipeline.ts`）：9 阶段 / 35 模块，逐模块声明默认状态、破坏性标记与依赖；面板按阶段分组展示，依赖未满足自动置灰
- **输出模式下拉**：第一阶段 LLM 改为输出「Danbooru 标签 + 自然语言描述」双表示，按需选其一 —— `description`（默认）/ `tags` / `mixed`
- **两条内部解析链**：自然语言链（规则引擎组装：人数标签 / 性别启发式 / NSFW 排他 / 景别裁衣）；Danbooru 链（词典匹配优化：归一 → 未收录剔除+告警 → 前缀去重 → 共现 → 分类排序 → 权重）
- **第二阶段 LLM 审核**（默认关闭）：位置在**插件处理完成后的最终 prompt → 审查优化 → 送 ComfyUI 之前**；固定输出 `{prompt, notes}`；失败不阻断（保留原提示词）；格式守卫；审核前后对照
- **提示词可编辑**：两阶段各自的「预设（可改写）+ 自定义追加」；**输出格式契约块固定追加、不可关闭** —— 无论怎么改提示词，解析格式都不会被破坏
- **Danbooru 标签工具**（新 `tagTool.ts`）：本地词库检索（词面 + 中文释义 + 共现）与外部词库服务适配（自动探测、失败回落本地），以候选清单注入提示词供模型挑选
- **生成管线独立 tab**（`settings.html` / `ui.ts`）：模块开关树、输出模式、两阶段提示词编辑、审核设置、标签工具设置与词库状态行
- **设置迁移**：`gen_pipeline` / `pp_*` / `ext_*` / `mvu_enabled` 等 v2.1 旧键一次性迁移到模块开关（幂等，旧键保留只读）

### Changed
- `src/index.ts` — 走统一管线（`runTagPipeline`）取代原先的 `postProcessCommon` + `formatPromptExtTool` 分支；合成阶段接入模块开关；新增第二阶段审核环节
- `src/promptBuilder.ts` — 系统提示词支持输出模式参数；schema 增加可选 `description` / `tags`
- `src/promptPost.ts` — 后处理拆为可独立开关的模块函数（`modSanitize` / `modDedup` / `modEmotionStrip` / `modProcessStrip` / `modCjkStrip` / `modSceneConflictGuard` / `modBudget` / `modDictValidate`）
- `src/promptPost.ts` 的 `postProcessCommon` / `formatPromptExtTool` 保留为**离线回归的参考实现（oracle）**，生产路径不再调用

### Fixed
- **标签段多词歧义**：标签段以空格分隔，而 `sanitizeTokenP0` 会把下划线转成空格 → "best quality" 变成两个 token（消费端无法区分一个标签与两个标签）→ 标签段改为**统一下划线形式**（Danbooru 标准：`best_quality` / `wooden_bed` / `on_all_fours`），别名归一同步适配；景别裁剪与校验的词边界正则改为「非字母边界」（下划线视为分隔符）
- **未收录标签剔除不可配置** → 新增模块 `resolve.strip_unlisted`（默认开=剔除+告警）；**未导入完整词库时可在生成管线 tab 关闭**（改为保留+告警）
- **四源注入格式不统一**：MVU / 数据库 / 本地库 / 柏宝书统一为「段头 + 单行条目 `[名称] 键:值 键:值`」，条目间单换行；段头统一由 index.ts 添加
- **POV 叙述者剔除泄漏**：旧实现只删 `[叙述者]` 标题行，字段行（外貌/服装/性格）仍留在提示词里 → 改为**按块剔除**（标题行 + 块内续行，遇段头恢复），并跳过 MVU 的点分路径标题（避免误判叙述者）
- **词库恢复阻塞生成**：完整词库（解码 93ms + 建索引 147ms = 240ms / 94MB）原先在**每次生成时**同步等待 → 改为**页面加载后台恢复**，生成路径只检查就绪状态，未就绪则降级内嵌精选并告警
- **UI 旧功能残留清理**：LLM tab 中已失效的旧控件（`gen_pipeline` 下拉、`ext_*` 5 个、`pp_*` 8 个，共 14 个）已移除 —— 这些控件只写旧键，而生产路径只读模块开关，改它们**不生效**；相关只读状态块也已删除（面板精简），**唯一编辑入口 = 「生成管线」tab**
- **无效开关**：旧版角色串格式（`prompt_legacy_subject_format`）自 v3.x 起已不被规则引擎读取（人数标签恒定、性别恒并入），属死开关 → 已移除
- **POV / NSFW 设置归位**：从「LLM 连接」tab 迁入「生成管线」tab（与 POV 判定模块、NSFW 提示词块同属管线语义）
- **词库导入入口不可达**：`词库.bmz` 导入/移除按钮原先被 `ext_options` 隐藏块包住，已迁到生成管线 tab 独立可见
- **权重映射无入口**：`ext_weight_map` 此前没有任何 UI 入口（权重功能实际不可用），已补上编辑区（每行 `tag=N`）
- **迁移把值型旧键当开关**：`pov_triggers=""` 会让迁移把「POV 判定」误判为关闭（功能回归）→ 值型旧键不再参与开关推导
- **迁移只执行一次**：版本新增模块在已迁移用户上拿不到默认开关 → 改为每次启动补齐缺失模块的默认值（不覆盖用户已有选择）
- **预算口径错位**：预算统一在标签层统计，与最终标签数一致（此前在自然语言段统计，与空格标签串对不上）
- **格式混排**：外部拼接与标签层输出统一按目标分隔符渲染（此前固定用逗号拼接，污染空格链路）
- **CJK 双重清洗**：中文兜底只在合成阶段做一次（此前后处理与尾处理各做一遍）
- **状态块不刷新**：已迁移设置的只读状态块现随模块开关 / 解析模式变更实时同步

### Verified
- `tsc --noEmit` ✅ 零错误 · `eslint src/` ✅ 零错误 · `npm run build` ✅ 通过
- 离线断言 ✅ 管线 12/12（含**等价性**：新管线 description 模式产物 == v2.1 产物）· 柏宝书 38/38 · 链路 A/B/词库 B/P0 各 8/8
- 运行时 ✅ 生成管线 tab 在真实 ST 中渲染正常；⏳ 三种输出模式与审核开/关的实机出图待复测 → 本版本**未冻结**

## v2.1 — 柏宝书（ST-BaiBai-Book）信息源：角色 / 场景 / 物品三组面板 + 三段注入 (2026-10-20)

### Added
- **柏宝书信息源**（新增 `src/baibaiLib.ts`）：只读柏宝书公开 API（`globalThis.STBaiBaiBook.getSnapshot()`），作为继 MVU / 神·数据库 / 本地角色库之后的第三个信息源
  - 只消费【角色】功能：主角档案 / NPC 名册 / 场景树 / 物品 / 时间地点 / 局势卡；**不使用**其自定义变量系统（`vars`）
  - 按柏宝书自身语义分档：角色（主要角色 / 在场 / 同区域 / 不在场）、场景（当前地点 / 上级地点 / 其他地点）、物品（随身 / 在场可取 / 他处寄存）
  - 分档判定与插件同口径（`classifyNpcPresence` / `itemReachableAtScene` / `sceneRelation`）
- **柏宝书角色库面板**（角色库 tab 第三个折叠区，交互与 MVU / 神·数据库一致）
  - 三级勾选树：分组（档位）→ 条目 → 字段，全部三态；条目级/分组级 checkbox 一键全选
  - 状态行、已选 chips（带 × 移除 / 清空全部）、搜索过滤、全部展开收起、失效选择提示条
  - 「读取名册」与「按默认勾选」按钮
- **三段注入**：`【角色信息·柏宝书】` / `【场景信息·柏宝书】` / `【物品信息·柏宝书】`
  - 紧凑格式：每个条目一行、字段空格分隔（`[艾琳] 性别:女 年龄:25 外貌:黑色长发，左眉有疤`）
  - 主角档案单独处理：非 POV 并入角色段，POV 场景叙述者即镜头、不入画
- **设置项**：`bbs_enabled` / `bbs_include_nearby` / `bbs_include_absent` / `bbs_include_other_scenes` / `bbs_include_distant_items` / `bbs_name_gate` / `bbs_selection`

### Fixed
- **未勾选也注入**：柏宝书字段选择改为**只认显式勾选**（与 MVU / 数据库一致），此前存在隐式默认字段导致「界面没勾也照样注入」的错位；改由「按默认勾选」按钮显式铺好视觉字段
- **注入冗余**：场景名 / 物品名不再作为字段重复输出（条目标签已含名称）；时间 / 局面 / 在场名单只在「当前地点」输出一次；条目间由空行改为单换行
- **截断行为**：注入超预算时停止全部输出（此前仅中断当前分组）

### Verified
- `tsc --noEmit`: ✅ 零错误 · `eslint src/`: ✅ 零错误 · `npm run build`: ✅ 通过
- 离线断言: ✅ 柏宝书 38/38（分档 / 可达 / 场景链 / 白名单 / 显式勾选 / 紧凑格式 / 失效检测）
- 运行时: ✅ 真实 ST 中面板加载与三组树渲染已验证（截图核对）；⚠️ 注入链路待带真实聊天数据复测 → 本版本**未冻结**

## v2.0 — 双链路生成 + 词库层 + 公共后处理 + 取消生成 (2026-10-20)

### Added
- **双链路生成**: `gen_pipeline` 设置项（`current` 默认 / `extool` 外部工具纯标签格式）。`extool` 输出「纯标签 + 空格 + 分类排序（画风→主体→动作→背景）」，**不产出**画师串 / 质量词 / 负面提示词；负提示词仍走全局设置
- **词库层**（新建 4 模块 + 1 生成文件）:
  - `src/lexicon.ts` — BMZ1 词库包解码（PBKDF2-SHA256 12 万次 + AES-256-GCM + gzip）、5 层索引（manual / mt / custom / builtin / big）、共现邻居、标签分类、Danbooru 别名归一
  - `src/lexiconStore.ts` — 词库原始字节 IndexedDB 持久化（只存密文，自带 GCM 完整性校验）
  - `src/defaultLexicon.ts` — 默认内嵌精选词库 + 导入 / 刷新恢复 / 移除（恢复与导入共用同一构建路径）
  - `src/builtinDict.ts` — 由 `_extract_builtin.mjs` 从参考插件 BM_DICT_RAW 生成的内嵌精选（1040 条）
  - 链路 B 启用词库后：贪心分解成已收录 Danbooru 标签 + 分类排序 + 可选共现联想
- **公共后处理**（`src/promptPost.ts` `postProcessCommon`）: 标签清洗 / 跨节变体折叠去重 / 情绪词硬剔 / 残留过程词硬剔 / 中文 CJK 兜底 / 景别↔下半身冲突告警 / 标签预算（尾部截断）; 非破坏性附加 Danbooru 词形归一（`black_hair`→`black hair`、`silver hair`→`grey hair`）与权重 token 保留（`(solo:3)` / `(2character:3)`）
- **词库校验告警**（`pp_validate`）: 零覆盖短语只告警不删，控制台诊断「模型可能不识别」
- **LLM 调用优化**: `llm_json_mode`（纯 JSON `response_format`，与文本思维链二选一）、`retry_json_fail`（解析失败自动重发一次）、`formatLLMError`（HTTP 状态 → 可读中文文案：401 密钥 / 402 余额 / 403 权限 / 404 地址 / 429 频率 / 400 参数）
- **取消生成**: 浮窗「取消生成」按钮 → AbortController 中断 LLM 与 ComfyUI 渲染; ComfyUI 轮询单次 fetch 20s 超时，避免断连锁死; 取消态显示「已取消」而非失败
- **规则引擎 species**: 非人类种族/生物标签并入主语头（`A green-skinned orc man`），抑制非人角色被画成人的幻觉
- **角色串格式 v2.x**: `prompt_legacy_subject_format`（默认新格式：无人数标签、性别并入括号短语）

### Changed
- `src/nameMatcher.ts` — 新增 `matchesNameVariant`：含拉丁字母的变体按词边界匹配（`Al` 不再命中 `Alice`/`wall`），中文变体排除单字; 拉丁名按单词边界拆全名/名/姓，取消单字别名
- `src/localLib.ts` — 角色名匹配改用收紧口径（避免短变体 / 半词误注入）
- `src/comfy.ts` — `generateComfyImage` 新增 `signal` 参数，支持中断渲染
- `src/api.ts` — LLM HTTP 错误改用可读文案（不再直接抛 status）
- `src/promptBuilder.ts` — 系统提示词与 schema 增加 `species` 字段与约束
- `settings.html` — ComfyUI tab 新增「生成链路」下拉、链路 B 选项组、公共后处理开关组、纯 JSON 模式与 JSON 重试开关、词库导入/移除
- `package.json` / `manifest.json` — version 1.9 → 2.0
- `docs/.api-baseline.json` — 同步至 v2.0（215 条导出；事实补登 v1.3–v1.9 遗漏项）

### Fixed
- **eslint 未归零**: 删除 `promptBuilder.ts` 两个死函数（`formatOpticsLine` / `buildSummary`，v3.x 起已不再输出独立镜头行与概要行）
- **目录结构违规**: `src/data/` 子目录扁平化为 `src/builtinDict.ts`（PROJECT_STATE §7 扁平结构 / ARCHITECTURE §5 子目录需同职责 ≥3 文件）
- **运行时资源漏入库**: 内置工作流 `（自用）Anima正式版-文生图工作流.json` 纳入版本管理（运行时按固定路径 fetch，漏入库将 404 断链）

### Verified
- `tsc --noEmit`: ✅ 零错误
- `eslint src/`: ✅ 零错误
- `npm run build`: ✅ 通过（新增 lexicon / lexiconStore / defaultLexicon / promptPost / builtinDict 产物）
- 离线质量测试: ✅ 链路 A 8/8 · 链路 B 8/8 · 词库链路 B 8/8 零噪声 · P0 8/8 · 完整词库 347,094 词加载
- 运行时 Gate（G5）: ⏳ 待执行（链路 A/B 生图 + 词库导入与刷新恢复 + 取消生成）→ 本版本**未冻结**

## v1.9 — 工作流优化适配 + 本地角色库特征结构简化 + NSFW 适配 (2026-08-16)

### Added
- **结构化 JSON → 规则引擎工作流**: 新增 `src/promptBuilder.ts`，移植「（测试）工作流优化」的确定性规则引擎（`resolveOptics`/`formatOpticsLine`/`buildPrompt`）；LLM 不再直接输出多行 prompt，改为输出结构化 JSON，由代码保证词表/互斥/依赖/回退/格式
- **POV 前置判定**: `detectPov()`（叙述者触发词 + 第一人称「我」计数兜底）+ `stripNarrator()`（POV 时剔除叙述者角色块）；触发词可配置（`pov_triggers` 设置项，默认空）
- **NSFW 适配**: 本地角色库固定槽位新增 NSFW 身体特征（胸部/乳晕/乳头/腰胯臀/私处）与内衣槽位（内衣上身/内衣下身），由 `nsfw_enabled` 开关控制（默认 false）；`optics` 引擎保留 `<部位>focus` 身体部位白名单
- **api.ts**: `callLLM`/`generateLLMPrompt` 新增 `jsonMode` 参数，启用时携带 `response_format:{type:"json_object"}` 与 `enable_thinking:false`

### Changed
- **本地角色库固定槽位化**: `localLib.ts` 抽取 schema 从「基础身份/外观/服装系统/配饰/细粒度标签」简化为「核心DNA/服装DNA」固定槽位；增加身体特征（身高/体型/肩宽/肤色肤质/手部），服装简化为固定层级（妆容/外套/内搭/下装/鞋袜/配件），移除心理/声音/气味/数值/技能/关系等非视觉内容；注入格式改为 `核心DNA: 发色{...}; 体型{...}` / `服装DNA: 外套{...}; 内搭{...}`；旧版库经 `isLegacyCharacter` 判定后需重建
- **prompt.ts**: `DEFAULT_SYSTEM_PROMPT` 从 5 模块英文提示词改为「结构化 JSON 抽取」提示词（运行时按 POV 判定动态构建）
- **index.ts**: `onGenerate()` 接入 JSON→`parseJson`→`buildPrompt` 链路；新增 `nsfw_enabled`/`pov_triggers` 设置项
- **settings.html / ui.ts**: LLM tab 新增「POV 叙述者触发词」输入，本地角色库新增「NSFW 特征」开关
- `package.json` / `manifest.json`: version 1.7 → 1.9

### Removed
- **死开关清理**: 删除 4 个「提示词后处理」开关（JSON 清洗/小写/删中文/标点清洗）及其 UI 与设置项
- **系统提示词文本框**: 删除「系统提示词」编辑框及 `llm_system_prompt` 设置项（系统提示词改为按 POV 动态构建）
- **v1.7 后处理链**: 删除 `postProcessPrompt`/`cleanJsonPrompt`/`stripChinese`/`toLowerCaseEnglish`/`cleanPunctuation`/`normalizePhraseSeparators`/`mergeUI` 死代码
- **仓库杂物归档**: `src/localLib.ts.bak`、`酒馆角色卡/`、`（测试）工作流优化/` 压缩归档至 `杂物归档-20260816.zip` 并移除原始文件

### Fixed
- **注入预览不一致**: 提取公共 `buildInjectionInput()`，`onGenerate` 与 `previewInjectionPipeline` 共用（POV 判定 + 叙述者剔除 + 段截断统一）
- **「模型思考」复选框失效**: `image_st_local_thinking_enabled` 补充事件绑定
- **删中文兜底**: 新增 `stripChineseFallback`，规则引擎输出后无条件剔除偶发中文/CJK 标点
- **本地角色库注入失效**: 旧版库被 `isLegacyCharacter` 静默过滤导致注入为空，补充明确告警日志；`sanitizeDna` 容忍 LLM 输出字符串；`detectPov`/`stripNarrator` 正则改为仅匹配 `[角色名]`、跳过 `【区块】` 标题
- **POV 生图三缺陷修复**: 采纳「绘图模型tag生成器 / 3.0_1 人体姿势 / 附录2 第一人称视角」规则——① POV 场景不再输出 `(solo:2)`、第一/第二人称代词 `me/my/you` 映射为 `viewer/viewer's`，summary 追加 `pov view`；② 新增 `povBody` 字段（如 `male pov, pov crotch, erection, penetration`），POV 性行为时叙述者生殖器可见；③ 系统提示词新增「动作链句法/代词禁令/交合体位先定躯干朝向/单一锚点/体位名+景别配合」硬约束，消除 `during intercourse` 过程词导致的畸变

### Verified
- tsc --noEmit: ✅ 零错误
- eslint src/: ✅ 零错误
- dist 构建: ✅ 通过（新增 promptBuilder.js）

## v1.7 — 角色库注入链路稳定性修复 (2026-08-08)

### Fixed
- **数据库迁移数据丢失**: `migrateDbSelections()` 移除无条件写回副作用，仅在迁移结果非空时才更新 `s.db_selection`，避免旧格式选择在切换角色卡/刷新后被静默清空
- **注入截断丢弃后续段**: `COMBINED_MAX=5000` 逻辑重构，首个超长段不再触发 `break` 丢弃后续段，改为逐段在剩余空间内按句号边界截断并标记 `(注入信息已截断)`，确保角色信息段与正文段均有机会进入 LLM 输入
- **`findNameColIndex` 任意回退**: 找不到 name 列时不再回退到第 1 列猜测，改为返回 `-1`；`scanDatabaseCharacters()` / `extractDatabaseInfoSegment()` 调用方在 `nameIdx < 0` 时跳过该表，避免将 `hp`/`mp` 等字段误当作角色名
- **MVU 空对象失效漏报**: `computeInvalidSelections()` 移除空对象 `{}` 豁免条件，空路径展开零产出统一标记为失效，UI 失效条不再漏报
- **数据库字段值截断无标记**: 单字段超过 100 字符截断时追加 `[...]` 标记，LLM 输入可观测性增强
- **Thinking Budget 持久化显示**: `createSettingsUI()` 模板 data 补传 `thinking_budget` 字段，设置面板重新打开时正确回显已保存值

### Changed
- `src/databaseLib.ts`: `migrateDbSelections()` 副作用消除 + `findNameColIndex` 返回语义调整 + 3 处调用方 guard + 字段截断标记
- `src/index.ts`: 注入段组合截断策略从 `break` 改为逐段截断
- `src/ui.ts`: `computeInvalidSelections()` 空对象豁免移除
- `src/ui.ts`: `createSettingsUI()` 补传 `thinking_budget` 模板变量
- `package.json` / `manifest.json`: version 1.6 → 1.7

### Verified
- eslint src/: ✅ 零错误

## v1.6 — UI 信息密度优化：渐进披露与折叠收纳 (2026-07-30)

### Added
- **ComfyUI 参数折叠**: 二次采样参数 / LoRA 设置 / 自定义提示词标签 三区使用 `<details>` 默认折叠，初始仅显示 URL/模型/采样步数/尺寸/Seed/提示词等核心控件。仅首次采样参数保持现有条件显隐（`first_steps > 0`）
- **角色库折叠 header**: MVU 角色库与神·数据库两区块各自拥有可折叠 header，点击箭头展开/收起。初始展开状态由启用开关决定（enabled=true 展开，false 折叠）；切换启用开关时自动同步折叠状态
- **状态栏精简**: MVU/数据库状态文本从详细指标简化为简短状态词（`✓ 已选 N 项` / `不可用` / `未启用`），详细信息移入 `title` 属性悬停查看

### Changed
- `settings.html`: ComfyUI tab 3 组 `<details>` 折叠 + charlib tab 2 组 `.image-st-fold-section` 折叠结构
- `src/ui.ts`: 注入折叠 CSS、事件委托 fold header 点击切换、初始状态同步、MVU/DB 启用开关联动折叠
- `src/ui.ts`: `updateMvuStatusSummary()` / `updateDbStatusSummary()` 新增 `image_st_*_fold_status` 精简状态更新
- `CHAT_CHANGED` 事件处理器新增 fold status 更新
- **自定义标签条目折叠冻结**: 未勾选的标签条目内 textarea 和名称输入框 `disabled` + 隐藏，header 仅保留名称(淡化)、启用开关、删除按钮、箭头指示器
- **正则规则条目折叠冻结**: 规则行改为 header/body 双层结构，未勾选时 pattern/replacement 输入框 `disabled` + 隐藏，header 仅保留名称(淡化)、启用开关、删除按钮、箭头指示器
- `package.json` / `manifest.json`: version 1.5 → 1.6

### Verified
- tsc --noEmit: ✅ 零错误
- eslint src/: ✅ 零错误

## v1.5 — 角色信息注入排版优化 + 段顺序可配置 (2026-07-30)

### Added
- **【正文】标签**: 在正文段前添加 `【正文】` 标签头，与 `【角色信息·MVU】` / `【角色信息·数据库】` 机制一致，清晰隔离角色信息与正文，优化模型注意力
- **注入段顺序配置**: 角色库 tab 新增 `注入段顺序` 下拉选择器，支持「角色信息 → 正文（默认）」或「正文 → 角色信息」两种排列
- **`injection_order` 设置项**: 持久化存储段顺序偏好，默认 `"info_first"`（角色信息前置）

### Changed
- **MVU 角色信息排版**: `formatResults()` 输出从 `[label/field1:val1/field2:val2]` 改为多行格式 `[label]\nfield1:val1\nfield2:val2`，每个字段独立一行，条目间空行分隔
- **数据库角色信息排版**: `extractDatabaseInfoSegment()` 输出从 `[name/field1:val1/field2:val2]` 改为多行格式 `[name]\nfield1:val1\nfield2:val2`
- **`onGenerate()` / `previewInjectionPipeline()`**: 段拼接从硬编码顺序改为 `charParts` + `bodyPart` 根据 `injection_order` 动态排序
- `package.json` / `manifest.json`: version 1.4 → 1.5

### Verified
- tsc: ✅ 零错误

## v1.4 — 数据库树形面板 + 姓名匹配增强 + 生成链路稳定性 (2026-07-30)

### Added
- **数据库三态级联树**: 对标 MVU 树结构，表=分支节点（checkbox 一键全选/取消全部字段）、字段=叶子节点（可单独勾选）；搜索过滤（表名/字段名模糊匹配 + 高亮 + 祖先自动展开）、展开/收起全部按钮、已选 chips 区
- **`DbTableSelection` / `DbTableInfo` 接口**: 结构化选择格式 `{ sheetKey, fields[] }`，替代旧的平面 `{ cols: string[] }`
- **`getDbSelections()` / `migrateDbSelections()`**: 新选择存储键访问器 + 旧格式延迟迁移（cachedSheets 就绪后自动触发）
- **`scanDatabaseTables()`**: 返回类型化 `DbTableInfo[]`（key/name/fields/rowCount）
- **`refreshDbPanelExtras()`**: 数据库面板状态汇总 + 已选 chips 独立刷新入口
- **`rebuildDatabaseTableTree()`**: 替代 `rebuildDatabaseTableList()` 的树形渲染
- **DB 输出截断**: `DB_MAX_OUTPUT=2000`，超出追加 `(已截断)`
- **并发防重**: `refreshDbPromise` / `refreshMvuPromise` dedup guard，并发调用共享同一 Promise
- **段组合截断**: `COMBINED_MAX=5000` 保护 LLM 输入总长度，超出追加 `(注入信息已截断)`
- **生成链路 DB 失败警告**: 数据库刷新失败时 toastr.warning 提示，不再静默跳过

### Changed
- **`extractDatabaseInfoSegment` 签名**: `selectedCols: string[]` → `selections: DbTableSelection[]`，按表+字段结构化过滤注入
- **`onGenerate` 签名**: 新增 `isAuto` 参数，自动生成时跳过 `scrollIntoView`，消除自动场景的滚动干扰
- **`initAutoGenerate()`**: 监听事件从 `MESSAGE_RECEIVED` 改为 `GENERATION_ENDED`，更精确的事件触点
- **`nameMatcher.normalize()`**: 新增 `ANNOTATION_RE` 剥离中文注解 `(注释)`/`（注释）`/`【注释】`，提升姓名匹配精度
- **`nameMatcher.generateAliases()`**: 名单字别名支持（`\p{Script=Han}`），如"赵铁柱"→别名"铁柱"+"铁"+"柱"
- **`nameMatcher.buildAliasMap()`**: 修复重复歧义别名日志（`!aliasMap.has(alias)` 守卫）
- **`loadSettings()`**: `db_selection` 默认从 `{ cols: [] }` 改为 `[]`，调用 `migrateDbSelections()` 处理旧格式
- **`previewInjectionPipeline()`**: 同步适配新 DB 选择格式
- **`settings.html`**: 数据库区块从扁平字段列表重构为树结构容器（搜索/展开收起/三态树/chips/失效提示）
- `package.json` / `manifest.json`: version 1.3 → 1.4

### Removed
- `rebuildDatabaseTableList()` → `rebuildDatabaseTableTree()`（导出名变更）
- 旧的 `{ cols: string[] }` 平面选择格式（自动迁移保留向后兼容）

### Fixed
- **自动生成滚动干扰**: 自动触发生成时不再滚动聊天面板
- **自动生成事件错位**: 从 `MESSAGE_RECEIVED` 改为 `GENERATION_ENDED`，避免在消息渲染完成前触发

### Verified
- tsc + eslint: ✅ 零错误
- 详见 docs/v1.4-proof.md

## v1.3-P2 — MVU 字段矩阵视图 (2026-07-28)

### Added
- **字段矩阵视图**: 集合节点（人物/道侣/绝色榜等，含 R2 单成员潜在集合）头部新增矩阵按钮，行=成员、列=字段并集的批量勾选表格；缺字段成员显示"—"，对象值字段显示"▸对象"并引导回列表视图
- **列头一键通配**: 点击列头写入单条通配选择 `["人物","*","字段"]`（nameSegment=集合路径长度），一条覆盖所有成员且未来新增成员自动生效；该列既有具体选择被通配吸收；再次点击移除通配及该列全部具体选择
- **单元格"全员除TA"**: 通配覆盖下点击某成员单元格，自动炸开为其他成员的具体选择并排除该成员；普通状态下单元格切换该成员该字段的具体选择
- **空集合徽标 (R3)**: 无子节点的分支显示"（空）"占位（道侣/灵宠/玉简/功法等）
- 矩阵 CSS：横向溢出滚动、粘性表头、通配覆盖单元格虚线标识，移动端兼容

### Fixed
- **相同路径重复输出（P2 前置缺陷）**: 通配展开与既有具体选择撞车时输出重复——提取层新增精确去重（同路径留一条，name=null 直出优先于门控）

### Verified (WebBridge 实测，《道渊》v5.2 聊天)
- tsc + eslint: ✅ 零错误
- 列头一键勾选"好感" → 单条 `["人物","*","好感"]`，0 条具体残留
- 正文含赵老六 → 输出 `[人物.赵老六.好感:40]`；不含 → 空串
- 单元格炸开 → 王婶/赵铁柱/翠芳三条具体，赵老六不再输出；列头状态 indeterminate 正确
- 列头再开（通配吸收具体）/关闭（清零）全流程通过，设置回归基线
- 详见 docs/v1.3-p2-proof.md

## v1.3-P1 — MVU 选择模型升级 + 三态树 + 数据源回退链 (2026-07-28)

### Added
- **MvuSelection 选择模型**: 新存储键 `mvu_selections`，结构 `{ path: string[], nameSegment: number | null }`；`path` 支持 `*` 单层通配；`nameSegment` 显式标注匹配名段（集合成员用于正文门控），替代旧"末段即角色名"硬编码
- **集合节点自动识别**: `isCollectionNode()`（≥2 对象子键 + objRatio≥80% + 键相似度≥60%，六角色卡实测零误判）；勾选时自动推断 nameSegment（`$`/`_` 前缀系统字段跳过）
- **MVU 数据源回退链 (R1)**: `refreshMvuData` 改为 latest → 末尾回扫 ≤12 楼 → chat 级变量三级回退，解决最新楼无 stat_data 时静默失败（道渊实测 latest 无数据，回扫命中 msg:30）；状态区显示实际数据来源楼层
- **三态级联树**: 所有节点（含叶子）均有 checkbox；分支三态（全选/半选/未选），点击级联选中/取消自身及全部子孙；勾选后原位更新状态，不再整树重建丢失滚动位置
- **祖先覆盖去重**: 提取时路径 A 是 B 的严格前缀则丢弃 B，级联全选不产生重复输出
- **截断标记**: MVU 输出超 `MAX_OUTPUT` 截断时追加 `(已截断)`

### Changed
- `extractMvuInfoSegment` 签名改为 `(text, selections: MvuSelection[])`；onGenerate 与预览管线同步改用 `getMvuSelections()`
- 旧 `mvu_paths` (`string[][]`) 加载时自动迁移为 `mvu_selections`（`nameSegment = 末段`，行为不变），旧键保留可回滚
- `getMvuStatus()` 新增 `source` 字段（latest / msg:N / chat）
- settings.html MVU 区提示文案更新；空树提示补充"请先打开含 MVU 的角色聊天"

### Fixed
- **名字含 老/小/阿 永远无法匹配（存量 bug）**: `trimHonorifics` 把"赵老六"裁成"赵六"，导致名字匹配必然失败；新增 `findAliasesInText()` 同时在原文与裁剪文本中匹配，`characterLib` 与 `databaseLib` 同步修复
- **级联全选误删既有选择（验收发现）**: add 分支先移除全部 universe 内既有选择、却只补回缺失项，导致已勾选的 4 个角色节点被误删；改为既有选择原样保留、仅追加缺失项

### Verified (WebBridge 实测，《道渊》v5.2 聊天)
- tsc + eslint: ✅ 零错误
- 回退链: ✅ source=msg:30 命中
- 迁移: ✅ 13 条旧路径迁移 nameSegment=1，旧键保留
- 提取六场景: ✅ 叶子门控命中/未命中、无门控直出、祖先去重、通配展开、分支门控
- 三态树 UI 全流程: ✅ 全选(missingCount=0)/取消/半选(indeterminate)
- 详见 docs/v1.3-p1-proof.md 与 docs/design-mvu-ux-v1.3.md

## v1.2 — iOS 移动端专项优化 (2026-07-28)

### Added
- **浮动按钮 iOS touch 事件支持**: 并行注册 touchstart/touchmove/touchend 监听器（不删不改现有 mouse 事件），touchstart 使用 `{ passive: false }` + `preventDefault()` 抑制合成 mouse 事件；touchend 中直接处理 tap → onGenerate()；touchmove 中 `preventDefault()` 防止拖动时页面滚动
- **CSS 触屏覆盖层**: 使用 `@media (hover: none) and (pointer: coarse)` 精准命中 iOS，PC 端零影响：
  - Tab 触摸目标放大（padding 10px 8px，高度 ~48pt）
  - 全局按钮 `min-height: 44px`（Apple HIG 推荐最小触摸目标）
  - 删除按钮 ✕ 44×44pt、MVU 树展开三角 32×32px、复制图标 44×44pt
  - Tab 容器溢出滚动（`overflow-x:auto` + `-webkit-overflow-scrolling:touch`）
  - 窄屏单列布局：宽高滑块、模型选择行、sampler/scheduler 并列、regex 行
  - MVU 树 max-height 缩小至 200px、textarea min-height 80px、slider thumb 24px
  - 复制图标触屏常显（opacity:0.5，移除 hover-only）
  - Tab content 启用内部滚动（max-height:60vh）
- **iOS 键盘适配**: `clampFloatingPos()` 改用 `window.visualViewport` 适配键盘弹出后可视区变化；所有输入框/下拉框 focus 时自动 `scrollIntoView({ block: 'center' })`

### Changed
- `src/ui.ts`: 浮动按钮 touch 事件三件套 + CSS 覆盖层 + `activateTab()` scrollTop 重置 + 输入框 focus 委托
- `src/index.ts`: 行内进度元素插入后 `scrollIntoView`；生成完成结果 update 后 `scrollIntoView`
- `package.json` / `manifest.json`: version 1.1.3 → 1.2

### Fixed
- **B1 浮动按钮 iOS 不可拖拽（严重）**: 仅绑定了 mouse 事件，触屏设备无法拖拽 — 并行添加 touchstart/touchmove/touchend 事件
- **B2 Tab 切换后滚动位置未重置**: 切换到新 tab 时 content 未自动回到顶部 — `activateTab()` 中显式重置 `scrollTop`
- **B3 iOS 键盘遮挡输入框**: 设置面板位于 inline-drawer 内，键盘弹出后下部输入框被遮挡 — 所有输入元素 focus 时滚动到视口中心
- **B4 MVU 树复制图标触屏不可见**: 使用 hover-only 显示策略，触屏设备永远看不见 — `@media (hover: none)` 下常显半透明

### Verified (9/9 Gate PASS)
- tsc --noEmit: ✅ 零错误
- eslint src/: ✅ 零错误
- .api-baseline.json: ✅ 无 diff（公开导出零变更）
- iOS Safari 真机实测（拖拽/触控/布局/键盘/生成反馈）: ✅ 用户确认 2026-07-28
- Windows Chrome 回归（浮动按钮/Tab/控件/生成链路）: ✅ 用户确认 2026-07-28
- 详见 docs/Definition of Done v1.2.md 与 docs/v1.2-proof.md

## v1.1.3 — LLM 参数自定义配置 + DeepSeek 适配优化 (2026-07-27)

### Added
- **temperature 参数**: LLM 配置 tab 新增滑块 + 数字输入 (0-2, step 0.1, 默认 1)，控制生成文本随机性。仅非默认值/非 undefined 时写入请求体。
- **top_p 参数**: LLM 配置 tab 新增滑块 + 数字输入 (0-1, step 0.05, 默认 1)，控制核采样概率阈值。仅非默认值/非 undefined 时写入请求体。

### Changed
- **reasoning_effort 选项更新**: 下拉选项改为 none / high（推荐）/ max（复杂任务），移除 medium 选项
- **reasoning_effort 值映射**: 新增 `EFFORT_MAP`，兼容旧值 low/medium → high, xhigh → max，用户原有配置无需手动迁移
- **思考模式提示优化**: 仅在 reasoning_effort 非 none 时显示 Temperature/Top P 不生效提示，减少无关干扰
- `src/api.ts`: callLLM 签名增加 temperature/top_p 参数；REASONING_EFFORT_OPTIONS 更新为 ["none", "high", "max"]
- `src/prompt.ts`: generateLLMPrompt 签名透传 temperature/top_p
- `src/index.ts`: loadSettings 新增 llm_temperature(1)/llm_top_p(1) 默认值；onGenerate 透传至 LLM
- `src/ui.ts`: 新增 temperature/top_p 控件绑定；思考模式 hint 联动 toggle
- `settings.html`: LLM 配置 tab 新增温度/核采样滑块；reasoning_effort 下拉更新
- `package.json` / `manifest.json`: version 1.1.2 → 1.1.3

### Fixed (3-agent code review)
- **滑块同步修复**: 新增 temperature/top_p 的 `linkSlider` 调用，滑块与数字输入双向同步
- **UI 初始化修复**: temperature/top_p 输入框从保存的设置初始化，而非始终显示 1
- **思考模式隔离**: temperature/top_p 仅在 `thinking=disabled` 时写入请求体，推理模式下不发送
- **标签修正**: reasoning_effort high 选项移除误导性的 "默认" 标签

### Verified (tsc+eslint 静态验证)
- tsc --noEmit: ✅ 零错误
- eslint src/: ✅ 零错误
- 3-agent code review: ✅ 发现 4 项问题，全部修复，复审通过

## v1.1.2 — 自定义提示词标签 (2026-07-27)

### Added
- **自定义提示词标签系统**: ComfyUI tab → "提示词设置" 区块新增「自定义提示词标签」功能
  - 全局启用/禁用开关（`prompt_tags_enabled`）
  - 可新建/编辑/删除标签，每个标签含名称（仅显示）和提示词内容（多行）
  - 多个标签可同时启用，启用标签的 prompt 以 ", " 连接后附加到固定正面提示词之后
  - 交互模式与正则规则一致（事件委托，数组索引操作，自动持久化）
- **`PromptTag` 接口**: 新增 `{ name, prompt, enabled }` 类型定义（`prompt.ts`）
- **最终 prompt 组装增强**: `onGenerate()` 中 `fixed_prompt_prefix` 与 LLM prompt 之间插入启用标签的提示词

### Changed
- `src/prompt.ts`: 新增 `PromptTag` 接口导出（+5 行）
- `src/index.ts`: `loadSettings()` 增加 `prompt_tags_enabled`/`prompt_tags` 默认值；`onGenerate()` 增加标签拼接逻辑
- `src/ui.ts`: 新增 `rebuildPromptTagsUI()` + `bindPromptTagEvents()` + CSS 样式 + toggle 绑定 + 初始化调用
- `settings.html`: ComfyUI tab → "提示词设置" 内新增自定义提示词标签 UI 区块
- `package.json` / `manifest.json`: version 1.1.1 → 1.1.2

### Verified (tsc+eslint 静态验证)
- tsc --noEmit: ✅ 零错误
- eslint src/: ✅ 零错误

## v1.1.1 — LLM 响应清洗 + thinking 字段 + 空提示词保护 (2026-07-27)

### Added
- **`stripPrefillContent()`**: 新增内部函数，剥离 LLM 响应中的前导推理/预填充文本 — 结构化模式（如 `2 girls, 1 boy.`）和中文散字前缀两级清洗，保障最终提示词以有效内容开头
- **`thinking` 字段联动**: `reasoning_effort` 非 none 时同步发送 `thinking: { type: "enabled" }`，关闭时发送 `{ type: "disabled" }`，满足部分 API 供应商的字段要求
- **`reasoning_content` 兜底**: SSE 流式解析新增 `delta.reasoning_content` 捕获，`content` 为空时自动回退使用 reasoning 内容作为提示词
- **空提示词保护（index.ts）**: LLM 返回空或纯空白提示词时，toastr 报错并取消后续生图，避免 ComfyUI 收到空 prompt 导致静默失败

### Changed
- **SSE 解析重构**: 行级解析提取为 `processPayload()` 内部函数，统一处理 content / reasoning_content / usage 三类 delta；流结束时处理剩余 buffer 中未消费的 data 行，消除偶发截断
- **非流式兜底增强**: 回退 JSON 解析路径增加 content 空值警告日志 + 同样应用 `stripPrefillContent` 清洗
- **日志全面增强**: LLM 响应 content-type / status / 耗时 / content 长度全方位打点，便于链路问题快速定位
- `package.json` / `manifest.json` version 1.1 → 1.1.1

### Fixed
- **Anima_v6.9_生图prompt系统提示词.md git 残留**: 该文件 v1.0.2 已移入 `_research/`，本次清理 git 跟踪记录（`git rm`）

### Security
- 空提示词取消生图可防止 ComfyUI 收到无效请求，避免资源浪费和潜在错误

## v1.1 — index.ts UI 职责提取：拆分 ui.ts (TD-001 + TD-003) (2026-07-27)

### Changed
- **TD-001/TD-003**: 新建 `src/ui.ts`（1336 行），收拢 index.ts 全部 UI 职责 — 设置面板 UI（createSettingsUI + 内联绑定）、运行时 UI（进度系统 setProgress/resetProgress/currentStage、浮动按钮 init/destroy/updateStage、CSS 注入）、渲染函数（renderMvuTree/renderMvuNode、rebuildDatabaseTableList）、UI 辅助（populateDropdown/populateSelect/populateModelDropdown/populateLoraDropdowns）、连接测试 UI、文本清洗测试 UI、图库路径复制 UI；index.ts 1467 → 466 行（-1001），单向依赖 index.ts → ui.ts → 底层模块/ST 运行时，零行为变更
- **T2 settingsUi.ts 过渡层消除**: 3 个导出（rebuildLoraUI / rebuildRegexRulesUI / ensureValidLoraSlots）合并入 ui.ts，`src/settingsUi.ts` 删除（dist 陈旧产物 settingsUi.js 同步清理）
- **T3 事件监听分离（companion fix）**: 新增 `bindLoraEvents()` / `bindRegexEvents()` 一次性事件委托（createSettingsUI 中调用），rebuildLoraUI / rebuildRegexRulesUI 不再重新挂载监听器，消除 DOM 重建循环中的叠加风险
- **baseline 同步**: `docs/.api-baseline.json` 登记 ui.ts 17 个导出 + index.ts init，行号同步实际值
- `package.json` / `manifest.json` version 1.0.8 → 1.1

### Fixed
- 验证阶段修复 1 处提取遗漏：index.ts 残留 `onCopyGalleryPath` 死代码副本（ui.ts 已有正本），eslint 捕获后删除（G10 职责残留检查发挥作用的实例）

### Verified (Kimi WebBridge 运行时实测，12/12 Gate PASS)
- G1/G2/G12: `tsc --noEmit` + `eslint src/` 零错误
- G3: 设置面板 5 tab 切换/显隐/控件全部正常，输入/下拉/开关双向同步 settings
- G4: LoRA 4 槽位渲染/模式显隐/选择持久化正常；连续 3 次重建后 CDP getEventListeners 实测仅 1 个 change 监听器
- G5: 正则增删改正常；5 次重建后仅 1 change + 1 click 监听器
- G6: MVU 树渲染/展开收起/checkbox 持久化正常（环境无 MVU 前端，桩数据验证 UI 层）
- G7: 数据库扫描/勾选/持久化/重扫描恢复全部正常
- G8: 浮动按钮拖拽 + 位置持久化（right/bottom 偏移语义）；生成中光晕/动画/行内进度，完成后全部消解
- G9: 永嘉风流一次真实生成成功（总 1分38秒；LLM OPTIONS 204 + POST 200 SSE；ComfyUI POST 200；图片附加 mesid=7，锚点/对齐/大小设置生效）
- G10: index.ts 仅保留入口/协调/生成链路；ui.ts 无反向导入；settingsUi.ts 已删除
- G11: baseline 与实际导出双向一致
- 证据: docs/v1.1-proof.md, webbridge-tests/v11-proof-final.jpg, webbridge-tests/responses/v11-*

## v1.0.8 — 技术债清理：设置面板 UI 构建器提取 (TD-004 + TD-005) (2026-07-27)

### Changed
- **TD-004/TD-005**: 新建 `src/settingsUi.ts`，将 `rebuildLoraUI` / `rebuildRegexRulesUI` / `ensureValidLoraSlots` 从 index.ts 机械搬运至新模块（零行为变更）；index.ts 1711 → 1467 行（-244），单向依赖 index.ts → settingsUi.ts → comfy.js/ST 运行时
- **baseline 同步**: `docs/.api-baseline.json` 补登 v1.0.6 遗漏的 `getLastCacheInfo` / `REASONING_EFFORT_OPTIONS`（事实补登，非新增），登记新模块 3 个导出
- `package.json` / `manifest.json` version 1.0.7 → 1.0.8

### Verified (Kimi WebBridge 运行时实测，11/11 Gate PASS)
- G1/G2/G11: `tsc --noEmit` + `eslint src/` 零错误
- G3: LoRA 4 槽位结构全对（mode 4 选项、双强度、wrapper 按 mode 显隐）
- G4: 刷新模型列表后 4 个已存 LoRA 名保持选中（persistOk: true，v1.0.4 回归保持）
- G5: 正则规则增删改往返后原有 2 条规则完整（origIntact: true）
- G6: 清洗工具输出 1827 字符、两次幂等、启用正则规则生效
- G7: 永嘉风流（chid=8）一次真实生成成功（1分28秒，media-above-text，align-center/size-large，progressLeft 0）
- G8: index.ts -244 行（≥180 达标）；G9: baseline 双向比对空集
- G10: WEBBRIDGE_TESTING.md 对比更新（P8 扩写 / 新增 P13 网络红错定位 / P14 LLM 链路抓包验证）
- 证据: docs/v1.0.8-proof.md, webbridge-tests/v108-proof-final.jpg

## v1.0.7 — 基础设置 Bug 修复：图片显示/定位/行内进度 (2026-07-26)

### Fixed
- **B1 图片显示设置失效（双根因）**: (1) 实测 `.mes_media_wrapper` 是 flex 容器（ST 规则 `.mes .mes_media_wrapper{display:flex}`，特异性 0-2-0），`text-align` 对 flex 子项无效 — 对齐改为 `justify-content + text-align` 双写并加 `!important`，内层容器转 `inline-block !important` 兜底非 flex 场景；(2) ST 默认 `max-height` 限制使中/大两档渲染同宽 — 大小 CSS 全部 `!important` 且对 img/video 解除 `max-height`，300px/500px/全宽三档真实生效（实测 300/500/740px）
- **B2 锚点定位失效（深层根因）**: 锚点文本为 HTML 标签形态（如 `</正文>`）时被浏览器解析吞掉，DOM `textContent` 中不存在，DOM 匹配永远失败 — 新增 `getMesRawText()` 从消息数据层 `chat[mesid].mes` 取原文匹配（DOM 文本作回退）；另加 `document.contains` 保护 + media 未就绪有限重试（5×100ms）
- **B3 行内进度不显示**: 取消 `anchor_text` 非空限制 — 无锚点/未匹配时在 `mes_text` 之后插入进度元素，有锚点时在锚点位置插入；生成完成或失败后自动移除（成功/失败路径均已实测）

### Changed
- `src/index.ts`: FLOATING_CSS 注入块对齐/大小规则重写；新增内部函数 `getMesRawText()`；`applyAnchorPosition` 数据层锚点匹配 + 重试保护；`onGenerate` 行内进度条件放宽 + 数据层锚点匹配
- `package.json` / `manifest.json` version 1.0.6 → 1.0.7

### Verified (Kimi WebBridge 运行时实测，11/11 Gate PASS)
- G1/G2/G11: `tsc --noEmit` + `eslint src/` 零错误
- G3/G4: 永嘉风流/催眠APP 真实图片消息实测 — 对齐三档几何位置变化（left/right/center）、大小三档宽度 300/500/740px
- G5/G10: 生成 #1（锚点上方）— 进度元素位于 mes_text 上方，完成后自动移除，图片定位于锚点上方（总耗时 1分27秒）
- G6: 生成 #2（锚点下方）— 图片定位于 mes_text 下方（总耗时 1分43秒）
- G7/G8/G9: 生成 #3（无锚点）— 进度元素出现在消息末尾（mes_text 之后），完成后自动移除，全程无报错，图片位置不受影响（总耗时 1分38秒）
- 证据: docs/v1.0.7-proof.md, webbridge-tests/v107-proof-final.jpg

## v1.0.6 — LLM 交互优化：思考模式 + 提示词透明 + 缓存感知 + CORS 修复 (2026-07-26)

### Added
- **R1 思考模式控制**: LLM 配置 tab 新增「思考模式」下拉框，支持 Non-think（默认·不传参）/ Think（medium）/ Think High（high）/ Think Max（max）
- **R2 提示词透明化**: 展开图像的标题从 "Generated Image" 替换为实际 finalPrompt，并添加 text-overflow: ellipsis 防布局溢出
- **R3 缓存命中检测**: callLLM 在 SSE 流式响应中捕获 usage.prompt_cache_hit_tokens / cache_read_input_tokens，导出 getLastCacheInfo() 供 UI 显示

### Changed
- `src/api.ts`: 新增 llmFetch 内部函数（CORS 直连失败时自动回退到 ST 服务端代理）；callLLM 签名增加 reasoningEffort 参数，条件写入请求体；SSE 解析增加 usage 字段捕获；入口重置模块级缓存状态；导出 getLastCacheInfo() → { hit, hitTokens? }
- `src/prompt.ts`: generateLLMPrompt 签名增加 reasoningEffort 透传参数
- `src/index.ts`: loadSettings() 新增 llm_reasoning_effort 默认值（"none"）；createSettingsUI() 绑定思考模式下拉框 + CSS 注入 text-overflow: ellipsis；onGenerate() 替换 title 为 finalPrompt + 缓存命中 toastr
- `settings.html`: LLM 配置 tab 新增思考模式选择区域（4 选项下拉框）
- `package.json` / `manifest.json` version 1.0.5 → 1.0.6

## v1.0.5 — LLM 请求超时 + 链路打点 + 输出长度控制 (2026-07-26)

### Breaking Changes
- **callLLM 改为固定流式 SSE**: `callLLM` 发送 `stream: true` 并解析 SSE 响应。此前使用非流式 JSON Response。使用不支持流式 SSE 的 LLM API 端点的用户需要注意兼容性。如果 API 未返回 SSE 流，会触发热备降级为普通 JSON 解析（`text/event-stream` content-type 缺失时触发）。

### Added
- **callLLM 超时控制**: `AbortController` + 180 秒 fallback timeout，请求超时自动中止（`api.ts:LLM_TIMEOUT_MS`）
- **请求链路三段打点**: `console.log` 输出 `[image_st] LLM timing:` — request start / response headers received / response parsed，每段附带 elapsed ms
- **AbortSignal 透传**: `onGenerate()` → `generateLLMPrompt()` → `callLLM()` 全链路可取消
- **输出长度控制**: LLM 配置 tab 新增 `llm_max_tokens` 设置项，默认 512，仅 >0 时写入请求体
- **并行刷新**: MVU/DB 数据刷新改为 `Promise.all` 并行执行，消除串行等待

### Changed
- `src/api.ts`: `callLLM` 签名增加 `maxTokens`（number, 默认 0）和 `signal`（AbortSignal 可选）参数；响应错误信息包含已等待时间；超时从 60s 改为 180s
- `src/prompt.ts`: `generateLLMPrompt` 签名增加 `signal` + `maxTokens` 透传参数
- `src/prompt.ts`: `cleanChatContent` 增加 ReDoS 安全检查 — 嵌套量词模式（`(.*)+` 等）跳过并 `console.warn`
- `src/index.ts`: `onGenerate()` 创建顶级 `AbortController`，finally 统一 abort + timer 清理
- `src/index.ts`: `previewInjectionPipeline()` MVU/DB 刷新改为并行
- `src/index.ts`: `init()` 非阻塞初刷改为并行
- `src/index.ts`: `loadSettings()` 新增 `llm_max_tokens` 默认值（512）
- `settings.html`: LLM 配置 tab 新增最大输出 Token 输入框
- `package.json` / `manifest.json` version 1.0.4 → 1.0.5

### Security
- 请求不再无限等待：180 秒超时自动中止，防止半连接/服务端挂死
- 危险正则被跳过而非执行，防止 ReDoS 攻击导致浏览器卡死

## v1.0.4 — 图片定位 + 生成耗时 + LoRA 持久化修复 (2026-07-26)

### Code Review Fixes
- **聊天切换后 mesBlock 引用保护**: 复用外层 `targetMesBlock` 引用 + `document.contains()` 校验，防止长时间生成中切换聊天导致图片写入错误消息
- **`nextSibling` → `nextElementSibling`**: 避免锚点定位时图片插入到空白文本节点前造成间距错位
- **定时器取消标记**: 新增 `genProgressTimerCancelled` 标志，防止 `clearInterval` 后已排队回调覆盖 `floatingBtn.title`
- **`anchor_text` 输入校验**: change handler 增加 trim + 最大长度 200 字符限制
- **锚点匹配去空白**: `textContent.includes()` 前先 `trim()`，减少因首尾空白引起的误匹配
- **`formatDuration` 增强**: 增加 `<1秒` 显示、小时单位处理、负值防护
- **`populateLoraDropdowns` 超时保护**: 3s `Promise.race` 超时，防止 ComfyUI 不可达时阻塞 UI 初始化

### Added
- **文本锚点定位**: `anchor_text` 设置（用户自定义锚定字符串，如 `<正文>`），生成图片固定位于锚点上方或下方
- **锚定位置选择**: `anchor_position` 设置（上方/下方，默认上方），基础设置 tab 新增下拉选择
- **生成耗时记录**: 生成过程中 toastr 进度消息实时显示已用时间（X 分 Y 秒）
- **生成耗时面板**: 生成完成后插件面板 result 区域显示各阶段耗时（提示词生成/图片渲染）和总耗时
- `formatDuration()`: 毫秒转可读格式（分钟/秒）的内部辅助函数
- `applyAnchorPosition()`: 文本锚点 DOM 重排逻辑，仅定位 `.mes_media_wrapper` 在父级中的位置
- `docs/Definition of Done v1.0.4.md` — 版本范围与 12 Gate 验证标准

### Changed
- `src/index.ts`: `loadSettings()` 新增 `anchor_text`/`anchor_position` 默认值
- `src/index.ts`: `createSettingsUI()` 新增锚点文本绑定 + 位置下拉绑定
- `src/index.ts`: `onGenerate()` 新增 `genTiming` 各阶段时间戳记录 + 完成后耗时摘要 + `applyAnchorPosition()` 调用
- `src/index.ts`: `setProgress()` 在 prompting/rendering 阶段追加已用时间显示
- `src/index.ts`: `populateLoraDropdowns()` 改为从 `settings.lora_slots[i].name` 读取当前值，解决刷新后重置问题
- `settings.html`: 基础设置 tab 新增图片定位区块（锚点文本输入 + 位置下拉）
- `package.json` / `manifest.json` version 1.0.3 → 1.0.4

### Fixed
- **LoRA 选择不持久化**: 双重修复 — (1) `rebuildLoraUI` 创建 select 时把保存的 LoRA 名预先添加为 option，使 `.value` 赋值不再静默失败；(2) `populateLoraDropdowns` 改为手动构建 option 列表，保证保存的 LoRA 名即使不在 ComfyUI 返回列表中也被保留并选中

### Security
- 仅通过 `insertBefore` 重新定位媒体节点在父级中的顺序，不删除/修改 ST 原始文本节点
- 锚点文本为空时完全跳过 DOM 操作，零影响

## v1.0.3 — 图片展示体验优化 (2026-07-25)

### Added
- **图片对齐**: `image_align` 设置（左/中/右），生成后自动应用到 `.mes_media_wrapper` 容器
- **图片大小**: `image_size` 设置（小300px/中500px/大全宽），通过 CSS max-width 控制
- **增强悬浮按钮**: `progress_in_chat` 设置控制生成中动画：
  - 提示词生成阶段 → 图标变 `fa-spinner fa-spin-pulse`
  - 图片渲染阶段 → 图标变 `fa-spinner fa-spin-pulse` + 脉冲光晕动画
  - 完成 → 图标变 `fa-check` 后恢复 `fa-magic`
  - 失败 → 图标变 `fa-xmark` 后恢复 `fa-magic`
- **CSS 脉冲动画**: `@keyframes image-st-pulse` — 渲染阶段光晕以 0.8s 节奏脉冲
- **长时间生成提醒**: `onGenerate()` 内 LLM/comfy 阶段每隔 5 分钟弹窗提示当前进度，防止用户不知是否卡住
- `docs/Definition of Done v1.0.3.md` — 版本范围与 12 Gate 验证标准

### Changed
- `src/index.ts`: `loadSettings()` 新增 `image_align`/`image_size`/`progress_in_chat` 默认值
- `src/index.ts`: `createSettingsUI()` 新增控件绑定 + 图片控制 CSS 注入
- `src/index.ts`: `onGenerate()` 在 `appendMediaToMessage` 后调用 `applyImagePosition()`
- `src/index.ts`: `onGenerate()` 添加长时间生成定时提醒（5 分钟间隔）
- `src/index.ts`: `updateFloatingButtonStage()` 增强图标切换 + 脉冲动画
- `settings.html`: 基础设置 tab 新增图片显示设置区块
- `package.json` / `manifest.json` version 1.0.2 → 1.0.3

### Fixed
- **LoRA 空名提交 400 错误**: `comfy.ts` `replacePlaceholders()` 中 mode="none" 时 name 为空字串被填入工作流，ComfyUI easy loraNames 节点拒绝空值。修复：模块级缓存 LoRA 列表，空名时以首个可用 LoRA 名占位并设强度为 0，满足节点校验且零效果
- **图片显示设置不生效**: 三个问题：(1) `applyImagePosition()` 查询 `.mes_media`（不存在），改为 `.mes_media_wrapper`；(2) 对齐 CSS 使用 `text-align`，对 flex 容器无效，改为 `justify-content`；(3) 大小 CSS 选择器特异性不足，改为直接约束 `img`/`video` + `.mes_img_container`/`.mes_video_container` 双重保障

### Removed
- 不设置：`anchor_text` / `anchor_position` 延后至独立版本

### Security
- 不进 mes DOM，不移除/移动 ST 原始节点，无残留 DOM
- 所有动画仅作用于插件自有元素（悬浮按钮）

## v1.0.2 — 系统提示词职责重构 (2026-07-25)

### Added
- **职责边界文档**: `docs/SYSTEM_PROMPT_RESPONSIBILITY.md` — 定义 System Prompt 与 Plugin 的职责边界 + 5 条设计原则 + 变更审核清单
- **Anima v7.0 系统提示词**: 独立文档 `Anima_v7.0_系统提示词.md`，用户可直接复制使用
- **5 模块常量**: `HEADER`/`VISUAL_RULES`/`STRUCTURE_RULES`/`OUTPUT_TEMPLATE`/`VALIDATION_CHECKLIST` — 职责分离的模块化架构，`prompt.ts:9-135`
- **插件默认提示词**: `DEFAULT_SYSTEM_PROMPT` 作为 `llm_system_prompt` 的默认值，零配置可用

### Changed
- **提示词压缩 80%**: 35,223 字符 → 6,801 字符。删除 IR/AST/Layer 等编译器说明、教程解释、附录 B/C 错误案例
- **每规则一句话**: 所有规则改为声明式陈述，删除"为什么"/"如果不"/推理过程
- **Archived**: `Anima_v6.9_生图prompt系统提示词.md` → `_research/`
- `src/prompt.ts`: 顶部 143 行新增 5 模块常量 + `DEFAULT_SYSTEM_PROMPT` 导出
- `src/index.ts`: `loadSettings()` 默认值 `""` → `DEFAULT_SYSTEM_PROMPT`
- `package.json` / `manifest.json` version 1.0.1 → 1.0.2

### Removed
- **Phase 3 校验器**: `validateFormat()` / `retryWithFeedback()` / `VALIDATION_RULES` 回滚删除（Phase 3 取消）

## v1.0.1 — 发布质量修复 (2026-07-25)

详见 Definition of Done v1.0.1.md

### Added
- **Workflow 节点校验**: `validateWorkflowNodes()` — 启动时检查工作流是否包含所有预期节点 ID，缺失即报错，防止静默失败
- **API Baseline**: `.api-baseline.json` — 公开发布 API 签名快照，后续版本可检测 API drift
- **TECHNICAL_DEBT.md**: 技术债登记表，分离 Bug 与架构债
- **空路径防御**: `extractMvuInfoSegment()` 增加 `!segments.length` 跳过检查

### Changed
- **Toast 顺序修复**: `onGenerate()` 将 `setProgress('prompting')` 移到 API Key 和文本有效性检查之后，防止"Prompting"误导
- **AbortSignal 隔离**: `comfyFetch()` CORS 代理重试时剥离原始 AbortSignal，避免超时信号误中止代理请求
- **死代码清理**: 删除 `databaseLib.ts` 中不可达的 `scanDatabaseTables()` 和 `DatabaseTableInfo` 接口
- **死导出清理**: 6 个符号移除无用 `export`（`extractAssistantMessages`、`truncateByPercent`、`MvuNodeType`、`NameAliasOptions`、`MAX_SURNAME_LEN`）
- **迁移代码清理**: 删除 v0.9.7→v0.9.8 `mvu_fields` 格式迁移、旧 `db_selection` 格式迁移、旧 `localStorage` key 清理
- **UI 一致性**: MVU 树复制按钮 emoji `📋` 替换为 `<i class="fa-solid fa-copy"></i>`; `image_st_gallery_path_status` inline style 替换为 `.image-st-hint-text` 类
- **重复字符修复**: `nameMatcher.ts` 正则字符类 `．` 重复项删除
- **文档同步**: DoD v0.9.9 移除 `downloading` 失效状态; v0.9.8-proof Gate G1/G2 `PENDING`→`WAIVED`; PROJECT_STATE.md 补充缺失的 v0.8-proof / v0.9.1-proof 条目; PRODUCT.md 文件名修正

### Security
- 代理请求不再携带原始 AbortSignal，防止 CORS 重试时被上游超时信号误中止

## v0.9.9 — 自动生成自动化 (2026-07-25)

详见 Definition of Done v0.9.9.md

### Added
- **自动生成**: `MESSAGE_RECEIVED` 事件监听，角色回复后自动触发生成，30 秒冷却防刷
- **运行锁**: `isGenerating` 全局锁，阻止并发生成（手动 + 自动均受控）
- **悬浮按钮**: `#movingDivs` 注入，可拖拽，localStorage 持久化位置，光晕显示进度
- **进度系统**: 状态机 Idle → Prompting → Rendering → Done/Failed → Idle，toastr 通知 + 按钮状态
- **图库入口**: 点击按钮复制 `user/images/{角色名}/` 到剪贴板
- **基础设置 tab**: 激活原禁用 tab，含自动生成/悬浮按钮/进度显示三个开关 + 复制目录按钮

### Changed
- `onGenerate()`: 增加运行锁检查 + 进度阶段调用 + 图片路径记录
- `createSettingsUI()`: 增加浮动按钮 CSS + 基础设置控件绑定
- `init()`: 调用 `initAutoGenerate()` 和 `initFloatingButton()`
- `loadSettings()`: 新增 `auto_generate_enabled`、`floating_btn_enabled`、`progress_enabled` 默认值
- `settings.html`: 基础设置 tab 激活 + 控件 HTML
- `package.json` / `manifest.json` version 0.9.8 → 0.9.9
- `comfy.ts`: SAMPLERS 扩展 24→46（新增 cfg_pp 变体等）、SCHEDULERS 扩展 5→9、MAX_POLL 60→300（长耗时容错）

### Security
- `finally` 块保证所有异常路径恢复 `isGenerating = false`

## v0.9.8 — MVU ObjectPath 选择器 (2026-07-25)

详见 Definition of Done v0.9.8.md

### Added
- `characterLib.ts`: `buildMvuTree()` — 从 MVU `stat_data` 构建树结构，仅 `branch`（object/array）和 `leaf`（原始值）两种节点
- `characterLib.ts`: `extractMvuInfoSegment(text, paths)` — 路径筛选 → buildAliasMap + trimHonorifics 角色名匹配 → 格式化输出
- `characterLib.ts`: `resolveObjectPath(obj, segments)` — 纯 key 遍历路径解析（公共 API，UI leaf 渲染用）
- `characterLib.ts`: `getMvuData()` — 缓存原始数据读取器
- `characterLib.ts`: 新增 `import { buildAliasMap, trimHonorifics }` 复用 nameMatcher 匹配逻辑
- 保存格式改为 `mvu_paths: string[][]`（Path Segments 数组），路径变化仅勾选丢失，不崩溃
- UI 树选择器：branch 可勾选（checkbox）/ leaf 可点击复制路径（无 checkbox）
- 空对象/空数组始终为 branch（可勾选）
- 输出限制：展平深度 MAX_DEPTH=3，总长度 MAX_OUTPUT=2000

### Changed
- `characterLib.ts`: 移除 `scanMvuCharacters`、`scanMvuFields`、`extractCharacterInfoSegment`、`injectCharacterInfo`（旧自动匹配机制）
- `index.ts`: `onGenerate()` MVU 段改为 `extractMvuInfoSegment(processedText, mvuPaths)`
- `index.ts`: `previewInjectionPipeline()` MVU 段同上
- `index.ts`: `loadSettings()` 新增 `mvu_paths` 默认值 + 旧 `mvu_fields` 自动迁移
- `settings.html`: 「扫描字段」→「加载 MVU 树」按钮，字段列表 → 树容器
- `package.json` / `manifest.json` version 0.9.7 → 0.9.8

### Removed
- `characterLib.ts`: 旧的自动角色名匹配 + 字段提取逻辑（~120 行）
- `index.ts`: MVU UI 中的字段 checkbox 列表渲染 + 默认字段集

## v0.9.7 — Alias 非精确姓名匹配系统 (2026-07-25, Frozen)

(详见 Definition of Done v0.9.7.md)

### Added
- `src/nameMatcher.ts` — 新模块，职责：Character Name Normalizer → Alias Builder → Matcher
  - `buildAliasMap(characters)` — 确定性 Alias 生成，返回 `Map<string, string | null>`（null = ambiguous）
  - `trimHonorifics(text)` — 扫描前裁剪称谓前缀（老/小/阿）和后缀（哥/姐/酱/先生/小姐等）
  - `COMPOUND_SURNAMES` Set — 80+ 中文复姓表，`MAX_SURNAME_LEN=4`
- 复姓最长优先解析（`for len=4; len>=2; len--`），自动匹配"欧阳""西园寺"等
- 单字姓 Alias 排除（李/王/张等不进入 Map）
- Canonical Name 优先规则（第一轮写入，Alias 不覆盖 Canonical）

### Changed
- `src/characterLib.ts`: `extractCharacterInfoSegment()` 正文名匹配从 `text.includes(name)` 升级为 Alias HashMap 匹配
- `src/databaseLib.ts`: `extractDatabaseInfoSegment()` 正文名匹配从 `text.includes(name)` 升级为 Alias HashMap 匹配
- `package.json` / `manifest.json` version 0.9.6 → 0.9.7

### Fixed
- 正文中角色名变体无法匹配问题（"夏美"→"犬冢夏美"，"夏美酱"→"夏美"等）
- 多角色共用名称导致的误匹配（冲突 Alias 标记为 null 跳过）

## v0.9.6 — 角色库信息源统一注入 (2026-07-25, Frozen)

### Added
- `src/databaseLib.ts`: `scanDatabaseCharacters()` — 从缓存 sheet 收集所有角色名（姓名列值去重）
- `src/databaseLib.ts`: `scanDatabaseFields()` — 收集所有表头列名去重（排除 row_id）
- `src/characterLib.ts`: `scanMvuCharacters()` — 从 cachedStatData 提取顶级角色名
- `settings.html`: 注入预览区块 — 「预览注入结果」按钮 + 只读 textarea，展示与 LLM 实际发送完全一致的内容
- `src/index.ts`: `previewInjectionPipeline()` — 复用提取拼接逻辑，不调 LLM
- 可读块标题：`【角色信息·MVU】` / `【角色信息·数据库】` 标注来源

### Changed
- `settings.html`: 角色库 tab 重构为对称三区块结构（MVU / 数据库 / 注入预览）
- `settings.html`: 数据库区块 UI — 两表合并去重，角色名只读列表 + 全局字段 checkbox
- `settings.html`: MVU 区块 UI — 增加「可匹配角色 N 个」显示
- `src/databaseLib.ts`: `extractDatabaseInfoSegment` 签名增加 `text` 参数，注入时仅取姓名列值在正文中出现的行
- `src/databaseLib.ts`: 移除 `injectDatabaseInfo`（未被任何位置 import）
- `src/index.ts`: `onGenerate()` 段组装改为可读块标题模式
- `src/index.ts`: `rebuildDatabaseTableList()` 重写为角色名列表 + 字段列表渲染
- `src/index.ts`: `loadSettings()` — `db_selection` 默认改为 `{ cols: [] }`，增加旧格式自动迁移
- `package.json` / `manifest.json` version 0.9.5 → 0.9.6

### Removed
- `src/databaseLib.ts`: `injectDatabaseInfo`（dead code，未 import）

## v0.9.5 — Database Source Basic Integration (2026-07-24)

### Added
- `src/databaseLib.ts` — new module with 5 public APIs:
  - `refreshDatabaseData()`: polls for window.AutoCardUpdaterAPI readiness (500ms × max 20), deep-copy caches exportTableAsJson() result
  - `scanDatabaseTables()`: parses cached sheets (skip `mate`) into { key, name, header, rows } for UI rendering
  - `injectDatabaseInfo()`: injects selected rows × cols as `[姓名/列名:值]` lines before input text
  - `clearDatabaseCache()`: clears database cache on chat switch
  - `getDatabaseStatus()`: returns availability + sheet/row counts
- 「数据库」section in 角色库 tab (below MVU section):
  - Database enable/disable toggle (`db_enabled`), default disabled
  - Database status display (未检测 / 已就绪 (N 表 / M 行) / 不可用 / 未启用)
  - 「扫描数据库」button — renders per-sheet groups: row checkboxes (label = name column value) + column checkboxes (header, row_id excluded)
  - Selection persisted via `db_selection: Record<sheetKey, { rows, cols }>`; restored on re-scan
- Name column detection: first header matching 姓名/人物名称/名称/name (case-insensitive), fallback to column 1
- Database injection in onGenerate: after MVU injection, format `[行标识/列名1:值1/列名2:值2]`, 100-char value truncation, empty/placeholder cells skipped

### Changed
- `settings.html`: added 数据库 section in charlib tab (toggle, status, scan button, table list container)
- `src/index.ts`: added databaseLib imports, CHAT_CHANGED database clearing/refresh, db toggle + scan bindings, `rebuildDatabaseTableList()`, onGenerate step 0b refresh + injection
- `loadSettings()`: added `db_enabled` (false) and `db_selection` ({}) defaults
- `package.json` / `manifest.json` version 0.9.4 → 0.9.5

### Fixed
- Per-chat database cache isolation: cache cleared on CHAT_CHANGED, no cross-chat data leak
- Plugin missing / API unavailable / empty table data: graceful degradation, no pipeline interruption

## v0.9.4 — MVU Character Library Integration (2026-07-24)

### Added
- `src/characterLib.ts` — new module with 3 public APIs:
  - `refreshMvuData()`: polls for window.Mvu readiness (500ms × max 20), caches stat_data
  - `injectCharacterInfo()`: matches characters from cached stat_data against cleaned text, prepends `[角色/字段:值]` info
  - `scanMvuFields()`: collects all leaf field names from cached stat_data
- 「角色库」tab (replaces previously disabled「测试工具」tab) with:
  - MVU enable/disable toggle (`mvu_enabled`), default disabled
  - MVU status display (未检测 / 已就绪 / 不可用 / 未启用)
  -「扫描字段」button — recursively collects all leaf fields from cached stat_data, renders checkbox list
  - Field checkbox list with built-in defaults pre-checked, persisted via `mvu_fields`
  - Hint footnote about per-chat scanning
- `CHAT_CHANGED` event handler: clears cache + field list, refreshes MVU on chat switch
- `onGenerate()` step 0: refreshes MVU cache before text cleaning pipeline
- Character info injection: candidate name collection (keys + 姓名/名称 values), long-name-first substring matching, field extraction from matched role subtree, format `[角色/字段1:值1/字段2:值2]`
- Single value truncation at 100 chars for injected fields
- Built-in default field set: 好感/好感度/姓名/名称/年龄/外貌/容貌/性格/当前状态/状态/描述/衣着/头衔

### Changed
- `settings.html`: tab `data-tab="test" data-disabled="true"` → `data-tab="charlib"` with functional UI
- `src/index.ts`: added characterLib imports, CHAT_CHANGED handler, MVU refresh in onGenerate, charlib event bindings
- `loadSettings()`: added `mvu_enabled` (false) and `mvu_fields` ({}) defaults
- `package.json` / `manifest.json` version 0.9.3 → 0.9.4

### Fixed
- Per-chat MVU cache isolation: cache cleared on CHAT_CHANGED, no cross-chat data leak
- Non-MVU character cards: 10s polling timeout → graceful degradation, no pipeline interruption
- Empty role containers (6 of 12 surveyed chats): silently skipped, no error or injection

## v0.9.3 — ComfyUI Connection Fix & UI Polish (2026-07-24)

### Added
- `comfyFetch()` wrapper function in comfy.ts: auto-detects CORS/TypeError and falls back to ST server-side proxy (`/proxy/:url(*)`)
- All 6 ComfyUI API calls now use `comfyFetch` (test connection, model list, LoRA list, workflow submit, polling, image download)
- Character count display `(N 字符)` in text cleaning test tool, updated after "执行测试" click
- `Definition of Done v0.9.3.md`, `v0.9.3-proof.md`

### Changed
- `settings.html`: total steps slider/number moved above first steps input
- `settings.html`: text cleaning test tool heading now includes character count element
- `comfy.ts`: `testComfyConnection`, `fetchModelList`, `fetchLoraList`, `fetchImageAsBase64`, `generateComfyImage` all use `comfyFetch` instead of raw `fetch`
- `index.ts`: `onTestTextCleaning()` updates character count after execution
- `package.json` / `manifest.json` version 0.9.2 → 0.9.3

### Fixed
- ComfyUI connection failure due to CORS origin mismatch (`localhost` vs `127.0.0.1`): requests now transparently fall back to ST's `/proxy/` endpoint which bypasses browser CORS
- When ST `--corsProxy` is not enabled, user sees clear actionable error message with fix instructions
- Model list and LoRA list fetch failures caused by same CORS issue

## v0.9.2 — Text Cleaning Enhancement (2026-07-24)

### Added
- Floor extraction: slider (1-5) to control number of assistant messages extracted
- Length truncation: direction selector (top/bottom) + percentage slider, sentence-aware cutoff at `。.!！?？` boundaries
- Text cleaning test tool: executes full pipeline (floor extraction → regex → truncation), displays result in readonly textarea
- `extractAssistantMessages()`, `truncateByPercent()`, `processTextPipeline()` in prompt.ts
- Settings: `floor_count`, `truncate_direction`, `truncate_percent`

### Changed
- `onGenerate()` now uses `processTextPipeline()` for floor extraction + regex + truncation
- Text cleaning tab UI restructured: floor extraction controls at top, regex in middle, truncation below, test tool at bottom
- `package.json` / `manifest.json` version 0.9.1 → 0.9.2

### Removed
- Manual `lastAssistantMsg` extraction loop from `onGenerate()` (replaced by pipeline)

## v0.9.1 — ComfyUI Configuration Enhancement (2026-07-24, Draft)

### Added
- ComfyUI connection test button with status indicator (gray/orange/green/red, same style as LLM tab)
- Connection test uses AbortController with 10s timeout, shows response time or error details
- Dual-sampling control: first sampling steps = 0 → single mode, > 0 → dual mode
- First pass independent parameters: CFG, sampler, scheduler controls
- Second pass independent parameters: CFG, sampler, scheduler controls
- Total steps slider + number input
- LoRA system: 4 slots with model dropdown, mode selector (无/仅首次/仅二次/全部)
- Per-LoRA dual strengths: first pass model_strength + clip_strength, second pass model_strength + clip_strength
- Built-in workflow loaded from project root JSON via fetch() at runtime
- Runtime placeholder injection: converts hardcoded workflow to %placeholder% template
- UNETLoader model list fetching (replaces CheckpointLoaderSimple)

### Changed
- `src/comfy.ts`: rewritten workflow loading, placeholder injection, dual-sampling params, UNETLoader fetch, new LoRA system, connection test helper
- `settings.html`: ComfyUI tab restructured with connection test, dual-sampling section, new LoRA UI; removed file upload UI
- `src/index.ts`: removed workflow upload event binding, added ComfyUI connection test, new LoRA settings bindings, dual-sampling bindings, removed `injectLoraPlaceholders`/`countLoraPlaceholders` calls
- `DEFAULTS` constants updated to match workflow actual defaults
- `replacePlaceholders` extended with all new dual-sampling and dual-LoRA-strength placeholders
- `package.json` / `manifest.json` version 0.9.0 → 0.9.1

### Removed
- Workflow file upload (`<input type="file">`) and associated event binding
- `injectLoraPlaceholders()` function (no longer needed — fixed workflow)
- `countLoraPlaceholders()` function (no longer needed)
- `fetchModelList` from `CheckpointLoaderSimple` (replaced by UNETLoader)
- `extension_settings["image_st"].workflow` field (user-managed workflow no longer supported)

### Fixed
- Workflow JSON hardcoded values now properly converted to placeholders at runtime
- LoRA system incompatible with rgthree Lora Loader Stack nodes (full rewrite)
- Model list source mismatch: UNETLoader vs CheckpointLoaderSimple

## v0.9.0 — LLM Configuration Enhancement (2026-07-24, Draft)

### Added
- LLM API URL input field in LLM 配置 Tab (previously hardcoded to SiliconFlow)
- URL change listener takes effect immediately without restart (settings saved on change)
- LLM 模型 changed from fixed dropdown to free text input (removed hardcoded `LLM_MODELS` list)
- "测试连接" button with status indicator (gray=untested, orange=testing, green=success, red=fail)
- Connection test shows response time in ms on success, or error details on failure
- Connection test uses AbortController with 15s timeout
- System prompt character count display (updates in real-time on input)

### Changed
- `src/api.ts`: removed hardcoded `LLM_URL`, renamed `callSiliconFlow` → `callLLM`, added dynamic `url` parameter
- `src/prompt.ts`: `generateLLMPrompt` accepts `llmUrl` parameter (4th param), passes `model` to `callLLM`
- `src/prompt.ts`: system prompt empty check uses `systemPrompt.trim()` for robustness
- `src/index.ts`: `loadSettings` saves `llm_url` with default SiliconFlow URL
- `src/index.ts`: LLM model binding changed from `bindSelect` to `<input type="text">` change listener
- `settings.html`: LLM 配置 Tab restructured with URL input, text model input, test button + status, char count
- Tab CSS injection includes `.image-st-llm-status` indicator styles
- `package.json` / `manifest.json` version 0.8.0 → 0.9.0

### Removed
- Hardcoded `LLM_MODELS` constant from `src/index.ts`
- `populateLlmModelDropdown()` function (no longer needed with text input)

## v0.8.0 — Tab-based Settings UI (2026-07-24, Frozen)

### Added
- Tab navigation bar with 5 tabs: 基础设置、文本清洗、LLM配置、ComfyUI配置、测试工具
- Tab switching via pure JS click + show/hide (zero dependencies)
- `activateTab()` init call to set correct initial tab on load
- Tab styles injected as `<style>` using ST theme CSS variables (auto-compatible with current theme)
- Inline CSS injection guard (one-time injection, idempotent)
- UI_STANDARD.md — L2 UI implementation standards document

### Changed
- Generate button moved into `.inline-drawer-header` (always visible, `stopPropagation()` prevents drawer toggle)
- `settings.html` restructured: inline-drawer preserved, tab bar + 5 tab content panels added inside drawer content
- All settings controls reorganized into logical tab groups (IDs preserved, no event binding changes)
- `src/index.ts` — added tab switching logic, CSS injection, and `activateTab()` init in `createSettingsUI()`
- ComfyUI tab slider wrappers: `flex1` → `flexGrow flexShrink gap0 flexBasis48p` (matching SD extension)
- 4 textareas added `autoSetHeight` class (system prompt, fixed prefix/suffix, negative prompt)
- `SETTINGS_KEY` consolidated — exported from `comfy.ts`, imported by `index.ts`
- `package.json` / `manifest.json` version 0.7.2 → 0.8.0

### Fixed
- Initial tab state mismatch: "ComfyUI配置" tab now correctly active on first load
- Tab click handler scoped to `#image_st_settings` container (no cross-extension interference)

### Removed
- Duplicate `SETTINGS_KEY` definition from `index.ts` (single source in `comfy.ts`)

## v0.7.2 — UI Code Quality & Consistency Patch (2026-07-24)

### Added
- `populateSelect()` helper function to eliminate `<option>` creation duplication across 5 call sites
- `DEFAULTS` constant object in comfy.ts centralizing all default values (comfyUrl, model, sampler, steps, scale, width/height, seed, loraStrength)

### Changed
- `rebuildRegexRulesUI` dynamic DOM: row uses `flex-container alignitemscenter`, pattern input uses `text_pole flex1`
- `rebuildLoraUI` dynamic DOM: wrapper uses `flex-container alignitemscenter`, select uses `text_pole flex1`
- Workflow status text: removed `right_menu_button` class (was showing misleading pointer cursor)
- `loadSettings` defaults: all reference `DEFAULTS.*` constants instead of hardcoded values
- `replacePlaceholders` defaults: all reference `DEFAULTS.*` constants instead of hardcoded values
- LoRA model/clip strength: references `DEFAULTS.loraStrength` instead of `0.6`
- Budget in PROJECT_STATE.md corrected: `settings.html` now counted (2→3 files)

### Removed
- ~35 lines of duplicated `<option>` creation code across 5 populate functions
- `right_menu_button` class from workflow status span

## v0.7.1 — UI Template Separation & Standardization (2026-07-24)

### Added
- `settings.html` — standalone Handlebars template for settings panel UI
- `.inline-drawer` collapsible shell around settings panel (ST standard pattern)
- Range sliders (`neo-range-slider`) + number input pairs for Steps, Scale, Width, Height
- Font Awesome icons for buttons (plus, sync, wand, etc.)
- `linkSlider` helper to sync range slider values to number inputs

### Changed
- Settings UI HTML extracted from `src/index.ts` template literal to independent `settings.html`
- `createSettingsUI()` is now `async`, loads template via `renderExtensionTemplateAsync`
- Inline `style` attributes replaced with ST standard CSS classes (`flex-container`, `flex1`, `textarea_compact`, `alignitemscenter`, etc.)
- Section dividers changed from inline-bordered `div` to `<hr>` elements
- `init()` is now `async` to support template loading
- RegexRule interface imported in index.ts for type safety
- `rebuildRegexRulesUI()` delete button uses `color:red` style (unchanged — dynamic DOM)

### Removed
- ~180 lines of inline HTML template string from `src/index.ts`
- All inline `style` attributes from settings panel (except `white-space:pre-wrap` for result div)

## v0.7.0 — Chat Content Cleaning Capability (2026-07-24)

### Added
- Regex-based text cleaning: custom rules with find/replace applied to message content
- Regex rules management UI in settings panel (add/delete/enable rules)
- Regex rules saved to extension_settings["image_st"].regex_rules
- `RegexRule` interface and `cleanChatContent` function in prompt.ts

### Changed
- `onGenerate` to extract only the last LLM reply (non-user message) instead of last 3 messages
- `generateLLMPrompt` signature: first param from `chat: string[]` to `chatContent: string`, added `rules: RegexRule[]` param

### Removed
- `buildPrompt` function (replaced by single-message extraction + cleaning)

## v0.6.0 — LLM Prompting Configuration Capability

- Added LLM model dropdown (hardcoded list of common SiliconFlow models)
- Added system prompt textarea in settings panel (defaults to empty, skips system message when empty)
- LLM model and system prompt settings saved to extension_settings["image_st"]
- Extended generateLLMPrompt signature to accept systemPrompt and model parameters
- Added LLM_MODELS constant and populateLlmModelDropdown helper

## v0.5.0 — Workflow Parameter Expansion Capability

- Added base model dropdown (fetched from ComfyUI GET /object_info)
- Added sampler dropdown (hardcoded standard list)
- Added scheduler dropdown (hardcoded standard list)
- Added negative prompt textarea (manual input only)
- Added fixed prompt prefix/suffix textareas (concatenated before/after LLM prompt)
- Added dynamic LoRA dropdowns (auto-detects LoraLoader nodes in workflow, "None" option skips the LoRA)
- Auto-inject LoRA placeholders on workflow upload (idempotent)
- Added refresh button to re-fetch model/LoRA lists from ComfyUI
- Extended WorkflowSettings interface with model/sampler/scheduler/negative_prompt/loras/loraDefaults
- Added fetchModelList, fetchLoraList, injectLoraPlaceholders, countLoraPlaceholders helper functions

## v0.4.0 — Workflow Parameter Tuning Capability

- Added Step / Scale / Width / Height / Seed controls to settings panel
- Seed: -1 = random, ≥0 = fixed seed
- Modified "正式版" workflow JSON to use placeholders
- Removed "测试用快速.json"

## v0.3.0 — ComfyUI Integration Capability

- Direct ComfyUI REST API calls (no ST plugin channel)
- User-uploaded workflow JSON
- 10 placeholder replacement system

## v0.2.0 — LLM Prompt Generation Capability

- SiliconFlow / Qwen API integration
- generateLLMPrompt function

## v0.1.0 — Prompt Generation Capability

- Chat context reading
- Prompt string output

---

## v2.0 — 收尾整理阶段（文档体系规整 + 全新版本基础准备）(2026-10-15)

### 整理内容
- **文档体系规整**：
  - 创建综合验证状态记录 `docs/VERSION_PROOFS_SUMMARY.md`（取代分散的 proof 文件，记录所有已验证版本状态）
  - 所有已验证版本的 `proof.md` 归档至 `docs/archive/proofs/`（v1.0.1 至 v1.6 全部归档）
  - 恢复被删除的历史 `Definition of Done` 文档（v1.0.1 至 v1.6）并保持在 `docs/`（版本治理工件，非归档内容）
  - 恢复并保留 `docs/archive/` 历史旧版本文档（v0.x 系列 DoD + proof 完整保留）
  - 恢复 `UI_ARCHITECTURE.md`（L3 文档，已删除但内容有效）
  - 恢复 `docs/design-local-library-v1.8.md`（设计文档，已实现内容完整保留）
- **外部工具整理**：
  - 归档旧版 `外部工具/更新公告_7.0.txt` 至 `外部工具/archive/`
  - 保留最新 `更新公告_7.1.txt` 作为主文件
  - 外部工具内容完整性检查通过（提示词工具.html、词库.bmz、ComfyUI-PromptSync 节点、说明文档全部完整有效）
- **核心文档状态同步**：
  - `PROJECT_STATE.md` 更新为 v2.0 收尾整理状态（Last Updated: 2026-10-15）
  - 本 `CHANGELOG.md` 追加 v2.0 整理条目
  - `AI_CONTEXT.md`、`ARCHITECTURE.md`、`DEV_RULES.md`、`EVOLUTION_RULES.md`、`UI_STANDARD.md` 保持冻结（L0–L2 未修改）

### 版本定位
- **当前开发状态**：v1.9 开发中（静态 3 Gate PASS：tsc + eslint + dist 构建通过）
- **收尾条件**：v1.9 运行时 Capability 验证（G4–G7）通过后标记 Frozen，随后全面进入后续新功能开发阶段
- **基础状态**：所有已冻结版本（v0.9.9 至 v1.8）的文档、代码、验证记录完整可追溯；外部工具内容有效无损；文档体系清晰有序

### 提交信息
- 提交为全新 v2.0 版本标记，代表文档整理完成、旧内容归档清理完毕、项目基础清晰，为后续开发提供明确起点
- 无代码行为变更（仅文档整理与归档），零新增 API、零新增模块、零架构扩展
