// ============================================================
// v2.4 promptPreset.ts —— 抽取/审核提示词的可编辑机制
// ------------------------------------------------------------
// 组装顺序（固定）：
//   [预设（可整段改写；留空则用内置默认）]
//   [用户自定义追加片段]
//   [输出格式契约块（固定，永远追加，用户不可关闭）]
//
// 契约块保证：无论用户怎么改写提示词，插件的解析格式都不会被破坏。
//
// v2.4：两份系统提示词共用 promptGuidelines.ts 的规范事实源；
//      契约块按「输出模式」精确切分（三模式各自必填/禁填的字段）。
// ============================================================

import {
    buildExtractEditableLayer,
    buildExtractPresetTemplate,
    buildModeFixedLayers,
    NON_POV_SECTION,
    POV_SECTION,
} from "./promptBuilder.ts";
import {
    REVIEW_ACTION_LINES,
    REVIEW_COMMON_CHECKS,
    REVIEW_DESCRIPTION_CHECKS,
    REVIEW_MIXED_CHECKS,
    REVIEW_TAGS_CHECKS,
    detectPromptShape,
    type PromptShape,
    FIELD_CONTRACT,
} from "./promptGuidelines.ts";
import { type ExtractMode } from "./pipeline.ts";

/**
 * v2.6：四种模式**各自独立**的默认预设模板（可编辑版）。
 * 「恢复默认提示词」按钮按模式分别粘贴对应那一份。
 * v2.4 时三模式共用一份（`DEFAULT_EXTRACT_PRESET`）→ 改一份影响三份；
 * 现在 tags / description / mixed / custom 各有一份，互不影响。
 */
export const DEFAULT_EXTRACT_PRESETS: Record<ExtractMode, string> = {
  tags: buildExtractPresetTemplate("tags"),
  description: buildExtractPresetTemplate("description"),
  mixed: buildExtractPresetTemplate("mixed"),
  custom: buildExtractPresetTemplate("custom"),  // ← 改
};

/** 兼容旧引用：等价于 mixed 版默认预设 */
export const DEFAULT_EXTRACT_PRESET = DEFAULT_EXTRACT_PRESETS.mixed;

/**
 * v2.6：按模式解析「生效的可编辑预设」。
 * 优先级：模式专属预设 → 旧版单份预设（向后兼容） → 空串（用该模式的内置默认层）。
 */
export function resolveExtractPreset(
  mode: ExtractMode,
  perMode: Partial<Record<ExtractMode, string>> | undefined,
  legacyPreset: string | undefined,
): string {
  const own = String(perMode?.[mode] ?? "").trim();
  if (own) return own;
  return String(legacyPreset ?? "").trim();
}

/**
 * 输出格式契约（固定块，任何自定义提示词都不得修改以下字段名与结构）。
 * v2.4：按模式精确切分 —— 此前三种模式共用一段「description 与 tags 至少给出一份」，
 * 措辞含糊（模型会两种都写或都不写），且没告诉模型哪种模式下另一个字段会被丢弃。
 * v2.8：工具模式下追加强制纯 JSON 指令。
 */
