// ============================================================
// v2.3 promptPost.ts —— 阶段6/7 的确定性后处理模块（TagDoc 操作）
// 纯函数 · 零依赖 · 数据表驱动 · 可离线测（prompt_quality_test.mjs）
//
// v2.3 变更：
//   - 删除 v2.0 的两套遗留实现（postProcessCommon / formatPromptExtTool）：
//     它们是阶段6/7 规则的第一份副本，已与管线实现漂移（遗留版仍带
//     「权重映射命中不了」「景别告警在标签链下失效」等已修 bug），
//     却仍被离线测试断言 → 制造「已覆盖」的错觉。规则唯一实现在 pipeline.ts。
//   - TagSection 增加 kind（tags / phrase / sentence）→ 阶段6/7 规则按语义分流，
//     消除「同一段自然语言在两条路径下被当作不同对象处理」的隐式分叉。
//   - 形态双轨收敛：匹配前统一把下划线/连字符视为分隔符
//     （此前 `\b` 词边界遇 "_" 不成立 → 一批规则在标签链下静默失效）。
// ============================================================
import { isKnownTag, isModelableTag, aliasOfTag, applyAliasPhrases, normTag, QUALITY_TAG_WHITELIST } from "./lexicon.js";
import { FULL_LEXICON_MIN_TAGS } from "./constants.js";
// --------------------------------------------------
// 通用词表（与外部工具「表情纯视觉化 / 纯静态化」铁律对应）
// --------------------------------------------------
export const EMOTION_LIST = [
    "angry", "sad", "happy", "impatient", "teasing", "annoyed", "worried",
    "excited", "nervous", "irritated", "amused", "bored",
    // v2.4：**移出 smile / smiling / blush / blushing / grin / grinning**。
    //   依据：① Anima 格式规范要求「表情纯视觉化」，而这 6 个词本身就是视觉可读的
    //   面部状态，不是心理状态；② 热门提示词实测语料里 `blush` 单独出现 26/80（32.5%），
    //   `lustful smile` / `forced smile` 等更是标准表情标签；③ v2.4 的抽取提示词与
    //   审核提示词都把 `blush` 当作规范表情标签使用 —— 若管线再把它剔除，
    //   提示词与管线就互相打脸。
    //   保留的 12 个词全是「不可见的心理状态」，剔除它们才是「表情纯视觉化」的正解。
];
export const PROCESS_LIST = [
    "mid-thrust", "thrusting", "thrust", "during intercourse", "having sex",
    "making love", "brushing", "running", "jumping", "walking", "dancing",
];
/** 情绪词默认正则（词边界） */
export const EMOTION_RE = new RegExp(`\\b(${EMOTION_LIST.join("|")})\\b`, "gi");
/** 残留过程词默认正则 */
export const PROCESS_RE = new RegExp(`\\b(${PROCESS_LIST.join("|")})\\b`, "gi");
/** CJK / 全角残留 */
const CJK_RE = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/;
/** 全角标点 → 半角；全角数字/字母 → 半角 */
export function toHalfWidth(text) {
    return text
        .replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
        .replace(/\u3000/g, " ") // 全角空格
        .replace(/[，。！？；：（）【】《》“”‘’]/g, m => ({
        "，": ",", "。": ".", "！": "!", "？": "?", "；": ";", "：": ":",
        "（": "(", "）": ")", "【": "[", "】": "]", "《": "<", "》": ">",
        "“": "\"", "”": "\"", "‘": "'", "’": "'",
    }[m] ?? m));
}
/** 景别↔下半身冲突的关键词 */
const LOWER_BODY_WORDS_PER_DISTANCE = {
    "close-up": ["leg", "legs", "knee", "knees", "ankle", "ankles", "foot", "feet", "shoe", "shoes", "boot", "boots", "thigh", "thighs", "skirt", "pants", "sock", "socks", "stockings", "thighhighs"],
    "waist up": ["leg", "legs", "knee", "knees", "ankle", "ankles", "foot", "feet", "shoe", "shoes", "boot", "boots", "skirt", "pants", "sock", "socks", "stockings", "thighhighs"],
    "cowboy shot": ["ankle", "ankles", "foot", "feet", "shoe", "shoes", "boot", "boots"],
};
/**
 * 形态归一（匹配用）：下划线 / 连字符都视为空格（兼容 LLM 偶发的下划线写法）。
 * 根因：Hard Tags 段是下划线形式（"close_up" / "black_shoes"），
 * 而 `\b` 词边界遇 "_" 不成立 → 此前景别冲突告警在标签链下**恒不触发**。
 */
function foldForMatch(t) {
    return String(t ?? "").toLowerCase().replace(/[_-]+/g, " ");
}
/** 权重语法 token（(solo:3) / (2character:3) / (masterpiece:1.2)）：括号是语义必需，原样保留 */
const WEIGHT_TOKEN_RE = /^\([^():]+:\d+(?:\.\d+)?\)$/;
function normalizeTag(t) {
    const base = String(t).toLowerCase().replace(/\s+/g, " ").trim();
    // builder 会给段尾加句点：先剥句尾标点再判定/清洗，避免 "(solo:3)." 判不成权重 token
    // （曾导致只剥前括号、留下断裂的 "solo:3)"）；同样修复 "penetration)." 一类叠加残留
    const w = base.replace(/[.,;、；：]+$/g, "");
    if (WEIGHT_TOKEN_RE.test(w))
        return w;
    return w
        .replace(/^[()[\]{}`]+|[()[\]{}`]+$/g, "")
        .replace(/\s*[:：]$/, "")
        .replace(/\.+$/g, "")
        .trim();
}
/**
 * 逐"标签"做情绪/过程词剔除：
 *  - Hard Tags 段（kind="tags"）：Danbooru 标签是**原子**的 → 命中即整条删除
 *    （"big_smile" 拆成 "big"、"mid_thrust" 拆成 "mid" 都是无意义碎片）；
 *  - 短语段（kind="phrase"）：只删命中的词、保留其余
 *    （"1girl, long black hair, running" → "1girl, long black hair"）。
 *
 * v2.3：匹配前把**下划线视为分隔符**（"running_shoes" → "running shoes"）。
 * 此前按空白切词 → 下划线形式的多词标签整体匹配不上词表
 * （"mid_thrust" / "big_smile" 全部放行），同一逻辑词在两种形态下行为相反。
 */
