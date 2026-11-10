import { logger } from "./logger.js";

interface NameAliasOptions {
    maxSurnameLen?: number;
    compoundSurnames?: Set<string>;
    honorificPrefixes?: string[];
    honorificSuffixes?: string[];
    separators?: RegExp;
}

const COMMON_COMPOUND_SURNAMES = new Set([
    "欧阳", "诸葛", "司马", "上官", "夏侯", "令狐", "慕容",
    "东方", "南宫", "独孤", "万俟", "闻人", "赫连", "澹台",
    "皇甫", "尉迟", "公羊", "端木", "轩辕", "鲜于",
    "淳于", "申屠", "钟离", "宇文", "长孙",
    "闾丘", "子车", "颛孙", "巫马", "公西", "漆雕",
    "乐正", "壤驷", "公良", "拓跋", "夹谷", "宰父", "谷梁",
    "段干", "百里", "东郭", "南门", "呼延", "羊舌", "微生",
    "梁丘", "左丘", "东门", "西门", "戏阳", "即墨",
    "司空", "司徒", "司寇", "司城", "公冶", "公输",
    "公仪", "公玉", "公乘", "公族", "公皙",
    "左人", "右师", "石作", "仲孙", "叔孙", "季孙",
    "单于", "叱干", "纥骨", "可频", "乙弗", "乞伏",
    "豆卢", "贺兰", "达奚",
    "犬冢", "西园寺", "井上", "高桥",
]);

const MAX_SURNAME_LEN = 4;

const DEFAULT_SEPARATORS = /[·•．.\u3000]/g;

const DEFAULT_PREFIXES = ["老", "小", "阿"];

const DEFAULT_SUFFIXES = ["哥", "姐", "叔", "姨", "先生", "小姐", "老师", "总", "酱", "君", "桑"];

const ANNOTATION_RE = /\s*[[（(【「『][^\]）)】」』]*?[\]）)】」』]\s*/g;

function normalize(name: string, separators?: RegExp): string {
    const sep = separators ?? DEFAULT_SEPARATORS;
    return name.trim().replace(ANNOTATION_RE, "").replace(sep, "").trim();
}

function generateAliases(normalized: string, compoundSurnames: Set<string>, maxSurnameLen: number): string[] {
    const aliases: string[] = [];
    let surname = "";
    let given = "";

    // 拉丁（英文/拼音）名：按单词边界拆全名/名/姓，不产生字符碎片（避免 "Ali"→"Ali"ce 误注入）
    if (/[a-zA-Z]/.test(normalized)) {
        const words = normalized.split(/[\s.\-·]+/).filter(Boolean);
        aliases.push(normalized);
        if (words.length >= 2) {
            // 西方顺序「名 姓」：尾词作姓、首词作名
            const givenName = words.slice(0, -1).join(" ");
            const familyName = words[words.length - 1] as string;
            if (givenName.length >= 2) aliases.push(givenName);
            if (familyName.length >= 2) aliases.push(familyName);
        }
        return aliases;
    }

    for (let len = maxSurnameLen; len >= 2; len--) {
        const prefix = normalized.slice(0, len);
        if (compoundSurnames.has(prefix)) {
            surname = prefix;
            given = normalized.slice(len);
            break;
        }
    }

    if (!surname) {
        surname = normalized[0] ?? "";
        given = normalized.slice(1);
    }

    aliases.push(normalized);

    if (surname.length >= 2) {
        aliases.push(surname);
    }

    if (given.length >= 2) {
        aliases.push(given);
        // v2.x 收紧：不再对 given 产生单字别名（单字极易误注入）；仅保留两字以上的给定名
    }

    return aliases;
}

