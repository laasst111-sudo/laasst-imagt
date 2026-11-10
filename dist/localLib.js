// @ts-expect-error — ST provides this module at runtime
import { getContext } from "../../../../../scripts/st-context.js";
// @ts-expect-error — ST provides this module at runtime
import { eventSource, event_types, getRequestHeaders } from "../../../../../script.js";
// @ts-expect-error — ST provides this module at runtime
import { extension_settings } from "../../../../../scripts/extensions.js";
import { SETTINGS_KEY } from "./comfy.js";
import { logger } from "./logger.js";
import { deepClone } from "./utils.js";
import { matchesNameVariant } from "./nameMatcher.js";
import { fsRead, fsWrite, fsDelete } from "./storage.js";
/* eslint-disable @typescript-eslint/no-explicit-any */
// ============================================================
// v1.8 本地角色库 — 核心模块
// 职责：世界书条目选择、分段、LLM 提取、合并、持久化、注入
// ============================================================
// --------------------------------------------------
// 常量与配置
// --------------------------------------------------
export const CHUNK_STRATEGY = {
    MERGE: 'merge',
    PER_ENTRY: 'per_entry',
};
export const LOCAL_LIBRARY_CONFIG = {
    llamaUrl: 'http://127.0.0.1:8080',
    apiEndpoint: '/v1/chat/completions',
    model: 'qwen3.5-4b',
    chunkTokens: 12000,
    maxOutputTokens: 8096,
    temperature: 0.6,
    topP: 0.8,
    topK: 20,
    repeatPenalty: 1.05,
    storageBase: 'user/data/image-st/local-characters/',
    requestTimeoutMs: 3600000,
    maxRetries: 3,
    retryDelays: [5000, 10000, 20000],
    chunkStrategy: CHUNK_STRATEGY.MERGE,
};
// 在线 API 配置（当全局 LLM 配置存在时使用）
const ONLINE_API_TIMEOUT_MS = 300000; // 5 分钟
function getBuildLLMConfig(apiSourceOverride) {
    const s = extension_settings?.[SETTINGS_KEY] ?? {};
    const apiSource = apiSourceOverride || s.local_build_api_source || 'auto';
    if (apiSource === 'local') {
        return {
            url: LOCAL_LIBRARY_CONFIG.llamaUrl + LOCAL_LIBRARY_CONFIG.apiEndpoint,
            apiKey: '',
            model: LOCAL_LIBRARY_CONFIG.model,
            isOnline: false,
        };
    }
    if (apiSource === 'online') {
        const onlineUrl = s.llm_url;
        if (!onlineUrl) {
            throw new Error('未配置在线 API 地址，请在 LLM 配置中设置 llm_url');
        }
        return {
            url: onlineUrl,
            apiKey: s.apiKey || '',
            model: s.llm_model || LOCAL_LIBRARY_CONFIG.model,
            isOnline: true,
        };
    }
    // auto: 跟随全局设置
    if (s.llm_url) {
        return {
            url: s.llm_url,
            apiKey: s.apiKey || '',
            model: s.llm_model || LOCAL_LIBRARY_CONFIG.model,
            isOnline: true,
        };
    }
    return {
        url: LOCAL_LIBRARY_CONFIG.llamaUrl + LOCAL_LIBRARY_CONFIG.apiEndpoint,
        apiKey: '',
        model: LOCAL_LIBRARY_CONFIG.model,
        isOnline: false,
    };
}
// CORS 回退 fetch：直接请求失败时走 ST 服务端代理
async function llmFetchWithCorsFallback(url, options) {
    try {
        return await fetch(url, options);
    }
    catch (err) {
        if (!(err instanceof TypeError))
            throw err;
        const proxyOpts = { ...options };
        delete proxyOpts.signal;
        if (options.headers instanceof Headers) {
            proxyOpts.headers = Object.fromEntries(options.headers.entries());
        }
        const proxyResp = await fetch(`/proxy/${encodeURIComponent(url)}`, proxyOpts);
        if (!proxyResp.ok) {
            throw new Error(`LLM 连接失败（通过代理）: ${proxyResp.status}`);
        }
        return proxyResp;
    }
}
export function buildExtractionSystemPrompt(nsfw) {
    const nsfwCoreRule = nsfw
        ? '\n核心DNA（NSFW 身体槽位）：胸部、乳晕、乳头、腰胯臀、私处'
        : '';
    const nsfwClothingRule = nsfw
        ? '\n服装DNA（NSFW 内衣槽位）：内衣上身、内衣下身'
        : '';
    const nsfwCoreJson = nsfw
        ? ',"胸部":[],"乳晕":[],"乳头":[],"腰胯臀":[],"私处":[]'
        : '';
    const nsfwClothingJson = nsfw
        ? ',"内衣上身":[],"内衣下身":[]'
        : '';
    return `你是「酒馆角色卡世界书角色信息抽取器」。
**唯一任务**：从当前世界书片段中提取角色的生图视觉信息，输出一个严格的 JSON 对象。
不做任何解释、翻译、总结，不输出 JSON 以外的任何文字。

==================== 核心原则 ====================
- 原文明确描述的内容准确提取；原文未提及的，服装可按职业/身份/场景合理推测，其余视觉特征可据上下文补全。
- 只提取「眼睛能直接看到」的信息。禁止提取心理、情绪、声音、气味、温度、数值、技能、超能力、修为、关系、剧情等非视觉内容。
- 每个角色必须有「角色姓名」「角色昵称」「名称详情」。
- 昵称全量抓取：别名、外号、称呼、称号、代号、敬称、蔑称、乳名、简称、异写。
- 所有固定槽位每个角色都必须出现，缺省填 "none" 或 "unknown"，严禁省略槽位、严禁编造。

==================== 角色识别 ====================
1. 扫描所有人物称呼（姓名、姓氏、外号、称号、职位/亲属称呼、代号、英文名等）。
2. 普通代词（他/她/它）不视为角色姓名，除非已固化为称号。
3. 有明确姓名时用该姓名作为「角色姓名」；无姓名但有稳定称谓（如"红发女人"）用该称谓作为「角色姓名」，并将「名称状态」设为"代称"。
4. 同一角色多个称呼必须合并；无法判断归属的写入「歧义与冲突」。
5. 仅有视觉描述但无姓名或稳定称谓的，放入「未命名视觉实体」。

==================== 固定槽位（核心DNA / 服装DNA）====================
每个角色输出两组固定槽位，字段名严格一致，全部为字符串数组（短语列表）。

核心DNA（视觉身体特征，每个槽位都要出现，缺省 ["none"]）：
性别、年龄、发色、挑染、发型、发长、瞳色、眼型、脸型、面部特征、身高、体型、肩宽、肤色肤质、手部、标记、非人特征、常态表情${nsfwCoreRule}
- 身高/体型/肩宽/肤色肤质/手部 属于身体特征，必须尽可能填全。
- 标记：疤痕、纹身、痣、伤痕；非人特征：耳、尾、翼、角、异瞳等可见特征；常态表情：惯常可见面部状态（如"眯眼笑"）。无则 ["none"]。

服装DNA（服装固定层级，由外到内，每个槽位都要出现，缺省 ["none"]）：
妆容、外套、内搭、下装、鞋袜、配件${nsfwClothingRule}
- 每件衣物必须写成一句完整、固定的短语，格式严格为「颜色+材质/款式+服装名」，三者缺一不可。示例："黑色皮质夹克"、"白色雪纺长裙"、"深蓝色牛仔裤"、"棕色高帮皮靴"、"酒红色天鹅绒连衣裙"。
- 颜色必须明确到具体色系（黑/白/红/藏青/墨绿/米白/驼色/酒红/灰蓝 等），禁止只写"深色/浅色/彩色/纯色"等模糊词。原文有颜色用原文；原文未提颜色时，必须按职业/身份/场景推断一个合理且固定的颜色，保证同角色每次生图一致，不得留空。
- 材质/款式必须写明（皮质/雪纺/蕾丝/牛仔/针织/呢料/丝绸/天鹅绒、夹克/风衣/连衣裙/衬衫/短裙/长裤/靴/鞋 等），禁止只写"衣服/裤子/鞋/裙子"这类无颜色无款式的泛词。
- 同一角色在全文中的常服应保持一致：优先提取其最典型、最稳定的固定着装，跨段落只保留一套主服装，避免不同段落出现互相冲突的衣物。
- 配件只抓随身固有配饰（发饰/项链/戒指/耳环/眼镜/帽子/围巾/腰带/胸针/发带/发夹），同样要求「颜色+材质/款式」；不抓武器/工具/临时手持物/背包。
- 服饰推测：医生→"白色医用白大褂"、学生→"深蓝色学生校服"、军人→"军绿色军装"、贵族→"酒红色天鹅绒贵族礼服"；确无依据时填 ["none"]。

==================== 输出 JSON 结构 ====================
必须输出且仅输出如下 JSON（顶层字段固定）：
{
  "段落ID": "",
  "提及锚点扫描": [],
  "角色列表": [
    {
      "角色姓名": "",
      "角色昵称": [],
      "名称状态": "正名/代称/未命名",
      "名称详情": {"全名":[],"别名":[],"外号":[],"称号":[],"称谓":[],"代号":[],"其他写法":[]},
      "核心DNA": {"性别":[],"年龄":[],"发色":[],"挑染":[],"发型":[],"发长":[],"瞳色":[],"眼型":[],"脸型":[],"面部特征":[],"身高":[],"体型":[],"肩宽":[],"肤色肤质":[],"手部":[],"标记":[],"非人特征":[],"常态表情":[]${nsfwCoreJson}},
      "服装DNA": {"妆容":[],"外套":[],"内搭":[],"下装":[],"鞋袜":[],"配件":[]${nsfwClothingJson}}
    }
  ],
  "歧义与冲突": [{"类型":"","内容":"","说明":""}]
}

==================== 最终约束 ====================
- 只输出上述 JSON，无任何额外字符。
- 所有固定槽位每个角色都要出现，缺省 ["none"]。
- 优先保证角色姓名、昵称、核心DNA、服装DNA。`;
}
// 提取指令（作为 user message 发送）
export const EXTRACTION_INSTRUCTION = `请严格按照系统提示提取角色信息。世界书文本：
"""
{chunk_text}
"""`;
// ============================================================
// v1.9：固定槽位 schema（核心DNA / 服装DNA）
// 数据表驱动：sanitize / merge / inject 均遍历这些槽位，
// 新增槽位只需在此追加，逻辑代码不动。
// ============================================================
export const CORE_DNA_BASE_SLOTS = [
    '性别', '年龄', '发色', '挑染', '发型', '发长', '瞳色', '眼型',
    '脸型', '面部特征', '身高', '体型', '肩宽', '肤色肤质', '手部',
    '标记', '非人特征', '常态表情',
];
export const CORE_DNA_NSFW_SLOTS = ['胸部', '乳晕', '乳头', '腰胯臀', '私处'];
export const CLOTHING_DNA_BASE_SLOTS = ['妆容', '外套', '内搭', '下装', '鞋袜', '配件'];
export const CLOTHING_DNA_NSFW_SLOTS = ['内衣上身', '内衣下身'];
/** 读取 NSFW 开关（设置项 nsfw_enabled，默认 false） */
function nsfwEnabled() {
    const s = extension_settings?.[SETTINGS_KEY] ?? {};
    return s.nsfw_enabled === true;
}
/** 当前生效的核心DNA槽位（含 NSFW） */
function activeCoreDnaSlots() {
    return [...CORE_DNA_BASE_SLOTS, ...(nsfwEnabled() ? CORE_DNA_NSFW_SLOTS : [])];
}
/** 当前生效的服装DNA槽位（含 NSFW） */
function activeClothingDnaSlots() {
    return [...CLOTHING_DNA_BASE_SLOTS, ...(nsfwEnabled() ? CLOTHING_DNA_NSFW_SLOTS : [])];
}
// --------------------------------------------------
// 构建模式：与现有库合并
// --------------------------------------------------
/**
 * 将新构建的角色列表与现有库合并。
 * 追加合并模式专用。
 */