function stripWordsInTags(tags, re, wholeTagDrop) {
    const out = [];
    for (const t of tags) {
        const words = t.split(/[\s_]+/).filter(Boolean);
        const cleaned = [];
        let removed = false;
        for (const w of words) {
            re.lastIndex = 0;
            if (re.test(w)) {
                removed = true;
                continue;
            }
            cleaned.push(w);
        }
        if (!removed) {
            out.push(t);
            continue;
        }
        if (wholeTagDrop)
            continue; // Hard Tags：整条删除，不留碎片
        const cj = cleaned.join(" ").trim();
        if (cj)
            out.push(cj);
    }
    return out;
}
/**
 * sanitize 升级（v2.2 P0）：在原清洗上做 Danbooru 词形归一 ——
 * 下划线→空格（LLM 偶发 tag 风格 black_hair → black hair）+ 别名规范化
 * （silver hair→grey hair；词库按 Danbooru 规范收词）。只改拼写不改语义；
 * 连字符保留（close-up / mid-thrust 等是合法形式）。
 */
export function sanitizeTokenP0(t) {
    let n = normalizeTag(t);
    if (n.includes("_"))
        n = n.replace(/_/g, " ").replace(/\s+/g, " ").trim();
    if (!n)
        return n;
    // Danbooru 别名归一（词组级：嵌在长 token 里的写法也能替换，如 "a silver hair woman" → "a grey hair woman"）
    return applyAliasPhrases(n) || n;
}
/**
 * 标签段专用归一：**空格替换下划线**（Anima 格式规范：「标签使用小写，空格替换下划线」）。
 *
 * v2.2~v2.3 这里是**下划线形式**（best_quality / wooden_bed），理由是
 * 「标签段以空格分隔，多词标签写成 "best quality" 无法区分一个标签与两个标签」。
 * v2.4 改回**空格形式**，因为：
 *   ① Anima 规范（get_anima_format）「格式」段明确要求空格替换下划线，
 *      且「标签之间使用一个逗号和一个空格」—— 逗号分隔消除了歧义，不再需要下划线；
 *   ② 实测热门提示词语料：空格式（词间空格）58.7%，snake_case 仅 1.0%；
 *   ③ 下划线形式在 Anima 上会被当成一个畸形词，模型识别率显著低于空格形式。
 * 另：`score_1`~`score_9` 按规范保留下划线（本就是单 token，不受影响）。
 */
export function sanitizeTagTokenP0(t) {
    const n = normalizeTag(String(t ?? ""));
    if (!n)
        return "";
    // v2.6：score_1~score_9 **保留下划线**（Anima 契约的例外项）——
    //   此前被一并转成 "score 9"，与「只有 score_N 保留 snake_case」相悖。
    const sc = n.match(/^score[_ ]([1-9])$/);
    if (sc)
        return `score_${sc[1]}`;
    // 别名匹配用空格形式（silver hair → grey hair），命中后保持空格形式输出
    const spaced = n.replace(/_/g, " ").replace(/\s+/g, " ").trim();
    return applyAliasPhrases(spaced) || spaced;
}
/** 去重折叠键：空格/下划线/连字符视为同一分隔（long hair ≡ long_hair ≡ close up 的键） */
function dedupFoldKey(t) {
    return t.toLowerCase().replace(/[\s_-]+/g, " ").trim();
}
// --------------------------------------------------
// 词库层：贪心分解（把自然短语拆成词库已收录的 Danbooru 标签）
// --------------------------------------------------
/** 整段只有这些词时抛弃（避免产出 "a / the / on the" 等垃圾标签） */
const STOP_UNIT = new Set([
    "a", "an", "the", "on", "in", "at", "by", "of", "for", "with", "to",
    "on the", "in the", "at the", "in front of", "behind the", "beside the",
    "above", "below", "under", "viewer", "viewer's", "his", "her", "their",
    "me", "my",
]);
/**
 * 贪心分解：把一段自然短语（如 "a long black hair woman standing at the window"）
 * 拆成已收录的 Danbooru 标签（如 ["long hair","black hair","standing","window"]）。
 * 只保留词库里**可上画**（出现在 标签分类.tsv）的词/短语，介词/冠词/代词/裸性别/未分类噪声丢弃，
 * 这是参考插件「词库校验 + 不许臆造」的硬约束。导出供测试按原始 unit 直接调用验证。
 */
export function greedyDecompose(lex, phrase) {
    const words = phrase.split(/\s+/).map(w => w.trim()).filter(Boolean);
    const out = [];
    let i = 0;
    let pendingMods = []; // 已看到但还没被消费的单词（候选"前导修饰词"）
    while (i < words.length) {
        const rest = words.length - i;
        // 贪心最长短语：先试 4 词，再 3、2，最后单词（参考 bmRoughTranslate 的最长短语优先）
        let match = "";
        let matchLen = 0;
        for (let len = Math.min(4, rest); len >= 1; len--) {
            const cand = words.slice(i, i + len).join(" ");
            // 接受口径：分类表命中，或多词部位短语在大词库有收录（silver hair 类数据缺口回退）；
            // 先做 Danbooru 别名归一（silver hair → grey hair），用规范形式查词库并输出规范形式。
            let canonical = cand;
            if (!isAcceptableTag(lex, canonical)) {
                const alias = aliasOfTag(cand);
                if (alias && isAcceptableTag(lex, alias))
                    canonical = alias;
            }
            if (isAcceptableTag(lex, canonical)) {
                match = normalizeTag(canonical);
                matchLen = len;
                break;
            }
        }
        if (match) {
            // 命中可上画短语。若前面累积了"前导修饰词"，尝试把修饰词 + 本短语的**部位尾词**
            // 组成另一个可上画标签（如 long + black hair → long hair），实现 Danbooru 的
            // 多标签拆分（long hair + black hair），而不是把 long 丢弃。
            absorbLeadingMods(lex, out, pendingMods, match);
            pendingMods = [];
            out.push(match);
            i += matchLen;
            continue;
        }
        // 未命中：把该单词暂存为待吸收的修饰候选（介词/冠词/代词在 isModelableTag 里已判不可，
        // 这里仅累积可能被后续短语吸收的形容词/修饰词）
        pendingMods.push(words[i]);
        i++;
    }
    return out;
}
/** 部位词：形貌修饰词可与之组合成可上画标签（long hair / fair skin / spread legs…） */
const BODY_HEAD_WORDS = new Set([
    "hair", "hairs", "eyes", "eye", "skin", "legs", "leg", "arm", "arms", "hand", "hands",
    "breast", "breasts", "chest", "waist", "hips", "butt", "tail", "ears", "head", "face",
    "lips", "mouth", "teeth", "tongue", "feet", "hairpin", "ponytail",
]);
/**
 * 质量 / 画风 / 分辨率 / 评分类标签白名单（定义在 lexicon.ts，与阶段排序共用）。
 */
