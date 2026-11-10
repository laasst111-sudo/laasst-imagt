// ============================================================
// v2.2 pipeline.ts —— 统一生成管线
// ------------------------------------------------------------
// 职责：
//   1) 模块注册表（阶段 × 模块 × 默认状态 × 依赖 × 破坏性）
//   2) v2.1 设置键 → v2.2 模块开关的一次性迁移
//   3) 标签层管线：两条内部解析链（自然语言链 / Danbooru 链）→ 汇合为统一 TagDoc
//      → 公共后处理模块 → 格式化
//
// 设计约束：
//   - 同一件事只在一个模块里做（旧的 postProcessCommon / formatPromptExtTool
//     改为这里的薄封装，不留第二套逻辑）。
//   - 解析一次，后续只操作标签数组。
//   - 关闭任一模块不破坏链路结构，只影响该模块产出。
// ============================================================

import {
    type Lexicon,
    aliasOfTag,
    applyAliasPhrases,
    associateCooc,
    groupsOf,
    keywordPhaseOf,
    LLM_FORBIDDEN_QUALITY,
    normTag,
    phaseOf as lexPhaseOf,
} from "./lexicon.js";
import {
    type TagDoc,
    type TagSection,
    findCjkInSentences,
    greedyDecompose,
    isUsableTag,
    modBudget,
    modCjkStrip,
    modCorpusVocabulary,
    corpusVocabularyChanges,
    modCrossLayerCheck,
    modDedup,
    modDedupCrossCheck,
    modDictValidate,
    modEmotionStrip,
    modProcessStrip,
    modSanitize,
    modSceneConflictGuard,
    parseSentenceDoc,
    parseFallbackDoc,
    parseRuleEngineOutput,
    parseTagDoc,
    renderTagDoc,
    lowerFirstSafe,
} from "./promptPost.js";
import { applyDeterministicCorrections } from "./deterministicCorrections.js";
import type { SubjectInput } from "./promptBuilder.js";
import { FULL_LEXICON_MIN_TAGS, RATING_TAG_RE, COUNT_TAG_RE, SOLO_GENDER_TAG_RE } from "./constants.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

// --------------------------------------------------
// 1. 阶段与模块注册表
// --------------------------------------------------

export type StageId =
    | "clean" | "inject" | "pov" | "extract"
    | "resolve" | "tags" | "format" | "compose" | "review" | "render";

export const STAGE_LABEL: Record<StageId, string> = {
    clean: "阶段1 清洗",
    inject: "阶段2 信息源注入",
    pov: "阶段3 POV",
    extract: "阶段4 LLM-1 抽取",
    resolve: "阶段5 解析分流",
    tags: "阶段6 标签层后处理",
    format: "阶段7 格式化",
    compose: "阶段8 合成",
    review: "阶段9 LLM-2 最终审核",
    render: "阶段10 渲染",
};

export interface ModuleDef {
    id: string;
    stage: StageId;
    label: string;
    desc: string;
    defaultEnabled: boolean;
    /** 会删除内容 → UI 标注「破坏性」 */
    destructive?: boolean;
    /** 依赖的模块 id（依赖被关 → 本模块置灰） */
    requires?: string[];
    /** v2.1 设置键（迁移来源，多个表示「任一为真即开」） */
    legacyKeys?: string[];
    /**
     * 只读状态模块（阶段1 清洗 / 阶段2 信息源注入）：
     * 行为由各自面板的设置直接决定，管线 tab 不提供开关，只展示是否已激活。
     */
    statusOnly?: boolean;
}

export const PIPELINE_MODULES: ModuleDef[] = [
    // 阶段1 清洗（状态由「文本清洗」tab 决定 → 只读展示）
    { id: "clean.floor", stage: "clean", label: "楼层选取", desc: "取最近 N 楼 AI 回复作为正文来源", defaultEnabled: true, statusOnly: true },
    { id: "clean.regex", stage: "clean", label: "正则清洗", desc: "按用户自定义正则规则清洗正文（会删除内容）", defaultEnabled: true, destructive: true, statusOnly: true, legacyKeys: ["regex_rules"] },
    { id: "clean.truncate", stage: "clean", label: "百分比截断", desc: "按百分比截断正文（会删除内容）", defaultEnabled: true, destructive: true, statusOnly: true, legacyKeys: ["truncate_percent"] },
    // 阶段2 信息源（状态由各信息源自己的启用开关决定 → 只读展示）
    { id: "src.mvu", stage: "inject", label: "MVU 角色库", desc: "注入 MVU 变量树中勾选的角色信息", defaultEnabled: false, statusOnly: true, legacyKeys: ["mvu_enabled"] },
    { id: "src.db", stage: "inject", label: "神·数据库", desc: "注入数据库中勾选的表字段", defaultEnabled: false, statusOnly: true, legacyKeys: ["db_enabled"] },
    { id: "src.local", stage: "inject", label: "本地角色库", desc: "注入本地世界书构建的角色库", defaultEnabled: false, statusOnly: true, legacyKeys: ["local_enabled"] },
    { id: "src.bbs", stage: "inject", label: "柏宝书角色库", desc: "注入柏宝书角色/场景/物品（只用【角色】功能，不用 vars）", defaultEnabled: false, statusOnly: true, legacyKeys: ["bbs_enabled"] },
    // 阶段3 POV
    { id: "pov.detect", stage: "pov", label: "POV 判定", desc: "按触发词与第一人称密度判定是否 POV", defaultEnabled: true },
    { id: "pov.strip", stage: "pov", label: "叙述者剔除", desc: "POV 场景剔除叙述者整块（其外观不入画）", defaultEnabled: true, destructive: true, requires: ["pov.detect"] },
    // 阶段4 LLM-1
    { id: "llm.extract", stage: "extract", label: "第一阶段 LLM 抽取", desc: "正文 → 结构化 JSON（description + tags + subjects + optics + pov）", defaultEnabled: true },
    { id: "tagtool.call", stage: "extract", label: "标签工具调用", desc: "允许第一阶段 LLM 调用 Danbooru 标签检索工具挑选标签", defaultEnabled: true, requires: ["llm.extract"] },
    // 阶段5 解析分流
    { id: "resolve.danbooru", stage: "resolve", label: "Danbooru 解析链（词典）", desc: "标签经词典匹配优化：归一 / 未收录剔除 / 景别裁剪 / 人数补全", defaultEnabled: true, requires: ["llm.extract"], legacyKeys: ["ext_dict"] },
    { id: "resolve.strip_unlisted", stage: "resolve", label: "剔除未收录标签", desc: "词库未收录的标签直接剔除（关闭则保留并告警）—— 仅在导入完整词库（>5000 词）时生效；内嵌精选词库下自动保留并告警（否则会误删大量真实标签）", defaultEnabled: true, requires: ["resolve.danbooru"] },
    // 阶段6 标签层后处理
    { id: "pp.sanitize", stage: "tags", label: "标签清洗/词形归一", desc: "下划线→空格、Danbooru 别名归一", defaultEnabled: true, legacyKeys: ["pp_sanitize"] },
    { id: "pp.dedup", stage: "tags", label: "去重（段内+变体）", desc: "段内去重，long hair ≡ long_hair；跨段重复只告警不删", defaultEnabled: true, destructive: true, legacyKeys: ["pp_dedup"] },
    // v2.6：降噪 —— 语料词表归一 + 跨层一致性检查
    { id: "pp.corpus_vocab", stage: "tags", label: "语料词表归一（降噪）", desc: "把语料 0 次的稀有词换成实测高频词：sagging breasts→hanging breasts、pale skin→fair skin、white light→bright lighting、closed curtains→curtains、centered composition→cinematic composition…", defaultEnabled: true },
    { id: "pp.cross_check", stage: "tags", label: "跨层一致性检查（只告警）", desc: "检查标签段与散文段是否重复同一信息或互相矛盾（窗/无窗、室内/室外、有人/独处）", defaultEnabled: true },
    { id: "pp.emotion", stage: "tags", label: "情绪词剔除", desc: "剔除 smiling / happy 等情绪词（表情纯视觉化，会删除内容）", defaultEnabled: true, destructive: true, legacyKeys: ["pp_emotion"] },
    { id: "pp.process", stage: "tags", label: "过程词剔除", desc: "剔除 thrusting / running 等过程词（会删除内容）", defaultEnabled: true, destructive: true, legacyKeys: ["pp_process"] },
    { id: "pp.cjk", stage: "tags", label: "中文残留剔除", desc: "剔除中文/全角残留（句子段保留并告警，会删除内容）", defaultEnabled: true, destructive: true, legacyKeys: ["pp_cjk"] },
    { id: "pp.scene", stage: "tags", label: "景别冲突告警", desc: "近景 + 下半身词冲突告警（仅告警）", defaultEnabled: true, legacyKeys: ["pp_scene"] },
    { id: "pp.dict", stage: "tags", label: "词库校验告警", desc: "标签段零覆盖短语告警（仅告警不删）", defaultEnabled: true, legacyKeys: ["pp_validate"] },
    // 阶段7 格式化
    { id: "fmt.budget", stage: "format", label: "标签预算", desc: "标签段超出上限时从尾部截断（会删除内容）", defaultEnabled: true, destructive: true, legacyKeys: ["pp_budget"] },
    { id: "fmt.category_sort", stage: "format", label: "分类排序", desc: "画风→主体→动作→背景排序（仅标签段）", defaultEnabled: true, legacyKeys: ["ext_order"] },
    { id: "fmt.weight", stage: "format", label: "权重映射", desc: "按词组映射输出 (tag:N)（仅标签段）", defaultEnabled: false, legacyKeys: ["ext_weight"] },
    { id: "fmt.prefix_dedup", stage: "format", label: "前缀去重", desc: "pov + pov_crotch → 只留更长者（仅标签段；默认关闭，可能误删语义不同的标签）", defaultEnabled: false },
    { id: "fmt.enrich", stage: "format", label: "共现联想", desc: "按共现邻居补标签（会新增可能与原文不符的标签，仅标签段）", defaultEnabled: false, legacyKeys: ["ext_enrich"] },
    // 阶段8 合成
    { id: "cmp.prefix", stage: "compose", label: "固定前缀", desc: "在最终 prompt 前拼接固定前缀", defaultEnabled: true, legacyKeys: ["fixed_prompt_prefix"] },
    { id: "cmp.tags", stage: "compose", label: "自定义标签", desc: "拼接用户自定义 prompt 标签", defaultEnabled: true, legacyKeys: ["prompt_tags_enabled"] },
    { id: "cmp.style", stage: "compose", label: "预设风格", desc: "拼接预设风格提示词", defaultEnabled: true, legacyKeys: ["style_preset_enabled"] },
    { id: "cmp.suffix", stage: "compose", label: "固定后缀", desc: "在最终 prompt 后拼接固定后缀", defaultEnabled: true, legacyKeys: ["fixed_prompt_suffix"] },
    { id: "cmp.cjk_fallback", stage: "compose", label: "中文兜底剔除", desc: "最终 prompt 仍含中文时兜底剔除（会删除内容）", defaultEnabled: true, destructive: true },
    // 阶段9 LLM-2
    { id: "llm.review", stage: "review", label: "第二阶段 LLM 审核", desc: "对插件处理后的最终 prompt 审查优化后再送 ComfyUI", defaultEnabled: false, requires: ["llm.extract"] },
    { id: "review.format_guard", stage: "review", label: "审核格式守卫", desc: "修订版格式与原格式不符时丢弃修订版（会删除内容）", defaultEnabled: true, destructive: true, requires: ["llm.review"] },
    { id: "tagtool.review", stage: "review", label: "审核阶段标签工具", desc: "允许审核阶段调用标签工具补/换标签", defaultEnabled: true, requires: ["llm.review"] },
];

