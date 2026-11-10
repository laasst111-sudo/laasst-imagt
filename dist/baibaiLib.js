// ============================================================
// baibaiLib.ts —— 柏宝书（ST-BaiBai-Book）只读信息源
// 职责：读取公开 API 快照 → 本地重算分档（角色在场 / 物品可达 / 场景链）
//       → 构建三组勾选树 → 产出三段注入文本
//
// 边界（与柏宝书【自定义变量系统】的差异）：
//   - 本模块**只消费【角色】功能**：主角档案 / NPC 名册 / 场景 / 物品
//     这些是柏宝书记忆引擎按剧情维护的**结构化、带语义**的派生数据。
//   - 柏宝书的**自定义变量（vars）** 是用户/预设自建的通用 KV 树
//     （如「关系.爱丽丝.好感度」），无固定 schema，可能与角色名册重复或与画面无关。
//     本模块**完全不读取 vars**，也不调用 getVar。
//
// 分档口径：柏宝书公开 API 不暴露 presence / 物品可达结论（MemNpc 无该字段），
//   故此处按插件内部同一套规则**本地重算**（important / follow / location↔场景树路径关系）。
//   插件升级改了口径时需同步此处；面板允许人工纠正勾选作为兜底。
// ============================================================
/* eslint-disable @typescript-eslint/no-explicit-any */
import { matchesNameVariant } from "./nameMatcher.js";
/**
 * 设置访问器（注入式）。
 * 本模块不静态导入 ST 运行时模块，便于离线单测直接 import 编译产物。
 * 由 index.ts / ui.ts 在初始化时调用 configureBaibai() 注入。
 */
let settingsProvider = () => ({});
export function configureBaibai(provider) {
    settingsProvider = provider;
}
function settings() {
    try {
        return settingsProvider() ?? {};
    }
    catch {
        return {};
    }
}
export const BBS_ROLE_TIER_LABEL = {
    protagonist: "主角",
    main: "主要角色",
    present: "在场",
    nearby: "同区域",
    absent: "不在场",
};
export const BBS_ITEM_TIER_LABEL = {
    carried: "随身",
    reachable: "在场可取",
    elsewhere: "他处寄存",
};
export const BBS_SCENE_TIER_LABEL = {
    current: "当前地点",
    ancestor: "上级地点",
    other: "其他地点",
};
export const BBS_ROLE_FIELDS = [
    { key: "gender", label: "性别", def: true },
    { key: "age", label: "年龄", def: true },
    { key: "title", label: "身份", def: true },
    { key: "desc", label: "外貌", def: true },
    { key: "outfit", label: "着装", def: true },
    { key: "condition", label: "状态", def: true },
    { key: "personality", label: "性格", def: false },
    { key: "relation", label: "关系", def: false },
    { key: "ties", label: "人际", def: false },
    { key: "affinity", label: "好感", def: false },
    { key: "location", label: "所在", def: false },
];
export const BBS_SCENE_FIELDS = [
    { key: "desc", label: "地点描述", def: true },
    { key: "time", label: "当前时间", def: true },
    { key: "situation", label: "当前局面", def: false },
    { key: "participants", label: "在场名单", def: false },
];
export const BBS_ITEM_FIELDS = [
    { key: "desc", label: "物品描述", def: true },
    { key: "qty", label: "数量", def: false },
    { key: "location", label: "存放地", def: false },
];
export function getBbsSelection() {
    const s = settings();
    const raw = (s.bbs_selection ?? {});
    return {
        roles: raw.roles && typeof raw.roles === "object" ? raw.roles : {},
        scenes: raw.scenes && typeof raw.scenes === "object" ? raw.scenes : {},
        items: raw.items && typeof raw.items === "object" ? raw.items : {},
    };
}
/**
 * 某条目的已勾选字段。
 * 语义与 MVU / 数据库面板一致：**只认显式勾选** —— 未勾选即不注入，
 * 不做隐式默认（否则会出现「界面没勾也照样注入」的错位）。
 */
