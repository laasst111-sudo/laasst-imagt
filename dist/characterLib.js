// @ts-expect-error — resolved at runtime by ST
import { extension_settings } from "../../../../../scripts/extensions.js";
import { SETTINGS_KEY } from "./comfy.js";
import { buildAliasMap, findAliasesInText } from "./nameMatcher.js";
/* eslint-disable @typescript-eslint/no-explicit-any */
let cachedStatData = null;
let mvuAvailable = false;
let lastDataSource = null;
let refreshMvuPromise = null;
const MAX_DEPTH = 3;
const MAX_OUTPUT = 2000;
const BACKSCAN_LIMIT = 12;
export const MVU_WILDCARD = "*";
// ============================================================
// MVU 可用性与数据获取（v1.3 R1：latest → 回扫 → chat 三级回退链）
// ============================================================
async function waitMvuReady(timeoutMs = 10000) {
    if (typeof window.Mvu !== 'undefined' && typeof window.Mvu.getMvuData === 'function') {
        return true;
    }
    const intervalMs = 500;
    const maxAttempts = Math.ceil(timeoutMs / intervalMs);
    for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, intervalMs));
        if (typeof window.Mvu !== 'undefined' && typeof window.Mvu.getMvuData === 'function') {
            return true;
        }
    }
    return false;
}
function tryGetStatData(options) {
    try {
        const d = window.Mvu.getMvuData(options);
        if (d && typeof d.stat_data === 'object' && d.stat_data !== null && Object.keys(d.stat_data).length > 0) {
            return d.stat_data;
        }
    }
    catch { /* 单层失败不致命，走下一级回退 */ }
    return null;
}
function getChatLength() {
    try {
        const ctx = window.SillyTavern?.getContext?.();
        return Array.isArray(ctx?.chat) ? ctx.chat.length : 0;
    }
    catch {
        return 0;
    }
}
export async function refreshMvuData() {
    if (refreshMvuPromise)
        return refreshMvuPromise;
    refreshMvuPromise = (async () => {
        const s = extension_settings[SETTINGS_KEY] ?? {};
        if (!s.mvu_enabled) {
            cachedStatData = null;
            mvuAvailable = false;
            lastDataSource = null;
            return false;
        }
        const ready = await waitMvuReady();
        if (!ready) {
            mvuAvailable = false;
            cachedStatData = null;
            lastDataSource = null;
            return false;
        }
        // R1 回退链：latest → 从末尾回扫 ≤12 楼 → chat 级变量
        let sd = tryGetStatData({ type: 'message', message_id: 'latest' });
        let source = 'latest';
        if (!sd) {
            const len = getChatLength();
            for (let id = len - 1; id >= Math.max(0, len - BACKSCAN_LIMIT); id--) {
                sd = tryGetStatData({ type: 'message', message_id: id });
                if (sd) {
                    source = `msg:${id}`;
                    break;
                }
            }
        }
        if (!sd) {
            sd = tryGetStatData({ type: 'chat' });
            if (sd)
                source = 'chat';
        }
        if (!sd) {
            mvuAvailable = false;
            cachedStatData = null;
            lastDataSource = null;
            return false;
        }
        cachedStatData = sd;
        mvuAvailable = true;
        lastDataSource = source;
        return true;
    })();
    return refreshMvuPromise.finally(() => { refreshMvuPromise = null; });
}
export function clearMvuCache() {
    cachedStatData = null;
    mvuAvailable = false;
    lastDataSource = null;
}
export function isMvuAvailable() {
    return mvuAvailable && cachedStatData !== null;
}
export function getMvuData() {
    return cachedStatData;
}
export function getMvuStatus() {
    if (!mvuAvailable || !cachedStatData)
        return { available: false };
    const size = new TextEncoder().encode(JSON.stringify(cachedStatData)).length;
    return { available: true, size, source: lastDataSource ?? undefined };
}
/** MVU 系统字段前缀约定（$ 与 _ 均不参与匹配名段推断） */
function isSysKey(key) {
    return key.startsWith('$') || key.startsWith('_');
}
/**
 * 集合节点判定（六卡实测验证）：
 * 普通对象 + ≥2 子键 + ≥80% 子值为对象 + 子对象键集合相似度 ≥60%
 */
