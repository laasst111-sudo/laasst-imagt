// @ts-expect-error — resolved at runtime by ST
import { extension_settings } from "../../../../../scripts/extensions.js";
import { SETTINGS_KEY } from "./comfy.js";
import { buildAliasMap, findAliasesInText } from "./nameMatcher.js";
let cachedSheets = null;
let dbAvailable = false;
let refreshDbPromise = null;
const PLACEHOLDER_VALUES = new Set(["待初始化", "无名单元", ""]);
const DB_MAX_OUTPUT = 2000;
const NAME_COL_PATTERN = /^(姓名|人物名称|名称|name)$/i;
function findNameColIndex(header) {
    for (let i = 0; i < header.length; i++) {
        if (NAME_COL_PATTERN.test(String(header[i] ?? "").trim()))
            return i;
    }
    return -1;
}
export function getDbSelections() {
    const s = extension_settings[SETTINGS_KEY] ?? {};
    return migrateDbSelections(s);
}
export function migrateDbSelections(s) {
    if (Array.isArray(s.db_selection) && s.db_selection.length > 0 && typeof s.db_selection[0] === 'object' && 'sheetKey' in s.db_selection[0]) {
        return s.db_selection.filter(sel => sel && sel.sheetKey);
    }
    const rawSel = s.db_selection;
    const cols = (rawSel && typeof rawSel === 'object' && !Array.isArray(rawSel) ? rawSel.cols : []);
    if (!Array.isArray(cols) || cols.length === 0) {
        return [];
    }
    if (!cachedSheets) {
        return [];
    }
    const migrated = [];
    const usedFields = new Set(cols);
    for (const sheet of cachedSheets) {
        const sheetFields = sheet.header.filter(h => h !== "row_id" && usedFields.has(h));
        if (sheetFields.length > 0) {
            migrated.push({ sheetKey: sheet.key, fields: sheetFields });
        }
    }
    if (migrated.length > 0) {
        s.db_selection = migrated;
    }
    return migrated;
}
async function waitDatabaseReady(timeoutMs = 10000) {
    const api = window.AutoCardUpdaterAPI;
    if (typeof api === 'undefined')
        return false;
    const ready = () => {
        if (typeof api.exportTableAsJson !== 'function')
            return false;
        try {
            const raw = api.exportTableAsJson();
            if (!raw || typeof raw !== 'object')
                return false;
            return Object.keys(raw).some(k => k !== "mate");
        }
        catch {
            return false;
        }
    };
    if (ready())
        return true;
    const intervalMs = 500;
    const maxAttempts = Math.ceil(timeoutMs / intervalMs);
    for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, intervalMs));
        if (ready())
            return true;
    }
    return false;
}
function parseSheets(raw) {
    const sheets = [];
    for (const key of Object.keys(raw)) {
        if (key === "mate")
            continue;
        const sheet = raw[key];
        if (!sheet || typeof sheet !== 'object' || !Array.isArray(sheet.content))
            continue;
        const content = sheet.content;
        if (content.length === 0)
            continue;
        const header = (content[0] ?? []).map(c => String(c ?? ""));
        // 逐行拷贝（r.slice()），断开与 AutoCardUpdaterAPI 内部可变引用的共享，
        // 从而无需在 refreshDatabaseData 中做整库 JSON 深拷贝。
        const dataRows = content.slice(1).filter(r => Array.isArray(r)).map(r => r.slice());
        sheets.push({ key, name: String(sheet.name ?? key), header, dataRows });
    }
    return sheets;
}
export async function refreshDatabaseData() {
    if (refreshDbPromise)
        return refreshDbPromise;
    refreshDbPromise = (async () => {
        const s = extension_settings[SETTINGS_KEY] ?? {};
        if (!s.db_enabled) {
            cachedSheets = null;
            dbAvailable = false;
            return false;
        }
        const ready = await waitDatabaseReady();
        if (!ready) {
            cachedSheets = null;
            dbAvailable = false;
            return false;
        }
        try {
            const raw = window.AutoCardUpdaterAPI.exportTableAsJson();
            if (!raw || typeof raw !== 'object') {
                cachedSheets = null;
                dbAvailable = false;
                return false;
            }
            // v1.9.1 性能：不再 JSON.parse(JSON.stringify(raw)) 整库深拷贝；
            // parseSheets 已对 header 与 dataRows 逐行拷贝，直接用只读快照。
            const sheets = parseSheets(raw);
            if (sheets.length === 0) {
                cachedSheets = null;
                dbAvailable = false;
                return false;
            }
            cachedSheets = sheets;
            dbAvailable = true;
            // 延迟迁移：cachedSheets 就绪后检查并迁移残留的旧格式
            const ss2 = extension_settings[SETTINGS_KEY] ?? {};
            const legacySel = ss2.db_selection;
            if (legacySel && typeof legacySel === 'object' && !Array.isArray(legacySel) && Array.isArray(legacySel.cols)) {
                migrateDbSelections(ss2);
            }
            return true;
        }
        catch {
            cachedSheets = null;
            dbAvailable = false;
            return false;
        }
    })();
    return refreshDbPromise.finally(() => { refreshDbPromise = null; });
}
export function scanDatabaseTables() {
    if (!cachedSheets)
        return [];
    return cachedSheets.map(sheet => ({
        key: sheet.key,
        name: sheet.name,
        fields: sheet.header.filter(h => h !== "row_id"),
        rowCount: sheet.dataRows.length,
    }));
}
export function scanDatabaseCharacters() {
    if (!cachedSheets)
        return [];
    const names = new Set();
    for (const sheet of cachedSheets) {
        const nameIdx = findNameColIndex(sheet.header);
        if (nameIdx < 0)
            continue;
        for (const row of sheet.dataRows) {
            const name = String(row[nameIdx] ?? "").trim();
            if (name && !PLACEHOLDER_VALUES.has(name)) {
                names.add(name);
            }
        }
    }
    return Array.from(names);
}
export function scanDatabaseFields() {
    if (!cachedSheets)
        return [];
    const fields = new Set();
    for (const sheet of cachedSheets) {
        for (const col of sheet.header) {
            if (col !== "row_id")
                fields.add(col);
        }
    }
    return Array.from(fields);
}
export function extractDatabaseInfoSegment(text, selections) {
    const s = extension_settings[SETTINGS_KEY] ?? {};
    if (!s.db_enabled || !cachedSheets || !text) {
        return "";
    }
    if (!selections || selections.length === 0)
        return "";
    const sheetFieldMap = new Map();
    for (const sel of selections) {
        sheetFieldMap.set(sel.sheetKey, new Set(sel.fields));
    }
    const nameLabels = new Map();
    for (const sheet of cachedSheets) {
        if (!sheetFieldMap.has(sheet.key))
            continue;
        const nameIdx = findNameColIndex(sheet.header);
        if (nameIdx < 0)
            continue;
        for (const row of sheet.dataRows) {
            const nameLabel = String(row[nameIdx] ?? "").trim();
            if (!nameLabel || PLACEHOLDER_VALUES.has(nameLabel))
                continue;
            if (!nameLabels.has(nameLabel)) {
                nameLabels.set(nameLabel, nameLabel);
            }
        }
    }
    const aliasMap = buildAliasMap(nameLabels);
    const matchedNameSet = findAliasesInText(text, aliasMap);
    if (matchedNameSet.size === 0)
        return "";
    const infoParts = [];
    let totalLen = 0;
    let truncated = false;
    for (const sheet of cachedSheets) {
        const colSet = sheetFieldMap.get(sheet.key);
        if (!colSet)
            continue;
        const nameIdx = findNameColIndex(sheet.header);
        if (nameIdx < 0)
            continue;
        for (const row of sheet.dataRows) {
            const nameLabel = String(row[nameIdx] ?? "").trim();
            if (!nameLabel || !matchedNameSet.has(nameLabel))
                continue;
            const fields = [];
            for (let i = 0; i < sheet.header.length; i++) {
                const colName = sheet.header[i];
                if (colName === "row_id" || !colSet.has(colName))
                    continue;
                let val = String(row[i] ?? "").trim();
                if (!val || PLACEHOLDER_VALUES.has(val))
                    continue;
                if (val.length > 100)
                    val = val.substring(0, 100) + "[...]";
                fields.push(`${colName}:${val}`);
            }
            if (fields.length === 0)
                continue;
            // v2.2 统一格式：[角色名] 列名:值 列名:值（单行，字段空格分隔）
            const entry = `[${nameLabel}] ${fields.join(" ")}`;
            if (totalLen + entry.length > DB_MAX_OUTPUT) {
                truncated = true;
                break;
            }
            infoParts.push(entry);
            totalLen += entry.length;
        }
        if (truncated)
            break;
    }
    if (truncated)
        infoParts.push("(已截断)");
    return infoParts.join("\n");
}
export function clearDatabaseCache() {
    cachedSheets = null;
    dbAvailable = false;
}
export function getDatabaseStatus() {
    if (!dbAvailable || !cachedSheets)
        return { available: false };
    const rows = cachedSheets.reduce((sum, sheet) => sum + sheet.dataRows.length, 0);
    return { available: true, sheets: cachedSheets.length, rows };
}
