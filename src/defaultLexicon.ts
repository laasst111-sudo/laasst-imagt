// ============================================================
// defaultLexicon.ts —— 浏览器运行时词库（含 IndexedDB 持久化恢复）
// 默认内嵌精选（1040 条，离线可用）；导入 词库.bmz 后按 createLexiconFromEntries
// 构建完整 5 层（32 万词）并持久化到 IndexedDB（lexiconStore.ts）。
// 恢复与导入共用同一条构建路径，结果保证一致。
//
// v2.7 性能改造：**惰性加载**
//   旧行为：页面一加载就在后台解密 15MB 词库包（PBKDF2 12 万次 + AES-GCM + gzip）
//   并建 34 万词索引 —— 实测在手机端造成 ≈180ms 主线程阻塞 + ≈94MB 常驻堆，
//   是酒馆移动端首屏卡顿的主要来源之一。
//   新行为：
//   - 启动时只做一次 **廉价探测**（IndexedDB count，不读 blob、不解密）；
//   - 真正需要完整词库时（打开插件设置面板 / 点击生成）才解码建索引；
//   - 首次加载后本会话复用，行为与旧版完全一致。
// ============================================================

import { BUILTIN_DICT_RAW } from "./builtinDict.js";
import { createLexicon, type Lexicon } from "./lexicon.js";
import { clearBmzRaw, hasBmzRaw, loadBmzRaw, saveBmzRaw as writeBmzRaw } from "./lexiconStore.js";
import { FULL_LEXICON_MIN_TAGS } from "./constants.js";
import { decodeBmzInWorker } from "./lexiconWorker.js";

/** 当前默认词库（null = 尚未构建；删除持久化后回退内嵌精选就在下次取用时重建） */
let defaultLexicon: Lexicon | null = null;

/** 持久化词库是否存在（null = 尚未探测） */
let persistedPresent: boolean | null = null;

/** 记忆化的解码构建 Promise（并发/重复调用共享同一次） */
let loadPromise: Promise<Lexicon | null> | null = null;

/**
 * 持久化词库（写盘 + 同步"已持久化"标记）。
 * UI 只需对接这一个入口：写入成功后 UI 的惰性状态显示立刻变成"已持久化（待加载）"。
 */
export async function saveBmzRaw(buf: ArrayBuffer): Promise<void> {
    await writeBmzRaw(buf);
    persistedPresent = true;
}

export function getDefaultLexicon(): Lexicon {
    if (!defaultLexicon) {
        defaultLexicon = createLexicon({ builtinText: BUILTIN_DICT_RAW });
    }
    return defaultLexicon;
}

/** 直接设置默认词库；null 表示恢复内嵌默认（惰性重建）。 */
export function setDefaultLexicon(lex: Lexicon | null): void {
    defaultLexicon = lex;
}

/** 完整词库是否已在本会话构建完成。 */
export function isFullLexiconReady(): boolean {
    return !!defaultLexicon && defaultLexicon.allKeys.size > FULL_LEXICON_MIN_TAGS;
}

/**
 * 廉价探测持久化词库是否存在（只 count，不读 blob、不解密）。
 * 结果会被缓存，重复调用不再碰 IndexedDB。
 */
export async function hasPersistedLexicon(): Promise<boolean> {
    if (persistedPresent !== null) return persistedPresent;
    try {
        persistedPresent = await hasBmzRaw();
    }
    catch (err) {
        // 读库失败（隐私模式/占用等）：按"无持久化"处理，不抛
        console.warn("[image_st] 探测持久化词库失败:", err);
        persistedPresent = false;
    }
    return persistedPresent;
}

/** 词库是否已持久化到 IndexedDB（已持久化 → 刷新页面可按需恢复）。 */
export function isLexiconPersisted(): boolean {
    return persistedPresent === true;
}

/** 词库加载状态（UI 显示用）。 */
export type LexiconLoadState = "full" | "loading" | "persisted" | "builtin";

export function getLexiconLoadState(): LexiconLoadState {
    if (isFullLexiconReady()) return "full";
    if (loadPromise) return "loading";
    if (persistedPresent) return "persisted";
    return "builtin";
}

/** 解码 bmz → 构建完整 5 层 → 设为当前默认词库（导入与持久化恢复共用）。在 Worker 中执行。 */
export async function installFullLexicon(ab: ArrayBuffer): Promise<Lexicon> {
    const lex = await decodeBmzInWorker(ab);
    setDefaultLexicon(lex);
    return lex;
}

/**
 * 恢复 IndexedDB 里持久化的 词库.bmz（**惰性**：只在真正需要完整词库时调用）。
 * - 幂等：并发/重复调用共享同一次，不会重复解码构建；
 * - 无持久化或失败返回 null（不会抛），调用方安全降级到内嵌精选；
 * - 存储里的数据损坏时自动清除（以后不再每次加载空转）。
 * 在 Worker 中执行解码与索引构建，主线程不阻塞。
 */
export function restorePersistedLexicon(): Promise<Lexicon | null> {
    if (isFullLexiconReady()) return Promise.resolve(defaultLexicon);
    if (!loadPromise) {
        loadPromise = (async () => {
            try {
                const raw = await loadBmzRaw();
                if (!raw || raw.byteLength < 64) {
                    if (raw) await clearBmzRaw().catch(() => {}); // 空壳/脏数据 → 清掉
                    persistedPresent = false;
                    return null;
                }
                try {
                    const lex = await installFullLexicon(raw);
                    persistedPresent = true;
                    return lex;
                }
                catch (err) {
                    console.error("[image_st] 持久化词库解码失败，已清除（下次不再尝试）:", err);
                    await clearBmzRaw().catch(() => {});
                    persistedPresent = false;
                    return null;
                }
            }
            catch (err) {
                // 读库失败（隐私模式/占用等）：不抛、不清数据，本会话退回内嵌精选
                console.warn("[image_st] 读取持久化词库失败:", err);
                return null;
            }
        })();
    }
    return loadPromise;
}

/**
 * 按需确保完整词库可用：能拿到完整词库就返回它，拿不到就回退内嵌精选。
 * 首次调用会付出解码 + 建索引的代价（≈240ms / ≈94MB 堆），之后本会话复用。
 */
export async function ensureFullLexicon(): Promise<Lexicon> {
    const lex = await restorePersistedLexicon();
    return lex ?? getDefaultLexicon();
}

/** 移除持久化词库并把当前词库复位为内嵌精选。 */
export async function removePersistedLexicon(): Promise<void> {
    await clearBmzRaw();
    persistedPresent = false;
    loadPromise = null;
    setDefaultLexicon(null);
}