export { QUALITY_TAG_WHITELIST } from "./lexicon.js";
/**
 * 「可用于出图」的判定（Danbooru 链的收录口径）——
 * 词库收录 ∪ 分类表收录 ∪ 质量词白名单。
 * 与 isAcceptableTag 的区别：后者是**严格可上画**门槛（供贪心分解挡噪声用），
 * 这里只判断「这个词是不是词库里的正经标签」，避免把质量词/规范写法误判为未收录。
 */
export function isUsableTag(lex, cand) {
    const base = normTag(cand);
    if (!base)
        return false;
    if (QUALITY_TAG_WHITELIST.has(base))
        return true;
    if (isAcceptableTag(lex, base))
        return true;
    return isKnownTag(lex, base);
}
/**
 * 分解时的"接受"口径（比 isModelableTag 略宽）：
 *  - 命中分类表 → 接受（严格主流）；
 *  - **多词短语以部位词结尾且大词库已收录** → 也接受——分类表有数据缺口
 *    （silver hair / hazel eyes 是真实 Danbooru 标签但 标签分类.tsv 没有行），
 *    多词部位短语误判风险极低；单词仍走严格分类表判定（挡 he/on/the/brown）。
 */
export function isAcceptableTag(lex, cand) {
    if (isModelableTag(lex, cand))
        return true;
    const words = cand.trim().split(/\s+/);
    if (words.length >= 2) {
        const last = words[words.length - 1].toLowerCase();
        if (BODY_HEAD_WORDS.has(last) && isKnownTag(lex, cand))
            return true;
    }
    return false;
}
/**
 * 把累积的"前导修饰词"尝试吸收进已命中的可上画短语 m：
 * 例如 m = "black hair"，pendingMods = ["long"]，则 "long hair" 可上画 →
 * 在 m 之前插入 "long hair"，得到 ["long hair", "black hair"]。
 * 只认「修饰词 + 短语的部位尾词」这种组合，避免误吸收。
 */
function absorbLeadingMods(lex, out, pendingMods, m) {
    if (pendingMods.length === 0)
        return;
    const mWords = m.split(" ");
    if (mWords.length === 0)
        return;
    const head = mWords[mWords.length - 1].toLowerCase().replace(/[().,]/g, "");
    if (!BODY_HEAD_WORDS.has(head))
        return;
    // 最近的修饰词优先（可叠加：["very","long"] + "black hair" → 试 "long hair"）
    for (let k = pendingMods.length - 1; k >= 0; k--) {
        const mod = pendingMods[k].toLowerCase();
        // 只吸收像修饰词的（非介词/冠词/代词）
        if (STOP_UNIT.has(mod) || BARE_MOD_RE.test(mod))
            continue;
        const combo = `${mod} ${head}`;
        let comboC = combo;
        if (!isAcceptableTag(lex, comboC)) {
            const alias = aliasOfTag(combo);
            if (alias && isAcceptableTag(lex, alias))
                comboC = alias;
        }
        if (isAcceptableTag(lex, comboC)) {
            out.push(normalizeTag(comboC));
            return;
        }
    }
}
/** 明显是介/冠/代/裸性别词的单词（不当作修饰词被吸收） */
const BARE_MOD_RE = /^(the|a|an|on|in|at|by|of|for|with|to|and|or|from|up|out|over|into|under|between|woman|women|girl|girls|man|men|boy|boys|female|male|he|she|it|they|his|her|their|me|my|your|viewer)$/i;
/** 解析 buildPrompt 产物 → 标签文档（有逗号按逗号切，否则按空格切） */
export function parseTagDoc(prompt) {
    const sections = String(prompt ?? "").split("\nBREAK\n").map(s => s.trim()).filter(Boolean);
    return {
        sections: sections.map(sec => {
            const hasComma = /[,，、]/.test(sec);
            return {
                sep: (hasComma ? "comma" : "space"),
                kind: "phrase",
                tags: sec.split(hasComma ? /[,，、]/ : /\s+/)
                    .map(t => t.trim())
                    .filter(t => t && t !== "."),
            };
        }),
    };
}
/**
 * 解析规则引擎 buildPrompt 产物 → { tags, nl }
 * 输入形如：
 *   "(solo:3).\nBREAK\n a black hair woman: on all fours; 25-year-old, kneeling..., fully nude\nBREAK\n dim bedroom: lamplight from above."
 */