export const MODULE_MAP: Map<string, ModuleDef> = new Map(PIPELINE_MODULES.map(m => [m.id, m]));

// --------------------------------------------------
// 2. 设置迁移与开关读取
// --------------------------------------------------

/**
 * v2.1 → v2.2 迁移：把旧键映射到模块开关。
 * 规则：
 *   1) 首次迁移从旧键推导（旧键优先于模块默认值）；
 *   2) 之后每次启动只**补齐缺失模块**的默认开关，不覆盖用户已有选择
 *      （保证版本新增模块能自动获得默认值）；
 *   3) 只有布尔型旧键参与开关推导；值型旧键（如 pov_triggers / truncate_percent）
 *      不作为开关依据 —— 「空触发词」不等于「关闭 POV 判定」。
 * 版本历史：
 *   v1: 初始迁移 (pipeline_migrated)
 *   v2: v2.3 对齐 (pipeline_switch_aligned, pipeline_enrich_aligned, pipeline_prefix_dedup_aligned, id 归域)
 *   v3: 当前版本
 */
const PIPELINE_VERSION = 3;

export function migratePipelineSettings(settings: Record<string, any>): void {
    const switches: Record<string, boolean> = { ...(settings.pipeline_modules ?? {}) };
    const currentVersion = (settings.pipeline_version as number) ?? 0;
    const firstRun = currentVersion === 0;

    // v1: 初始迁移 - 从旧键推导模块开关
    if (currentVersion < 1) {
        for (const mod of PIPELINE_MODULES) {
            if (typeof switches[mod.id] === "boolean") continue;
            let on = mod.defaultEnabled;
            if (firstRun) {
                for (const key of mod.legacyKeys ?? []) {
                    const v = settings[key];
                    if (typeof v === "boolean") { on = v; break; }
                    if (Array.isArray(v)) { on = v.length > 0; break; }
                    if (typeof v === "number") { on = v > 0 && v < 100; break; }
                    if (typeof v === "string") { on = v.trim() !== ""; break; }
                }
            }
            switches[mod.id] = on;
        }

        // gen_pipeline：extool → 空格分隔 + 标签链；current → 逗号分隔
        const separator = settings.gen_pipeline === "extool" ? "space" : "comma";
        settings.pipeline_format = { separator, ...(settings.pipeline_format ?? {}) };
        settings.pipeline_modules = switches;
        if (settings.extract_output_mode === undefined) settings.extract_output_mode = "mixed";
        settings.pipeline_version = 1;
    }

    // v2: v2.3 对齐
    if (currentVersion < 2) {
        let sw = (settings.pipeline_modules ?? {}) as Record<string, boolean>;
        // ① 旧「启用审核 / 格式守卫」开关 → 对应模块开关
        if (settings.review_enabled === true) sw["llm.review"] = true;
        if (settings.review_format_guard === false) sw["review.format_guard"] = false;
        // ② 移除两个从未参与运行的失效开关
        const deadIds = ["resolve.natural", "resolve.count_tags"];
        if (deadIds.some(id => typeof sw[id] === "boolean")) {
            const next: Record<string, boolean> = {};
            for (const [k, v] of Object.entries(sw)) {
                if (deadIds.includes(k)) continue;
                next[k] = v;
            }
            sw = next;
        }
        // ③ 共现联想（fmt.enrich）默认关闭
        sw["fmt.enrich"] = false;
        // ④ 前缀去重（fmt.prefix_dedup）默认关闭
        sw["fmt.prefix_dedup"] = false;
        // ⑤ 模块 id 归域 + 失效开关清理
        const next: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(sw)) {
            if (k === "resolve.dual_dedup") continue;
            if (k === "pp.budget") { next["fmt.budget"] = v; continue; }
            next[k] = v;
        }
        settings.pipeline_modules = next;
        settings.pipeline_version = 2;
    }

    // v3: 当前版本 - 补齐新增模块的默认开关（不覆盖用户已有选择）
    if (currentVersion < PIPELINE_VERSION) {
        const sw = (settings.pipeline_modules ?? {}) as Record<string, boolean>;
        for (const mod of PIPELINE_MODULES) {
            if (typeof sw[mod.id] !== "boolean") {
                sw[mod.id] = mod.defaultEnabled;
            }
        }
        settings.pipeline_modules = sw;
        settings.pipeline_version = PIPELINE_VERSION;
    }

    // 保留兼容性标记（供旧版本检测）
    settings.pipeline_migrated = true;
    settings.pipeline_switch_aligned = true;
    settings.pipeline_enrich_aligned = true;
    settings.pipeline_prefix_dedup_aligned = true;
}

/** 读取全部模块开关（含默认值补全） */
export function getModuleSwitches(settings: Record<string, any>): Record<string, boolean> {
    const stored = (settings.pipeline_modules ?? {}) as Record<string, boolean>;
    const out: Record<string, boolean> = {};
    for (const mod of PIPELINE_MODULES) {
        out[mod.id] = typeof stored[mod.id] === "boolean" ? stored[mod.id] : mod.defaultEnabled;
    }
    return out;
}

/** 单个模块是否启用 */
export function isModuleEnabled(settings: Record<string, any>, id: string): boolean {
    const stored = (settings.pipeline_modules ?? {}) as Record<string, boolean>;
    return typeof stored[id] === "boolean" ? stored[id] : (MODULE_MAP.get(id)?.defaultEnabled ?? false);
}

/** 依赖是否满足（用于 UI 置灰） */
export function moduleDepsSatisfied(settings: Record<string, any>, id: string): boolean {
    const mod = MODULE_MAP.get(id);
    if (!mod?.requires?.length) return true;
    return mod.requires.every(dep => isModuleEnabled(settings, dep));
}

// --------------------------------------------------
// 2.5 只读状态模块（阶段1 清洗 / 阶段2 信息源注入）
// --------------------------------------------------

/** 阶段1/2 模块的当前状态（由各自面板的设置决定） */
export interface ModuleStatus {
    /** 是否已激活 */
    active: boolean;
    /** 状态摘要（展示在模块行内） */
    detail: string;
    /** 状态由哪个面板决定 */
    panel: string;
}