export function trimHonorifics(
    text: string,
    options?: Pick<NameAliasOptions, "honorificPrefixes" | "honorificSuffixes">,
): string {
    const prefixes = options?.honorificPrefixes ?? DEFAULT_PREFIXES;
    const suffixes = options?.honorificSuffixes ?? DEFAULT_SUFFIXES;
    let result = text;

    for (const prefix of prefixes) {
        const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        result = result.replace(new RegExp(`${escaped}(?=\\p{Script=Han})`, "gu"), "");
    }

    for (const suffix of suffixes) {
        const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        result = result.replace(new RegExp(`(?<=\\p{Script=Han})${escaped}`, "gu"), "");
    }

    return result;
}

/**
 * 在正文中查找别名命中（v1.3 修复）：
 * 同时在原文与裁剪称谓后的文本中匹配——避免名字本身含 老/小/阿（如"赵老六"）
 * 被 trimHonorifics 破坏（"赵老六"→"赵六"）而永远无法命中。
 */
/**
 * 判断正文是否命中一个名字变体（v2.x 收紧）：
 *  - 含拉丁字母（英文/拼音）变体：用词边界 \b 正则，避免 "Al" 命中 "Alice"/"wall"；
 *  - 纯中文变体：子串匹配（中文无词边界），但 ≤1 字符的过短变体不参与（防单字误注入）。
 * 统一小写+折叠全角+去分隔符后比较。
 */
export function matchesNameVariant(text: string, variant: string): boolean {
    const nv = normalize(variant, DEFAULT_SEPARATORS).toLowerCase();
    if (!nv) return false;
    // 含拉丁字母 → 词边界精确匹配（含大小写折叠）
    if (/[a-zA-Z]/.test(nv)) {
        const escaped = nv.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, "i");
        return re.test(text);
    }
    // 纯中文：过短（≤1）跳过，避免单字大面积误注入
    if ([...nv].length <= 1) return false;
    return text.includes(nv);
}

/**
 * v1.3 → v2.x：findAliasesInText 收紧版。
 * 用 matchesNameVariant 逐变体判定（含英文词边界；中文去单字）。
 */
export function findAliasesInText(text: string, aliasMap: Map<string, string | null>): Set<string> {
    const aliasedText = trimHonorifics(text);
    const matched = new Set<string>();
    for (const [alias, id] of aliasMap) {
        if (id === null) continue;
        if (matchesNameVariant(text, alias) || matchesNameVariant(aliasedText, alias)) {
            matched.add(id);
        }
    }
    return matched;
}

export function buildAliasMap(
    characters: Map<string, string>,
    options?: NameAliasOptions,
): Map<string, string | null> {
    const aliasMap = new Map<string, string | null>();
    const compoundSurnames = options?.compoundSurnames ?? COMMON_COMPOUND_SURNAMES;
    const maxSurnameLen = options?.maxSurnameLen ?? MAX_SURNAME_LEN;
    const separators = options?.separators;

    for (const [canonicalName, id] of characters) {
        const norm = normalize(canonicalName, separators);
        if (!aliasMap.has(norm)) {
            aliasMap.set(norm, id);
        }
    }

    const candidateAliases = new Map<string, Set<string>>();
    for (const [canonicalName, id] of characters) {
        const norm = normalize(canonicalName, separators);
        const aliases = generateAliases(norm, compoundSurnames, maxSurnameLen);
        for (const alias of aliases) {
            if (alias === norm) continue;
            let idset = candidateAliases.get(alias);
            if (!idset) {
                idset = new Set();
                candidateAliases.set(alias, idset);
            }
            idset.add(id);
        }
    }

    for (const [alias, ids] of candidateAliases) {
        if (ids.size > 1) {
            if (!aliasMap.has(alias)) {
                aliasMap.set(alias, null);
                const idsArr = Array.from(ids);
                logger.debug("[NameMatcher] Ambiguous alias: %s → %s", alias, idsArr.join(", "));
            }
        } else if (!aliasMap.has(alias)) {
            const singleId = Array.from(ids)[0] as string;
            aliasMap.set(alias, singleId);
        }
    }

    return aliasMap;
}