export function parseRuleEngineOutput(prompt, subjects, lexicon) {
    const sections = String(prompt ?? "").split("\nBREAK\n").map(s => s.trim()).filter(Boolean);
    const tags = [];
    const nlSentences = [];
    for (const sec of sections) {
        // 人数权重行：(solo:3). / (2character:3).
        const countMatch = sec.match(/^\((\w+):\d+\)\.?$/);
        if (countMatch) {
            const c = countMatch[1];
            // 优先从 subjects 推导人数标签
            if (subjects?.length) {
                const females = subjects.filter(p => p.gender !== "male").length;
                const males = subjects.filter(p => p.gender === "male").length;
                const F = ["", "1girl", "2girls", "3girls", "4girls", "5girls"];
                const M = ["", "1boy", "2boys", "3boys", "4boys", "5boys"];
                if (females >= 1)
                    tags.push(females <= 5 ? F[females] : "multiple girls");
                if (males >= 1)
                    tags.push(males <= 5 ? M[males] : "multiple boys");
            }
            else if (c === "solo") {
                tags.push("solo");
            }
            else if (/^\dcharacter$/.test(c)) {
                // 无 subjects 时只放 solo（最保守）
                tags.push("solo");
            }
            continue;
        }
        // 主体行：以 "a/an/the ... :" 开头，含 ";"
        if (/^[Aa]\s+/.test(sec) && sec.includes(":") && sec.includes(";")) {
            // 拆成 head: action; age, clothing, features.
            const colonIdx = sec.indexOf(":");
            const semiIdx = sec.indexOf(";", colonIdx);
            if (colonIdx > 0 && semiIdx > colonIdx) {
                const subject = sec.slice(0, colonIdx).trim(); // "A black hair woman"
                const action = sec.slice(colonIdx + 1, semiIdx).trim(); // "on all fours"
                const rest = sec.slice(semiIdx + 1).trim().replace(/\.$/, ""); // "25-year-old, ..."
                // 抽 age / 服装 / 特征 到 tags
                const restParts = rest.split(",").map(p => p.trim()).filter(Boolean);
                const taggable = [];
                const nlOnly = [];
                for (const p of restParts) {
                    if (/^\d+[- ]year[- ]old$/i.test(p)) {
                        nlOnly.push(p);
                        continue;
                    } // age 交给 NL
                    // 词库优先：已知标签直接归 tags
                    if (lexicon && isUsableTag(lexicon, p)) {
                        taggable.push(p);
                        continue;
                    }
                    // 启发式：疑似标签（无动词、无冠词、短语短）放 tags，其余放 NL
                    if (isTagLike(p)) {
                        taggable.push(p);
                        continue;
                    }
                    nlOnly.push(p);
                }
                tags.push(...taggable);
                nlSentences.push(`${subject} is ${action}${nlOnly.length ? `, ${nlOnly.join(", ")}` : ""}.`);
                continue;
            }
        }
        // 环境行：含 ":" 且不以 A 开头
        if (sec.includes(":") && !/^[Aa]\s+/.test(sec)) {
            nlSentences.push(`${sec.replace(/\.$/, "")}.`);
            continue;
        }
        // 兜底：整段作为 NL 句子
        nlSentences.push(sec);
    }
    return { tags, nl: nlSentences.join(" ") };
}
function isTagLike(text, _lexicon) {
    // 词库优先已在调用处处理，这里仅作启发式兜底
    const t = text.trim();
    if (t.length > 40)
        return false;
    if (/\b(is|are|has|have|with|wearing|showing|displaying)\b/i.test(t))
        return false;
    if (/^(a|an|the|my|your|his|her|their|our)\b/i.test(t))
        return false;
    if (/\b(in|on|at|under|over|above|below|behind|beside|between)\b/i.test(t))
        return false;
    return true;
}
/**
 * 规则引擎回退产物 → 标签文档（**按行取单位**）。
 *
 * v2.5 新增。**背景（真实链路阻塞级缺陷）**：
 *   规则引擎产物形如
 *     `(solo:3).\nBREAK\n a black hair woman: on all fours…; 25-year-old, kneeling on all fours…\nBREAK\n dim bedroom: lamplight from above.`
 *   `parseTagDoc` 对**没有逗号**的段按**空格**切 → 环境行被切成一堆单词
 *   （"dim" / "bedroom" / "lamplight" / "from" / "above"）→ 变成垃圾标签。
 *   而按逗号切的段又会把主体行里的逗号短语切碎。
 *
 * 修法：回退产物的每一**行**就是一个语义单位（行内逗号保留），整体作为**一个**自然语言段。
 */
export function parseFallbackDoc(prompt) {
    const lines = String(prompt ?? "")
        .split(/\nBREAK\n|\r?\n/)
        .map(l => l.trim())
        .filter(Boolean);
    const tags = [];
    for (const line of lines) {
        // 有逗号 → 按逗号切（主体行里的并列短语是独立语义单元）
        // 无逗号 → **整行保留**（环境行 "dim bedroom: lamplight from above." 之类
        //   按空格切会碎成 dim / bedroom / lamplight / from / above → 场景信息丢失）
        if (/[,，、]/.test(line)) {
            tags.push(...line.split(/[,，、]/).map(t => t.trim()).filter(Boolean));
        }
        else {
            tags.push(line);
        }
    }
    if (!tags.length)
        return { sections: [] };
    return { sections: [{ sep: "comma", kind: "phrase", tags }] };
}
export function renderTagDoc(doc, _mode) {
    const out = [];
    const tagsSec = doc.sections.find(s => s.kind === "tags");
    const nlSecs = doc.sections.filter(s => s.kind !== "tags");
    if (tagsSec)
        out.push(tagsSec.tags.join(", "));
    // NL 段：所有 sentence/phrase 合并
    const nlParts = [];
    for (const sec of nlSecs) {
        if (!sec.tags.length)
            continue;
        if (sec.sep === "sentence")
            nlParts.push(sec.tags.join(" "));
        else
            nlParts.push(sec.tags.join(", "));
    }
    if (nlParts.length)
        out.push(nlParts.join(" "));
    return out.join("\nBREAK\n");
}
/**
 * 解析 Natural Language 段（LLM 直出的完整英文句子）。
 * 按句号切分而非逗号 —— 逗号是句内成分，误切会把句子拆成短语流水。
 */
const ABBREVIATIONS = new Set([
    "mr", "mrs", "ms", "dr", "prof", "st", "jr", "sr", "vs", "etc",
    "e.g", "i.e", "a.m", "p.m", "no", "vol", "fig", "al", "cf",
]);
function splitSentencesSafely(text) {
    const parts = text.split(/(?<=[.!?])\s+/);
    const out = [];
    for (const p of parts) {
        if (!p.trim())
            continue;
        // 若上一段末尾是缩写，则与上一段合并
        if (out.length) {
            const prev = out[out.length - 1];
            const lastWord = prev.trimEnd().replace(/[.!?]+$/, "").split(/\s+/).pop()?.toLowerCase() ?? "";
            if (ABBREVIATIONS.has(lastWord)) {
                out[out.length - 1] = `${prev} ${p}`;
                continue;
            }
        }
        out.push(p);
    }
    return out;
}
export function parseSentenceDoc(prompt) {
    const sections = String(prompt ?? "").split("\nBREAK\n").map(s => s.trim()).filter(Boolean);
    return {
        sections: sections.map(sec => ({
            sep: "sentence",
            kind: "sentence",
            tags: splitSentencesSafely(sec).map(t => t.trim()).filter(Boolean),
        })),
    };
}
/**
 * ① 标签清洗：词形归一（下划线→空格、Danbooru 别名）
 * 句子段（Anima Natural Language）**不做标签化处理**：只折叠空白，保留标点与大小写，
 * 否则句末句点会被剥掉导致句子粘连。
 */
export function modSanitize(doc) {
    return {
        sections: doc.sections.map(sec => ({
            sep: sec.sep,
            kind: sec.kind,
            tags: sec.kind === "sentence"
                ? sec.tags.map(t => t.replace(/\s+/g, " ").trim()).filter(Boolean)
                : sec.kind === "tags"
                    ? sec.tags.map(t => sanitizeTagTokenP0(t)).filter(Boolean)
                    : sec.tags.map(t => sanitizeTokenP0(t)).filter(Boolean),
        })),
    };
}
/**
 * ② 去重：**段内**去重（变体折叠 long hair ≡ long_hair）；句子段不参与去重。
 *
 * v2.3：**不再跨段删除**。此前跨段去重会以 Hard Tags 为先 → 把自然语言段里
 *   与标签重复的描述整段吃掉（"1girl, black hair, white shirt" → "standing."），
 *   且与阶段5 的双链去重（改删标签段）重复且互斥 → 现跨段只告警（modDedupCrossCheck）。
 *
 * v2.4：**保留「重复即强调」**。
 *   实测热门提示词有 33.8% 在段内重复同一个标签（`completely nude` ×2、
 *   `genshin impact` ×4…），这是刻意强化权重的手法；v2.4 的抽取提示词与
 *   审核提示词都明确要求「保留强调性重复」。此前这里把重复一律删掉，
 *   与新提示词直接冲突。
 *   现在的规则：
 *     - **写法完全相同**的重复 → 保留（最多 2 份，再多才截断，防失控）；
 *     - **写法不同但归一后相同**（`black hair` vs `black_hair`）→ 折叠成 1 份
 *       （那是归一产物，不是强调）。
 */