export function mergeWithExistingLibrary(existing, newCharacters) {
    if (!existing || !existing.characters || existing.characters.length === 0) {
        return newCharacters;
    }
    const charMap = new Map();
    const order = [];
    for (const char of existing.characters) {
        const nameKey = getCharacterNameKey(char);
        if (!nameKey)
            continue;
        charMap.set(nameKey, deepClone(char));
        order.push(nameKey);
    }
    for (const char of newCharacters) {
        const nameKey = getCharacterNameKey(char);
        if (!nameKey)
            continue;
        if (charMap.has(nameKey)) {
            mergeCharacters(charMap.get(nameKey), char);
        }
        else {
            charMap.set(nameKey, deepClone(char));
            order.push(nameKey);
        }
    }
    return order.map(k => charMap.get(k)).filter((c) => c !== undefined);
}
// --------------------------------------------------
// 全局状态
// --------------------------------------------------
let buildLock = false;
let buildAbortController = null;
let currentBuildingCharName = null;
let currentBuildingWorldbookName = null;
// --------------------------------------------------
// 工具函数：文件名清理与路径安全
// --------------------------------------------------
const ILLEGAL_CHARS = /[\\/:*?"<>|+&=%#\s]/g;
const RESERVED_NAMES = new Set([
    'CON', 'PRN', 'AUX', 'NUL',
    'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
    'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);
export function sanitizeFilename(name, kind = 'worldbook') {
    const cleaned = name.trim().replace(ILLEGAL_CHARS, '-').replace(/\.\./g, '.');
    const upper = cleaned.toUpperCase();
    if (!cleaned || RESERVED_NAMES.has(upper)) {
        return kind === 'character' ? 'unnamed_character' : 'unnamed_worldbook';
    }
    if (cleaned.startsWith('/') || cleaned.includes('..')) {
        return kind === 'character' ? 'unnamed_character' : 'unnamed_worldbook';
    }
    return cleaned;
}
export function getCharStorageDir(charName) {
    const safeCharName = sanitizeFilename(charName, 'character');
    return `${LOCAL_LIBRARY_CONFIG.storageBase}${encodeURIComponent(safeCharName)}/`;
}
export function getWorldbookStorageDir(charName, worldbookName) {
    const safeCharName = sanitizeFilename(charName, 'character');
    const safeWbName = sanitizeFilename(worldbookName, 'worldbook');
    return `${LOCAL_LIBRARY_CONFIG.storageBase}${encodeURIComponent(safeCharName)}/libraries/${encodeURIComponent(safeWbName)}/`;
}
export function getChunksDir(charName, worldbookName) {
    return `${getWorldbookStorageDir(charName, worldbookName)}chunks/`;
}
// 校验路径是否在允许的基础目录内
export function isPathSafe(baseDir, targetPath) {
    const resolvedBase = resolvePath(baseDir);
    const resolvedTarget = resolvePath(targetPath);
    return resolvedTarget.startsWith(resolvedBase + '/') || resolvedTarget === resolvedBase;
}
function resolvePath(p) {
    // 简单的路径解析，不依赖 Node.js path 模块
    const parts = p.split('/').filter(Boolean);
    const stack = [];
    for (const part of parts) {
        if (part === '..') {
            stack.pop();
        }
        else if (part !== '.') {
            stack.push(part);
        }
    }
    return '/' + stack.join('/');
}
// --------------------------------------------------
// 工具函数：存储后端（/api/files 磁盘 API → IndexedDB 兜底）
// 磁盘文件以扁平化 ist_<hash>_<basename> 命名（服务端 name 仅允许 [a-zA-Z0-9_\-.]，
// 不支持子目录/中文/点开头，因此把逻辑相对路径哈希为扁平文件名）。
// IndexedDB 替代 localStorage，解决 iOS 5MB 配额限制。
// --------------------------------------------------
let diskApiAvailable = null;
// 逻辑相对路径 → 磁盘扁平文件名
// 新命名格式：ist_<charHash>_<wbHash>_<basename>
// 同一角色的文件有统一前缀，可按角色名排序快速定位
function shortHash(name) {
    let h = 0x811c9dc5;
    for (let i = 0; i < name.length; i++) {
        h = ((h ^ name.charCodeAt(i)) * 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0').slice(0, 6);
}
function extractNameParts(filePath) {
    const parts = filePath.split('/').filter(Boolean);
    const baseIdx = parts.indexOf('local-characters');
    if (baseIdx >= 0 && baseIdx + 1 < parts.length) {
        const charName = parts[baseIdx + 1];
        const wbName = parts[baseIdx + 3] ?? charName;
        return { charHash: shortHash(charName), wbHash: shortHash(wbName) };
    }
    return { charHash: shortHash(filePath), wbHash: shortHash(filePath) };
}
function toDiskFileName(filePath) {
    const { charHash, wbHash } = extractNameParts(filePath);
    const baseName = (filePath.split('/').pop() ?? '')
        .replace(/[^a-zA-Z0-9._-]/g, '')
        .replace(/^\.+/, '')
        .slice(0, 30) || 'bin';
    return `ist_${charHash}_${wbHash}_${baseName}`;
}
// 尝试探测磁盘 API 是否可用（本版 ST 必有 /api/files/upload）
async function probeDiskApi() {
    if (diskApiAvailable !== null)
        return diskApiAvailable;
    try {
        const resp = await fetch('/api/files/sanitize-filename', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ fileName: 'probe.bin' }),
        });
        diskApiAvailable = resp.ok;
    }
    catch {
        diskApiAvailable = false;
    }
    if (!diskApiAvailable)
        console.warn('[image_st_local] /api/files 不可用，降级为 IndexedDB 后端');
    return diskApiAvailable;
}
function utf8ToBase64(text) {
    return btoa(unescape(encodeURIComponent(text)));
}
// 磁盘写入：POST /api/files/upload（服务端 writeFileSyncAtomic 原子写）
async function fsWriteDisk(filePath, content) {
    try {
        const resp = await fetch('/api/files/upload', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                name: toDiskFileName(filePath),
                data: utf8ToBase64(content),
            }),
        });
        if (!resp.ok) {
            const detail = await resp.text().catch(() => '');
            console.warn('[image_st_local] disk upload failed:', resp.status, detail.slice(0, 120));
            return false;
        }
        fsWrite(filePath, content);
        return true;
    }
    catch (err) {
        console.warn('[image_st_local] disk upload error:', err);
        return false;
    }
}
// 磁盘读取：GET /user/files/<name>
async function readFromDisk(filePath) {
    try {
        const resp = await fetch(`/user/files/${toDiskFileName(filePath)}`);
        if (!resp.ok)
            return null;
        return await resp.text();
    }
    catch {
        return null;
    }
}
// 磁盘删除：POST /api/files/delete
async function deleteFromDisk(filePath) {
    try {
        await fetch('/api/files/delete', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ path: `user/files/${toDiskFileName(filePath)}` }),
        });
    }
    catch { /* ignore */ }
}
async function readFileText(filePath) {
    if (await probeDiskApi()) {
        const diskRaw = await readFromDisk(filePath);
        if (diskRaw !== null)
            return diskRaw;
    }
    return fsRead(filePath);
}
// 统一写入口：磁盘优先，失败自动降级到内存+IndexedDB
async function writeFileText(filePath, content) {
    if (await probeDiskApi()) {
        const ok = await fsWriteDisk(filePath, content);
        if (ok)
            return true;
        fsWrite(filePath, content);
        return true;
    }
    fsWrite(filePath, content);
    return true;
}
// 统一删入口
async function deleteFileText(filePath) {
    if (await probeDiskApi()) {
        await deleteFromDisk(filePath);
    }
    fsDelete(filePath);
}
// --------------------------------------------------
// 工具函数：JSON 读写
// --------------------------------------------------
async function safeReadJson(filePath, fallback) {
    try {
        const raw = await readFileText(filePath);
        if (raw === null)
            return fallback;
        return JSON.parse(raw);
    }
    catch {
        return fallback;
    }
}
async function safeWriteJson(filePath, data) {
    try {
        if (!isPathSafe(LOCAL_LIBRARY_CONFIG.storageBase, filePath)) {
            console.error('[image_st_local] path traversal blocked:', filePath);
            return false;
        }
        const json = JSON.stringify(data, null, 2);
        return await writeFileText(filePath, json);
    }
    catch (err) {
        console.error('[image_st_local] write failed:', err);
        return false;
    }
}
// 原子写入：磁盘 API 服务端本身原子写；localStorage 后端无原子语义，直接落内存
async function atomicWriteJson(filePath, data) {
    if (!isPathSafe(LOCAL_LIBRARY_CONFIG.storageBase, filePath)) {
        console.error('[image_st_local] path traversal blocked (atomic):', filePath);
        return false;
    }
    return safeWriteJson(filePath, data);
}
// --------------------------------------------------
// 工具函数：日志
// --------------------------------------------------
async function appendErrorLog(chunksDir, message) {
    const logPath = `${chunksDir}error_log.txt`;
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const line = `[${timestamp}] ${message}\n`;
    try {
        let existing = '';
        if (await probeDiskApi()) {
            existing = (await readFromDisk(logPath)) ?? '';
        }
        else {
            existing = (await fsRead(logPath)) ?? '';
        }
        await writeFileText(logPath, existing + line);
    }
    catch { /* ignore */ }
}
async function loadLibraryIndex(charName) {
    const path = `${getCharStorageDir(charName)}.index.json`;
    return safeReadJson(path, { version: 2, libraries: [] });
}
async function saveLibraryIndex(charName, index) {
    const path = `${getCharStorageDir(charName)}.index.json`;
    return atomicWriteJson(path, index);
}
export async function updateLibraryIndex(charName, worldbookName, library, totalChunks = 0, completedChunks = 0) {
    const index = await loadLibraryIndex(charName);
    if (library && library.status === 'completed') {
        const existing = index.libraries.findIndex(l => l.charName === charName && l.worldbookName === worldbookName);
        const entry = {
            charName,
            worldbookName,
            builtAt: library.builtAt,
            status: 'completed',
            totalChunks: totalChunks || library.totalChunks,
            completedChunks,
            characterCount: library.characters.length,
            filePrefix: `ist_${shortHash(charName)}_${shortHash(worldbookName)}`,
        };
        if (existing >= 0) {
            index.libraries[existing] = entry;
        }
        else {
            index.libraries.push(entry);
        }
    }
    else {
        index.libraries = index.libraries.filter(l => !(l.charName === charName && l.worldbookName === worldbookName));
    }
    await saveLibraryIndex(charName, index);
}
export async function getLibraryIndex(charName) {
    return loadLibraryIndex(charName);
}
// 旧版数据结构检测（v1.9 之前使用 基础身份/外观/服装系统/配饰/细粒度标签）
export function isLegacyCharacter(char) {
    return !(char && typeof char === 'object' &&
        char.核心DNA && typeof char.核心DNA === 'object' &&
        char.服装DNA && typeof char.服装DNA === 'object');
}
// --------------------------------------------------
// 条目选择持久化 + 库/选择结果缓存（v1.9.1 性能）
// 失效化：构建成功 / 选择保存 / 清库 都会 bump libraryMutationVersion，
// 使 loadAllCompletedLibraries / loadEntrySelection 的缓存失效并重读磁盘。
// --------------------------------------------------
let libraryMutationVersion = 0;
let entrySelectionCache = null;
let libraryLoadCache = null;
function bumpLibraryMutationVersion() {
    libraryMutationVersion++;
}
export async function loadEntrySelection(charName) {
    if (entrySelectionCache && entrySelectionCache.charName === charName && entrySelectionCache.version === libraryMutationVersion) {
        return entrySelectionCache.selection;
    }
    const dir = getCharStorageDir(charName);
    const path = `${dir}entry_selection.json`;
    const selection = await safeReadJson(path, { charName, selections: [], lastUpdated: new Date().toISOString() });
    entrySelectionCache = { charName, version: libraryMutationVersion, selection };
    return selection;
}
export async function saveEntrySelection(charName, data) {
    const dir = getCharStorageDir(charName);
    await atomicWriteJson(`${dir}dir_marker.json`, {});
    const path = `${dir}entry_selection.json`;
    const ok = await atomicWriteJson(path, data);
    if (ok)
        bumpLibraryMutationVersion();
    return ok;
}
// --------------------------------------------------
// 世界书数据获取
// --------------------------------------------------
const EMBEDDED_SUFFIX = ' [内嵌]';
export function getWorldInfoNames() {
    try {
        const ctx = getContext();
        const names = ctx.getWorldInfoNames?.() ?? [];
        logger.debug('[LocalLib] getWorldInfoNames:', names);
        return names;
    }
    catch {
        return [];
    }
}
export function getEmbeddedWorldbooks(charName) {
    try {
        const ctx = getContext();
        const characters = ctx.characters;
        if (!characters || !Array.isArray(characters))
            return [];
        // st-context 暴露的是 characterId（= this_chid），部分旧版上下文可能仍用 this_chid
        const chid = ctx.characterId ?? ctx.this_chid;
        let charData = chid != null ? characters[chid] : undefined;
        // characterId 不可用时，按角色名兜底匹配
        if (!charData && charName) {
            const found = characters.find((c) => c && (c.name === charName || c.name2 === charName));
            if (found) {
                charData = found;
                logger.debug('[LocalLib] getEmbeddedWorldbooks matched charData by name:', charName);
            }
        }
        if (!charData)
            return [];
        logger.debug('[LocalLib] getEmbeddedWorldbooks charData keys:', Object.keys(charData));
        const candidates = [
            charData.data?.worldbook,
            charData.extensions?.worldbook,
            charData.data?.character_book,
            charData.character_book,
        ];
        const embedded = candidates.find(Boolean);
        if (!embedded || !Array.isArray(embedded.entries))
            return [];
        const entries = embedded.entries
            .filter((e) => e && typeof e.content === 'string' && e.content.trim())
            .map((e) => ({
            id: String(e.id ?? ''),
            content: String(e.content ?? '').trim(),
            order: Number(e.order ?? 0),
        }));
        if (entries.length === 0)
            return [];
        // 返回角色名（不带 [内嵌] 后缀，后缀由 UI 层负责拼接）
        return [{ name: charName, entries }];
    }
    catch (e) {
        console.warn('[LocalLib] getEmbeddedWorldbooks failed:', e);
        return [];
    }
}
export async function getWorldInfoEntries(worldName, fallbackEntries) {
    const normalize = (entries) => {
        if (Array.isArray(entries)) {
            return entries.map((e) => ({
                id: String(e.id ?? e.uid ?? ''),
                content: String(e.content ?? ''),
                enabled: Boolean(e.enabled ?? true),
                order: Number(e.order ?? e.insertion_order ?? 0),
            }));
        }
        if (entries && typeof entries === 'object') {
            // 兼容对象形式：key 为 "0"、"1"… 或大整数字符串 uid，条目值本身不含 id，以 key 作为 id
            return Object.entries(entries).map(([key, e]) => ({
                id: String(e?.id ?? e?.uid ?? key ?? ''),
                content: String(e?.content ?? ''),
                enabled: Boolean(e?.enabled ?? true),
                order: Number(e?.order ?? e?.insertion_order ?? 0),
            }));
        }
        return [];
    };
    try {
        const ctx = getContext();
        // 优先走新版 ST 的 loadWorldInfo API（st-context 已暴露，数据按需加载）。
        // 注意：内嵌世界书名不属于外部世界书，loadWorldInfo 可能返回 { entries: {} } 空对象，
        // 此时需继续回退到 fallbackEntries（内嵌缓存）。
        if (typeof ctx.loadWorldInfo === 'function') {
            const data = await ctx.loadWorldInfo(worldName);
            if (data && data.entries != null) {
                const normalized = normalize(data.entries);
                if (normalized.length > 0) {
                    return normalized;
                }
            }
        }
        // 兼容旧版 ST：ctx.world_info?.[worldName]
        const worldData = ctx.world_info?.[worldName];
        if (worldData && worldData.entries != null) {
            const normalized = normalize(worldData.entries);
            if (normalized.length > 0) {
                return normalized;
            }
        }
        if (fallbackEntries && Array.isArray(fallbackEntries)) {
            return fallbackEntries.map((e) => ({
                id: String(e.id ?? ''),
                content: String(e.content ?? ''),
                enabled: true,
                order: Number(e.order ?? 0),
            }));
        }
        return [];
    }
    catch {
        return [];
    }
}
export function isEmbeddedWorldbookName(name) {
    return name.endsWith(EMBEDDED_SUFFIX);
}
export function stripEmbeddedSuffix(name) {
    if (isEmbeddedWorldbookName(name)) {
        return name.slice(0, -EMBEDDED_SUFFIX.length);
    }
    return name;
}
// 从正文中筛选与当前对话相关的世界书
export function selectRelevantLibraries(text, libraries, selections) {
    if (!text || libraries.length <= 1)
        return libraries;
    const normalizedText = normalizeForMatch(text);
    const scored = libraries.map((lib) => {
        const sel = selections.find((s) => stripEmbeddedSuffix(s.worldbookName) === stripEmbeddedSuffix(lib.worldbookName));
        const keywords = sel?.keywords ?? [];
        const keywordList = Array.isArray(keywords)
            ? keywords
            : typeof keywords === 'string'
                ? keywords.split(/[,，、\s]+/).filter(Boolean)
                : [];
        // 关键词未配置时：不参与关键词匹配，但仍参与角色名匹配
        if (keywordList.length === 0) {
            // 检查库内角色名是否出现在正文中，有则纳入（v2.x 收紧：词边界+去单字）
            const hasCharMatch = lib.characters.some(char => {
                const variants = getAllNameVariants(char);
                return variants.some(v => matchesNameVariant(text, v));
            });
            return { lib, score: hasCharMatch ? 1 : 0 };
        }
        const matchedKeywords = keywordList.filter((kw) => {
            const nk = normalizeForMatch(kw);
            return nk.length > 0 && normalizedText.includes(nk);
        });
        const score = matchedKeywords.length * (sel?.priority ?? 1);
        return { lib, score };
    });
    const relevant = scored.filter((s) => s.score > 0).map((s) => s.lib);
    // 无任何命中时：只注入第一个库（不再全量注入，避免多角色场景污染）
    return relevant.length > 0 ? relevant : [libraries[0]];
}
function buildChunksMerge(entries, chunkSize) {
    const chunks = [];
    let currentEntryIds = [];
    let currentText = '';
    let currentTokens = 0;
    let chunkIndex = 0;
    for (const entry of entries) {
        // 中文平均约 1.5 字符/token（比英文 4 字符/token 密集），取保守值 1.5 避免超出上下文窗口。
        // 同时预留 system prompt（约 2500 token）+ user message wrapper，
        // 实际 chunk 上限设为 chunkSize * 0.75 以留安全边距。
        const entryTokens = Math.ceil(entry.content.length / 1.5);
        const safeChunkSize = Math.floor(chunkSize * 0.75);
        if (currentEntryIds.length > 0 && currentTokens + entryTokens > safeChunkSize) {
            chunks.push({
                index: chunkIndex++,
                text: currentText.trim(),
                entryIds: [...currentEntryIds],
                tokenCount: currentTokens,
            });
            currentEntryIds = [];
            currentText = '';
            currentTokens = 0;
        }
        currentEntryIds.push(entry.id);
        currentText += (currentText ? '\n\n' : '') + entry.content;
        currentTokens += entryTokens;
    }
    if (currentEntryIds.length > 0) {
        chunks.push({
            index: chunkIndex++,
            text: currentText.trim(),
            entryIds: [...currentEntryIds],
            tokenCount: currentTokens,
        });
    }
    return chunks;
}
export function buildChunksPerEntry(entries) {
    return entries.map((entry, index) => ({
        index,
        text: entry.content,
        entryIds: [entry.id],
        tokenCount: Math.ceil(entry.content.length / 1.5),
        isPerEntry: true,
        entryId: entry.id,
    }));
}
export function buildChunks(entries, chunkSize, strategy = CHUNK_STRATEGY.MERGE) {
    if (strategy === CHUNK_STRATEGY.PER_ENTRY) {
        return buildChunksPerEntry(entries);
    }
    return buildChunksMerge(entries, chunkSize);
}
// --------------------------------------------------
// LLM 调用（支持本地 llama.cpp + 在线 API）
// --------------------------------------------------
async function callGenericLLM(messages, signal, apiSourceOverride) {
    const { url, apiKey, model, isOnline } = getBuildLLMConfig(apiSourceOverride);
    const timeoutMs = isOnline ? ONLINE_API_TIMEOUT_MS : LOCAL_LIBRARY_CONFIG.requestTimeoutMs;
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(new DOMException('请求超时', 'TimeoutError')), timeoutMs);
    if (signal) {
        if (signal.aborted) {
            clearTimeout(timeoutId);
            throw new DOMException('请求被中止', 'AbortError');
        }
        signal.addEventListener('abort', () => ctrl.abort(signal.reason), { once: true });
    }
    try {
        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }
        const body = {
            model,
            messages,
            max_tokens: LOCAL_LIBRARY_CONFIG.maxOutputTokens,
            temperature: LOCAL_LIBRARY_CONFIG.temperature,
            top_p: LOCAL_LIBRARY_CONFIG.topP,
            stream: false,
        };
        // 本地 llama.cpp 特有参数
        if (!isOnline) {
            body.top_k = LOCAL_LIBRARY_CONFIG.topK;
            body.repeat_penalty = LOCAL_LIBRARY_CONFIG.repeatPenalty;
            // llama.cpp OpenAI 兼容 API 不支持 thinking 参数（由聊天模板自行控制）
        }
        else {
            // 仅在线 API 支持 thinking 参数
            const thinkingEnabled = extension_settings?.[SETTINGS_KEY]?.local_thinking_enabled === true;
            body.thinking = { type: thinkingEnabled ? 'enabled' : 'disabled' };
        }
        const resp = await llmFetchWithCorsFallback(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: ctrl.signal,
        });
        clearTimeout(timeoutId);
        if (!resp.ok) {
            const detail = await resp.text().catch(() => '');
            throw new Error(`LLM HTTP ${resp.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
        }
        const data = await resp.json();
        let content = data.choices?.[0]?.message?.content ?? '';
        if (!content.trim()) {
            const reasoning = data.choices?.[0]?.message?.reasoning_content ?? '';
            if (reasoning.trim()) {
                console.warn('[LocalLib] content 为空，使用 reasoning_content 作为回复内容');
                content = reasoning;
            }
        }
        if (!content.trim()) {
            throw new Error('LLM 返回空内容');
        }
        return content.trim();
    }
    catch (err) {
        clearTimeout(timeoutId);
        if (ctrl.signal.aborted) {
            const reason = ctrl.signal.reason;
            const isUserCancel = reason instanceof DOMException && reason.name === 'AbortError';
            throw new Error(isUserCancel ? '请求被用户中止' : '请求超时');
        }
        throw err instanceof Error ? err : new Error(String(err));
    }
}
async function callLlamaWithRetry(messages, retryCount, signal, apiSourceOverride) {
    const delays = LOCAL_LIBRARY_CONFIG.retryDelays;
    const attemptsLeft = Math.max(1, LOCAL_LIBRARY_CONFIG.maxRetries - retryCount);
    for (let attempt = 0; attempt < attemptsLeft; attempt++) {
        if (signal?.aborted)
            throw new Error('请求被用户中止');
        if (attempt > 0) {
            const delay = delays[Math.min(attempt - 1, delays.length - 1)];
            await new Promise(r => setTimeout(r, delay));
        }
        try {
            return await callGenericLLM(messages, signal, apiSourceOverride);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('用户中止'))
                throw err;
            const isRetryable = msg.includes('Failed to fetch') ||
                msg.includes('NetworkError') ||
                msg.includes('HTTP 5') ||
                msg.includes('HTTP 429') ||
                msg.includes('请求超时');
            if (attempt < attemptsLeft - 1 && isRetryable) {
                console.warn(`[LocalLib] chunk 调用失败（attempt ${attempt + 1}/${attemptsLeft}），${delays[Math.min(attempt, delays.length - 1)]}ms 后重试：${msg}`);
                continue;
            }
            throw err;
        }
    }
    throw new Error(`LLM 请求在 ${attemptsLeft} 次尝试后失败`);
}
// --------------------------------------------------
// JSON 解析与容错
// --------------------------------------------------
function tryExtractJson(raw) {
    const trimmed = raw.trim();
    if (!trimmed)
        return null;
    if (trimmed[0] === '{' || trimmed[0] === '[')
        return trimmed;
    const start = trimmed.search(/[{[]/);
    if (start < 0)
        return null;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < trimmed.length; i++) {
        const ch = trimmed[i];
        if (escape) {
            escape = false;
            continue;
        }
        if (ch === '\\') {
            escape = true;
            continue;
        }
        if (ch === '"') {
            inString = !inString;
            continue;
        }
        if (inString)
            continue;
        if (ch === '{' || ch === '[')
            depth++;
        else if (ch === '}' || ch === ']')
            depth--;
        if (depth === 0)
            return trimmed.substring(start, i + 1);
    }
    return null;
}
function parseLLMResponse(raw) {
    // 剥离 markdown 代码块
    let cleaned = raw.replace(/```json\b/gi, '').replace(/```/g, '').trim();
    // 剥离 qwen3 思考标签：答案...思考 或 /think 前缀行
    // 模型有时把推理混在输出里，JSON 在思考块之后
    cleaned = cleaned.replace(/思考[\s\S]*?<\/think>/gi, '').trim();
    // /think 单行前缀（部分 qwen3 配置）
    cleaned = cleaned.replace(/^\/think\s*/i, '').trim();
    const jsonStr = tryExtractJson(cleaned);
    if (!jsonStr)
        return null;
    try {
        const parsed = JSON.parse(jsonStr);
        // 基本结构校验
        if (typeof parsed !== 'object' || parsed === null)
            return null;
        if (!Array.isArray(parsed.角色列表))
            parsed.角色列表 = [];
        if (!Array.isArray(parsed.提及锚点扫描))
            parsed.提及锚点扫描 = [];
        if (!Array.isArray(parsed.歧义与冲突))
            parsed.歧义与冲突 = [];
        if (typeof parsed.段落ID !== 'string')
            parsed.段落ID = '';
        return parsed;
    }
    catch {
        return null;
    }
}
// 深层数据清洗：防止 LLM 返回非标准格式导致 [object Object]
function sanitizeCharacterData(parsed) {
    if (!Array.isArray(parsed.角色列表))
        return parsed;
    parsed.角色列表 = parsed.角色列表.map((char) => {
        const 名称详情 = char?.名称详情 || {};
        return {
            角色姓名: String(char?.角色姓名 ?? ''),
            角色昵称: Array.isArray(char?.角色昵称) ? char.角色昵称.map(String) : [],
            名称状态: String(char?.名称状态 ?? ''),
            名称详情: {
                全名: Array.isArray(名称详情.全名) ? 名称详情.全名.map(String) : [],
                别名: Array.isArray(名称详情.别名) ? 名称详情.别名.map(String) : [],
                外号: Array.isArray(名称详情.外号) ? 名称详情.外号.map(String) : [],
                称号: Array.isArray(名称详情.称号) ? 名称详情.称号.map(String) : [],
                称谓: Array.isArray(名称详情.称谓) ? 名称详情.称谓.map(String) : [],
                代号: Array.isArray(名称详情.代号) ? 名称详情.代号.map(String) : [],
                其他写法: Array.isArray(名称详情.其他写法) ? 名称详情.其他写法.map(String) : [],
            },
            核心DNA: sanitizeDna(char?.核心DNA, activeCoreDnaSlots()),
            服装DNA: sanitizeDna(char?.服装DNA, activeClothingDnaSlots()),
        };
    });
    return parsed;
}
/** 按固定槽位白名单清洗 DNA，缺失槽位补空数组，未在白名单内的字段一律丢弃；容忍 LLM 输出字符串/数值（包装为单元素数组） */
function sanitizeDna(dna, slots) {
    const result = {};
    const src = (dna && typeof dna === 'object' && !Array.isArray(dna)) ? dna : {};
    for (const slot of slots) {
        const v = src[slot];
        if (v == null) {
            result[slot] = [];
        }
        else if (Array.isArray(v)) {
            result[slot] = v.map(String);
        }
        else if (typeof v === 'object') {
            result[slot] = [];
        }
        else {
            result[slot] = [String(v)];
        }
    }
    return result;
}
// --------------------------------------------------
// 进度管理
// --------------------------------------------------
export async function loadProgress(charName, worldbookName) {
    const dir = getWorldbookStorageDir(charName, worldbookName);
    const path = `${dir}progress.json`;
    return safeReadJson(path, {
        charName,
        worldbookName,
        totalChunks: 0,
        completedChunks: [],
        failedChunks: [],
        retryCount: 0,
        chunkSize: LOCAL_LIBRARY_CONFIG.chunkTokens,
        chunkStrategy: LOCAL_LIBRARY_CONFIG.chunkStrategy,
        startedAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        status: 'idle',
    });
}
export async function saveProgress(charName, worldbookName, progress) {
    const dir = getWorldbookStorageDir(charName, worldbookName);
    const path = `${dir}progress.json`;
    progress.lastUpdated = new Date().toISOString();
    return atomicWriteJson(path, progress);
}
// --------------------------------------------------
// 构建流程
// --------------------------------------------------
export function isBuildLocked() {
    return buildLock;
}
export function getCurrentBuildingTarget() {
    if (!buildLock || !currentBuildingCharName || !currentBuildingWorldbookName)
        return null;
    return { charName: currentBuildingCharName, worldbookName: currentBuildingWorldbookName };
}
export function cancelBuild() {
    // 注意：不要把引用置空，构建循环内部仍会访问 signal
    // （buildAbortController 实例在 executeBuild 的 finally 中才置空）
    if (buildAbortController) {
        buildAbortController.abort();
    }
}
async function createBuildLock(charName, worldbookName) {
    const libDir = getWorldbookStorageDir(charName, worldbookName);
    const lockPath = `${libDir}build_lock.json`;
    const lockData = {
        charName,
        worldbookName,
        startedAt: new Date().toISOString(),
        pid: typeof window !== 'undefined' ? window.process?.pid ?? 0 : 0,
    };
    return atomicWriteJson(lockPath, lockData);
}
async function removeBuildLock(charName, worldbookName) {
    const libDir = getWorldbookStorageDir(charName, worldbookName);
    const lockPath = `${libDir}build_lock.json`;
    try {
        await deleteFileText(lockPath);
    }
    catch { /* ignore */ }
}
async function updateProgressStatus(charName, worldbookName, updater) {
    const current = await loadProgress(charName, worldbookName);
    const updated = updater(current);
    await saveProgress(charName, worldbookName, updated);
    return updated;
}
export async function executeBuild(charName, worldbookName, entryIds, fallbackEntries, onProgress, options) {
    if (buildLock) {
        return { success: false, worldbookName, characters: [], totalChunks: 0, completedChunks: 0, failedChunks: [], error: '已有构建任务在进行中' };
    }
    // 检查持久化锁文件（支持清理异常中断遗留的陈旧锁）
    const libDirForLock = getWorldbookStorageDir(charName, worldbookName);
    const lockData = await safeReadJson(`${libDirForLock}build_lock.json`, null);
    if (lockData !== null) {
        const progress = await loadProgress(charName, worldbookName);
        const STALE_LOCK_MS = 5 * 60 * 1000;
        const lastActiveRaw = progress?.lastUpdated || lockData.startedAt || '';
        const lastActiveMs = Date.parse(lastActiveRaw);
        const isFresh = progress?.status === 'in_progress' && Number.isFinite(lastActiveMs) && Date.now() - lastActiveMs < STALE_LOCK_MS;
        if (isFresh) {
            return { success: false, worldbookName, characters: [], totalChunks: 0, completedChunks: 0, failedChunks: [], error: '已有构建任务在进行中（文件锁）' };
        }
        // 陈旧锁（上次构建异常中断）：清理后继续
        console.warn('[LocalLib] 检测到陈旧的构建锁，自动清理后继续。', { lockData, progressStatus: progress?.status });
        await removeBuildLock(charName, worldbookName);
    }
    buildLock = true;
    buildAbortController = new AbortController();
    currentBuildingCharName = charName;
    currentBuildingWorldbookName = worldbookName;
    // 创建文件锁
    await createBuildLock(charName, worldbookName);
    try {
        const chunksDir = getChunksDir(charName, worldbookName);
        const libDir = getWorldbookStorageDir(charName, worldbookName);
        // 确保目录存在（通过写入占位文件）
        await atomicWriteJson(`${chunksDir}dir_marker.json`, {});
        await atomicWriteJson(`${libDir}dir_marker.json`, {});
        // 获取条目（内嵌世界书使用 fallback）
        const allEntries = await getWorldInfoEntries(worldbookName, fallbackEntries);
        const selectedEntries = allEntries
            .filter(e => entryIds.includes(e.id))
            .sort((a, b) => a.order - b.order);
        if (selectedEntries.length === 0) {
            await removeBuildLock(charName, worldbookName);
            return { success: false, worldbookName, characters: [], totalChunks: 0, completedChunks: 0, failedChunks: [], error: '未选择任何有效条目' };
        }
        // 初始化/恢复进度（先加载进度以获取已保存的分段策略）
        let progress = await loadProgress(charName, worldbookName);
        const buildMode = options?.mode ?? 'merge';
        let chunkStrategy;
        let chunks;
        let totalChunks;
        // 覆盖重建模式：清除旧进度和 chunk 结果，从头开始
        if (buildMode === 'overwrite') {
            chunkStrategy = options?.chunkStrategy ?? LOCAL_LIBRARY_CONFIG.chunkStrategy;
            chunks = buildChunks(selectedEntries, LOCAL_LIBRARY_CONFIG.chunkTokens, chunkStrategy);
            totalChunks = chunks.length;
            progress = {
                charName,
                worldbookName,
                totalChunks,
                completedChunks: [],
                failedChunks: [],
                retryCount: 0,
                chunkSize: LOCAL_LIBRARY_CONFIG.chunkTokens,
                chunkStrategy,
                startedAt: new Date().toISOString(),
                lastUpdated: new Date().toISOString(),
                status: 'in_progress',
            };
            await saveProgress(charName, worldbookName, progress);
            // 清除旧 chunk 结果文件
            const existingChunks = await safeReadJson(`${chunksDir}progress.json`, null);
            if (existingChunks && existingChunks.completedChunks.length > 0) {
                for (const idx of existingChunks.completedChunks) {
                    const resultPath = `${chunksDir}chunk_${String(idx).padStart(3, '0')}_result.json`;
                    const metaPath = `${chunksDir}chunk_${String(idx).padStart(3, '0')}_metadata.json`;
                    await deleteFileText(resultPath);
                    await deleteFileText(metaPath);
                }
            }
        }
        else if (progress.status === 'cancelled' || progress.status === 'failed') {
            chunkStrategy = options?.chunkStrategy ?? LOCAL_LIBRARY_CONFIG.chunkStrategy;
            chunks = buildChunks(selectedEntries, LOCAL_LIBRARY_CONFIG.chunkTokens, chunkStrategy);
            totalChunks = chunks.length;
            progress = {
                charName,
                worldbookName,
                totalChunks,
                completedChunks: [],
                failedChunks: [],
                retryCount: 0,
                chunkSize: LOCAL_LIBRARY_CONFIG.chunkTokens,
                chunkStrategy,
                startedAt: new Date().toISOString(),
                lastUpdated: new Date().toISOString(),
                status: 'in_progress',
            };
        }
        else if (progress.status === 'completed') {
            chunkStrategy = options?.chunkStrategy ?? LOCAL_LIBRARY_CONFIG.chunkStrategy;
            chunks = buildChunks(selectedEntries, LOCAL_LIBRARY_CONFIG.chunkTokens, chunkStrategy);
            totalChunks = chunks.length;
            progress = {
                charName,
                worldbookName,
                totalChunks,
                completedChunks: [],
                failedChunks: [],
                retryCount: 0,
                chunkSize: LOCAL_LIBRARY_CONFIG.chunkTokens,
                chunkStrategy,
                startedAt: new Date().toISOString(),
                lastUpdated: new Date().toISOString(),
                status: 'in_progress',
            };
        }
        else {
            // 恢复模式：使用已保存的分段策略，忽略新传入的选项（保证一致性）
            chunkStrategy = progress.chunkStrategy ?? CHUNK_STRATEGY.MERGE;
            chunks = buildChunks(selectedEntries, LOCAL_LIBRARY_CONFIG.chunkTokens, chunkStrategy);
            totalChunks = chunks.length;
            progress.totalChunks = totalChunks;
            progress.chunkStrategy = chunkStrategy;
            progress.status = 'in_progress';
        }
        await saveProgress(charName, worldbookName, progress);
        // 逐段处理（串行）
        const chunkResults = [];
        // per-chunk 重试状态
        const chunkRetryState = new Map();
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            // 检查取消
            if (buildAbortController?.signal.aborted) {
                await updateProgressStatus(charName, worldbookName, p => ({
                    ...p,
                    status: 'cancelled',
                    lastUpdated: new Date().toISOString(),
                }));
                break;
            }
            if (progress.completedChunks.includes(chunk.index)) {
                // 已完成段，跳过
                if (onProgress)
                    onProgress(progress.completedChunks.length, totalChunks, 'in_progress', chunk.index);
                const existing = await safeReadJson(`${chunksDir}chunk_${String(chunk.index).padStart(3, '0')}_result.json`, null);
                if (existing)
                    chunkResults.push(existing);
                continue;
            }
            // 检查连续失败：扫描 failedChunks 中实际连续的段
            const sortedFailed = [...progress.failedChunks].sort((a, b) => a - b);
            let consecutiveFailures = 0;
            let expected = -1;
            for (const fc of sortedFailed) {
                if (fc === expected || expected === -1) {
                    consecutiveFailures++;
                    expected = fc + 1;
                }
                else {
                    consecutiveFailures = 1;
                    expected = fc + 1;
                }
            }
            if (consecutiveFailures >= 3) {
                await updateProgressStatus(charName, worldbookName, p => ({
                    ...p,
                    status: 'failed',
                    lastUpdated: new Date().toISOString(),
                }));
                await removeBuildLock(charName, worldbookName);
                return {
                    success: false,
                    worldbookName,
                    characters: [],
                    totalChunks,
                    completedChunks: progress.completedChunks.length,
                    failedChunks: progress.failedChunks,
                    error: '连续 3 段失败，请检查 llama.cpp 是否运行',
                };
            }
            // per-chunk 重试
            const currentChunkRetry = chunkRetryState.get(chunk.index) ?? 0;
            if (currentChunkRetry >= LOCAL_LIBRARY_CONFIG.maxRetries) {
                await updateProgressStatus(charName, worldbookName, p => ({
                    ...p,
                    status: 'failed',
                    lastUpdated: new Date().toISOString(),
                }));
                await removeBuildLock(charName, worldbookName);
                return {
                    success: false,
                    worldbookName,
                    characters: [],
                    totalChunks,
                    completedChunks: progress.completedChunks.length,
                    failedChunks: progress.failedChunks,
                    error: `段 ${chunk.index} 已达最大重试次数`,
                };
            }
            try {
                // 段开始：上报当前进度与段号
                if (onProgress)
                    onProgress(progress.completedChunks.length, totalChunks, 'in_progress', chunk.index);
                // 写入 chunk 文本
                await atomicWriteJson(`${chunksDir}chunk_${String(chunk.index).padStart(3, '0')}.txt`, chunk.text);
                // 调用 LLM
                const userContent = EXTRACTION_INSTRUCTION.replace('{chunk_text}', chunk.text);
                const rawResponse = await callLlamaWithRetry([
                    { role: 'system', content: buildExtractionSystemPrompt(nsfwEnabled()) },
                    { role: 'user', content: userContent },
                ], currentChunkRetry, buildAbortController.signal, options?.apiSource);
                // 解析响应
                const parsed = parseLLMResponse(rawResponse);
                if (!parsed) {
                    throw new Error('LLM 返回格式无法解析');
                }
                // 深层数据清洗，防止 [object Object]
                const sanitized = sanitizeCharacterData(parsed);
                const chunkResult = {
                    chunkIndex: chunk.index,
                    data: sanitized,
                };
                // 保存结果
                await atomicWriteJson(`${chunksDir}chunk_${String(chunk.index).padStart(3, '0')}_result.json`, chunkResult);
                await atomicWriteJson(`${chunksDir}chunk_${String(chunk.index).padStart(3, '0')}_metadata.json`, {
                    chunkIndex: chunk.index,
                    entryIds: chunk.entryIds,
                    tokenCount: chunk.tokenCount,
                    startedAt: new Date().toISOString(),
                });
                chunkResults.push(chunkResult);
                chunkRetryState.delete(chunk.index);
                // 更新进度
                progress = await updateProgressStatus(charName, worldbookName, p => {
                    const completed = [...p.completedChunks, chunk.index];
                    const failed = p.failedChunks.filter(f => f !== chunk.index);
                    return {
                        ...p,
                        completedChunks: completed,
                        failedChunks: failed,
                        retryCount: 0,
                        lastUpdated: new Date().toISOString(),
                    };
                });
                if (onProgress)
                    onProgress(progress.completedChunks.length, totalChunks, 'in_progress', chunk.index);
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                await appendErrorLog(chunksDir, `[CHUNK ${chunk.index}] ERROR: ${msg}`);
                chunkRetryState.set(chunk.index, currentChunkRetry + 1);
                progress = await updateProgressStatus(charName, worldbookName, p => ({
                    ...p,
                    failedChunks: [...p.failedChunks, chunk.index],
                    lastUpdated: new Date().toISOString(),
                }));
                // 失败也上报进度（含当前段号），供 UI 显示失败信息
                if (onProgress)
                    onProgress(progress.completedChunks.length, totalChunks, 'in_progress', chunk.index);
                // 继续下一段
                continue;
            }
        }
        // 检查是否被取消
        const finalProgress = await loadProgress(charName, worldbookName);
        if (finalProgress.status === 'cancelled') {
            await removeBuildLock(charName, worldbookName);
            return {
                success: false,
                worldbookName,
                characters: [],
                totalChunks,
                completedChunks: finalProgress.completedChunks.length,
                failedChunks: finalProgress.failedChunks,
                error: '构建已取消',
            };
        }
        // 合并结果
        const merged = mergeChunkResults(chunkResults);
        // 根据构建模式决定最终角色列表
        const libPath = `${libDir}${sanitizeFilename(worldbookName, 'worldbook')}.json`;
        const existingLibrary = await safeReadJson(libPath, null);
        let finalCharacters = merged;
        if (buildMode === 'merge' && existingLibrary && existingLibrary.status === 'completed') {
            finalCharacters = mergeWithExistingLibrary(existingLibrary, merged);
        }
        // 保存 library.json
        const library = {
            charName,
            worldbookName,
            builtAt: new Date().toISOString(),
            totalChunks,
            status: 'completed',
            characters: finalCharacters,
        };
        await atomicWriteJson(`${libDir}${sanitizeFilename(worldbookName, 'worldbook')}.json`, library);
        // 更新库索引
        await updateLibraryIndex(charName, worldbookName, library, totalChunks, progress.completedChunks.length);
        // 更新进度为完成
        await updateProgressStatus(charName, worldbookName, p => ({
            ...p,
            status: 'completed',
            lastUpdated: new Date().toISOString(),
        }));
        await removeBuildLock(charName, worldbookName);
        // 构建成功：库文件已更新，失效相关缓存
        bumpLibraryMutationVersion();
        if (onProgress)
            onProgress(totalChunks, totalChunks, 'completed', totalChunks);
        return {
            success: true,
            worldbookName,
            characters: merged,
            totalChunks,
            completedChunks: finalProgress.completedChunks.length,
            failedChunks: finalProgress.failedChunks,
        };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        try {
            await updateProgressStatus(charName, worldbookName, p => ({
                ...p,
                status: 'failed',
                lastUpdated: new Date().toISOString(),
            }));
        }
        catch { /* ignore */ }
        await removeBuildLock(charName, worldbookName);
        return {
            success: false,
            worldbookName,
            characters: [],
            totalChunks: 0,
            completedChunks: 0,
            failedChunks: [],
            error: msg,
        };
    }
    finally {
        buildLock = false;
        buildAbortController = null;
        currentBuildingCharName = null;
        currentBuildingWorldbookName = null;
    }
}
// --------------------------------------------------
// 合并策略
// --------------------------------------------------
export function mergeChunkResults(chunkResults) {
    const charMap = new Map();
    const appearanceOrder = [];
    for (let ci = 0; ci < chunkResults.length; ci++) {
        const result = chunkResults[ci];
        if (!result || !result.data)
            continue;
        for (const char of result.data.角色列表) {
            const nameKey = getCharacterNameKey(char);
            if (!nameKey)
                continue;
            if (!charMap.has(nameKey)) {
                charMap.set(nameKey, deepClone(char));
                appearanceOrder.push(nameKey);
            }
            else {
                mergeCharacters(charMap.get(nameKey), char);
            }
        }
    }
    // 按首次出现顺序排列
    return appearanceOrder.map(k => charMap.get(k)).filter((c) => c !== undefined);
}
function getCharacterNameKey(char) {
    const name = char.名称详情?.全名?.[0]?.trim();
    if (name)
        return name;
    const alias = char.名称详情?.别名?.[0]?.trim();
    if (alias)
        return alias;
    const nickname = char.角色昵称?.[0]?.trim();
    if (nickname)
        return nickname;
    return char.角色姓名?.trim() ?? null;
}
function mergeCharacters(target, source) {
    // 跳过旧版数据结构
    if (isLegacyCharacter(source)) {
        console.warn('[LocalLib] 跳过旧版角色数据（基础身份/外观/服装系统格式），请重新构建角色库。');
        return;
    }
    // 名称详情取并集
    mergeStringArrays(target.名称详情.全名, source.名称详情.全名);
    mergeStringArrays(target.名称详情.别名, source.名称详情.别名);
    mergeStringArrays(target.名称详情.外号, source.名称详情.外号);
    mergeStringArrays(target.名称详情.称号, source.名称详情.称号);
    mergeStringArrays(target.名称详情.称谓, source.名称详情.称谓);
    mergeStringArrays(target.名称详情.代号, source.名称详情.代号);
    mergeStringArrays(target.名称详情.其他写法, source.名称详情.其他写法);
    // 核心DNA / 服装DNA 固定槽位取并集
    mergeDna(target.核心DNA, source.核心DNA, activeCoreDnaSlots());
    mergeDna(target.服装DNA, source.服装DNA, activeClothingDnaSlots());
}
function mergeStringArrays(target, source) {
    for (const item of source) {
        if (!target.includes(item)) {
            target.push(item);
        }
    }
}
function mergeDna(target, source, slots) {
    for (const slot of slots) {
        if (!Array.isArray(target[slot]))
            target[slot] = [];
        const srcArr = Array.isArray(source[slot]) ? source[slot] : [];
        for (const item of srcArr) {
            if (typeof item !== 'string')
                continue;
            if (!target[slot].includes(item))
                target[slot].push(item);
        }
    }
}
// --------------------------------------------------
// 跨世界书合并
// --------------------------------------------------
export function mergeCrossWorldbook(libraries) {
    const charMap = new Map();
    const appearanceOrder = [];
    for (const lib of libraries) {
        if (lib.status !== 'completed')
            continue;
        for (const char of lib.characters) {
            // 跳过旧版数据结构
            if (isLegacyCharacter(char))
                continue;
            const nameKey = getCharacterNameKey(char);
            if (!nameKey)
                continue;
            if (!charMap.has(nameKey)) {
                charMap.set(nameKey, deepClone(char));
                appearanceOrder.push(nameKey);
            }
            else {
                mergeCharacters(charMap.get(nameKey), char);
            }
        }
    }
    return appearanceOrder.map(k => charMap.get(k)).filter((c) => c !== undefined);
}
// --------------------------------------------------
// 注入逻辑
// --------------------------------------------------
const INJECT_MEMO_MAX = 16;
const injectMemo = new Map();
export function injectLocalCharacters(text, libraries) {
    if (!text || libraries.length === 0)
        return '';
    // 记忆化：库内容由 (角色名选择 + 磁盘) 决定，构建/选择变更会 bump libraryMutationVersion，
    // 故 (version + 世界书集合 + 正文) 唯一确定注入结果。上限 16 条防内存无界增长。
    const wbSig = libraries.map(l => l.worldbookName).join('~');
    const key = `${libraryMutationVersion}|${wbSig}|${text}`;
    const hit = injectMemo.get(key);
    if (hit !== undefined)
        return hit;
    const result = computeInjectLocalCharacters(text, libraries);
    if (injectMemo.size >= INJECT_MEMO_MAX) {
        const oldest = injectMemo.keys().next().value;
        if (oldest !== undefined)
            injectMemo.delete(oldest);
    }
    injectMemo.set(key, result);
    return result;
}
function computeInjectLocalCharacters(text, libraries) {
    const merged = mergeCrossWorldbook(libraries);
    if (merged.length === 0) {
        console.warn('[LocalLib] 注入失败：合并后角色数为 0（可能为旧版库或库内无角色）');
        return '';
    }
    const parts = [];
    const matchedChars = [];
    for (const char of merged) {
        const nameVariants = getAllNameVariants(char);
        // v2.x 收紧：英文名按词边界、中文排除单字，避免短变体/半词误注入
        const matched = nameVariants.some(variant => matchesNameVariant(text, variant));
        if (matched) {
            matchedChars.push(char);
        }
    }
    if (matchedChars.length === 0) {
        console.warn(`[LocalLib] 注入失败：正文未命中任何角色名（合并角色 ${merged.length} 个）`);
        return '';
    }
    logger.debug(`[LocalLib] 注入角色: ${matchedChars.map(c => c.角色姓名).join('、')}`);
    // v2.2 统一格式：段头由 index.ts 统一添加，本模块只产出条目
    for (const char of matchedChars) {
        const body = buildCharacterInjectionText(char);
        if (body)
            parts.push(`[${char.角色姓名}] ${body}`);
    }
    return parts.join('\n');
}
function normalizeForMatch(text) {
    return text
        .toLowerCase()
        .replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
        .replace(/[\u3000-\u303F]/g, ' ')
        .trim();
}
function getAllNameVariants(char) {
    const variants = [];
    const addUnique = (arr) => { for (const v of arr)
        if (v && !variants.includes(v))
            variants.push(v); };
    addUnique(char.名称详情.全名);
    addUnique(char.名称详情.别名);
    addUnique(char.名称详情.外号);
    addUnique(char.名称详情.称号);
    addUnique(char.名称详情.称谓);
    addUnique(char.名称详情.代号);
    addUnique(char.名称详情.其他写法);
    addUnique(char.角色昵称);
    return variants.filter(v => v.length > 0);
}
function isMeaningfulValue(v) {
    const t = (v ?? '').trim();
    if (!t)
        return false;
    return !/^(none|unknown|null|undefined|无|未知|无信息)$/i.test(t);
}
function buildCharacterInjectionText(char) {
    const lines = [];
    // 核心DNA：按固定槽位顺序输出，跳过空/none/unknown 值
    const coreParts = [];
    for (const slot of activeCoreDnaSlots()) {
        const values = (char.核心DNA?.[slot] ?? []).filter(isMeaningfulValue);
        if (values.length > 0) {
            coreParts.push(`${slot}${values.map(v => `{${v}}`).join(', ')}`);
        }
    }
    if (coreParts.length > 0) {
        lines.push(`核心DNA:${coreParts.join('; ')}`);
    }
    // 服装DNA：按固定槽位顺序输出，跳过空/none/unknown 值
    const clothingParts = [];
    for (const slot of activeClothingDnaSlots()) {
        const values = (char.服装DNA?.[slot] ?? []).filter(isMeaningfulValue);
        if (values.length > 0) {
            clothingParts.push(`${slot}${values.map(v => `{${v}}`).join(', ')}`);
        }
    }
    if (clothingParts.length > 0) {
        lines.push(`服装DNA:${clothingParts.join('; ')}`);
    }
    return lines.join(' ');
}
// --------------------------------------------------
// 本地库状态检查
// --------------------------------------------------
export async function getLocalLibraryStatus(charName) {
    // 尝试加载已知世界书
    const selection = await loadEntrySelection(charName);
    const libraries = [];
    let hasCompleted = false;
    for (const sel of selection.selections) {
        const wbDir = getWorldbookStorageDir(charName, sel.worldbookName);
        const libPath = `${wbDir}${sanitizeFilename(sel.worldbookName, 'worldbook')}.json`;
        const lib = await safeReadJson(libPath, null);
        if (lib && lib.status === 'completed') {
            // 过滤旧版数据结构（v1.8 之前）
            const hasLegacy = lib.characters.some(isLegacyCharacter);
            if (!hasLegacy) {
                libraries.push(lib);
                hasCompleted = true;
            }
        }
    }
    // enabled 反映真实状态：有已完成的库则视为已启用（供外部查询，不影响注入判断）
    return { enabled: hasCompleted, libraries, hasCompleted };
}
export async function loadAllCompletedLibraries(charName) {
    if (libraryLoadCache && libraryLoadCache.charName === charName && libraryLoadCache.version === libraryMutationVersion) {
        return libraryLoadCache.libraries;
    }
    const selection = await loadEntrySelection(charName);
    const libraries = [];
    for (const sel of selection.selections) {
        const wbDir = getWorldbookStorageDir(charName, sel.worldbookName);
        const libPath = `${wbDir}${sanitizeFilename(sel.worldbookName, 'worldbook')}.json`;
        const lib = await safeReadJson(libPath, null);
        if (lib && lib.status === 'completed') {
            // 过滤旧版数据结构（v1.9 之前 schema）
            const hasLegacy = lib.characters.some(isLegacyCharacter);
            if (!hasLegacy) {
                libraries.push(lib);
            }
            else {
                console.warn(`[LocalLib] 角色库「${sel.worldbookName}」为 v1.9 之前 schema，已跳过注入。请在「本地角色库」面板重新构建。`);
            }
        }
    }
    libraryLoadCache = { charName, version: libraryMutationVersion, libraries };
    return libraries;
}
export async function clearLocalLibrary(charName) {
    const lockPath = `${getWorldbookStorageDir(charName, '__check__').replace(/__check__\/$/, '')}build_lock.json`;
    // 先删除可能存在的锁文件
    try {
        await deleteFileText(lockPath);
    }
    catch { /* ignore */ }
    // 注意：浏览器环境下无法直接删除目录，需要用户手动删除
    // 这里清除所有已知文件
    const selection = await loadEntrySelection(charName);
    for (const sel of selection.selections) {
        const wbDir = getWorldbookStorageDir(charName, sel.worldbookName);
        const files = [
            `${wbDir}${sanitizeFilename(sel.worldbookName, 'worldbook')}.json`,
            `${wbDir}progress.json`,
            `${wbDir}build_lock.json`,
        ];
        for (const f of files) {
            try {
                await deleteFileText(f);
            }
            catch { /* ignore */ }
        }
        // 更新索引
        await updateLibraryIndex(charName, sel.worldbookName, null);
    }
    // 清除条目选择
    const dir2 = getCharStorageDir(charName);
    try {
        await deleteFileText(`${dir2}entry_selection.json`);
    }
    catch { /* ignore */ }
    bumpLibraryMutationVersion();
}
// --------------------------------------------------
// 事件注册
// --------------------------------------------------
let chatChangedRegistered = false;
export function initLocalLibraryEvents(onChatChanged) {
    if (chatChangedRegistered)
        return;
    chatChangedRegistered = true;
    eventSource.on(event_types.CHAT_CHANGED, () => {
        onChatChanged();
    });
}