function sourceStatus(settings: Record<string, any>, key: string, name: string): ModuleStatus {
    const on = settings[key] === true;
    return { active: on, detail: on ? `${name}已启用` : `${name}未启用`, panel: "角色库" };
}

/**
 * 读取阶段1/2 模块的真实状态。
 * 这两类模块没有独立开关：行为完全由「文本清洗」「角色库」tab 的设置决定，
 * 管线 tab 只读展示（避免同一个功能出现两个开关）。
 */
export function getModuleStatus(settings: Record<string, any>, id: string): ModuleStatus | null {
    switch (id) {
        case "clean.floor": {
            const n = Number(settings.floor_count ?? 1);
            return { active: n >= 1, detail: `取最近 ${n} 楼 AI 回复`, panel: "文本清洗" };
        }
        case "clean.regex": {
            const rules = Array.isArray(settings.regex_rules) ? settings.regex_rules : [];
            const on = rules.filter(r => r && r.enabled !== false && String(r.pattern ?? "").trim() !== "").length;
            return { active: on > 0, detail: on > 0 ? `${on} 条启用规则` : "无启用规则", panel: "文本清洗" };
        }
        case "clean.truncate": {
            const p = Number(settings.truncate_percent ?? 100);
            return { active: p < 100, detail: p < 100 ? `截取 ${p}%` : "不截断（100%）", panel: "文本清洗" };
        }
        case "src.mvu": return sourceStatus(settings, "mvu_enabled", "MVU 角色库");
        case "src.db": return sourceStatus(settings, "db_enabled", "神·数据库");
        case "src.local": return sourceStatus(settings, "local_enabled", "本地角色库");
        case "src.bbs": return sourceStatus(settings, "bbs_enabled", "柏宝书角色库");
        default: return null;
    }
}

/** 模块是否处于「激活」状态（只读模块看状态，其余看开关） */
export function isModuleActive(settings: Record<string, any>, id: string): boolean {
    const mod = MODULE_MAP.get(id);
    if (mod?.statusOnly) return getModuleStatus(settings, id)?.active ?? false;
    return isModuleEnabled(settings, id);
}

/** 写出模块开关 */
export function setModuleEnabled(settings: Record<string, any>, id: string, enabled: boolean): void {
    const switches = { ...(settings.pipeline_modules ?? {}) } as Record<string, boolean>;
    switches[id] = enabled;
    settings.pipeline_modules = switches;
}

// --------------------------------------------------
// 3. 阶段报告
// --------------------------------------------------

export interface PipelineWarning {
    /** 告警等级 */
    level: "info" | "warn" | "error";
    /** 产生告警的模块 id */
    module: string;
    /** 机器可读的错误代码 */
    code: string;
    /** 人类可读的消息 */
    message: string;
    /** 结构化上下文数据（用于程序化处理/测试断言） */
    data?: Record<string, any>;
}

/** 兼容旧字符串告警的辅助函数 */
export function toPipelineWarning(w: string | PipelineWarning, module: string, code: string, level: "info" | "warn" | "error" = "warn"): PipelineWarning {
    if (typeof w === "string") {
        return { level, module, code, message: w };
    }
    return w;
}

/** 内部字符串告警数组转结构化告警 */
function convertWarnings(warnings: string[], defaultModule: string, defaultCode: string, defaultLevel: "info" | "warn" | "error" = "warn"): PipelineWarning[] {
    return warnings.map(w => toPipelineWarning(w, defaultModule, defaultCode, defaultLevel));
}

export interface StageReport {
    stage: StageId;
    id: string;
    label: string;
    enabled: boolean;
    /**
     * 本次是否**真的执行**了（v2.3）：
     * enabled 只表示「模块开关为开」；applied 表示「对本次产物产生了作用」。
     * 二者不等的情形很常见：阶段7 的模块只作用于标签段，
     * 而「只解析自然语言描述」模式下根本没有标签段 → 开关开着但模块没跑。
     */
    applied?: boolean;
    inLen: number;
    outLen: number;
    /** 计量单位：tags=标签条数，chars=字符数（避免同一列混用两种量纲） */
    unit?: "tags" | "chars";
    /** 告警信息：支持字符串数组（兼容旧代码）或结构化 PipelineWarning 数组 */
    warnings: (string | PipelineWarning)[];
}

// --------------------------------------------------
// 4. 标签层管线（两条内部解析链 → 统一 TagDoc → 后处理 → 格式化）
// --------------------------------------------------

export type ExtractMode = "mixed" | "description" | "tags" | "custom";

/**
 * v2.4：完整出图矩阵（3 输出模式 × 审核开/关 = 6 个格子）的**单一事实源**。
 * ------------------------------------------------------------
 * 每个格子决定了四件事：
 *   ① 抽取系统提示词按哪个模式规范组装（buildExtractSystemPrompt 的 mode）
 *   ② 阶段7 的分隔符（space=纯标签串 / comma=逗号串）
 *   ③ 送审形态（审核系统提示词按哪套审查条目）
 *   ④ 审核阶段是否参与
 *
 * 以前这四件事散落在 index.ts 的 if 分支里，没有任何一处能回答
 * 「当前配置落在矩阵的哪一格」；新增模式或改审核开关时很容易只改一半。
 * 现在 index.ts 与 prompt_matrix_test.mjs 共用本定义。
 */
export type ReviewShape = "tags" | "description" | "mixed";

export interface ImageMatrixCell {
    /** 输出模式（第一阶段抽取规范） */
    mode: ExtractMode;
    /** 第二阶段审核是否参与 */
    review: boolean;
    /** 阶段7 渲染分隔符 */
    separator: "comma" | "space";
    /** 送审形态（审核基准） */
    shape: ReviewShape;
    /** 该格子的中文标签（UI / 报告用） */
    label: string;
}

/** 送审形态由输出模式唯一决定（mode→shape 是 1:1） */
export function reviewShapeFor(mode: ExtractMode): ReviewShape {
    if (mode === "tags") return "tags";
    if (mode === "description") return "description";
    return "mixed"; // custom 走 mixed 审核基准（双段兼容）
}

/**
 * 审核阶段是否参与。
 * 条件与 index.ts 的调用点一致（模块开关为开，且未勾选「保留原始提示词」）。
 */
export function shouldRunReview(settings: Record<string, any>): boolean {
    return isModuleEnabled(settings, "llm.review") && settings.review_keep_original !== true;
}

/** 枚举完整矩阵（4 模式 × 审核开/关） */
export function enumerateImageMatrix(): ImageMatrixCell[] {
    const modes: ExtractMode[] = ["mixed", "description", "tags", "custom"];
    const cells: ImageMatrixCell[] = [];
    for (const mode of modes) {
        for (const review of [false, true]) {
            cells.push({
                mode,
                review,
                separator: "comma",   // v2.4：兼容字段，不再影响渲染（Hard Tags 统一逗号分隔）
                shape: reviewShapeFor(mode),
                label: `${mode} × 审核${review ? "开" : "关"}`,
            });
        }
    }
    return cells;
}

/** 按当前设置解析出所处矩阵格子（settings 为空 → 默认 mixed × 审核关） */
export function resolveMatrixCell(settings: Record<string, any>): ImageMatrixCell {
    const mode = (settings.extract_output_mode as ExtractMode) ?? "mixed";
    const review = shouldRunReview(settings);
    return {
        mode,
        review,
        separator: "comma",   // v2.4：兼容字段，不再影响渲染（Hard Tags 统一逗号分隔）
        shape: reviewShapeFor(mode),
        label: `${mode} × 审核${review ? "开" : "关"}`,
    };
}