export function modDedup(doc, maxDuplicates = 2) {
    return {
        sections: doc.sections.map(sec => {
            if (sec.kind === "sentence")
                return { ...sec, tags: [...sec.tags] };
            const firstForm = new Map(); // foldKey → 首次写法
            const kept = new Map(); // foldKey → 已保留份数
            return {
                sep: sec.sep,
                kind: sec.kind,
                tags: sec.tags.filter(t => {
                    const k = dedupFoldKey(t);
                    const prev = firstForm.get(k);
                    if (prev === undefined) {
                        firstForm.set(k, t);
                        kept.set(k, 1);
                        return true;
                    }
                    if (prev === t) {
                        const n = (kept.get(k) ?? 1) + 1;
                        kept.set(k, n);
                        return n <= maxDuplicates;
                    }
                    return false;
                }),
            };
        }),
    };
}
/**
 * 跨段重复检查：**只告警不删**（v2.3）。
 * 报出「标签段与描述段重复的词」，让用户自己决定是否关掉某个模块，
 * 避免插件在用户不知情的情况下删掉自然语言描述。
 */
export function modDedupCrossCheck(doc) {
    const groups = new Map();
    for (const sec of doc.sections) {
        if (sec.kind === "sentence")
            continue;
        for (const t of sec.tags) {
            const k = dedupFoldKey(t);
            if (!k)
                continue;
            const arr = groups.get(k);
            if (arr)
                arr.push(t);
            else
                groups.set(k, [t]);
        }
    }
    const dup = [];
    for (const [, arr] of groups) {
        if (arr.length > 1)
            dup.push(arr[0]);
    }
    if (!dup.length)
        return [];
    return [`跨段重复 ${dup.length} 个（标签段与描述段重复，仅提示不删）: ${dup.slice(0, 8).join(", ")}${dup.length > 8 ? " …" : ""}`];
}
/**
 * v2.6：**语料词表归一** —— 把「语料 0 次的稀有词」换成 80 条实测热门提示词里的高频写法。
 *
 * 为什么需要机械兜底：这些词大多本身是合法 Danbooru 标签，词库校验查不出来，
 * 但它们对画面没有贡献、只会稀释信号（实测一次生成里同时出现
 * `white light` + `overhead lighting` + `centered composition` + `low ponytail` + `pale skin`，
 * 五��词全部语料 0 次）。提示词层已明确禁用，这里再做一次确定性归一兜底。
 */