export function isCollectionNode(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return false;
    const kids = Object.values(value);
    if (kids.length < 2)
        return false;
    const objKids = kids.filter(v => v !== null && typeof v === 'object' && !Array.isArray(v));
    if (objKids.length / kids.length < 0.8)
        return false;
    const keySets = objKids.map(o => Object.keys(o));
    const union = new Set();
    keySets.forEach(ks => ks.forEach(k => union.add(k)));
    if (union.size === 0)
        return false;
    const avg = keySets.reduce((a, ks) => a + ks.length, 0) / keySets.length;
    return avg / union.size >= 0.6;
}
/**
 * 匹配名段推断：路径上首个"父节点是集合"的段即匹配名段。
 * 例如 ["人物","赵老六","外貌"] → 1；["主角","灵气"] → null（主角非集合成员）。
 * $ / _ 前缀段跳过。
 */
export function inferNameSegment(path, statData) {
    const data = statData ?? cachedStatData;
    if (!data || !path.length)
        return null;
    for (let i = 0; i < path.length; i++) {
        if (isSysKey(path[i]))
            continue;
        const parentVal = i === 0 ? data : resolveObjectPath(data, path.slice(0, i));
        if (isCollectionNode(parentVal))
            return i;
    }
    return null;
}
/**
 * 旧格式迁移：mvu_paths (string[][]) → mvu_selections (MvuSelection[])。
 * 旧语义"末段即角色名"迁移为 nameSegment = length - 1，行为不变。
 * 已存在 mvu_selections 时直接返回，不重复迁移；旧 mvu_paths 保留不删。
 */
export function migrateMvuPaths(s) {
    if (Array.isArray(s.mvu_selections)) {
        return s.mvu_selections.filter(sel => sel && Array.isArray(sel.path) && sel.path.length > 0);
    }
    const legacy = Array.isArray(s.mvu_paths) ? s.mvu_paths : [];
    const migrated = legacy
        .filter(p => Array.isArray(p) && p.length > 0)
        .map(p => ({ path: [...p], nameSegment: p.length - 1 }));
    s.mvu_selections = migrated;
    return migrated;
}
export function getMvuSelections() {
    const s = extension_settings[SETTINGS_KEY] ?? {};
    return migrateMvuPaths(s);
}
export function expandSelection(sel, statData) {
    const data = statData ?? cachedStatData;
    if (!data || !sel.path.length)
        return [];
    const results = [];
    const walk = (idx, cur, acc) => {
        if (idx === sel.path.length) {
            const name = sel.nameSegment !== null && sel.nameSegment < acc.length ? acc[sel.nameSegment] : null;
            results.push({ path: acc, name });
            return;
        }
        const seg = sel.path[idx];
        if (seg === MVU_WILDCARD) {
            if (cur === null || typeof cur !== 'object' || Array.isArray(cur))
                return;
            for (const k of Object.keys(cur)) {
                walk(idx + 1, cur[k], [...acc, k]);
            }
        }
        else {
            if (cur === null || typeof cur !== 'object')
                return;
            const next = cur[seg];
            if (next === undefined)
                return;
            walk(idx + 1, next, [...acc, seg]);
        }
    };
    walk(0, data, []);
    return results;
}
function buildTreeRecursive(data, parentPath) {
    if (data === null || data === undefined)
        return [];
    if (typeof data === 'object') {
        const entries = Object.entries(data);
        return entries.map(([key, val]) => {
            const currentPath = [...parentPath, key];
            const isBranch = typeof val === 'object' && val !== null;
            return {
                key,
                path: currentPath,
                type: isBranch ? 'branch' : 'leaf',
                children: isBranch ? buildTreeRecursive(val, currentPath) : [],
            };
        });
    }
    return [];
}
export function buildMvuTree() {
    if (!mvuAvailable || !cachedStatData)
        return [];
    return buildTreeRecursive(cachedStatData, []);
}
export function resolveObjectPath(obj, segments) {
    let current = obj;
    for (const key of segments) {
        if (current === null || current === undefined || typeof current !== 'object')
            return undefined;
        current = current[key];
    }
    return current;
}
// ============================================================
// 提取与格式化
// ============================================================
function flattenObject(obj, prefix, depth) {
    if (depth >= MAX_DEPTH)
        return [[prefix, "..."]];
    if (obj === null || obj === undefined)
        return [];
    if (typeof obj !== 'object')
        return [[prefix, String(obj)]];
    const result = [];
    const entries = Object.entries(obj);
    for (const [key, val] of entries) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (typeof val === 'object' && val !== null) {
            result.push(...flattenObject(val, fullKey, depth + 1));
        }
        else {
            const strVal = typeof val === 'string' ? val
                : typeof val === 'number' ? String(val)
                    : typeof val === 'boolean' ? (val ? "是" : "否")
                        : String(val ?? "");
            result.push([fullKey, strVal]);
        }
    }
    return result;
}
function formatResults(results) {
    if (!results.length)
        return "";
    const sorted = [...results].sort((a, b) => {
        const ap = a.segments.join(".");
        const bp = b.segments.join(".");
        return ap.localeCompare(bp);
    });
    const parts = [];
    let totalLen = 0;
    let truncated = false;
    for (const { segments, value } of sorted) {
        const label = segments.join(".");
        let entry;
        if (typeof value === 'object' && value !== null) {
            const flat = flattenObject(value, "", 0);
            const lines = flat.map(([k, v]) => `${k}:${v}`);
            // v2.2 统一格式：[标题] 键:值 键:值（单行，字段空格分隔）
            entry = `[${label}] ${lines.join(" ")}`;
        }
        else {
            const strVal = typeof value === 'string' ? value : String(value ?? "");
            entry = `[${label}] ${strVal}`;
        }
        if (totalLen + entry.length > MAX_OUTPUT) {
            truncated = true;
            break;
        }
        parts.push(entry);
        totalLen += entry.length;
    }
    if (truncated)
        parts.push("(已截断)");
    return parts.join("\n");
}
/**
 * v1.3 提取逻辑：
 * 1. 展开所有选择（含通配）→ 具体路径
 * 2. 祖先覆盖去重：路径 A 是 B 的严格前缀时丢弃 B（级联全选不产生重复输出）
 * 3. name = null 的项直接输出；name ≠ null 的项走别名匹配管道做正文门控
 * 4. 取值 + 格式化（MAX_OUTPUT 截断并标记）
 */