export interface TagPipelineInput {
    /** 自然语言链产物（规则引擎组装或 LLM 直出 description） */
    descriptionPrompt: string;
    /** Danbooru 链原始标签（LLM 直出） */
    llmTags: string[];
    /** 输出模式 */
    mode: ExtractMode;
    /** 模块开关 */
    modules: Record<string, boolean>;
    /** 词库（Danbooru 链与词库校验用） */
    lexicon?: Lexicon;
    /** 输出分隔符：comma=自然语言，space=纯标签 */
    separator: "comma" | "space";
    /** 标签预算上限（只作用于标签段） */
    budgetMax?: number;
    /** 权重映射（键为用户填写的词组；支持空格 / 下划线 / 别名归一后写法） */
    weightMap?: Record<string, number>;
    /**
     * v2.6：质量/评分词（如 masterpiece, best quality, absurdres, score_9）。
     * 由用户在设置里手动填写（Anima 官方契约要求 Hard Tags 含质量词与评分），
     * 插件**不生成**它们，只负责把它们放到**正确的位置**（风格位 = 分级与人数之后）。
     */
    qualityWords?: string[];
    /**
     * 「剔除未收录标签」由模块开关 resolve.strip_unlisted 决定（v2.3 起统一从 modules 读，
     * 不再走独立输入字段，避免两处口径不一致）。
     */
    /** 描述段是否为「完整英文句子」（LLM 直出 description）→ 按句号切分，不按逗号 */
    descriptionIsSentence?: boolean;
    /**
     * 校正层（Anima 规范对齐）：LLM 直出时，规则引擎的确定性要素在此叠加，
     * 而不是被丢弃。缺省（undefined）= 不做校正（保持与 v2.1 等价）。
     */
    corrections?: {
        /** 人数标签（Hard Tags 形式） */
        countTags?: string[];
        /** 归一后的镜头词（Natural Language 段缺失时补入） */
        opticsWords?: string[];
        /** 新增：结构化镜头词（用于标签化） */
        opticsWordsV2?: {
            subjectDirection?: string;
            cameraAngle?: string;
            distance?: string;
            focusTarget?: string;
            depthOfField?: string;
            composition?: string;
            perspective?: string;
        };
        /** 景别（标签兼容性裁剪） */
        distance?: string;
        /** POV 场景 */
        isPov?: boolean;
    };
    /** 主 + 次角色（用于 sexWith 排他、性别启发式等确定性校正） */
    subjects?: SubjectInput[];
    /** 是否允许 corrections 覆盖 LLM 直出的人数标签（默认 false = 只告警） */
    overrideLlmCountTags?: boolean;
    /** 候选标签来源备注（用于告警归因） */
    candidateSourceNote?: string;
}

export interface TagPipelineResult {
    prompt: string;
    warnings: PipelineWarning[];
    reports: StageReport[];
}

function on(modules: Record<string, boolean>, id: string): boolean {
    return modules[id] === true;
}

/** 从 subjects 推导人数标签（与 deterministicCorrections.ts 逻辑一致） */
function countTagsFromSubjects(subjects: SubjectInput[]): string[] {
    const females = subjects.filter(p => p.gender !== "male").length;
    const males = subjects.filter(p => p.gender === "male").length;
    const F = ["", "1girl", "2girls", "3girls", "4girls", "5girls"];
    const M = ["", "1boy", "2boys", "3boys", "4boys", "5boys"];
    const out: string[] = [];
    if (females >= 1) out.push(females <= 5 ? F[females] : "multiple girls");
    if (males >= 1) out.push(males <= 5 ? M[males] : "multiple boys");
    return out;
}

/**
 * v2.6：标签段**头部顺序**校正「分级 → 人数 → 其余」（共享路径，两条链都执行）。
 *
 * 为什么上移：v2.4 的这段校正只写在「Danbooru 解析链」里（buildDanbooruSection），
 * 一旦该开关关闭 → 走「LLM 直出标签原样保留」分支 → 头部顺序完全不校正 →
 * 实测出现「质量咒语在最前、explicit 排到第 6 位」的分叉。
 * 语料骨架：分级 0.21 → 人数 0.27 → 风格 0.36 → 外观 0.49。
 */
export function applyHeaderOrder(tags: string[], warnings?: string[]): void {
    const ratingIdx = tags.findIndex(t => RATING_TAG_RE.test(t));
    if (ratingIdx > 0) {
        const [rt] = tags.splice(ratingIdx, 1);
        tags.unshift(rt);
        warnings?.push(`[头部顺序] 安全分级提到段首: ${rt}`);
    }
    // v3: solo 与 1girl/1boy 同组，保持二者相对顺序
    const isCountLike = (t: string): boolean => COUNT_TAG_RE.test(t) || SOLO_GENDER_TAG_RE.test(t);
    const movers = tags.filter(isCountLike);
    if (!movers.length) return;
    // 去重保持原相对顺序
    const uniqueMovers: string[] = [];
    const seen = new Set<string>();
    for (const m of movers) {
        if (!seen.has(m)) { seen.add(m); uniqueMovers.push(m); }
    }
    const moversSet = new Set(uniqueMovers);
    // 一次性过滤，避免 indexOf 逐个删除
    const filtered = tags.filter(t => !moversSet.has(t));
    tags.length = 0;
    tags.push(...filtered);
    const at = tags.findIndex(t => RATING_TAG_RE.test(t));
    tags.splice(at >= 0 ? at + 1 : 0, 0, ...uniqueMovers);
    warnings?.push(`[头部顺序] 人数/性别标签提到分级之后: ${uniqueMovers.join(", ")}`);
}

/**
 * v2.6：剔除 LLM 吐出来的「质量咒语 / 评分词」。
 * 用户手填的质量词随后由 insertQualityWords 放回风格位（分级与人数之后）。
 * 安全分级（safe/sensitive/nsfw/explicit）与合法画风词（realistic/illustration…）**不动**。
 */
export function stripLlmQualityWords(tags: string[], warnings?: string[]): void {
    const kept: string[] = [];
    const dropped: string[] = [];
    for (const t of tags) {
        if (LLM_FORBIDDEN_QUALITY.has(normTag(t))) { dropped.push(t); continue; }
        kept.push(t);
    }
    if (!dropped.length) return;
    tags.length = 0;
    tags.push(...kept);
    warnings?.push(`[质量词剔除] 已移除 LLM 输出的质量/评分词（应由设置里的「质量/评分词」提供）: ${dropped.join(", ")}`);
}

/**
 * v2.6：把用户手动填写的质量/评分词放到**风格位**（分级与人数之后）。
 *
 * 背景：Anima 官方契约要求 Hard Tags 含「质量/年代/安全分级 + score_1~9」，
 * 但插件的输出禁令不让 LLM 写质量咒语（语料 80 条 0 次使用）。
 * 折中：质量词由**用户设置**手动提供，插件只管位置 ——
 * 放在段首会顶掉分级旗标（规范要求分级最靠前），放在末尾又会被当成"随手一提"，
 * 正确位置是语料骨架里的**风格位（0.36）**：分级 → 人数 → 质量/风格 → 外观。
 */
export function insertQualityWords(tags: string[], quality: string[], warnings?: string[]): void {
    if (!quality?.length) return;
    const existing = new Set(tags.map(t => String(t ?? "").trim().toLowerCase()));
    const add = quality
        .map(q => String(q ?? "").trim())
        .filter(q => q && !existing.has(q.toLowerCase()));
    if (!add.length) return;
    let at = 0;
    const rIdx = tags.findIndex(t => RATING_TAG_RE.test(t));
    if (rIdx >= 0) at = rIdx + 1;
    const cIdx = tags.findIndex((t, i) => i >= at && COUNT_TAG_RE.test(t));
    if (cIdx >= 0) at = cIdx + 1;
    tags.splice(at, 0, ...add);
    warnings?.push(`[质量词位] 质量/评分词已放到风格位（分级与人数之后）: ${add.join(", ")}`);
}

/**
 * 标签段输出归一：**空格替换下划线**（Anima 格式规范：「标签使用小写，空格替换下划线」）。
 *
 * v2.2~v2.3 这里是下划线形式，理由是「标签段以空格分隔，多词标签写成 "best quality"
 * 无法区分一个标签与两个标签」。v2.4 改回空格形式，因为：
 *   ① Anima 规范要求逗号分隔（`一个逗号 + 一个空格`）+ 空格替换下划线；
 *   ② 逗号分隔消除了歧义，不再需要下划线；
 *   ③ 实测热门提示词语料：空格式 58.7%，snake_case 仅 1.0%。
 * `score_1`~`score_9` 按规范**保留下划线**（v2.6 修复：此前被一并转成 `score 9`，
 * 与 Anima 契约「score_N 保留 snake_case」相悖）。
 * 权重 token `(tag:1.2)` **保留原样**（括号是语义必需，内部空格不折叠）。
 */
function normalizeTagForSection(raw: string): string {
    const t = String(raw ?? "").trim().toLowerCase();
    if (!t) return "";
    // 权重 token (tag:1.2) 保留原样（不折叠内部空格、不转下划线）
    if (/^\([^():]+:\d+(?:\.\d+)?\)$/.test(t)) return t;
    // v2.6：score_1~score_9 保留下划线（Anima 契约的例外项）—— 空格形式也统一转回下划线
    const sc = t.match(/^score[_ ]([1-9])$/);
    if (sc) return `score_${sc[1]}`;
    // 空白折叠为单空格；下划线视为空格（Danbooru 两种写法都收）
    return t.replace(/[_\s]+/g, " ").replace(/^ | $/g, "");
}

/**
 * 词库查询用形式：保留空格（词库键是空格形式），仅小写 + 折叠空白。
 * v2.6：`score_1`~`score_9` **保留下划线**（Anima 契约的例外项）——
 *   否则查库/白名单都命中不到（白名单里是 `score_9`），最终被输出成 `score 9`。
 */
/** 解析权重 token → { tag, weight } 或 null */
export function parseWeightToken(raw: string): { tag: string; weight: number } | null {
    const m = String(raw ?? "").trim().match(/^\(([^():]+):(\d+(?:\.\d+)?)\)$/);
    if (!m) return null;
    const w = Number(m[2]);
    if (!Number.isFinite(w)) return null;
    return { tag: m[1].trim(), weight: w };
}

