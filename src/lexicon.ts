// ============================================================
// v2.0 lexicon.ts —— 词库层（迁移自参考插件「提示词工具 7.0」）
// 纯函数核心 · 可在 Node 离线测（--experimental-strip-types）
// 三块：
//   A) decode 词库.bmz（BMZ1 = gzip + AES-256-GCM，口令/参数与参考插件一致）
//   B) 5 层索引：manual / mt / custom / builtin / big（+ 旁路 groups / cooc）
//   C) 查询与联想：正常化/翻译/变体/机翻兜底/共现联想/分类排序
// ============================================================

// 内嵌精选数据在 src/builtinDict.ts（由参考插件 BM_DICT_RAW 生成）。
// lexicon.ts 保持零依赖（便于 Node 离线测）；浏览器侧默认词库走 src/defaultLexicon.ts。

// ---------------------------------------------------------------
// A) 词库.bmz 解码（BMZ1 头部 + PBKDF2-SHA256 12 万次 + AES-256-GCM + gzip）
//    用 WebCrypto / DecompressionStream —— 浏览器与 Node 24 都可用，离线可测
// ---------------------------------------------------------------
export const BMZ_PW = "bmz-dict-pack-2026-9f3c1a7e5b2d8046c1afe37b95";
export const BMZ_ITER = 120000;

export interface LexiconEntry {
  name: string;
  text: string;
}

/** 解开 词库.bmz 的 ArrayBuffer，返回 {name, text} 数组（5 层）。 */
export async function decodeBmz(buf: ArrayBuffer): Promise<LexiconEntry[]> {
  const u8 = new Uint8Array(buf);
  if (u8.length < 40) throw new Error("词库包不完整");
  const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
  if (magic !== "BMZ1") throw new Error("这不是词库包（文件头认不出来）");
  const salt = u8.subarray(4, 20), iv = u8.subarray(20, 32), ct = u8.subarray(32);
  // WebCrypto 密文末尾 16 字节是 GCM tag，Node createDecipheriv 需单独给出；
  // 统一走 WebCrypto 则不需要拆 —— 两端都用 crypto.subtle 保持一致。
  const enc = new TextEncoder();
  const km = await crypto.subtle.importKey("raw", enc.encode(BMZ_PW), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt, iterations: BMZ_ITER, hash: "SHA-256" },
    km, { name: "AES-GCM", length: 256 }, false, ["decrypt"]
  );
  // iv 直接给：WebCrypto 的 AES-GCM iv 直接传，tag 在密文末尾，WebCrypto 自动校验
  const gz: ArrayBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(iv) }, key, ct);
  const ds = new DecompressionStream("gzip");
  const st = new Blob([gz]).stream().pipeThrough(ds);
  const raw = await new Response(st).arrayBuffer();
  const b = new Uint8Array(raw), te = new TextDecoder();
  const out: LexiconEntry[] = [];
  let p = 0;
  while (p + 2 <= b.length) {
    const nl = b[p] | (b[p + 1] << 8); p += 2;
    const nm = te.decode(b.subarray(p, p + nl)); p += nl;
    const dl = (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0; p += 4;
    const txt = te.decode(b.subarray(p, p + dl)); p += dl;
    out.push({ name: nm, text: txt });
  }
  if (!out.length) throw new Error("词库包里没有内容");
  return out;
}

// ---------------------------------------------------------------
// B) 5 层 + 旁路结构 & 索引
// ---------------------------------------------------------------

/** 翻译英文 tag 用：空格为规范写法；连字符/下划线视为变体 */
export function normEn(s: unknown): string {
  return String(s == null ? "" : s)
    .replace(/_/g, " ")
    .replace(/[-：:]+$/g, "")
    .trim()
    .toLowerCase();
}

/**
 * 标签规范化（参考 bmNormTag）：去头尾空白/括号、去尾部权重 :1.2、折叠空白。
 * v2.3：**下划线视作空格** —— 标签段（Hard Tags）用下划线分隔多词（black_hair），
 * 而词库键是空格形式（black hair）；不还原的话分类/共现/别名/阶段查询全部落空
 * （下划线形式查不到 → 分类排序退化为字母序、共现联想只剩单词种子）。
 */