const CORPUS_VOCAB_MAP = {
    "sagging breasts": "hanging breasts", // 语料 3 次 hanging breasts / 0 次 sagging
    "pale skin": "fair skin", // 语料 3 次 fair skin / 0 次 pale skin
    "furrowed brow": "frown", // 语料 1 次 frown / 0 次 furrowed brow
    "low ponytail": "ponytail", // 语料 1 次 ponytail / 0 次 low ponytail
    "closed curtains": "curtains", // 语料 0 次 closed curtains
    "centered composition": "cinematic composition", // 语料只有 cinematic / dynamic composition
    "rule of thirds": "cinematic composition", // 语料 0 次 rule of thirds
    "white light": "bright lighting", // 语料 1 次 bright lighting / 0 次 white light
    "overhead lighting": "bright lighting", // 语料 0 次 overhead lighting
    "hard light": "high contrast", // 语料 0 次 hard light
    "wooden bed": "bed", // 场景家具不写材质（语料 0 次 wooden bed）
    "black blindfold": "blindfold", // 颜色单列：blindfold + black
};
/** 语料词表归一（只作用于 Hard Tags 段；自然语言段不动） */
export function modCorpusVocabulary(doc) {
    return {
        sections: doc.sections.map(sec => {
            if (sec.kind !== "tags")
                return sec;
            const tags = [];
            for (const raw of sec.tags) {
                const key = String(raw ?? "").trim().toLowerCase();
                const to = CORPUS_VOCAB_MAP[key];
                if (!to) {
                    tags.push(raw);
                    continue;
                }
                if (tags.some(t => String(t).toLowerCase() === to)) {
                    continue;
                }
                tags.push(to);
            }
            return { ...sec, tags };
        }),
    };
}
/** v2.6：语料词表归一的变更清单（供阶段报告使用） */
export function corpusVocabularyChanges(before, after) {
    const b = before.sections.find(s => s.kind === "tags")?.tags ?? [];
    const a = after.sections.find(s => s.kind === "tags")?.tags ?? [];
    const changes = [];
    const bSet = new Set(b.map(t => String(t).toLowerCase()));
    for (const t of a) {
        const k = String(t).toLowerCase();
        if (!bSet.has(k) && CORPUS_VOCAB_MAP[k])
            changes.push(`${CORPUS_VOCAB_MAP[k]} → ${k}`);
    }
    for (const t of b) {
        const k = String(t).toLowerCase();
        if (CORPUS_VOCAB_MAP[k] && !a.some(x => String(x).toLowerCase() === k))
            changes.push(`${k} → ${CORPUS_VOCAB_MAP[k]}`);
    }
    return changes;
}
/** v2.6：跨层一致性检查（标签段 ↔ 自然语言段）—— 重复与矛盾各报一类 */
const CROSS_LAYER_DUPES = [
    { re: /\bnaked\b/i, tag: "nude" },
    { re: /\bblack[- ]haired\b/i, tag: "black hair" },
    { re: /\bwooden bed\b/i, tag: "bed" },
    { re: /\bsweat\b/i, tag: "sweat" },
    { re: /\bblindfold\b/i, tag: "blindfold" },
    { re: /\bfrom behind\b/i, tag: "from behind" },
    { re: /\bseated\b|\bsitting\b/i, tag: "sitting" },
    // 新增：镜头词去重
    { re: /\bclose.?up\b/i, tag: "close-up" },
    { re: /\bwaist.?up\b/i, tag: "waist up" },
    { re: /\bcowboy.?shot\b/i, tag: "cowboy shot" },
    { re: /\bfull.?body\b/i, tag: "full body" },
    { re: /\bwide.?shot\b/i, tag: "wide shot" },
    { re: /\brule.?of.?thirds\b/i, tag: "rule of thirds" },
    { re: /\bdepth.?of.?field\b/i, tag: "depth of field" },
];
const CROSS_LAYER_CONFLICTS = [
    { tagRe: /\b(curtains?|window)\b/i, nlRe: /\b(windowless|no window|without windows?)\b/i, label: "窗 / 无窗" },
    { tagRe: /\bindoors\b/i, nlRe: /\b(outdoors|in the open|under the open sky)\b/i, label: "室内 / 室外" },
    // 修复：1girl/1boy 与 alone 并不矛盾（画面一个女孩，房间空）。矛盾是多人标签 vs alone
    { tagRe: /\b(2girls|2boys|3girls|3boys|4girls|4boys|5girls|5boys|multiple girls|multiple boys)\b/i, nlRe: /\b(alone in the room|no one else)\b/i, label: "多人 / 独处" },
    // 新增：景别冲突
    { tagRe: /\b(close.?up|waist.?up)\b/i, nlRe: /\b(legs?|feet|thighs?|skirt|pants|boots?)\b/i, label: "近景与下半身可见冲突" },
];
/** 跨层一致性检查（只告警不删 —— 改写散文会破坏句子结构） */
export function modCrossLayerCheck(doc) {
    const out = [];
    const tagSec = doc.sections.find(s => s.kind === "tags");
    if (!tagSec)
        return out;
    // v2.6：自然语言段可能有**多句**（每个句子一个 section）→ 必须全部拼起来再查，
    //   否则只查第一句 → 末句的矛盾（如「windowless room」）查不出来。
    const nlParts = doc.sections.filter(s => s.kind === "sentence" || s.kind === "phrase").flatMap(s => s.tags);
    if (!nlParts.length)
        return out;
    const tags = new Set(tagSec.tags.map(t => String(t).toLowerCase()));
    const nl = nlParts.join(" ");
    for (const d of CROSS_LAYER_DUPES) {
        if (!tags.has(d.tag))
            continue;
        const m = nl.match(d.re);
        if (m)
            out.push(`[跨层重复] 散文里的「${m[0]}」与标签层「${d.tag}」同义 —— 删散文里的那一处可省 token`);
    }
    for (const c of CROSS_LAYER_CONFLICTS) {
        const tHit = tagSec.tags.find(t => c.tagRe.test(t));
        const nHit = nl.match(c.nlRe);
        if (tHit && nHit)
            out.push(`[跨层矛盾] 标签层「${tHit}」与散文里的「${nHit[0]}」互相矛盾（${c.label}）`);
    }
    return out;
}
/** ③ 情绪词硬剔（句子段跳过，避免破坏句子结构；Hard Tags 段整条删除） */
export function modEmotionStrip(doc) {
    return {
        sections: doc.sections.map(s => s.kind === "sentence"
            ? { ...s, tags: [...s.tags] }
            : { sep: s.sep, kind: s.kind, tags: stripWordsInTags(s.tags, EMOTION_RE, s.kind === "tags") }),
    };
}
/** ④ 残留过程词硬剔（句子段跳过；Hard Tags 段整条删除） */
export function modProcessStrip(doc) {
    return {
        sections: doc.sections.map(s => s.kind === "sentence"
            ? { ...s, tags: [...s.tags] }
            : { sep: s.sep, kind: s.kind, tags: stripWordsInTags(s.tags, PROCESS_RE, s.kind === "tags") }),
    };
}
/** ⑤ 中文 / 全角残留（句子段跳过：句子中的中文同样不可取，但剔除会破坏句子 → 整句保留并告警） */
export function modCjkStrip(doc) {
    return {
        sections: doc.sections.map(s => s.kind === "sentence"
            ? { ...s, tags: [...s.tags] }
            : { sep: s.sep, kind: s.kind, tags: s.tags.map(t => toHalfWidth(t)).filter(t => !CJK_RE.test(t)) }),
    };
}
/**
 * 句子段里的中文残留（**只检测不修改**）——
 * 句子里的中文不能整句删（会破坏句子），但必须告警：
 * 阶段8 的中文兜底会把整段剥光 → 最终提示词为空 → 报「提示词为空」，
 * 而真实原因在阶段6，故此处提前给出可归因的告警。
 */
export function findCjkInSentences(doc) {
    const out = [];
    for (const sec of doc.sections) {
        if (sec.kind !== "sentence")
            continue;
        for (const t of sec.tags) {
            if (CJK_RE.test(t) && !out.includes(t))
                out.push(t);
        }
    }
    return out;
}
/** ⑥ 景别 ↔ 下半身冲突粗判（仅告警，不改产物）
 *  v2.3：匹配前做形态归一（下划线/连字符→空格）——
 *  此前用 `\b{word}\b` 直接匹配下划线形式的 Hard Tags（"close_up" / "black_shoes"），
 *  词边界遇 "_" 不成立 → 该告警在标签链下**恒不触发**（形同虚设）。 */
export function modSceneConflictGuard(doc) {
    const all = doc.sections
        .filter(s => s.kind !== "sentence")
        .flatMap(s => s.tags)
        .map(foldForMatch)
        .join(" ");
    for (const [dist, words] of Object.entries(LOWER_BODY_WORDS_PER_DISTANCE)) {
        if (!all.includes(foldForMatch(dist)))
            continue;
        const hit = words.filter(w => new RegExp(`\\b${w}\\b`, "i").test(all));
        if (hit.length)
            return [`景别为${dist}但检测到冲突词：${hit.join(", ")}`];
    }
    return [];
}
/**
 * 镜头/构图词 → 自然英文前置短语。
 *
 * v2.5 新增。**背景（真实链路里的阻塞级缺陷）**：
 *   校正层把归一后的镜头词（direction / distance / angle / composition / focus，
 *   实测为 `front view, full body, eye-level, rule of thirds, depth of field`）
 *   **原样拼到第一句前面** → 产出
 *   `front view full body eye-level rule of thirds depth of field A young woman kneels…`
 *   —— 五个裸 Danbooru 词 + 半句英文，是彻底的破碎句子。
 *
 * 修法：把镜头词转成**自然英文状语短语**，以「前置状语 + 逗号」的形式并入首句：
 *   `In a full body shot, from an eye-level angle, with a rule-of-thirds composition,
 *    a young woman kneels on all fours…`
 * Anima 规范也要求「第一句：景别、第一视觉主体、构图模式」——正好对应这个形态。
 */