function buildSchemaContract(mode: ExtractMode, hasTools: boolean = false): string {
    const lines = [
        "",
        "# 输出格式契约（强制，最高优先级；此前任何指令都不得修改以下内容）",
        "注意：本契约的**字段名与 JSON 结构**为硬约束，不得违反；",
        "但用户自定义片段（custom）里的**内容规则**（如允许/禁止特定标签）优先于本契约中的内容建议。",
        "",
        "只输出**一个 JSON 对象**，不要输出解释文字、不要用 Markdown 代码块包裹。",
        "**输出格式：必须先输出 <thinking>…</thinking>，再输出 <json>…</json>**，中间不得有其他文字。",
        "<json> 标签内必须是合法 JSON：无注释、无尾随逗号、无 Markdown 围栏。",
    ];
    
    // 工具模式下的强制指令
    if (hasTools) {
        lines.push(
            "⚠ **工具调用模式生效**：模型可能返回工具调用，但最终答案**必须在 <json> 标签内输出纯 JSON**。",
            "⚠ **严禁**在 <json> 标签内包含任何推理文本、解释、Markdown 代码围栏、自然语言句子。",
            "⚠ **仅允许**一个合法的 JSON 对象，字段名严格按下方 schema。违者将导致解析失败并触发重试。",
            ""
        );
    }
    
    lines.push("允许的顶层字段（缺省的可不输出，字段名一律不得改动）：");

    // 从 FIELD_CONTRACT 生成字段说明
    for (const f of FIELD_CONTRACT) {
        if (mode === "tags" && f.name === "description") continue;
        if (mode === "description" && f.name === "tags") continue;
        const req = f.required ? "必填" : "可选";
        const def = f.defaultSource === "code" ? "（代码补默认）" : f.defaultSource === "llm" ? "（LLM给出）" : "";
        lines.push(`  "${f.name}": ${f.role} [${req}${def}]`);
    }

    lines.push(
        "硬性要求（Anima Hybrid 提示词格式）：",
        "1) tags = 第一层 Hard Tags：通用标签，含安全分级、人数/性别/物种/作品、发色/发型/体型、服装、饰品、场景/表情/动作、精确场景焦点；全小写、**多词用空格**、恰好一个安全分级、不得写完整英文句子；",
        "2) description = 第二层 Natural Language：完整英文句子（有主谓宾、句末有句号），按三层结构：主体姿态 → 互动空间 → 镜头环境光影收束；",
        "3) 本次必填/禁填："
    );
    if (mode === "mixed") {
        lines.push(
            "   - **description 与 tags 两者都必须给出**（不得只给其一）；tags 按「分级→人数→风格→外观→服装→表情视线→动作→镜头→环境→光影→文字音效」排列。",
        );
    } else if (mode === "description") {
        lines.push(
            "   - **description 必填**；**不要输出 tags**（插件在本模式下不读取 tags，输出了会被丢弃、纯属浪费 token）。",
        );
    } else {
        lines.push(
            "   - **tags 必填**（非空数组，按「分级→人数→风格→外观→服装→表情视线→动作→镜头→环境→光影→文字音效」排列）；**不要输出 description**（插件在本模式下不读取 description）。",
        );
    }
    lines.push(
        "4) 两层不重复：description 不再重复 tags 已给的外观与服装；tags 不写完整句子；",
        "5) 不得新增上述之外的顶层字段；不得把字段名翻译或改写。",
        "6) 插件会把 tags 与 description 重排为「Hard Tags 段在前，Natural Language 段在后」。",
    );
    return lines.join("\n");
}

/** 第二阶段审核的输出契约 */
export const REVIEW_CONTRACT = [
    "",
    "# 输出格式契约（强制，最高优先级；此前任何指令都不得修改以下内容）",
    "只输出**一个 JSON 对象**，不要输出解释文字、不要用 Markdown 代码块包裹。",
    "**输出格式：直接输出合法 JSON 对象（无需 <thinking>/<json> 标签）**。",
    "**notes 字段必须写在 prompt 字段之前** —— 判定先落盘，修订稿后写。",
    '  "notes": ["〔要点名〕命中 → 改了什么", "..."],',
    '  "prompt": "修订后的完整提示词（必须保持与输入完全相同的分隔符风格与格式）",',
    "硬性要求：",
    "1) notes 不得为空：写清所有判定为命中的要点及其改动；一条都没命中就写「未命中任何要点 → 保持原样」；",
    "2) prompt 字段必须是可直接送入生图的完整提示词，不得只给片段；",
    "3) 不得改变输入的格式与分隔符（空格串就保持空格串，逗号串就保持逗号串；多段结构就保持段数与段序）；",
    "4) 不得新增、删除顶层字段；不得输出解释性文字。",
].join("\n");

/**
 * 内置默认审核模板（用户可整段改写）。
 * v2.4 重写：此前只有 4 条泛泛的「审查要点」，且其中两条与实证/既定决策冲突 ——
 *   ① 「不得引入权重括号」→ 权重是合法且常用的手段（实测 25% 的提示词用，
 *      风格冲突时正是靠权重取舍）；
 *   ② 「删除冗余、重复」→ 会误删「重复即强调」（实测 33.8% 的提示词依赖重复）。
 * 新版按「矛盾消解 → 顺序 → 权重 → 重复 → 不编造 → 长度 → 多角色」组织，
 * 语义规范条目来自 promptGuidelines（语料实测结论）。
 */