function normalizeTagForLookup(raw: string): string {
    const t = String(raw ?? "").trim().toLowerCase();
    // 权重 token：内部原样保留（含下划线），只折叠外部空白
    const wt = parseWeightToken(t);
    if (wt) return t;
    if (/^score_[1-9]$/.test(t)) return t;
    if (/^score [1-9]$/.test(t)) return t.replace(" ", "_");
    return t.replace(/\s+/g, " ");
}

/**
 * 「更具体的部位词」白名单：前缀去重时，只有当更长的标签是
 * 「短标签 + 身体部位词」时才允许删掉短标签。
 * 收紧前的纯字符串前缀规则会删掉语义不同的标签：
 *   blue_hair + blue_hair_ribbon → 只剩 blue_hair_ribbon（发色丢失）
 * 收紧后：
 *   pov + pov_crotch → 只留 pov_crotch ✓（crotch 是部位词）
 *   blue_hair + blue_hair_ribbon → 两个都留 ✓（ribbon 是配饰，不是部位）
 */
const SPECIFIC_PART_WORDS = new Set([
    "hair", "hairs", "hairpin", "ponytail", "eyes", "eye", "skin", "face", "head",
    "chest", "breast", "breasts", "cleavage", "waist", "hips", "butt", "crotch",
    "belly", "navel", "thigh", "thighs", "thighhighs", "leg", "legs", "knee", "knees",
    "ankle", "ankles", "foot", "feet", "arm", "arms", "hand", "hands", "finger", "fingers",
    "elbow", "elbows", "shoulder", "shoulders", "neck", "back", "forehead", "cheek", "cheeks",
    "mouth", "lips", "teeth", "tongue", "ear", "ears", "tail",
]);

/** 阶段7-1 前缀去重（默认关闭；收紧匹配 + 删除告警） */
function fmtPrefixDedup(tags: string[], warnings: string[]): string[] {
    const key = (t: string) => t.toLowerCase().replace(/_/g, " ");
    const removed: string[] = [];
    const out = tags.filter(t => {
        const kt = key(t);
        const dominated = tags.some(o => {
            if (o === t) return false;
            const ko = key(o);
            if (!ko.startsWith(kt + " ")) return false;
            const extra = ko.slice(kt.length + 1).trim();
            return extra.length > 0 && extra.split(/\s+/).every(w => SPECIFIC_PART_WORDS.has(w));
        });
        if (dominated) removed.push(t);
        return !dominated;
    });
    if (removed.length) {
        warnings.push(`[前缀去重] 已删除被更具体标签覆盖的标签: ${removed.join(", ")}`);
    }
    return out;
}

/** 阶段7-2 共现联想（默认关闭：凭种子补邻居，可能与原文不符） */
function fmtEnrich(tags: string[], input: TagPipelineInput, warnings: string[]): string[] {
    const lex = input.lexicon;
    if (!lex) return tags;
    // 邻居与标签都可能是空格/下划线形式 → 比较前统一折叠（否则重复标签会漏判）
    const fold = (t: string) => String(t ?? "").toLowerCase().replace(/[_-]+/g, " ").trim();
    const seen = new Set(tags.map(fold));
    const extra = associateCooc(lex, tags)
        .filter(t => isUsableTag(lex, t) && !seen.has(fold(t)))
        .slice(0, 12);
    if (!extra.length) return tags;
    warnings.push(`[共现联想] 新增 ${extra.length} 个联想标签（可能与原文不符）: ${extra.slice(0, 6).join(", ")}`);
    return [...tags, ...extra.map(normalizeTagForSection)];
}

/** 阶段7-3 分类排序（Anima 规范词序：分级 → 人数 → 风格 → 外观 → 服装 → 表情 → 动作 → 镜头 → 场景 → 光影 → 文字） */
function fmtCategorySort(tags: string[], input: TagPipelineInput): string[] {
    const lex = input.lexicon;
    if (!lex) {
        return [...tags].sort((a, b) => keywordPhaseOf(a) - keywordPhaseOf(b));
    }
    // v2.4：**稳定排序**（不再用 localeCompare 做次级键）。
    //   此前同一阶段内按字母序排 → 把 LLM 在同一维度内刻意排的顺序打乱
    //   （例："black hair" 与 "blue eyes" 被重排成字母序）。
    //   JS 的 Array.prototype.sort 自 ES2019 起保证稳定 → 阶段内保持输入顺序，
    //   正好就是抽取提示词要求 LLM 遵守的「维度内顺序」。
    return [...tags].sort((a, b) => lexPhaseOf(lex, a) - lexPhaseOf(lex, b));
}

/**
 * 阶段7-4 权重映射
 *  - 查表同时支持：原始键 / 下划线键 / 空格键 / **别名归一后**的键
 *    （用户写 "silver hair"，标签被别名归一成 "grey_hair" 后仍能命中）
 *  - 人数标签（1girl/2girls…）是结构 token，加权会破坏计数语义 → 跳过并告警
 *  - 已带权重的标签 `(tag:1.2)` 直接跳过并告警（防双重加权）
 *  - 安全分级标签（safe/sensitive/nsfw/explicit）不加权
 */
const RATING_RE = /^(safe|sensitive|nsfw|explicit)$/i;
function fmtWeight(tags: string[], input: TagPipelineInput, warnings: string[]): string[] {
    const wm = input.weightMap ?? {};
    const lookup = new Map<string, number>();
    for (const [k, v] of Object.entries(wm)) {
        if (typeof v !== "number" || !k.trim()) continue;
        lookup.set(k.trim().toLowerCase(), v);
        lookup.set(normTag(k), v);
        lookup.set(normTag(applyAliasPhrases(k)), v);
    }
    if (!lookup.size) return tags;
    const skipped: string[] = [];
    const doubleWeighted: string[] = [];
    const out = tags.map(t => {
        const wt = parseWeightToken(t);
        if (wt) { doubleWeighted.push(t); return t; }   // 已带权重，跳过
        const w = lookup.get(t.toLowerCase()) ?? lookup.get(normTag(t));
        if (typeof w !== "number") return t;
        if (COUNT_TAG_RE.test(t)) { skipped.push(t); return t; }
        if (RATING_RE.test(t)) { skipped.push(t); return t; }
        return `(${t}:${w})`;
    });
    if (skipped.length) {
        warnings.push(`[权重映射] 已跳过人数标签（加权会破坏计数语义）: ${skipped.join(", ")}`);
    }
    if (doubleWeighted.length) {
        warnings.push(`[权重映射] 已跳过已带权重的标签（防双重加权）: ${doubleWeighted.join(", ")}`);
    }
    return out;
}

/**
 * 阶段7 的标签段专属处理（调度器）。
 * v2.3：四个模块拆成独立函数（fmtPrefixDedup / fmtEnrich / fmtCategorySort / fmtWeight），
 * 由 runTagPipeline 逐个调用 → 每个模块在阶段报告里可单独归因
 * （此前四个模块挤在一个函数里跑，报告里 in/out 完全相同、看不出谁做了什么）。
 */

/**
 * Danbooru 链：LLM 直出标签 → 词典匹配优化
 * 归一 → 未收录剔除（+告警）→ 景别兼容性裁剪 → 人数标签补全
 *
 * v2.3 修正：
 *   ① **词库查询一律用空格形式**（black hair），输出时才转下划线（black_hair）——
 *      此前先转下划线再查库，而词库键是空格形式 → 分类/共现/别名/阶段查询全部落空。
 *   ② 「未收录」口径 = 词库收录 ∪ 分类表收录 ∪ 质量词白名单（此前只用分类表，
 *      导致 masterpiece / best_quality 等质量词被当成未收录剔除，与 Anima 契约冲突）。
 *   ③ 阶段7 的四个 fmt 模块（前缀去重 / 共现 / 分类排序 / 权重）移出本函数，
 *      交回阶段7 统一执行（此前在阶段5 内部跑，阶段分组与执行顺序不一致）。
 *
 * 标签来源优先级：
 *   1) LLM 直出的 tags（模型已按 Danbooru 风格给出）
 *   2) 无直出标签时，从自然语言段做词典贪心分解（等价 v2.1 extool 链路）
 */
