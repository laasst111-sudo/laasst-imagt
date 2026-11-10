// ============================================================
// lexiconStore.ts —— 词库.bmz 的浏览器持久化（IndexedDB）
// 只存**原始 bmz 字节**（~7MB，gzip 密文即自带 GCM 完整性校验），
// 恢复时复用 decodeBmz + createLexiconFromEntries 这条与导入一致的路径。
// 零依赖；Node 离线测试不导入本模块（IndexedDB 仅浏览器有）。
// ============================================================
const DB_NAME = "image_st_lexicon";
const DB_VERSION = 1;
const STORE = "dict";
const KEY_RAW = "bmz_raw";
function openDb() {
    return new Promise((resolve, reject) => {
        let req;
        try {
            if (typeof indexedDB === "undefined") {
                reject(new Error("此环境不支持 IndexedDB（浏览器隐私模式？）"));
                return;
            }
            req = indexedDB.open(DB_NAME, DB_VERSION);
        }
        catch (err) {
            reject(err instanceof Error ? err : new Error("IndexedDB 不可用"));
            return;
        }
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE))
                db.createObjectStore(STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("IndexedDB 打开失败"));
        req.onblocked = () => reject(new Error("IndexedDB 被其他标签页占用，请关闭其他 SillyTavern 页面后刷新"));
    });
}
function txDone(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB 事务失败"));
        tx.onabort = () => reject(tx.error ?? new Error("IndexedDB 事务中断"));
    });
}
/** 持久化词库原始字节（覆盖旧值）。 */
export async function saveBmzRaw(buf) {
    const db = await openDb();
    try {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(buf, KEY_RAW);
        await txDone(tx);
    }
    finally {
        db.close();
    }
}
/**
 * 廉价探测：持久化的词库是否存在。
 * 只用 count() 读条目数，**不会**把 ~7MB 的 blob 读进内存，也不解密/解压。
 * 供「惰性加载」在页面启动时零成本判断是否值得加载完整词库。
 */
export async function hasBmzRaw() {
    const db = await openDb();
    try {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).count();
        const n = await new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error ?? new Error("IndexedDB 计数失败"));
        });
        return n > 0;
    }
    finally {
        db.close();
    }
}
/** 读取持久化的词库原始字节；不存在返回 null。 */
export async function loadBmzRaw() {
    const db = await openDb();
    try {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(KEY_RAW);
        const result = await new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error ?? new Error("IndexedDB 读取失败"));
        });
        return result instanceof ArrayBuffer ? result : null;
    }
    finally {
        db.close();
    }
}
/** 清除持久化词库（不存在时也是成功调用）。 */
export async function clearBmzRaw() {
    const db = await openDb();
    try {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(KEY_RAW);
        await txDone(tx);
    }
    finally {
        db.close();
    }
}