export function getSelectedFields(stored, key) {
    const explicit = stored[key];
    return Array.isArray(explicit) ? explicit : [];
}
/** 默认字段（视觉相关），供「按默认勾选」一键设置使用 */
export function defaultFieldKeys(defs) {
    return defs.filter(d => d.def).map(d => d.key);
}
export function getBbsStaleSelections() {
    const snap = cachedSnapshot;
    if (!snap)
        return [];
    const sel = getBbsSelection();
    const stale = [];
    const check = (kind, map, exists) => {
        for (const [key, fields] of Object.entries(map)) {
            if (!Array.isArray(fields) || fields.length === 0)
                continue;
            if (!exists(key))
                stale.push({ kind, key, fields: fields.length });
        }
    };
    check("role", sel.roles, key => key === "__protagonist__" || snap.npcs.some(n => n.name === key));
    check("scene", sel.scenes, key => key === "__location__" || snap.scenes.some(s => s.id === key));
    check("item", sel.items, key => snap.items.some(i => i.name === key));
    return stale;
}
// --------------------------------------------------
// 快照读取
// --------------------------------------------------
let cachedSnapshot = null;
let bbsAvailable = false;
let refreshPromise = null;
function getApi() {
    const api = globalThis.STBaiBaiBook;
    if (!api || typeof api.getSnapshot !== "function")
        return null;
    return api;
}
/** 等待柏宝书公开接口就绪（先查全局，未就绪则监听 ready 事件） */
export async function waitBaiBaiReady(timeoutMs = 10000) {
    if (getApi())
        return true;
    const intervalMs = 250;
    const maxAttempts = Math.ceil(timeoutMs / intervalMs);
    for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, intervalMs));
        if (getApi())
            return true;
    }
    return false;
}
function toSnapshot(raw) {
    const npcs = Array.isArray(raw?.npcs) ? raw.npcs : [];
    const scenes = Array.isArray(raw?.scenes) ? raw.scenes : [];
    const items = Array.isArray(raw?.items) ? raw.items : [];
    const focus = raw?.state?.sceneFocus ?? null;
    return {
        revision: Number(raw?.revision ?? 0),
        chatId: raw?.chat?.id ?? null,
        coverageComplete: raw?.coverage?.complete !== false,
        missingAiFloors: Array.isArray(raw?.coverage?.missingAiFloors) ? raw.coverage.missingAiFloors : [],
        time: String(raw?.state?.time ?? ""),
        location: String(raw?.state?.location ?? ""),
        locationPath: Array.isArray(raw?.state?.locationPath) ? raw.state.locationPath.map(String) : [],
        situation: String(focus?.situation ?? ""),
        participants: Array.isArray(focus?.participants) ? focus.participants.map(String) : [],
        protagonist: {
            gender: raw?.protagonist?.gender,
            age: raw?.protagonist?.age,
            identity: raw?.protagonist?.identity,
            appearance: raw?.protagonist?.appearance,
            outfit: raw?.protagonist?.outfit,
            condition: raw?.protagonist?.condition,
        },
        npcs,
        scenes,
        items,
    };
}
export async function refreshBaibaiData() {
    if (refreshPromise)
        return refreshPromise;
    refreshPromise = (async () => {
        const s = settings();
        if (!s.bbs_enabled) {
            cachedSnapshot = null;
            bbsAvailable = false;
            return false;
        }
        const api = getApi();
        if (!api) {
            bbsAvailable = false;
            cachedSnapshot = null;
            return false;
        }
        try {
            const raw = api.getSnapshot();
            if (!raw || typeof raw !== "object") {
                cachedSnapshot = null;
                bbsAvailable = false;
                return false;
            }
            cachedSnapshot = toSnapshot(raw);
            bbsAvailable = true;
            return true;
        }
        catch {
            // 无聊天 / 未就绪：降级为不可用，不抛出
            cachedSnapshot = null;
            bbsAvailable = false;
            return false;
        }
    })();
    return refreshPromise.finally(() => { refreshPromise = null; });
}
export function clearBaibaiCache() {
    cachedSnapshot = null;
    bbsAvailable = false;
}
export function getBaibaiSnapshot() {
    return cachedSnapshot;
}
export function isBaibaiAvailable() {
    return bbsAvailable && cachedSnapshot !== null;
}
export function getBaibaiStatus() {
    if (!bbsAvailable || !cachedSnapshot)
        return { available: false };
    return {
        available: true,
        characters: cachedSnapshot.npcs.length,
        scenes: cachedSnapshot.scenes.length,
        items: cachedSnapshot.items.length,
        coverage: cachedSnapshot.coverageComplete,
        missing: cachedSnapshot.missingAiFloors.length,
    };
}
// --------------------------------------------------
// 分档计算（本地重算柏宝书同款判定）
// --------------------------------------------------
function normPath(s) {
    return String(s ?? "").replace(/[\uFE0E\uFE0F]/g, "").trim().toLowerCase();
}
/** 地名双向包含（命名粗细不一的兜底，与插件 sceneNameReachable 同口径） */
function nameReachable(a, b) {
    const x = String(a ?? "").trim();
    const y = String(b ?? "").trim();
    if (!x || !y)
        return false;
    return x.includes(y) || y.includes(x);
}
/** 场景路径键（规范化后以 '/' 连接，与插件 sceneId 同构） */
function scenePathKey(path) {
    return (path ?? []).map(normPath).filter(Boolean).join("/");
}
/** 定位当前场景节点 —— 对齐插件 findCurrentSceneId：
 *  ① locationPath 权威定位（取最长存在前缀）
 *  ② 模糊兜底（本级名 或 完整路径串 双向包含，取最深）
 */