const OPTICS_PHRASE = {
    "full body": "in a full body shot",
    "close-up": "in a close-up",
    "close up": "in a close-up",
    "upper body": "in an upper body shot",
    "waist up": "in an upper body shot",
    "cowboy shot": "in a cowboy shot",
    "wide shot": "in a wide shot",
    "medium shot": "in a medium shot",
    "bust shot": "in a bust shot",
    "front view": "from the front",
    "back view": "from behind",
    "side view": "from the side",
    "eye-level": "from an eye-level angle",
    "eye level": "from an eye-level angle",
    "low angle": "from a low angle",
    "high angle": "from a high angle",
    "dutch angle": "from a dutch angle",
    "dynamic angle": "from a dynamic angle",
    "rule of thirds": "with a rule-of-thirds composition",
    "centered composition": "in a centered composition",
    "depth of field": "with a shallow depth of field",
    "subject focus": "with the subject in focus",
};
/**
 * 镜头词 → 前置短语（按 景别 → 角度 → 构图 取**前 1 个**）。
 *
 * v2.6 修复（实测缺陷）：此前一次拼**最多 3 个**短语，实测产出
 *   `in a cowboy shot, from a high angle, in a centered composition, Kneeling on the wooden bed…`
 * —— 三个无主语碎片 + 句中大写，既违反「每句完整主谓结构」，也把镜头信息
 *   在散文里重复了一遍（镜头已由 Hard Tags 承载）。
 * 现在只补**一个**短语（景别优先），其余镜头信息走标签层（见 pipeline 的「镜头标签化」）。
 */
export function buildOpticsLeadIn(opticsWords) {
    const byKey = new Map();
    for (const raw of opticsWords ?? []) {
        const t = String(raw ?? "").trim().toLowerCase();
        const phrase = OPTICS_PHRASE[t];
        if (phrase && !byKey.has(phrase))
            byKey.set(phrase, t);
    }
    // 优先级：景别 > 角度 > 构图（最多 1 个，避免无主语碎片串）
    const order = ["in a full body shot", "in a close-up", "in an upper body shot", "in a cowboy shot",
        "in a wide shot", "in a medium shot", "in a bust shot",
        "from an eye-level angle", "from a low angle", "from a high angle", "from a dutch angle", "from a dynamic angle",
        "with a rule-of-thirds composition", "in a centered composition", "with a shallow depth of field",
        "from the front", "from behind", "from the side", "with the subject in focus"];
    const picked = order.filter(p => byKey.has(p)).slice(0, 1);
    return picked.join(", ");
}
/** 可安全小写的句首词（避免把专有名词改成小写） */
const SAFE_LOWER_FIRST = new Set([
    "a", "an", "the", "this", "that", "these", "those", "his", "her", "their", "its", "our", "my", "your",
    "one", "two", "three", "four", "five", "some", "several", "many", "both", "all",
    "in", "on", "at", "with", "after", "while", "when", "as", "by", "from",
]);
/** 分词/过去分词结尾（Kneeling / Bent / Arched）—— 句首大写必然是拼接产物 */
const PARTICIPLE_END = /(?:ing|ed)$/i;
/**
 * 句首安全小写：把「冠词/指示词/数词/介词」以及**分词**开头的句子首字母改成小写，
 * 专有名词（Princess Peach / Makima）保持原样。
 *
 * v2.6 修复（实测缺陷）：此前白名单只有虚词 → 句子以分词开头时（如
 *   `…, Kneeling on the wooden bed with her back to the camera, …`）首字母保持大写，
 *   在句中出现「句中大写」。现在分词结尾的词一律小写（除非词库判定为角色/作品名）。
 *
 * @param isProperNoun 判定回调：返回 true 表示该词是专有名词（不改写）
 */
