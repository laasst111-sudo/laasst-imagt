// ============================================================
// lexicon.types.ts —— 词库契约类型定义（供 pipeline、promptPost 等消费方导入）
// 仅含类型与常量签名，不含实现。实现保留在 lexicon.ts。
// ============================================================

export interface LexiconEntry {
    name: string;
    text: string;
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
    /** big 大词库 英文→中文（懒查询，查过缓存） */
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

// 常量导出（运行时值来自 lexicon.ts，这里仅作类型声明）
export declare const RATING_TAG_SET: Set<string>;
export declare const QUALITY_TAG_WHITELIST: Set<string>;
export declare const LLM_FORBIDDEN_QUALITY: Set<string>;
export declare const COOC_MAX: number;
export declare const COOC_SEEDS: number;
export declare const BIG_CATS: Record<string, string>;
export declare const GROUP_PHASE: Record<string, number>;
export declare const DANBOORU_ALIAS: Record<string, string>;

// 函数签名
export declare function normTag(s: unknown): string;
export declare function normEn(s: unknown): string;
export declare function keyVariants(s: string): string[];
export declare function wordsOf(tag: string): string[];
export declare function isKnownTag(lex: Lexicon, tag: string): boolean;
export declare function isModelableTag(lex: Lexicon, tag: string): boolean;
export declare function aliasOfTag(tag: string): string;
export declare function applyAliasPhrases(text: string): string;
export declare function groupsOf(lex: Lexicon, tag: string): [string, string] | undefined;
export declare function coocOf(lex: Lexicon, tag: string): string[];
export declare function phaseOf(lex: Lexicon, tag: string): number;
export declare function associateCooc(lex: Lexicon, existing: string[], max?: number): string[];
export declare function dictLookup(lex: Lexicon, w: string): string;
export declare function variantLookup(lex: Lexicon, w: string): string;
export declare function roughTranslate(lex: Lexicon, k: string): string;
export declare function createLexicon(opts?: LexiconOptions): Lexicon;
export declare function createLexiconFromEntries(entries: LexiconEntry[], builtinText?: string): Lexicon;