export function findCurrentScene(scenes, here, locationPath) {
    if (!scenes.length)
        return null;
    const lp = (locationPath ?? []).map(normPath).filter(Boolean);
    for (let depth = lp.length; depth >= 1; depth--) {
        const key = lp.slice(0, depth).join("/");
        const hit = scenes.find(sc => scenePathKey(sc.path) === key);
        if (hit)
            return hit;
    }
    const h = String(here ?? "").trim();
    if (!h)
        return null;
    let best = null;
    for (const sc of scenes) {
        const hit = nameReachable(sc.name, h) || nameReachable((sc.path ?? []).join(""), h);
        if (hit && (!best || (sc.path?.length ?? 0) > (best.path?.length ?? 0)))
            best = sc;
    }
    return best;
}
/** 场景路径相对关系（与插件 sceneRelation 同口径）：same / near / far */
export function sceneRelation(pPath, nPath) {
    const p = pPath ?? [];
    const q = nPath ?? [];
    const min = Math.min(p.length, q.length);
    let common = 0;
    while (common < min && normPath(p[common]) === normPath(q[common]))
        common++;
    if (common === p.length && common === q.length)
        return "same";
    if (common === q.length)
        return p.length - q.length === 1 ? "near" : "far";
    if (common === p.length)
        return "near";
    return p.length - common === 1 ? "near" : "far";
}
/** 当前场景的祖先链（由粗到细，含当前节点） */
export function sceneChain(scenes, current) {
    if (!current)
        return [];
    const byId = new Map(scenes.map(s => [s.id, s]));
    const chain = [];
    const seen = new Set();
    let cur = current;
    while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        chain.unshift(cur);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return chain;
}
/**
 * 把自由文本地点解析成场景节点（对齐插件 resolveSceneLocationId）：
 * 从根往下逐层找「名字出现在地点串里」的子节点；同名并列则放弃。
 */