function buildDanbooruSection(input: TagPipelineInput, warnings: string[], _descDoc: TagDoc): TagSection {
    const lex = input.lexicon;
    // v2.6 安全网：**内嵌精选词库只有 1040 条**，绝大多数真实标签（nude / breasts / navel /
    //   sweat / chair / centered composition…）都「未收录」→ 若此时执行「剔除未收录标签」，
    //   标签段会被系统性削掉一大半（实测：36 个标签只剩 19 个）。
    //   因此只有**导入完整词库**（词库.bmz，>5000 词）后才允许剔除；否则一律保留 + 告警。
    const lexIsFull = !!lex && lex.allKeys.size >= FULL_LEXICON_MIN_TAGS;
    const stripSwitch = on(input.modules, "resolve.strip_unlisted");
    const stripUnlisted = stripSwitch && lexIsFull;
    if (stripSwitch && !lexIsFull) {
        warnings.push(`[Danbooru 链] 「剔除未收录标签」已开启，但当前词库只有 ${lex?.allKeys.size ?? 0} 条（内嵌精选）→ 本次**不剔除**（否则会误删大量真实标签）；导入完整 词库.bmz 后该开关才会生效`);
    }
    const tags: string[] = [];      // 空格形式（词库查询用；输出保持空格形式）
    const unlisted: string[] = [];

    const source = input.llmTags ?? [];
    if (!source.length && lex) {
        // 无直出标签 → 词典贪心分解（v2.1 extool 行为）
        // v2.5：用 parseFallbackDoc（按行取单位）—— 此前用 parseTagDoc 会把
        //   无逗号的环境行（"dim bedroom: lamplight from above."）按空格切碎
        //   → 逐词去词库匹配 → 命中不了 → 场景信息整体丢失。
        for (const sec of parseFallbackDoc(input.descriptionPrompt ?? "").sections) {
            for (const unit of sec.tags) {
                for (const c of greedyDecompose(lex, unit)) {
                    if (!tags.includes(c)) tags.push(c);
                }
            }
        }
    } else {
        for (const raw of source) {
            const t = normalizeTagForLookup(raw);
            if (!t) continue;
            if (lex) {
                let canonical = t;
                if (!isUsableTag(lex, canonical)) {
                    const alias = aliasOfTag(canonical);
                    if (alias && isUsableTag(lex, alias)) canonical = normalizeTagForLookup(alias);
                }
                if (!isUsableTag(lex, canonical)) {
                    unlisted.push(t);
                    if (stripUnlisted) continue;
                }
                tags.push(canonical);
            } else {
                tags.push(t);
            }
        }
    }
    if (unlisted.length) {
        warnings.push(`[Danbooru 链] ${unlisted.length} 个标签词库未收录${stripUnlisted ? "（已剔除）" : "（已保留）"}: ${unlisted.slice(0, 8).join(", ")}${unlisted.length > 8 ? " …" : ""}`);
        // 安全网：全部标签都被剔除 → 标签段会塌陷（Anima 双段结构失效，只剩自然语言段）。
        // 此时保留原标签并告警（多为「未导入完整词库」导致，词库只收 1040 条内嵌精选）。
        if (stripUnlisted && tags.length === 0 && source.length > 0) {
            tags.push(...source.map(normalizeTagForLookup).filter(Boolean));
            warnings.push("[Danbooru 链] 所有标签都被判为未收录 → 已保留原标签以维持段结构；建议导入完整词库或关闭「剔除未收录标签」");
        }
    }

    // 校正层②：人数标签补全（仅作规则引擎内部兜底——无 corrections 时）
    // 优先用校正层给出的人数标签；校正层缺失时按主体头统计（旧「计数标签」模块的逻辑，改为常驻）。
    // 注意：LLM 直出标签的人数冲突由共享校正层（runTagPipeline 中的 applyDeterministicCorrections）处理。
    if (!tags.some(t => COUNT_TAG_RE.test(t) || SOLO_GENDER_TAG_RE.test(t))) {
        const countTags = countTagsFromSubjects(input.subjects ?? []);
        if (countTags.length) {
            tags.unshift(...countTags);
        }
    }

    // 校正层③：安全分级（Anima 规范：「必须包含一个安全分级：safe / sensitive / nsfw / explicit」）
    //   只告警不自动补 —— 自动补 "safe" 会把 NSFW 内容误标成 safe（安全回退），
    //   正确的分级必须由第一阶段 LLM 依据正文内容判定（抽取提示词已强制要求）。
    const ratings = tags.filter(t => RATING_TAG_RE.test(t));
    if (ratings.length === 0) {
        warnings.push("[分级校验] Hard Tags 段缺少安全分级（Anima 规范要求恰好一个：safe / sensitive / nsfw / explicit）—— 请检查第一阶段 LLM 是否输出了分级标签；插件不会自动补 safe（避免把涉敏内容误标为 safe）");
    } else if (ratings.length > 1) {
        warnings.push(`[分级校验] Hard Tags 段有 ${ratings.length} 个安全分级（${ratings.join(", ")}）—— Anima 规范要求恰好一个，建议只保留最贴切的一个`);
    }

    // 校正层④：**头部顺序**「分级 → 人数 → 其余」
    //   实测热门提示词的规范骨架（80 条语料 3254 个 tag 单元的平均相对位置）：
    //   分级旗标 0.21 → 人数 0.27 → 风格 0.36 → 外观 0.49 → ……
    //   此前分级与人数标签散落在标签段各处（sensitive 常落在第 2 位、solo 甚至跑到末尾），
    //   与 Anima 规范的 Hard Tags 清单顺序也不一致。
    //   v2.6：这段校正已上移到**共享路径**（runTagPipeline）—— 此前它只在本函数里，
    //   「Danbooru 解析链」一关，LLM 直出标签就保持原顺序 → 实测出现
    //   「explicit 排在第 6 位、质量咒语压在分级前面」的分叉。此处不再调用（由共享路径统一处理）。

    // 输出：空格形式的多词标签（Anima：空格替换下划线）+ 逗号分隔渲染
    return { sep: "comma", kind: "tags", tags: tags.map(normalizeTagForSection) };
}

/** Custom 模式直通处理 */
function runCustomMode(input: TagPipelineInput): TagPipelineResult {
    const prompt = input.descriptionPrompt ?? "";
    return {
        prompt,
        warnings: [],
        reports: [{
            stage: "format", id: "fmt.custom_passthrough", label: "Custom 模式直通", enabled: true, applied: true,
            inLen: prompt.length, outLen: prompt.length, unit: "chars", warnings: [],
        }],
    };
}

/**
 * 标签层管线主入口。
 * 产出最终 prompt（未含前后缀/风格 —— 那部分在 compose 阶段）。
 */
