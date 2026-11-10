// ============================================================
// pipeline/shared.ts —— 共享校正/工具函数
// ============================================================
import { RATING_TAG_RE, COUNT_TAG_RE, SOLO_GENDER_TAG_RE } from "../constants.js";
/** 从 subjects 推导人数标签（与 deterministicCorrections.ts 逻辑一致） */
export function countTagsFromSubjects(subjects) {
    const females = subjects.filter(p => p.gender !== "male").length;
    const males = subjects.filter(p => p.gender === "male").length;
    const F = ["", "1girl", "2girls", "3girls", "4girls", "5girls"];
    const M = ["", "1boy", "2boys", "3boys", "4boys", "5boys"];
    const out = [];
    if (females >= 1)
        out.push(females <= 5 ? F[females] : "multiple girls");
    if (males >= 1)
        out.push(males <= 5 ? M[males] : "multiple boys");
    return out;
}
/**
 * v2.6：标签段**头部顺序**校正「分级 → 人数 → 其余」（共享路径，两条链都执行）。
 */
export function applyHeaderOrder(tags, warnings) {
    const ratingIdx = tags.findIndex(t => RATING_TAG_RE.test(t));
    if (ratingIdx > 0) {
        const [rt] = tags.splice(ratingIdx, 1);
        tags.unshift(rt);
        warnings?.push(`[头部顺序] 安全分级提到段首: ${rt}`);
    }
    // v3: solo 与 1girl/1boy 同组，保持二者相对顺序
    const isCountLike = (t) => COUNT_TAG_RE.test(t) || SOLO_GENDER_TAG_RE.test(t);
    const movers = tags.filter(isCountLike);
    if (!movers.length)
        return;
    // 去重保持原相对顺序
    const uniqueMovers = [];
    const seen = new Set();
    for (const m of movers) {
        if (!seen.has(m)) {
            seen.add(m);
            uniqueMovers.push(m);
        }
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
export function stripLlmQualityWords(tags, warnings) {
    const kept = [];
    const dropped = [];
    for (const t of tags) {
        if (LLM_FORBIDDEN_QUALITY.has(normTag(t))) {
            dropped.push(t);
            continue;
        }
        kept.push(t);
    }
    if (!dropped.length)
        return;
    tags.length = 0;
    tags.push(...kept);
    warnings?.push(`[质量词剔除] 已移除 LLM 输出的质量/评分词（应由设置里的「质量/评分词」提供）: ${dropped.join(", ")}`);
}
import { LLM_FORBIDDEN_QUALITY, normTag } from "../lexicon.js";
/**
 * v2.6：把用户手动填写的质量/评分词放到**风格位**（分级与人数之后）。
 *
 * 背景：Anima 官方契约要求 Hard Tags 含「质量/年代/安全分级 + score_1~9」，
 * 但插件的输出禁令不让 LLM 写质量咒语（语料 80 条 0 次使用）。
 * 折中：质量词由**用户设置**手动提供，插件只管位置 ——
 * 放在段首会顶掉分级旗标（规范要求分级最靠前），放在末尾又会被当成"随手一提"，
 * 正确位置是语料骨架里的**风格位（0.36）**：分级 → 人数 → 质量/风格 → 外观。
 */
export function insertQualityWords(tags, qualityWords, warnings) {
    const add = [];
    for (const q of qualityWords) {
        const ql = q.trim().toLowerCase();
        if (!ql)
            continue;
        if (tags.some(t => t.toLowerCase() === ql))
            continue;
        if (RATING_TAG_RE.test(ql) || COUNT_TAG_RE.test(ql) || SOLO_GENDER_TAG_RE.test(ql))
            continue;
        add.push(q.trim());
    }
    if (!add.length)
        return;
    const ratingIdx = tags.findIndex(t => RATING_TAG_RE.test(t));
    const countIdx = tags.findIndex(t => COUNT_TAG_RE.test(t) || SOLO_GENDER_TAG_RE.test(t));
    const insertAt = Math.max(ratingIdx, countIdx) + 1;
    if (insertAt <= 0) {
        tags.unshift(...add);
    }
    else {
        tags.splice(insertAt, 0, ...add);
    }
    warnings?.push(`[质量词位] 质量/评分词已放到风格位（分级与人数之后）: ${add.join(", ")}`);
}