function resolveSceneLocation(scenes, location) {
    const key = normPath(location ?? "");
    if (!key || !scenes.length)
        return null;
    const byParent = new Map();
    for (const sc of scenes) {
        const parent = sc.parentId ?? "";
        const list = byParent.get(parent) ?? [];
        list.push(sc);
        byParent.set(parent, list);
    }
    const bestChild = (children) => {
        const hits = children.filter(s => normPath(s.name) && key.includes(normPath(s.name)));
        if (!hits.length)
            return null;
        const bestLen = normPath(hits[0].name).length;
        const tied = hits.filter(s => normPath(s.name).length === bestLen);
        return tied.length === 1 ? tied[0] : null;
    };
    let cur = bestChild(byParent.get("") ?? []);
    if (!cur) {
        const candidates = scenes.filter(s => normPath(s.name) && key.includes(normPath(s.name)));
        if (!candidates.length)
            return null;
        const bestLen = Math.max(...candidates.map(s => normPath(s.name).length));
        const tied = candidates.filter(s => normPath(s.name).length === bestLen);
        return tied.length === 1 ? tied[0] : null;
    }
    for (;;) {
        const next = bestChild(byParent.get(cur.id) ?? []);
        if (!next)
            break;
        cur = next;
    }
    return cur;
}
/** 路径是否以某前缀开头（祖先链判定） */
function pathStartsWith(path, prefix) {
    if (!prefix.length || prefix.length > path.length)
        return false;
    return prefix.every((seg, i) => normPath(seg) === normPath(path[i]));
}
/** 角色分档（对齐插件 classifyNpcPresence + 注入端「主要角色单列」口径） */
export function classifyRoleTier(npc, scenes, here, locationPath) {
    if (npc.important)
        return "main";
    if (npc.follow === true)
        return "present";
    const cur = findCurrentScene(scenes, here, locationPath);
    if (!cur)
        return nameReachable(npc.location, here) ? "present" : "absent";
    // NPC 所在地同样解析成节点后比路径（与插件一致：此处不传 locationPath）
    const n = findCurrentScene(scenes, npc.location ?? "", []);
    if (!n)
        return nameReachable(npc.location, here) ? "present" : "absent";
    const rel = sceneRelation(cur.path ?? [], n.path ?? []);
    return rel === "same" ? "present" : rel === "near" ? "nearby" : "absent";
}
/** 物品可达（对齐插件 itemReachableAtScene）：随身，或存放地是当前节点的祖先或自身 */
export function isItemReachable(item, scenes, here, locationPath) {
    if (item.carried !== false)
        return true;
    const cur = findCurrentScene(scenes, here, locationPath);
    if (!cur)
        return nameReachable(item.location, here);
    const itemScene = resolveSceneLocation(scenes, item.location);
    if (!itemScene)
        return false;
    return pathStartsWith(cur.path ?? [], itemScene.path ?? []);
}
/** 分档是否默认纳入注入（白名单：主要角色 + 在场 + 当前地点链 + 可达物品） */
export function tierIncluded(tier) {
    switch (tier) {
        case "main":
        case "present":
        case "current":
        case "ancestor":
        case "carried":
        case "reachable":
        case "protagonist":
            return true;
        default:
            return false;
    }
}
export function buildBaibaiTree() {
    const snap = cachedSnapshot;
    if (!snap)
        return { roles: [], scenes: [], items: [] };
    const { scenes } = snap;
    const here = snap.location;
    const locPath = snap.locationPath;
    // ---- 角色 ----
    const roleGroups = {
        protagonist: [], main: [], present: [], nearby: [], absent: [],
    };
    const hasProtagonist = Object.values(snap.protagonist).some(v => v !== undefined && String(v).trim() !== "");
    if (hasProtagonist) {
        roleGroups.protagonist.push({
            key: "__protagonist__",
            kind: "role",
            group: BBS_ROLE_TIER_LABEL.protagonist,
            label: "主角",
            hint: snap.protagonist.identity,
            fields: BBS_ROLE_FIELDS,
        });
    }
    for (const npc of snap.npcs) {
        const tier = classifyRoleTier(npc, scenes, here, locPath);
        roleGroups[tier].push({
            key: npc.name,
            kind: "role",
            group: BBS_ROLE_TIER_LABEL[tier],
            label: npc.name,
            hint: npc.title || npc.location || "",
            fields: BBS_ROLE_FIELDS,
        });
    }
    // ---- 场景 ----
    const cur = findCurrentScene(scenes, here, locPath);
    const chain = sceneChain(scenes, cur);
    const chainIds = new Set(chain.map(s => s.id));
    const sceneGroups = { current: [], ancestor: [], other: [] };
    for (const sc of scenes) {
        const tier = cur && sc.id === cur.id ? "current"
            : chainIds.has(sc.id) ? "ancestor"
                : "other";
        sceneGroups[tier].push({
            key: sc.id,
            kind: "scene",
            group: BBS_SCENE_TIER_LABEL[tier],
            label: (sc.path ?? [sc.name]).join(" › "),
            hint: sc.desc,
            fields: BBS_SCENE_FIELDS,
        });
    }
    // 当前地点与祖先链若未落在场景树上（柏宝书未记录该地点），用 state.location 兜底成一条
    if (!cur && snap.location) {
        sceneGroups.current.push({
            key: "__location__",
            kind: "scene",
            group: BBS_SCENE_TIER_LABEL.current,
            label: snap.location,
            hint: "未在场景树中记录",
            fields: BBS_SCENE_FIELDS,
        });
    }
    // ---- 物品 ----
    const itemGroups = { carried: [], reachable: [], elsewhere: [] };
    for (const it of snap.items) {
        const reachable = isItemReachable(it, scenes, here, locPath);
        const tier = it.carried !== false ? "carried" : reachable ? "reachable" : "elsewhere";
        itemGroups[tier].push({
            key: it.name,
            kind: "item",
            group: BBS_ITEM_TIER_LABEL[tier],
            label: it.name,
            hint: it.desc || it.location || "",
            fields: BBS_ITEM_FIELDS,
        });
    }
    const mkGroups = (order, src, labels) => order.map(tier => ({
        id: tier,
        label: labels[tier],
        included: tierIncluded(tier),
        note: tier === "protagonist" ? "非 POV 场景注入" : undefined,
        nodes: src[tier] ?? [],
    })).filter(g => g.nodes.length > 0);
    return {
        roles: mkGroups(["protagonist", "main", "present", "nearby", "absent"], roleGroups, BBS_ROLE_TIER_LABEL),
        scenes: mkGroups(["current", "ancestor", "other"], sceneGroups, BBS_SCENE_TIER_LABEL),
        items: mkGroups(["carried", "reachable", "elsewhere"], itemGroups, BBS_ITEM_TIER_LABEL),
    };
}
// --------------------------------------------------
// 注入抽取
// --------------------------------------------------
const BBS_MAX_OUTPUT = 2000;
function oneLine(v) {
    return String(v ?? "").replace(/\s*[\r\n]+\s*/g, " ").trim();
}
function ageText(npc) {
    return oneLine(npc.age);
}
function affinityText(npc) {
    const inner = npc.affinityInner;
    const outer = npc.affinityOuter;
    if (inner === undefined && outer === undefined)
        return "";
    const lvl = (v) => {
        if (v === null || v === undefined)
            return "未知";
        return ["强烈反感", "不喜欢", "无明显好恶", "有好感", "感情深厚"][v + 2] ?? "未知";
    };
    const parts = [];
    if (inner !== undefined && inner !== null)
        parts.push(`内心:${lvl(inner)}`);
    if (outer !== undefined && outer !== null)
        parts.push(`外在:${lvl(outer)}`);
    const note = oneLine(npc.affinityNote);
    if (note)
        parts.push(note);
    return parts.join(" / ");
}
function roleFieldValue(npc, key) {
    switch (key) {
        case "gender": return oneLine(npc.gender);
        case "age": return ageText(npc);
        case "title": return oneLine(npc.title);
        case "desc": return oneLine(npc.desc);
        case "outfit": return oneLine(npc.outfit);
        case "condition": return oneLine(npc.condition);
        case "personality": return oneLine(npc.personality);
        case "relation": return oneLine(npc.relation);
        case "ties": return oneLine(npc.ties);
        case "affinity": return affinityText(npc);
        case "location": return oneLine(npc.location);
        default: return "";
    }
}
function protagonistFieldValue(p, key) {
    switch (key) {
        case "gender": return oneLine(p.gender);
        case "age": return oneLine(p.age);
        case "title": return oneLine(p.identity);
        case "desc": return oneLine(p.appearance);
        case "outfit": return oneLine(p.outfit);
        case "condition": return oneLine(p.condition);
        default: return "";
    }
}
function sceneFieldValue(snap, sc, key) {
    switch (key) {
        case "desc": return oneLine(sc?.desc);
        case "time": return oneLine(snap.time);
        case "situation": return oneLine(snap.situation);
        case "participants": return snap.participants.map(oneLine).filter(Boolean).join("、");
        default: return "";
    }
}
function itemFieldValue(it, key) {
    switch (key) {
        case "desc": return oneLine(it.desc);
        case "qty": return typeof it.qty === "number" ? String(it.qty) : "";
        case "location": return oneLine(it.location);
        default: return "";
    }
}
/**
 * 产出三段注入文本。
 * 白名单：主要角色 + 在场角色（+ POV 主角）；当前地点与祖先链；随身/可达物品。
 * 同区域 / 不在场 / 其他地点 / 他处物品默认排除（由设置项开启）。
 */