export function extractMvuInfoSegment(text, selections) {
    if (!cachedStatData || !text || !selections.length)
        return "";
    const s = extension_settings[SETTINGS_KEY] ?? {};
    if (!s.mvu_enabled)
        return "";
    // 1. 展开
    const expanded = selections.flatMap(sel => expandSelection(sel));
    if (!expanded.length)
        return "";
    // 2a. 相同路径精确去重（通配展开与具体选择可能撞车）：
    // 同一路径保留一条；name=null（直出）优先于 name≠null（门控）
    const seen = new Map();
    for (const e of expanded) {
        const key = JSON.stringify(e.path);
        const prev = seen.get(key);
        if (!prev || (prev.name !== null && e.name === null)) {
            seen.set(key, e);
        }
    }
    const uniqueExpanded = Array.from(seen.values());
    // 2b. 祖先覆盖去重
    const allPaths = uniqueExpanded.map(e => e.path);
    const deduped = uniqueExpanded.filter((e, i) => !allPaths.some((other, j) => j !== i && other.length < e.path.length && other.every((seg, k) => seg === e.path[k])));
    // 3. 正文匹配
    const direct = deduped.filter(e => e.name === null);
    const gated = deduped.filter(e => e.name !== null);
    const matchedNames = new Set();
    if (gated.length > 0) {
        const nameLabels = new Map();
        for (const e of gated)
            nameLabels.set(e.name, e.name);
        const aliasMap = buildAliasMap(nameLabels);
        for (const id of findAliasesInText(text, aliasMap)) {
            matchedNames.add(id);
        }
    }
    const finalItems = [...direct, ...gated.filter(e => e.name !== null && matchedNames.has(e.name))];
    // 4. 取值 + 格式化
    const resolved = finalItems
        .map(e => ({ segments: e.path, value: resolveObjectPath(cachedStatData, e.path) }))
        .filter(r => r.value !== undefined);
    return formatResults(resolved);
}