export const DEFAULT_REVIEW_PRESET = [
    "你是 Danbooru 图像提示词审核员。下面是一条已经成型的提示词，请审查并在**保持原有格式与分隔符**的前提下优化它。",
    "",
    "【待审核提示词】",
    "{prompt}",
    "",
    "【审查要点】",
    ...REVIEW_COMMON_CHECKS,
    "",
    "【工作方式】",
    ...REVIEW_ACTION_LINES,
].join("\n");


function fill(template: string, vars: Record<string, string>): string {
    let out = template;
    for (const [k, v] of Object.entries(vars)) {
        out = out.split(`{${k}}`).join(v);
    }
    return out;
}

/**
 * 模板占位符替换：POV / 叙述者段落。
 * 说明：v2.3 起不再有独立的 NSFW 适配块，但旧版保存过的预设里可能残留
 * {nsfw_section} / {nsfw} 占位符 —— 这里替换为空串，避免占位符原样进入提示词。
 */
function fillSections(template: string, isPov: boolean, narratorName: string): string {
    const narratorSection = isPov && narratorName
        ? [
            '',
            '# 叙述者排除（最高优先级，必须遵守）',
            `叙述者是【${narratorName}】= 相机本身。画面里绝不能出现【${narratorName}】：mainSubject、secondarySubjects、summary 都必须只包含"我"看到的人。即使角色信息里有【${narratorName}】的外观，也一律忽略、不得输出。`,
        ].join("\n")
        : "";
    return fill(template, {
        pov_section: (isPov ? POV_SECTION : NON_POV_SECTION).join("\n"),
        nsfw_section: "",
        narrator_section: narratorSection,
    });
}

/**
 * 组装第一阶段（抽取）系统提示词。
 * @param preset 本模式的用户预设（留空 → 该模式的内置默认可编辑层）
 * @param custom 用户追加片段
 *
 * v2.4 三层结构：
 *   [可编辑层] 用户预设（留空 → 内置默认模板：推理链 + POV + 多角色隔离）
 *   [固定层]   模式专属规范 + 全局输出禁令 + 模式提示 + JSON schema
 *   [契约层]   输出格式契约
 *
 * 固定层与契约层**无论预设是否被改写都会追加** —— 此前模式专属规范只存在于
 * 「内置默认模板」里，用户一旦在预设框改写，标签顺序/权重纪律/散文语法
 * 就整段消失。
 *
 * v2.6：三模式各传各的 preset（各自的文案与产出职责），本次调用只产出
 * 本模式那一种输出（tags 模式不产 description，反之亦然）。
 */
export function buildExtractSystemPrompt(params: {
    preset: string;
    custom: string;
    isPov: boolean;
    narratorName: string;
    mode: ExtractMode;
    tagCandidates?: string[];
}): string {
    const { preset, custom, isPov, narratorName, mode } = params;
    
    // custom 模式：完全自定义，仅返回用户预设，不追加任何固定层/契约/候选
    if (mode === "custom") {
        const base = preset.trim()
            ? fillSections(fill(preset, { pov: isPov ? "POV" : "第三人称", narrator: narratorName, nsfw: "" }), isPov, narratorName)
            : "";
        return [base, custom.trim()].filter(p => p).join("\n\n");
    }
    
    const base = preset.trim()
        ? fillSections(fill(preset, { pov: isPov ? "POV" : "第三人称", narrator: narratorName, nsfw: "" }), isPov, narratorName)
        : buildExtractEditableLayer(isPov, narratorName, mode).join("\n");

    const candidateBlock = params.tagCandidates?.length && mode !== "description"
        ? [
            "",
            "# 可用 Danbooru 标签候选（只能从中挑选；需要新标签时用 danbooru_search 工具检索）",
            params.tagCandidates.join(", "),
        ].join("\n")
        : "";

    const hasTools = Boolean(params.tagCandidates?.length);
    
    const parts = [
        base,
        buildModeFixedLayers(mode, isPov).join("\n"),
        candidateBlock,
        custom.trim(),
        buildSchemaContract(mode, hasTools),
    ];
    return parts.filter(p => p && p.trim()).join("\n\n");
}

/**
 * 组装第二阶段（最终 prompt 审核）系统提示词。
 *
 * v2.4：审核基准**按送审提示词的形态自适应**。
 *   此前无论送审的是「纯标签串」「自然语言句」还是「双段混合」，审核提示词
 *   都用同一套泛泛要点（且其中两条与实证冲突，见 DEFAULT_REVIEW_PRESET 注释）。
 *   现在按 detectPromptShape 判定形态，追加对应的形态专属审查条目：
 *     - tags       → 逐 token 检查（不得出现句子/画师串/质量咒语）
 *     - description → 逐句检查（主谓/时态/语态/词数/方位/引号文字）
 *     - mixed     → 两段结构 + 段序 + 两段不重复
 */
