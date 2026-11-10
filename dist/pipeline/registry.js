// ============================================================
// pipeline/registry.ts —— 阶段/模块注册表 & 迁移
// ============================================================
export const STAGE_LABEL = {
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
/** v2.2 → v2.3：旧「计数标签」模块拆为「人数/性别」与「solo」，迁移一次 */
export function migratePipelineSettings(s) {
    if (s.pipeline_migrated === true)
        return;
    const modules = s.modules ?? {};
    if (modules["tags.count_tags"] !== undefined) {
        modules["tags.count_tags"] = false;
        modules["tags.solo_gender"] = true;
    }
    s.modules = modules;
    s.pipeline_migrated = true;
}
/** v2.7：模块键名统一化（旧键 → 新键） */
const MODULE_KEY_MAP = {
    "resolve.danbooru": "resolve.danbooru",
    "fmt.budget": "fmt.budget",
    "fmt.category": "fmt.category",
    "fmt.weight": "fmt.weight",
    "fmt.enrich": "fmt.enrich",
    "pp.dedup": "pp.dedup",
    "pp.emotion": "pp.emotion",
    "pp.process": "pp.process",
    "pp.sanitize": "pp.sanitize",
    "pp.corpus_vocab": "pp.corpus_vocab",
    "pp.cross_check": "pp.cross_check",
    "pp.scene": "pp.scene",
    "pp.dict": "pp.dict",
    "cmp.cjk_fallback": "cmp.cjk_fallback",
    "cmp.chinese_fallback": "cmp.cjk_fallback",
    "review.format_guard": "review.format_guard",
    "review.quality_guard": "review.quality_guard",
};
export function normalizeModuleKey(key) {
    return MODULE_KEY_MAP[key] ?? key;
}
export function getModuleSwitches(s) {
    const raw = s.modules ?? {};
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
        const nk = normalizeModuleKey(k);
        if (typeof v === "boolean")
            out[nk] = v;
    }
    return out;
}
export function on(modules, id) {
    return modules[id] === true;
}
export const MODULE_DEFS = [
    // 阶段5 解析分流
    { id: "resolve.danbooru", label: "Danbooru 解析链（词库归一/未收录剔除/景别裁剪）", stage: "resolve", defaultOn: true, dependsOn: [], destructive: false, modes: ["tags", "mixed"] },
    // 阶段6 标签层后处理
    { id: "pp.dedup", label: "段内去重（保留强调性重复 1-2 次）", stage: "tags", defaultOn: true },
    { id: "pp.emotion", label: "情绪词硬剔（标签段）", stage: "tags", defaultOn: true },
    { id: "pp.process", label: "过程词硬剔（标签段）", stage: "tags", defaultOn: true },
    { id: "pp.sanitize", label: "标签清洗（下划线/别名/空格折叠）", stage: "tags", defaultOn: true },
    { id: "pp.corpus_vocab", label: "语料词表归一（稀有词→高频词）", stage: "tags", defaultOn: true },
    { id: "pp.cross_check", label: "跨层一致性检查（仅告警）", stage: "tags", defaultOn: true },
    { id: "pp.scene", label: "景别↔下半身冲突检测", stage: "tags", defaultOn: true },
    { id: "pp.dict", label: "词库零覆盖告警", stage: "tags", defaultOn: true },
    // 阶段7 格式化
    { id: "fmt.category", label: "分类排序（Anima 词序）", stage: "format", defaultOn: true },
    { id: "fmt.weight", label: "权重映射（用户自定义 weight map）", stage: "format", defaultOn: true },
    { id: "fmt.enrich", label: "共现联想（默认关）", stage: "format", defaultOn: false },
    { id: "fmt.budget", label: "标签预算（从尾部截断/按 phase 保留）", stage: "format", defaultOn: true },
    // 阶段8 合成
    { id: "cmp.cjk_fallback", label: "中文兜底剔除", stage: "compose", defaultOn: true },
    // 阶段9 审核
    { id: "review.format_guard", label: "格式守卫（段结构/标签数分桶）", stage: "review", defaultOn: false },
    { id: "review.quality_guard", label: "质量守卫（关键标签丢失/重复/矛盾）", stage: "review", defaultOn: false },
];
export const MODULE_MAP = new Map(MODULE_DEFS.map(d => [d.id, d]));
