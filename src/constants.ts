/**
 * v3.x：统一标签/分级/人数/词库阈值常量（单一事实源）
 * 所有模块从此文件引用，避免口径不一。
 */

/** 完整词库判定阈值：内嵌精选 1040 条，导入完整包 > 30 万条 */
export const FULL_LEXICON_MIN_TAGS = 5000;

/** 安全分级标签（Anima 规范：「必须包含一个安全分级」） */
export const RATING_TAGS = ["safe", "sensitive", "nsfw", "explicit", "questionable"] as const;

/** 安全分级正则：兼容 rating:safe / rating:questionable / rating:explicit 写法 */
export const RATING_TAG_RE = /^(safe|sensitive|nsfw|explicit|questionable|rating:\s*(safe|questionable|explicit))$/i;

/** 安全分级集合：用于 O(1) 查询（词库校验、排序等） */
export const RATING_TAG_SET = new Set(RATING_TAGS);

/** 人数标签正则（严格计数：1girl/2girls... multiple girls/boys） */
export const COUNT_TAG_RE = /^(1girl|1boy|2girls|2boys|3girls|3boys|4girls|4boys|5girls|5boys|multiple girls|multiple boys)$/i;

/** solo / 宽泛性别词（girl/boy/female/male）——不属于严格人数标签，不参与头部顺序调整 */
export const SOLO_GENDER_TAG_RE = /^(solo|girls?|boys?|female|male)$/i;

/** sexWith 排他正则 */
export const SEX_WITH_TAG_RE = /^sex with (woman|he|man|girl|boy|male|female)$/i;

/** 景别不兼容标签映射（Anima「画面规则」）—— 唯一事实源：deterministicCorrections.ts 引用 */
export const DISTANCE_INCOMPATIBLE: Record<string, RegExp> = {
    "close-up": /(?<![a-z])(breasts?|boobs?|tits?|cleavage|thighs?|legs?|thighhighs?|hips?|butt|buttocks?|feet|foot|shoes?|boots?|skirt|panties|underwear|shorts?|stockings?)(?![a-z])\b/i,
    "waist up": /(?<![a-z])(thighs?|legs?|hips?|butt|buttocks?|feet|foot|shoes?|boots?|skirt|panties|underwear|shorts?|stockings?)(?![a-z])\b/i,
    "cowboy shot": /(?<![a-z])(feet|foot|shoes?|boots?|ankle|ankles)(?![a-z])\b/i,
};