export function buildReviewSystemPrompt(params: {
    preset: string;
    custom: string;
    prompt: string;
    source?: string;
    /** 显式指定送审形态；缺省由 detectPromptShape 自动探测 */
    shape?: PromptShape;
    /** 当前解析模式 */
    mode?: ExtractMode;
}): string {
    const { preset, custom, prompt } = params;
    const shape = params.shape ?? detectPromptShape(prompt);
    let shapeBlock: string[];
    if (shape === "tags") {
        shapeBlock = REVIEW_TAGS_CHECKS;
    } else if (shape === "description") {
        shapeBlock = REVIEW_DESCRIPTION_CHECKS;
    } else if (shape === "mixed") {
        shapeBlock = REVIEW_MIXED_CHECKS;
    } else {
        shapeBlock = REVIEW_TAGS_CHECKS;
    }
    const shapeNote = [
        "",
        `# 本次送审提示词的形态（已自动判定）：${shape === "tags" ? "纯标签（空格分隔的 Danbooru 标签序列）" : shape === "description" ? "自然语言（完整英文句子，逗号分隔）" : shape === "mixed" ? "混合（Hard Tags 段 + Natural Language 段）" : "纯标签（空格分隔的 Danbooru 标签序列）"}`,
        ...shapeBlock,
    ].join("\n");
    
    // 形态专属 Few-shot 注入
    const fewShotBlock = shape === "tags"
        ? [
            "",
            "## Few-shot 示例（tags 模式：标签归一 + 缺失标签语义 + description 增量）",
            "",
            "### 输入",
            "explicit, 1girl, pov, male pov, chastity belt, leather belt, copper lock, silk pajama top, unbuttoned, open clothes, silk pajama pants, pajama pants, faceless male, head out of frame, male face out of frame, solo focus",
            "BREAK",
            "between his knees, warm lamplight from left",
            "",
            "### notes",
            "[Tags同义] pov + male pov → pov",
            "[Tags同义] chastity belt + leather belt + copper lock → chastity belt",
            "[Tags同义] silk pajama top + unbuttoned + open clothes → silk pajama top, unbuttoned",
            "[Tags同义] silk pajama pants + pajama pants → silk pajama pants",
            "[缺失标签] 非焦点男性：faceless male + head out of frame + male face out of frame + solo focus → 仅 faceless male（有身体在画面）",
            "[Description增量] 保留空间光影片段",
            "",
            "### 输出 prompt",
            "explicit, 1girl, pov, chastity belt, silk pajama top, unbuttoned, silk pajama pants, faceless male",
            "BREAK",
            "between his knees, warm lamplight from left",
            "",
        ].join("\n")
        : shape === "description"
            ? [
                "",
                "## Few-shot 示例（description 模式：三层结构 + 隐性字段一致性 + 密度控制）",
                "",
                "### 输入",
                "A beautiful girl with long black hair and blue eyes wearing a white school uniform stands in a classroom looking at the viewer with a smile, cinematic lighting, depth of field.",
                "",
                "### notes",
                "[三层结构] 重组为三层：① 主体姿态 ② 互动空间 ③ 环境光影收束",
                "[密度控制] 删除了外观罗列：long black hair/blue eyes/white school uniform → 改为指代短语",
                "[隐性字段] optics.distance=cowboy shot 与句子可见部位一致",
                "",
                "### 输出 prompt",
                "A black-haired girl in uniform stands at cowboy-shot distance, her gaze fixed on the viewer with a faint smile.",
                "Morning light slants through tall windows, catching dust motes and the edge of her jaw, shadows pooling behind empty desks.",
                "",
            ].join("\n")
            : "";
    
    const base = (preset.trim() ? preset : DEFAULT_REVIEW_PRESET)
        .split("{prompt}").join(prompt)
        .split("{source}").join(params.source ?? "");
    const parts = [base, shapeNote, fewShotBlock, custom.trim(), REVIEW_CONTRACT];
    return parts.filter(p => p && p.trim()).join("\n\n");
}