export function normTag(s: unknown): string {
  return String(s == null ? "" : s)
    .replace(/^[\s({[]+/, "")
    .replace(/[\s)}\]]+$/, "")
    .replace(/:[\d.]+\s*$/, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** 同一词的几种写法（空格 / 连字符 / 下划线，参考 bmKeyVariants） */
export function keyVariants(s: string): string[] {
  const v = [s];
  if (s.indexOf(" ") >= 0) { v.push(s.replace(/ /g, "-"), s.replace(/ /g, "_")); }
  if (s.indexOf("-") >= 0) { v.push(s.replace(/-/g, " "), s.replace(/-/g, "_")); }
  if (s.indexOf("_") >= 0) { v.push(s.replace(/_/g, " "), s.replace(/_/g, "-")); }
  return v;
}

/** 拆词：英文 小写 单字（参考 bmWordsOf 的 bmNormTag split） */
export function wordsOf(tag: string): string[] {
  return normTag(tag).split(/[\s_]+/).filter((w) => w && /[a-z]/.test(w));
}

/** 大词库分类名（参考 BM_BIG_CATS）；通用画风主体等 */
export const BIG_CATS: Record<string, string> = { "0": "通用", "1": "画师", "3": "作品", "4": "角色", "5": "元标签" };

export interface Lexicon {
  /** 译文层顺序（manual→mt→custom→builtin→big），同词时按此取第一命中 */
  order: string[];
  /** builtin 英文→中文（内嵌精选） */
  builtinZh: Map<string, string>;
  /** manual 手译 英文→中文 */
  manualZh: Map<string, string>;
  /** mt 机翻词表 英文→中文 */
  mtZh: Map<string, string>;
  /** custom 自建 */
  customZh: Map<string, string>;
  /** big 大词库 英文→中文（懒查询，查过缓存；未填表示未建索引时按 lines 惰性建） */
  bigZh: Map<string, string>;
  /** 大词库原始行（英文\t中文\t分类数字），保留供全扫描 */
  bigLines?: string[];
  /** 标签分类：英文小写 → [大类, 小类]（供排序） */
  groups: Map<string, [string, string]>;
  /** 共现邻居：英文 → 邻居数组 */
  cooc: Map<string, string[]>;
  /** 全词（英文小写）集合，用于"是否收录"校验 */
  allKeys: Set<string>;
}

export interface LexiconOptions {
  builtinText?: string;
  customZh?: Map<string, string>;
  bigLines?: string[];
  groupsText?: string;
  coocText?: string;
  manualZh?: Map<string, string>;
  mtZh?: Map<string, string>;
}

/** 从内嵌精选 + 可选外部层构造 Lexicon 索引。所有层都做：全词集合（供校验）+ 查中文（供翻译）。 */
export function createLexicon(opts: LexiconOptions = {}): Lexicon {
  const builtinZh = new Map<string, string>();
  const allKeys = new Set<string>();
  // 内嵌精选（BM_DICT_RAW：英文\u0001中文 每行）
  for (const line of String(opts.builtinText ?? "").split("\n")) {
    if (!line) continue;
    const i = line.indexOf("\u0001");
    if (i < 1) continue;
    const en = line.slice(0, i);
    const zh = line.slice(i + 1);
    builtinZh.set(en, zh);
    allKeys.add(en);
  }

  const customZh = opts.customZh ?? new Map<string, string>();
  const manualZh = opts.manualZh ?? new Map<string, string>();
  const mtZh = opts.mtZh ?? new Map<string, string>();
  const bigZh = new Map<string, string>();
  for (const [k] of customZh) allKeys.add(k);
  for (const [k] of manualZh) allKeys.add(k);
  for (const [k] of mtZh) allKeys.add(k);

  // 大词库：把英文 tag 进 allKeys（供"是否收录"校验）；译文懒查询
  if (opts.bigLines) {
    for (const line of opts.bigLines) {
      const tab = line.indexOf("\t");
      if (tab < 1) continue;
      allKeys.add(line.slice(0, tab));
    }
  }

  // 标签分类 （每行：英文\t大类\t小类）
  const groups = new Map<string, [string, string]>();
  if (opts.groupsText) {
    for (const L of String(opts.groupsText).split("\n")) {
      const l = L.replace(/\r$/, "");
      if (!l || l.charAt(0) === "#") continue;
      const p = l.split("\t");
      if (p.length < 3) continue;
      const en = p[0].trim().toLowerCase();
      if (!en) continue;
      groups.set(en, [p[1].trim(), p[2].trim()]);
    }
  }

  // 共现邻居 （每行：英文\t邻居1|邻居2|…）
  const cooc = new Map<string, string[]>();
  if (opts.coocText) {
    for (const L of String(opts.coocText).split("\n")) {
      const l = L.replace(/\r$/, "");
      if (!l || l.charAt(0) === "#") continue;
      const tab = l.indexOf("\t");
      if (tab < 1) continue;
      const es = l.slice(0, tab).trim().toLowerCase();
      const arr = l.slice(tab + 1).split("|").map((x) => x.trim().toLowerCase()).filter(Boolean);
      if (es && arr.length) cooc.set(es, arr);
    }
  }

  const lex: Lexicon = {
    order: ["manual", "mt", "custom", "builtin", "big"],
    builtinZh,
    manualZh,
    mtZh,
    customZh,
    bigZh,
    groups,
    cooc,
    allKeys,
  };
  if (opts.bigLines) lex.bigLines = opts.bigLines;
  return lex;
}

/**
 * 把 词库.bmz 解出的 5 个 {name,text} 条目直接构建成完整 Lexicon。
 * 浏览器「导入」与 IndexedDB「刷新恢复」共用此路径（保证两者构建结果一致）；
 * 纯函数、可离线回归（prompt_quality_test.mjs 有一致性断言）。
 */
export function createLexiconFromEntries(entries: LexiconEntry[], builtinText = ""): Lexicon {
  const byName: Record<string, string> = {};
  for (const e of entries) byName[e.name] = e.text;
  const line = (n: string) => (byName[n] || "").split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
  return createLexicon({
    builtinText,
    bigLines: line("danbooru_tags.txt"),
    groupsText: line("标签分类.tsv").join("\n"),
    coocText: line("共现邻居.tsv").join("\n"),
    mtZh: new Map(line("机翻词表.tsv").map((l) => { const p = l.split("\t"); return [p[0], p[1]]; })),
    manualZh: new Map(line("手动翻译.tsv").map((l) => { const p = l.split("\t"); return [p[0], p[1]]; })),
  });
}

// ---------------------------------------------------------------
// C) 查询与联想（参考 bmDictLookup / bmVariantLookup / bmRoughTranslate /
//     bmSearchDict 重联想 / bmLayerRank）
// ---------------------------------------------------------------

function layerZh(lex: Lexicon, id: string, k: string): string {
  if (id === "manual") return lex.manualZh.get(k) || "";
  if (id === "mt") return lex.mtZh.get(k) || "";
  if (id === "custom") return lex.customZh.get(k) || "";
  if (id === "builtin") return lex.builtinZh.get(k) || "";
  if (id === "big") {
    const hit = lex.bigZh.get(k);
    if (hit !== undefined) return hit;
    if (lex.bigLines) {
      for (const line of lex.bigLines) {
        const t1 = line.indexOf("\t");
        if (t1 < 1) continue;
        if (line.slice(0, t1) === k) {
          const t2 = line.indexOf("\t", t1 + 1);
          const zh = line.slice(t1 + 1, t2 < 0 ? line.length : t2);
          lex.bigZh.set(k, zh);
          return zh;
        }
      }
      lex.bigZh.set(k, "");
    }
    return lex.bigZh.get(k) || "";
  }
  return "";
}

/** 词/短语 → 中文（按层顺序 + 几种写法，参考 bmDictLookup） */
export function dictLookup(lex: Lexicon, w: string): string {
  if (!w) return "";
  const vs = keyVariants(w);
  for (const v of vs) {
    for (const id of lex.order) {
      const r = layerZh(lex, id, v);
      if (r) return r;
    }
  }
  return "";
}

/** 单词：允许常见词形变化（参考 bmVariantLookup） */
export function variantLookup(lex: Lexicon, w: string): string {
  const cands = [w];
  if (/ies$/.test(w)) cands.push(w.replace(/ies$/, "y"));
  if (/(ses|xes|zes|ches|shes)$/.test(w)) cands.push(w.replace(/es$/, ""));
  if (/s$/.test(w) && !/ss$/.test(w)) cands.push(w.replace(/s$/, ""));
  if (/ing$/.test(w)) cands.push(w.replace(/ing$/, ""), w.replace(/ing$/, "e"));
  for (const c of cands) {
    const v = dictLookup(lex, c);
    if (v) return v;
  }
  return "";
}

/** 机翻兜底：先最长 4 词短语、再单词变体，逐段硬拼（参考 bmRoughTranslate） */
export function roughTranslate(lex: Lexicon, k: string): string {
  const words = String(k || "").split(/[\s_]+/).filter(Boolean);
  if (!words.length) return "";
  let out = "", got = 0, i = 0;
  while (i < words.length) {
    let hit = "", used = 0;
    for (let len = Math.min(4, words.length - i); len >= 1; len--) {
      const phrase = words.slice(i, i + len).join(" ");
      const v = len === 1 ? variantLookup(lex, words[i]) : dictLookup(lex, phrase);
      if (v) { hit = v; used = len; break; }
    }
    if (hit) { out += hit; got += used; i += used; }
    else { out += words[i]; i++; }
  }
  if (!got) return "";
  return out;
}

/** 是否收录（在任意层）；词库键多为空格形式，下划线/连字符按变体一并试。 */
export function isKnownTag(lex: Lexicon, tag: string): boolean {
  const base = normTag(tag);
  if (lex.allKeys.has(base)) return true;
  for (const v of keyVariants(base)) {
    if (lex.allKeys.has(v)) return true;
  }
  return false;
}

/**
 * Danbooru 官方别名归一：词库（32万）按 Danbooru 规范收词（grey hair / purple eyes / pale skin），
 * 而输入语料常用同义写法（silver hair / violet eyes / fair skin / golden eyes）。
 * 输入端先归一到规范形式再查，避免合法写法被"不臆造"口径误丢。
 */
const DANBOORU_ALIAS_ENTRIES: Array<[string, string]> = [
  ["silver hair", "grey hair"],
  ["silver eyes", "grey eyes"],
  ["gray hair", "grey hair"],
  ["violet eyes", "purple eyes"],
  ["golden eyes", "yellow eyes"],   // Danbooru 官方别名
  ["fair skin", "pale skin"],       // Danbooru 规范收 pale skin
];
const DANBOORU_ALIAS: Record<string, string> = Object.fromEntries(DANBOORU_ALIAS_ENTRIES);
/** 有规范别名则返回规范形式，否则返回空串（整串精确匹配）。 */
export function aliasOfTag(tag: string): string {
  return DANBOORU_ALIAS[normTag(tag)] || "";
}
/** 在（已小写规范化的）自由文本里做 Danbooru 别名**词组级**替换——嵌在长 token
 *  里的写法也能替换（"a silver hair woman: ..." → "a grey hair woman: ..."）。 */
const ALIAS_PHRASE_RE = new RegExp(
  `\\b(${DANBOORU_ALIAS_ENTRIES.map(([k]) => k.replace(/ /g, "\\s+")).join("|")})\\b`, "g");
export function applyAliasPhrases(text: string): string {
  return String(text).replace(ALIAS_PHRASE_RE, (m) => DANBOORU_ALIAS[m] || m);
}

/**
 * 判定"可上画"的 Danbooru 标签：
 *  - 传入了 标签分类.tsv（groups 非空）→ **必须命中分类表**（通用可上画标签；否则画师/角色/
 *    作品/元标签/无分类噪声一律不进 prompt）——完整 词库.bmz 的高保真口径。
 *  - 只有内嵌精选词库（无分类表，默认无 .bmz 场景）→ 要求：被词库收录 **且** 非停用介词/冠词/代词/
 *    bare 修饰噪声；内置 1040 词本身是人工精选的可上画标签，直接采用即正确。
 * 这保证**两种模式下贪心分解都不会输出空/噪声**：完整模式靠分类表，内嵌模式靠精选+停用词过滤。
 */
const STOP_LEX = new Set([
  "a", "an", "the", "on", "in", "at", "by", "of", "for", "with", "to", "and", "or",
  "on the", "in the", "at the", "in front of", "behind the", "beside the",
  "above", "below", "under", "between", "from", "up", "out", "over", "into",
  "viewer", "viewer's", "his", "her", "their", "me", "my", "your", "they", "he", "she", "it",
  "woman", "women", "girl", "girls", "man", "men", "boy", "boys", "female", "male",
]);
export function isModelableTag(lex: Lexicon, tag: string): boolean {
  const base = normTag(tag);
  if (lex.groups.size > 0) {
    if (lex.groups.has(base)) return true;
    for (const v of keyVariants(base)) if (lex.groups.has(v)) return true;
    return false;
  }
  // 无分类表：需被收录且非停用噪声
  if (!isKnownTag(lex, base)) return false;
  const low = base.toLowerCase();
  if (STOP_LEX.has(low)) return false;
  // 单一 bare 修饰词（short/brown/pale/silver…）词库有但本身不上画 → 交由是否有复数短语包裹决定，
  // 这里保留（贪心已优先吞掉 "short hair" 等更长可上画短语，剩下来的单体若是词库收录修饰词也给画）
  return true;
}

/** 分类：[大类, 小类] 或 undefined（参考标签分类.tsv）*/
export function groupsOf(lex: Lexicon, tag: string): [string, string] | undefined {
  const k = normTag(tag);
  return lex.groups.get(k);
}

/** 共现邻居数组（参考共现邻居.tsv）*/
export function coocOf(lex: Lexicon, tag: string): string[] {
  const k = normTag(tag);
  return lex.cooc.get(k) || [];
}

/**
 * 质量 / 画风 / 分辨率 / 评分类标签白名单。
 * 「标签分类.tsv」是**画什么**的分类表（长头发/穿制服/表情…），**不收质量词**；
 * 但 Anima 契约要求 Hard Tags 含「质量/年代/安全分级」——
 * 若用分类表当「可上画」门槛，导入完整词库后 masterpiece/best_quality 会被当成未收录剔除。
 */
export const QUALITY_TAG_WHITELIST = new Set([
    "masterpiece", "best quality", "high quality", "normal quality", "low quality", "worst quality",
    "ultra detailed", "highly detailed", "detailed", "simplified", "minimalist",
    "highres", "absurdres", "lowres", "4k", "8k", "uhd", "hd", "fhd", "2k",
    "official art", "anime screencap", "manga style", "anime style", "illustration", "sketch",
    "score_1", "score_2", "score_3", "score_4", "score_5", "score_6", "score_7", "score_8", "score_9",
    // v2.6：normTag 会把下划线转成空格 → 查表用的是空格形式，补齐空格写法
    "score 1", "score 2", "score 3", "score 4", "score 5", "score 6", "score 7", "score 8", "score 9",
    "rating: safe", "rating:questionable", "rating:explicit", "safe", "sensitive", "questionable", "explicit",
    "commentary", "dialogue", "realistic", "photorealistic",
]);

/**
 * 安全分级标签（Anima 规范：「必须包含一个安全分级：safe / sensitive / nsfw / explicit」）。
 * 与质量词白名单分开 —— 质量词归「风格」段（phase 2），安全分级必须排最前（phase 0）。
 */
/**
 * v2.6：LLM **不该输出**、由用户手动提供的「质量咒语 / 评分词」黑名单。
 *
 * 为什么要机械剔除（而不只是提示词里禁写）：
 *   实测产物里 LLM 在标签段头部吐了 5 个质量词
 *   （masterpiece, best quality, very aesthetic, absurdres, score_9），
 *   把安全分级挤到第 6 位、白占 14% 的标签预算，还把画风带偏。
 *   提示词层的禁令挡不住模型惯性 —— 这里做兜底剔除，
 *   用户在设置里手填的质量词随后由 insertQualityWords 放回**风格位**。
 *
 * 注意：**不包含**安全分级（safe/sensitive/nsfw/explicit）与
 * 合法画风词（realistic / illustration / anime style / detailed …）。
 */
export const LLM_FORBIDDEN_QUALITY = new Set([
    "masterpiece", "best quality", "very aesthetic", "aesthetic", "absurdres", "highres", "lowres",
    "score_1", "score_2", "score_3", "score_4", "score_5", "score_6", "score_7", "score_8", "score_9",
    // normTag 把下划线转空格 → 查表用空格形式，两种写法都要能命中
    "score 1", "score 2", "score 3", "score 4", "score 5", "score 6", "score 7", "score 8", "score 9",
    "amazing quality", "perfect quality", "top quality", "good quality", "best art",
    "4k", "8k", "uhd", "2k", "fhd",
]);

export const RATING_TAG_SET = new Set([  "safe", "sensitive", "nsfw", "explicit",
  "rating: safe", "rating: questionable", "rating: explicit",
]);

/**
 * 一个"标签分类"映射成 Anima 阶段（标签段内的规范词序）—— 值越小越靠前。
 *
 * v2.4 重排：原表是「画风→主体→动作→背景」四段，把**构图/视角/光影放在最前**，
 * 与两处权威都不符：
 *   ① 实测热门提示词语料（80 条 / 3254 个 tag 单元的平均相对位置）的维度骨架是
 *      分级 0.21 → 人数 0.27 → 风格 0.36 → 外观 0.49 → 服装 0.50 →
 *      表情 0.52 → 动作 0.53 → 镜头 0.55 → 场景 0.60 → 光影 0.65 → 文字 0.77；
 *   ② Anima 格式规范的 Hard Tags 清单顺序是「质量/分级 → 人数/角色 →
 *      发色/瞳色/发型/体型 → 服装/道具 → 姿势/表情/动作 → 场景锚点」。
 * 镜头与光影在两份依据里都**靠后**，原表把它们放在最前是主要偏差。
 */
const GROUP_PHASE: Record<string, number> = {
  "画师风格": 2, "质感": 2,
  "发型": 3, "面容": 3, "身材": 3,
  "上装": 4, "下装": 4, "配饰": 4, "头饰": 4, "鞋子": 4, "道具": 4,
  "表情": 5,
  "姿势": 6, "动作": 6, "特殊动作": 6,
  "构图": 7, "视角": 7,
  "背景": 8,
  "光影": 9,
};

/**
 * 未分类时按关键词粗判的阶段。
 * **数组顺序 = 匹配优先级**（先命中先返回），phase 值才是排序位置。
 * 优先级排序的理由：多词标签常同时命中多个维度，靠前放更具体的那个，避免误判：
 *   "full body"（镜头）必须先于 "body"（外观）命中，否则会被当成身体特征；
 *   "cinematic lighting"（光影）必须先于 "cinematic"（风格）命中。
 */
const KW_PHASE = [
  { re: /^(safe|sensitive|nsfw|explicit|rating:\s*safe|rating:\s*questionable|rating:\s*explicit)$/i, phase: 0 },
  { re: /\b(\d+ ?girls?|\d+ ?boys?|solo|multiple girls|multiple boys|female|male)\b/i, phase: 1 },
  { re: /\b(full body|upper body|lower body|waist up|close-up|close up|wide shot|cowboy shot|bust shot|medium shot|dynamic angle|dutch angle|low angle|high angle|angle|shot|depth of field|composition|foreshortening|from above|from below|from behind|from side|from front|pov|selfie|focus)\b/i, phase: 7 },
  { re: /\b(lighting|light|sunlight|moonlight|shadow|spotlight|lamplight|rim light|volumetric|backlighting|glow|bloom|neon|high contrast|dramatic lighting|cinematic lighting|godrays)\b/i, phase: 9 },
  { re: /\b(anime|style|render|3d|sketch|watercolor|painting|oil painting|flat vector|flat color|no lineart|no outline|masterpiece|best quality|absurdres|highres|score_|realistic|photorealistic|chiaroscuro|cinematic|illustration)\b/i, phase: 2 },
  { re: /\b(hair|eyes|skin|breast|tits|nipples|body|pubic hair|tail|ears?|horns?|wings?|freckles|mole|slender|curvaceous|petite|thighs?|waist|hips?|ponytail|twintails|braid|braids|bangs|ahoge|bob cut|wolf cut|sweat|sweating|wet skin|shiny skin|drooling|saliva|pale skin|tan|tanned)\b/i, phase: 3 },
  { re: /\b(dress|uniform|skirt|pants|shirt|gloves|hat|stockings|thighhighs|pantyhose|underwear|bra|panties|apron|coat|jacket|sweater|boots|heels|shoes|socks|ribbon|glasses|necklace|earrings|choker|collar|blindfold|ring|hairclip|hairband|costume|outfit)\b/i, phase: 4 },
  { re: /\b(looking|blush|blushing|smile|smiling|grin|ahegao|expressionless|expression|open mouth|closed mouth|half-closed eyes|rolling eyes|uneven eyes|tears|crying|moaning|eyebrows?)\b/i, phase: 5 },
  { re: /\b(gripping|holding|kissing|grabbing|penetration|fingering|licking|sucking|reaching|waving|crossing|cupping|hugging|lying|standing|sitting|kneeling|posing|posed|on all fours|spread legs|leaning|arched back|hand on|leg grab|bent over|thrusting|walking|running)\b/i, phase: 6 },
  { re: /\b(background|room|bedroom|classroom|office|stage|street|desk|window|mirror|bed|outdoors|indoors|simple background|scenery|cave|forest|beach|garden|school|hall|field|alley|rooftop)\b/i, phase: 8 },
  { re: /\b(speech bubble|thought bubble|sound effects|typography|japanese text|text)\b/i, phase: 10 },
];
/** 算一个标签/短语的阶段（用于排序；值越小越靠前）*/
export function phaseOf(lex: Lexicon, tag: string): number {
  // v2.4：**安全分级优先判定**（必须排最前）。
  //   此前分级与质量词同在 QUALITY_TAG_WHITELIST 里 → 一起归到 phase 0，
  //   分级词与画风词无法区分先后。
  if (RATING_TAG_SET.has(normTag(tag))) return 0;
  const g = groupsOf(lex, tag);
  if (g) {
    const sub = g[1];
    if (GROUP_PHASE[sub] !== undefined) return GROUP_PHASE[sub];
    // 大类兜底
    if (sub === "双人/多人") return 6;
    if (sub === "人物属性") return 3;
    if (g[0] === "画面全局") return 2;
  }
  // v2.4：质量/画风词归入第 2 段（风格）—— 不是第 0 段（第 0 段是安全分级）
  if (QUALITY_TAG_WHITELIST.has(normTag(tag))) return 2;
  // v2.3：关键词兜底也用归一化形式（下划线标签段 "black_hair" 必须能命中 \bhair\b）
  const norm = normTag(tag);
  for (const { re, phase } of KW_PHASE) if (re.test(norm)) return phase;
  return 11;
}

/** 无词库时的关键字兜底阶段（用于排序；值越小越靠前）*/
export function keywordPhaseOf(tag: string): number {
    const norm = normTag(tag);
    for (const { re, phase } of KW_PHASE) if (re.test(norm)) return phase;
    return 11;
}

// ---------------------------------------------------------------
// D) 重联想（参考 bmSearchDict ③.6 重度共现）
//    种子=已命中标签，对每个种子轮取它的共现邻居（每轮各取1、15轮封顶、总量12）
// ---------------------------------------------------------------
export const COOC_MAX = 12;
export const COOC_SEEDS = 6;

/** 给一组已存在标签补共现邻居（深度联想确定性化；不凭空加）。 */
export function associateCooc(lex: Lexicon, existing: string[], max: number = COOC_MAX): string[] {
  const seen = new Set(existing.map(normTag));
  const seeds = existing
    .map(normTag)
    .filter((s) => s && lex.cooc.has(s))
    .slice(0, COOC_SEEDS);
  const cands: string[] = [];
  for (let round = 0; round < 15 && cands.length < max; round++) {
    for (const s of seeds) {
      if (cands.length >= max) break;
      const arr = lex.cooc.get(s) || [];
      const nb = arr[round];
      if (nb && !seen.has(nb) && cands.indexOf(nb) < 0) cands.push(nb);
    }
  }
  return cands;
}