export function extractBaibaiSegments(text, opts = {}) {
    const empty = { roles: "", scenes: "", items: "", protagonist: "" };
    const s = settings();
    if (!s.bbs_enabled)
        return empty;
    const snap = cachedSnapshot;
    if (!snap)
        return empty;
    const sel = getBbsSelection();
    const tree = buildBaibaiTree();
    const { scenes } = snap;
    let total = 0;
    let truncated = false;
    const take = (entry) => {
        if (truncated)
            return false;
        if (total + entry.length > BBS_MAX_OUTPUT) {
            truncated = true;
            return false;
        }
        total += entry.length;
        return true;
    };
    // ---- 角色 ----
    const roleParts = [];
    const protagonistParts = [];
    for (const group of tree.roles) {
        const tier = group.id;
        const allow = tierIncluded(tier) ||
            (tier === "nearby" && opts.includeNearby === true) ||
            (tier === "absent" && opts.includeAbsent === true);
        if (!allow)
            continue;
        for (const node of group.nodes) {
            if (opts.nameGate && text) {
                if (!matchesNameVariant(text, node.label))
                    continue;
            }
            const selected = new Set(getSelectedFields(sel.roles, node.key));
            if (selected.size === 0)
                continue;
            const npc = snap.npcs.find(n => n.name === node.key);
            const fields = [];
            for (const f of BBS_ROLE_FIELDS) {
                if (!selected.has(f.key))
                    continue;
                const val = node.key === "__protagonist__"
                    ? protagonistFieldValue(snap.protagonist, f.key)
                    : npc ? roleFieldValue(npc, f.key) : "";
                if (!val)
                    continue;
                fields.push(`${f.label}:${val}`);
            }
            if (!fields.length)
                continue;
            const entry = `[${node.label}] ${fields.join(" ")}`;
            if (!take(entry))
                break;
            if (node.key === "__protagonist__")
                protagonistParts.push(entry);
            else
                roleParts.push(entry);
        }
    }
    // ---- 场景 ----
    const sceneParts = [];
    for (const group of tree.scenes) {
        const tier = group.id;
        const allow = tierIncluded(tier) || (tier === "other" && opts.includeOtherScenes === true);
        if (!allow)
            continue;
        for (const node of group.nodes) {
            const sc = scenes.find(x => x.id === node.key) ?? null;
            const selected = new Set(getSelectedFields(sel.scenes, node.key));
            if (selected.size === 0)
                continue;
            const fields = [];
            for (const f of BBS_SCENE_FIELDS) {
                if (!selected.has(f.key))
                    continue;
                // 时间 / 局面 / 在场名单属于「当前场景」这一条，不在每个地点重复输出
                if (tier !== "current" && (f.key === "time" || f.key === "situation" || f.key === "participants"))
                    continue;
                const val = sceneFieldValue(snap, sc, f.key);
                if (!val)
                    continue;
                fields.push(`${f.label}:${val}`);
            }
            if (!fields.length)
                continue;
            const entry = `[${node.label}] ${fields.join(" ")}`;
            if (!take(entry))
                break;
            sceneParts.push(entry);
        }
    }
    // ---- 物品 ----
    const itemParts = [];
    for (const group of tree.items) {
        const tier = group.id;
        const allow = tierIncluded(tier) || (tier === "elsewhere" && opts.includeDistantItems === true);
        if (!allow)
            continue;
        for (const node of group.nodes) {
            const it = snap.items.find(x => x.name === node.key);
            if (!it)
                continue;
            const selected = new Set(getSelectedFields(sel.items, node.key));
            if (selected.size === 0)
                continue;
            const fields = [];
            for (const f of BBS_ITEM_FIELDS) {
                if (!selected.has(f.key))
                    continue;
                const val = itemFieldValue(it, f.key);
                if (!val)
                    continue;
                fields.push(`${f.label}:${val}`);
            }
            if (!fields.length)
                continue;
            const entry = `[${node.label}] ${fields.join(" ")}`;
            if (!take(entry))
                break;
            itemParts.push(entry);
        }
    }
    // 压缩格式：每个条目一行，条目间单换行
    return {
        roles: roleParts.join("\n"),
        scenes: sceneParts.join("\n"),
        items: itemParts.join("\n"),
        protagonist: protagonistParts.join("\n"),
    };
}