export function runTagPipeline(input: TagPipelineInput): TagPipelineResult {
    // custom 模式：完全旁路管线，直接透传用户 prompt
    if (input.mode === "custom") {
        return runCustomMode(input);
    }
    
    const warnings: string[] = [];
    // Internal report type with string warnings for easier construction
    interface InternalReport extends Omit<StageReport, "warnings"> {
        warnings: string[];
    }
    const reports: InternalReport[] = [];
    const m = input.modules;
    const mode = input.mode;

    // ── 阶段5 解析分流 ──
    // Anima 规范：主体 Prompt 结构 = 第一层 Hard Tags → 第二层 Natural Language
    // → 标签段在前、描述段在后（无论模型输出顺序）。
    //
    // v2.5：**两种解析并存**，各有用途（合并成一种会出事）：
    //   descDoc = parseTagDoc   → 保留**分段结构**；人数统计 collectCountTags
    //                              依赖「每段头部的主语性别」（woman/girl…），
    //                              一旦合并成一段，首个冒号（例如权重 token "(solo:3)"）
    //                              会把头部截断 → 人数信号丢失。
    //   nlDoc   = parseFallbackDoc → 规则引擎回退产物**按行取单位**；避免
    //                              无逗号的环境行被按空格切成一堆单词。
    const descDoc = input.descriptionIsSentence
        ? parseSentenceDoc(input.descriptionPrompt ?? "")
        : parseTagDoc(input.descriptionPrompt ?? "");
    
    // v3.x：mixed 模式回退路径（LLM 未给 description）→ 规则引擎产物需拆为 tags + NL
    let workingInput = { ...input, llmTags: [...(input.llmTags ?? [])] };
    let nlDoc: TagDoc;
    if (input.descriptionIsSentence) {
        nlDoc = descDoc;
    } else if (workingInput.mode === "mixed" && workingInput.descriptionPrompt && !input.descriptionIsSentence) {
        // mixed 回退路径：规则引擎产物需拆为 tags + NL
        const parsed = parseRuleEngineOutput(workingInput.descriptionPrompt, workingInput.subjects, workingInput.lexicon);
        if (parsed.tags.length) {
            // 混入 llmTags（作为 LLM 直出标签处理，走后续阶段）
            const existing = new Set((workingInput.llmTags ?? []).map(t => t.toLowerCase()));
            const extra = parsed.tags.filter(t => !existing.has(t.toLowerCase()));
            if (extra.length) {
                workingInput = { ...workingInput, llmTags: [...(workingInput.llmTags ?? []), ...extra] };
            }
        }
        nlDoc = parsed.nl
            ? { sections: [{ sep: "comma", kind: "sentence", tags: [parsed.nl] }] }
            : { sections: [] };
    } else {
        nlDoc = parseFallbackDoc(workingInput.descriptionPrompt ?? "");
    }
    const useNatural = mode === "description" || mode === "mixed";
    const useDanbooru = mode === "tags" || mode === "mixed";

    // 标签段（Hard Tags）
    const tagSections: TagSection[] = [];
    if (useDanbooru) {
        if (on(m, "resolve.danbooru")) {
            const sec = buildDanbooruSection(workingInput, warnings, descDoc);
            if (sec.tags.length) tagSections.push(sec);
        } else if (workingInput.llmTags?.length) {
            // v2.5 修复（死胡同配置）：此前「Danbooru 解析链（词典）」一关，
            //   整个标签段就不存在了 → mixed 模式退化成单层（只有 Natural Language），
            //   LLM 直出的几十个标签被整体丢弃 —— 而这个开关的本意只是
            //   「不要做词典归一 / 未收录剔除 / 景别裁剪」，不是「不要标签」。
            // 现在：词典链关闭时保留 LLM 直出标签（仅做形态归一），段结构不塌陷。
            const raw = workingInput.llmTags.map(normalizeTagForLookup).filter(Boolean);
            if (raw.length) {
                tagSections.push({ sep: "comma", kind: "tags", tags: raw.map(normalizeTagForSection) });
                warnings.push(`[Danbooru 链] 已关闭：保留 LLM 直出的 ${raw.length} 个标签（未做词典归一 / 未收录剔除 / 景别裁剪）`);
            }
        }
    }

    // ── v2.6 共享确定性校正层（阶段5之后、阶段6之前）：规则引擎的结构化要素叠加到 LLM 产物上 ──
    if (tagSections.length && workingInput.corrections) {
        const sec = tagSections[0];
        const cr = applyDeterministicCorrections({
            tags: sec.tags,
            countTags: workingInput.corrections.countTags ?? [],
            distance: workingInput.corrections.distance ?? "",
            isPov: workingInput.corrections.isPov ?? false,
            subjects: workingInput.subjects ?? [],
            overrideLlmCountTags: workingInput.overrideLlmCountTags === true,
        });
        sec.tags = cr.tags;
        warnings.push(...cr.warnings);
    }

    // 候选来源告警（在校正层之后、阶段6之前）
    if (workingInput.candidateSourceNote) {
        warnings.push(`[候选来源] ${workingInput.candidateSourceNote}`);
    }

    // ── v2.6 共享路径校正（两条链都执行，与「词典链开/关」无关）──
    //   ① 头部顺序「分级 → 人数 → 其余」：此前只在词典链里做，关掉词典链就完全失效
    //      （实测出现 explicit 排到第 6 位、质量咒语压在分级前面）。
    //   ② 用户手动填写的质量/评分词 → 放到风格位（分级与人数之后），不当成 LLM 产物。
    if (tagSections.length) {
        const sec = tagSections[0];
        stripLlmQualityWords(sec.tags, warnings);
        applyHeaderOrder(sec.tags, warnings);
        insertQualityWords(sec.tags, input.qualityWords ?? [], warnings);
    }

    // 描述段（Natural Language）
    const naturalSections: TagSection[] = [];
    if (useNatural) {
        // v2.5 修复（结构阻塞）：规则引擎回退产物自带 BREAK 分段
        //   （主体行 / 身体行 / 环境行 三段）→ 直接透传会让最终产物变成
        //   **4 段**（Hard Tags + 主体行 + 身体行 + 环境行），
        //   违反 Anima「单行 Hard Tags + Natural Language」的**两层**结构契约。
        //   现在把回退产物的所有段**合并成单个** Natural Language 段。
        //   注意：权重 token（如 "(solo:3)" / "(2character:3)"）**必须保留** ——
        //   规则引擎用权重 token 表达**人数**（而不是裸 1girl/2girls），
        //   它是回退路径里唯一的计数信号；剥掉它 → 人数信息全丢。
        const src = input.descriptionIsSentence
            ? nlDoc.sections
            : [{ sep: "comma" as const, kind: "phrase" as const, tags: nlDoc.sections.flatMap(s => s.tags) }];
        for (const s of src) {
            if (!s.tags.length) continue;
            naturalSections.push({ ...s, tags: [...s.tags] });
        }
    } else if (input.mode === "tags" && input.descriptionPrompt?.trim()) {
        // tags 模式：LLM 可能输出 description 增量，解析为 phrase kind
        const desc = input.descriptionPrompt.trim();
        // description 增量通常是短语片段，按逗号/句号切分
        const phraseTags = desc.split(/[,，。.!?]/).map(t => t.trim()).filter(Boolean);
        if (phraseTags.length) {
            naturalSections.push({ sep: "comma", kind: "phrase", tags: phraseTags });
        }
    }

    // 段序：Hard Tags 在前，Natural Language 在后
    const sections: TagSection[] = [...tagSections, ...naturalSections];

    // v2.3：**删除**阶段5 的「双链重复词剔除」（resolve.dual_dedup）。
    // 它与阶段6 的 pp.dedup 是同一规则的两份实现，且**受害者相反**：
    //   阶段5 版删「标签段」里与描述重复的标签；
    //   阶段6 版（跨段去重）删「描述段」里与标签重复的描述 → 会把自然语言段吃空。
    // 现在统一为：段内去重（pp.dedup）+ 跨段重复**只告警不删**（modDedupCrossCheck）。

    let doc: TagDoc = { sections };
    reports.push({
        stage: "resolve", id: "resolve", label: STAGE_LABEL.resolve, enabled: true, applied: true,
        inLen: (input.descriptionPrompt?.length ?? 0) + (input.llmTags?.length ?? 0),
        outLen: doc.sections.reduce((n, s) => n + s.tags.length, 0),
        warnings: [...warnings],
    });

    // v2.3：显式记录本次「自然语言语义路径」。
    // 阶段6/7 对自然语言段是按**句子**还是按**短语/标签**处理，取决于
    // LLM 是否返回了 description 字段（没返回 → 回退规则引擎产物）。
    // 此前这个分叉完全不可见 → 同一版本不同用户的出图差异无法归因。
    reports.push({
        stage: "resolve", id: "resolve.semantics", label: "自然语言语义",
        enabled: true, applied: true,
        inLen: 0, outLen: 0, unit: "tags",
        warnings: [input.descriptionIsSentence
            ? "自然语言段按【完整英文句子】处理（LLM 直出 description）"
            : "自然语言段按【逗号短语】处理（LLM 未返回 description → 已回退规则引擎产物）"],
    });

    // ── 阶段6 标签层后处理 ──
    const step = (id: string, fn: (d: TagDoc) => TagDoc, warnFn?: (d: TagDoc) => string[]) => {
        const def = MODULE_MAP.get(id);
        const before = doc.sections.reduce((n, s) => n + s.tags.length, 0);
        if (!on(m, id)) {
            reports.push({ stage: "tags", id, label: def?.label ?? id, enabled: false, applied: false, inLen: before, outLen: before, unit: "tags", warnings: [] });
            return;
        }
        doc = fn(doc);
        const w = warnFn ? warnFn(doc) : [];
        warnings.push(...w);
        reports.push({
            stage: "tags", id, label: def?.label ?? id, enabled: true, applied: true,
            inLen: before, outLen: doc.sections.reduce((n, s) => n + s.tags.length, 0), unit: "tags", warnings: w,
        });
    };

    step("pp.sanitize", modSanitize);
    step("pp.cjk", modCjkStrip, d => {
        // 句子段的中文不能整句删（会破坏句子），但必须告警：
        // 阶段8 的中文兜底会把整段剥光 → 最终提示词为空 → 报「提示词为空」，
        // 真实原因却在阶段6，故此处提前给出可归因的告警。
        const hits = findCjkInSentences(d);
        return hits.length
            ? [`自然语言段残留中文（整句保留；阶段8 兜底会剥除 → 可能导致提示词为空）: ${hits.slice(0, 3).join(" / ")}`]
            : [];
    });
    step("pp.process", modProcessStrip);
    step("pp.emotion", modEmotionStrip);
    step("pp.dedup", d => modDedup(d, 2), d => modDedupCrossCheck(d));
    // v2.6：**语料词表归一**（降噪）—— 把「语料 0 次的稀有词」换成实测高频词。
    //   提示词层已明确禁用这些词，这里做确定性兜底（模型偶尔不听话）。
    if (on(m, "pp.corpus_vocab")) {
        const hasRecovered = warnings.some(w => w.includes("所有标签都被判为未收录"));
        if (hasRecovered) {
            reports.push({
                stage: "tags", id: "pp.corpus_vocab", label: "语料词表归一（降噪）",
                enabled: true, applied: false,
                inLen: 0, outLen: 0, unit: "tags",
                warnings: ["安全网已恢复原标签，本次跳过语料词表归一"],
            });
        } else {
            const before = doc.sections.find(s => s.kind === "tags")?.tags.length ?? 0;
            const prev = doc;
            doc = modCorpusVocabulary(doc);
            const changes = corpusVocabularyChanges(prev, doc);
            const w = changes.length ? [`语料词表归一 ${changes.length} 处: ${changes.join("; ")}`] : [];
            warnings.push(...w);
            reports.push({
                stage: "tags", id: "pp.corpus_vocab", label: "语料词表归一（降噪）", enabled: true, applied: changes.length > 0,
                inLen: before, outLen: doc.sections.find(s => s.kind === "tags")?.tags.length ?? 0, unit: "tags", warnings: w,
            });
        }
    } else {
        reports.push({
            stage: "tags", id: "pp.corpus_vocab", label: "语料词表归一（降噪）", enabled: false, applied: false,
            inLen: 0, outLen: 0, unit: "tags", warnings: [],
        });
    }
    // v2.6：**跨层一致性检查**（只告警不删 —— 改写散文会破坏句子结构）
    step("pp.cross_check", d => d, d => modCrossLayerCheck(d));
    step("pp.scene", d => d, modSceneConflictGuard);
    step("pp.dict", d => d, d => (input.lexicon ? modDictValidate(d, input.lexicon) : []));

    // ── v2.6：镜头/角度**标签化**（语料 §1.3⑤：镜头是 Hard Tags 的第 7 维度）──
    //   实测缺陷：镜头信息只出现在散文里（还以三连无主语碎片的形式），
    //   标签层完全没有 → 两层信息不互补，且散文被无谓拉长。
    //   现在把归一后的镜头/构图词写进 Hard Tags（缺失才补），散文只做增量。
    //   若无 Hard Tags 段，补到 Natural Language 段作为前置短语。
    if (input.corrections?.opticsWordsV2) {
        const ow = input.corrections.opticsWordsV2;
        if (tagSections.length) {
            const sec = tagSections[0];
            const have = new Set(sec.tags.map(t => String(t ?? "").toLowerCase()));
            const add: string[] = [];
            
            // distance → 景别标签
            if (ow.distance && !have.has(ow.distance)) add.push(ow.distance);
            // cameraAngle → 相机视角标签
            if (ow.cameraAngle && ow.cameraAngle !== 'front view' && !have.has(ow.cameraAngle)) add.push(ow.cameraAngle);
            // composition
            if (ow.composition && !have.has(ow.composition)) add.push(ow.composition);
            // focusTarget/depthOfField
            if (ow.focusTarget && ow.focusTarget !== 'subject') {
                const tag = `${ow.focusTarget} focus`;
                if (!have.has(tag)) add.push(tag);
            } else if (ow.depthOfField && ow.depthOfField !== 'sharp focus' && !have.has(ow.depthOfField)) {
                add.push(ow.depthOfField);
            }
            // perspective
            if (ow.perspective && !have.has(ow.perspective)) add.push(ow.perspective);
            
            if (add.length) {
                sec.tags.push(...add);
                warnings.push(`[镜头标签化] 已把镜头/构图词写入 Hard Tags（缺失才补）: ${add.join(", ")}`);
            }
        } else if (naturalSections.length) {
            // 无 Hard Tags 段，补到 NL 段作为前置短语
            const first = naturalSections[0];
            const leadParts: string[] = [];
            if (ow.distance) leadParts.push(`in a ${ow.distance} shot`);
            if (ow.cameraAngle && ow.cameraAngle !== 'front view') leadParts.push(`from ${ow.cameraAngle.replace(' view', '')} angle`);
            if (ow.composition) leadParts.push(`with ${ow.composition.replace(' composition', '')} composition`);
            if (ow.focusTarget && ow.focusTarget !== 'subject') leadParts.push(`focus on ${ow.focusTarget}`);
            else if (ow.depthOfField && ow.depthOfField !== 'sharp focus') leadParts.push(`with ${ow.depthOfField}`);
            
            if (leadParts.length) {
                const lead = leadParts.slice(0, 2).join(', ');
                if (first.kind === 'sentence') {
                    const isProper = (w: string): boolean => {
                        if (!input.lexicon) return false;
                        const g = groupsOf(input.lexicon, w);
                        return !!g && (g[0] === '角色' || g[0] === '作品');
                    };
                    first.tags = [lead + ', ' + lowerFirstSafe(first.tags[0] ?? '', isProper), ...first.tags.slice(1)];
                    warnings.push(`[镜头校正] Natural Language 段缺少镜头/构图词，已以自然前置短语并入首句: ${lead}`);
                } else {
                    first.tags = leadParts.slice(0, 2).concat(first.tags);
                    warnings.push(`[镜头校正] Natural Language 段缺少镜头/构图词，已置句首补入: ${leadParts.slice(0, 2).join(', ')}`);
                }
            }
        }
    }

    // ── 阶段7 格式化 ──
    // 标签段专属：前缀去重 / 共现联想 / 分类排序 / 权重映射（只作用于 Hard Tags 段）
    // v2.3：逐模块执行 + 逐模块报告（此前四个模块挤在一个函数里跑，
    // 报告里 in/out 完全相同，且「无标签段时」仍显示"已执行"）。
    const fmtStep = (id: string, fn: (tags: string[], w: string[]) => string[]) => {
        const def = MODULE_MAP.get(id);
        const before = doc.sections.reduce((n, s) => n + s.tags.length, 0);
        if (!on(m, id)) {
            reports.push({ stage: "format", id, label: def?.label ?? id, enabled: false, applied: false, inLen: before, outLen: before, unit: "tags", warnings: [] });
            return;
        }
        const idx = doc.sections.findIndex(s => s.kind === "tags");
        if (idx < 0) {
            reports.push({
                stage: "format", id, label: def?.label ?? id, enabled: true, applied: false,
                inLen: before, outLen: before, unit: "tags",
                warnings: ["本次无标签段（Hard Tags）→ 该模块未执行"],
            });
            return;
        }
        const w: string[] = [];
        doc.sections[idx].tags = fn([...doc.sections[idx].tags], w);
        warnings.push(...w);
        reports.push({
            stage: "format", id, label: def?.label ?? id, enabled: true, applied: true,
            inLen: before, outLen: doc.sections.reduce((n, s) => n + s.tags.length, 0), unit: "tags", warnings: w,
        });
    };

    fmtStep("fmt.prefix_dedup", (tags, w) => fmtPrefixDedup(tags, w));
    fmtStep("fmt.enrich", (tags, w) => fmtEnrich(tags, input, w));
    fmtStep("fmt.category_sort", (tags) => fmtCategorySort(tags, input));
    fmtStep("fmt.weight", (tags, w) => fmtWeight(tags, input, w));

    // 标签预算：放在格式化之后（截断的是最终标签列表，含联想/权重后的结果）
    // v2.3：目标段改为「标签段」（此前取最后一个非句子段 → 截断的是自然语言/环境行，
    // 标签段反而完全不受限）；告警列出被删标签名。
    {
        const def = MODULE_MAP.get("fmt.budget");
        const before = doc.sections.reduce((n, s) => n + s.tags.length, 0);
        if (on(m, "fmt.budget")) {
            const hasTags = doc.sections.some(s => s.kind === "tags");
            const r = modBudget(doc, input.budgetMax ?? 45, input.lexicon ? (t => lexPhaseOf(input.lexicon!, t)) : keywordPhaseOf);
            doc = r.doc;
            warnings.push(...r.warnings);
            reports.push({
                stage: "format", id: "fmt.budget", label: def?.label ?? "fmt.budget",
                enabled: true, applied: hasTags,
                inLen: before, outLen: doc.sections.reduce((n, s) => n + s.tags.length, 0), unit: "tags",
                warnings: hasTags ? r.warnings : ["本次无标签段（Hard Tags）→ 预算未生效"],
            });
        } else {
            reports.push({
                stage: "format", id: "fmt.budget", label: def?.label ?? "fmt.budget", enabled: false, applied: false,
                inLen: before, outLen: before, unit: "tags", warnings: [],
            });
        }
    }

    // v2.4：**统一走 renderTagDoc**，不再有「空格分隔」旁路。
    //   Anima 格式规范要求 Hard Tags 段是「单行、逗号分隔」（`一个逗号 + 一个空格`），
    //   此前 tags 模式走 separator="space" 旁路 → 输出 `1girl solo black_hair`，
    //   既错在分隔符、也错在标签形态（实测语料空格式 58.7% / snake_case 仅 1.0%）。
    //   input.separator 保留为兼容字段，但不再影响渲染。
    const prompt = renderTagDoc(doc, input.mode);
    reports.push({
        stage: "format", id: "fmt.render", label: "最终渲染", enabled: true, applied: true,
        inLen: 0, outLen: prompt.length, unit: "chars", warnings: [],
    });

    // Convert string warnings to structured PipelineWarning[]
    const structuredWarnings = convertWarnings(warnings, "pipeline", "PIPELINE_WARNING");
    const structuredReports = reports.map(r => ({
        ...r,
        warnings: convertWarnings(r.warnings as any, r.id, r.id.toUpperCase().replace(".", "_"))
    }));

    return { prompt, warnings: structuredWarnings, reports: structuredReports };
}