export function lowerFirstSafe(sentence, isProperNoun) {
    const s = String(sentence ?? "");
    const m = s.match(/^([A-Za-z']+)(\s|$)/);
    if (!m)
        return s;
    const first = m[1].toLowerCase();
    if (!SAFE_LOWER_FIRST.has(first)) {
        const isParticiple = PARTICIPLE_END.test(m[1]) && m[1].length > 3;
        if (!isParticiple)
            return s;
        if (isProperNoun?.(first))
            return s;
    }
    return s.charAt(0).toLowerCase() + s.slice(1);
}
/**
 * v2.5：阶段8 合成 —— 把固定前缀 / 自定义标签 / 预设风格 / 固定后缀
 * **按段的性质**并入管线产物，且**不破坏 Natural Language 段的句子边界**。
 *
 * 规则：
 *   - 纯标签模式（tags）：单行，全部用「逗号+空格」串接（无句子可破坏）。
 *   - 混合模式（mixed）：头部 → 并入首个段（Hard Tags 段，用逗号）；
 *                        尾部 → 并入末个段（Natural Language 段）：
 *                        段以句号结尾 → **另起一句**（"…mattress. Watercolor illustration."）；
 *                        否则 → 逗号续接。
 *   - 自然语言模式（description）：没有 Hard Tags 段，头部与尾部都并入唯一的
 *                        Natural Language 段；头部另起一句放在句首，尾部另起一句放在句尾。
 *
 * 修复的缺陷：此前用 `[prefix, customPart, llmPrompt, stylePart, suffix].join(", ")`，
 * 风格/后缀被 ", " 拼在**句号之后** → `…mattress., watercolor illustration`（断句错误）；
 * description 模式下前缀被拼到**句子开头** → 把主句劈成两半。
 */
export function composePrompt(llmPrompt, head, tail, mode) {
    const base = String(llmPrompt ?? "").trim();
    if (!head && !tail)
        return base;
    if (mode === "custom") {
        // custom 模式：不做任何拼接，直接返回（用户已在提示词里处理 head/tail）
        return base;
    }
    if (mode === "tags") {
        return [head, base, tail].filter(Boolean).join(", ");
    }
    const secs = base.split("\nBREAK\n");
    const appendSentence = (s, extra) => {
        const t = s.trim();
        if (!t)
            return s;
        // Avoid double punctuation: if extra already ends with .!? don't add another
        const extraEndsWithPunct = /[.!?]$/.test(extra.trim());
        const extraFormatted = extraEndsWithPunct
            ? extra.trim()
            : `${extra.charAt(0).toUpperCase()}${extra.slice(1)}.`;
        if (/[.!?]$/.test(t))
            return `${t} ${extraFormatted}`;
        return `${t}, ${extraFormatted}`;
    };
    if (mode === "description" || secs.length === 1) {
        let s = secs[0] ?? "";
        if (head) {
            if (mode === "mixed" && secs.length === 1) {
                // mixed 单段（异常状态）：不破坏首句，把 head 作为逗号前缀拼到**段首**，
                // 但 head 里的质量词应被视为"标签"而非"句子"
                s = `${head}, ${s}`;
            }
            else {
                s = `${head.charAt(0).toUpperCase()}${head.slice(1)}. ${s}`;
            }
        }
        if (tail)
            s = appendSentence(s, tail);
        return s;
    }
    if (head)
        secs[0] = `${head}, ${secs[0]}`;
    for (let i = secs.length - 1; i >= 0; i--) {
        if (!secs[i].trim())
            continue;
        if (tail)
            secs[i] = appendSentence(secs[i], tail);
        break;
    }
    return secs.join("\nBREAK\n");
}
/** ⑦ 标签预算（**只作用于 Hard Tags 段**，超限从尾部截断并列出被删标签）
 *  v2.3：目标段由「最后一个非句子段」改为「kind==="tags" 段」。
 *  v2.0 的旧规则假设「最后一段=主段」，v2.2 把 Hard Tags 调到段首后，
 *  旧规则变成了「截断自然语言段/环境行」，标签段反而完全不受限。
 *  v2.6 修复：保留安全分级与人数标签（从头部提取，不参与截断），
 *  防止预算裁剪误删 critical 结构标签。
 *  v3.x：支持 phaseFn 按 phase 排序保留低 phase（外观、人数）标签优先。 */
export function modBudget(doc, budgetMax, phaseFn) {
    const warnings = [];
    if (!doc.sections.length)
        return { doc, warnings };
    const sections = doc.sections.map(s => ({ ...s, tags: [...s.tags] }));
    const idx = sections.findIndex(s => s.kind === "tags");
    if (idx < 0)
        return { doc: { sections }, warnings };
    const max = Math.max(0, Math.floor(budgetMax));
    const target = sections[idx];
    if (target.tags.length > max && phaseFn) {
        // 按 phase 排序，低 phase 优先保留
        const kept = [];
        const removed = [];
        const scored = target.tags.map(t => ({ t, phase: phaseFn(t) }));
        // 稳定排序：phase 升序
        scored.sort((a, b) => a.phase - b.phase);
        for (let i = 0; i < scored.length; i++) {
            if (i < max)
                kept.push(scored[i].t);
            else
                removed.push(scored[i].t);
        }
        // 恢复原相对顺序
        const keptSet = new Set(kept);
        target.tags = target.tags.filter(t => keptSet.has(t));
        warnings.push(`标签超预算（上限 ${max}），已移除 ${removed.length} 条高 phase 标签: ${removed.join(", ")}`);
    }
    else if (target.tags.length > max) {
        // 保留安全分级与人数标签（不参与预算裁剪）
        const RATING_TAG_RE = /^(safe|sensitive|nsfw|explicit|rating:\s*safe|rating:\s*questionable|rating:\s*explicit)$/i;
        const COUNT_TAG_RE = /^(1girl|1boy|2girls|2boys|3girls|3boys|4girls|4boys|5girls|5boys|multiple girls|multiple boys)$/i;
        const protectedTags = [];
        const otherTags = [];
        for (const t of target.tags) {
            if (RATING_TAG_RE.test(t) || COUNT_TAG_RE.test(t)) {
                protectedTags.push(t);
            }
            else {
                otherTags.push(t);
            }
        }
        // 预算仅针对非保护标签
        const availableBudget = max - protectedTags.length;
        if (availableBudget > 0 && otherTags.length > availableBudget) {
            const removed = otherTags.slice(availableBudget);
            otherTags.length = availableBudget;
            warnings.push(`标签超预算（上限 ${max}，保留 ${protectedTags.length} 个分级/人数标签），已从尾部截断 ${removed.length} 条: ${removed.join(", ")}`);
        }
        else if (availableBudget <= 0) {
            // 预算不足以容纳保护标签，仅保留保护标签并告警
            otherTags.length = 0;
            warnings.push(`标签预算 ${max} 低于保护标签数 ${protectedTags.length}，仅保留分级/人数标签`);
        }
        target.tags = [...protectedTags, ...otherTags];
    }
    return { doc: { sections }, warnings };
}
/** ⑧ 词库零覆盖告警（仅告警不删；**只校验 Hard Tags 段**）
 *  v2.3：收窄到 kind==="tags" 段 —— 自然语言段（英文散文）几乎不可能逐词命中
 *  Danbooru 词库，此前会产生大量「模型可能不识别」的误报，稀释告警可信度。 */
export function modDictValidate(doc, lexicon) {
    const scope = lexicon.allKeys.size > FULL_LEXICON_MIN_TAGS ? "完整词库" : "内嵌精选";
    const VALIDATE_SKIP = new Set([
        "a", "an", "the", "on", "in", "at", "by", "of", "for", "with", "to", "and", "or",
        "from", "above", "below", "behind", "beneath", "between", "up", "down", "out",
        "over", "under", "into", "viewer", "viewer's", "his", "her", "their", "me", "my",
        "your", "he", "she", "it", "they",
        "woman", "women", "girl", "girls", "man", "men", "boy", "boys", "female", "male",
    ]);
    const unknown = [];
    for (const sec of doc.sections) {
        if (sec.kind !== "tags")
            continue;
        for (const t of sec.tags) {
            if (!/[a-z]{3}/i.test(t))
                continue;
            if (/^[\d(]/.test(t))
                continue;
            if (/:[\d.]/.test(t))
                continue;
            if (VALIDATE_SKIP.has(t))
                continue;
            // v2.3：整词已被词库收录（或属质量词白名单）→ 不告警
            // （此前 medium shot 这类插件自己注入的规范值会被误判为「模型可能不识别」）
            if (isUsableTag(lexicon, t))
                continue;
            const probe = t.replace(/[:：;；()[\]（）]/g, " ").replace(/\s+/g, " ").trim();
            if (!probe || VALIDATE_SKIP.has(probe))
                continue;
            if (greedyDecompose(lexicon, probe).length === 0 && !unknown.includes(t)) {
                unknown.push(t);
            }
        }
    }
    if (unknown.length) {
        return [`[词库校验·${scope}] ${unknown.length} 处短语模型可能不识别（仅告警不删）: ${unknown.slice(0, 8).join(", ")}${unknown.length > 8 ? " …" : ""}`];
    }
    return [];
}
