// ============================================================
// storage.ts —— IndexedDB 存储层（替代 localStorage 兜底）
// 解决 iOS PWA 5MB 配额限制，支持大文件存储
// API 与原 localLib.ts 的 fsRead/fsWrite/fsDelete 兼容
// ============================================================

const DB_NAME = 'image-st-storage';
const DB_VERSION = 1;
const STORE_NAME = 'files';
const META_STORE = 'meta';

let dbPromise: Promise<IDBDatabase> | null = null;

/** 获取或创建数据库连接 */
function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE);
      }
    };
  });
  return dbPromise;
}

/** 读取文件内容 */
export async function fsRead(filePath: string): Promise<string | null> {
  try {
    const db = await getDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(filePath);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

/** 写入文件内容 */
export async function fsWrite(filePath: string, content: string): Promise<void> {
  const db = await getDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(content, filePath);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/** 删除文件 */
export async function fsDelete(filePath: string): Promise<void> {
  try {
    const db = await getDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(filePath);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    // 忽略不存在的键
  }
}

/** 批量读取（用于迁移/调试） */
export async function fsGetAll(): Promise<Record<string, string>> {
  try {
    const db = await getDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const keysRequest = store.getAllKeys();
      const valuesRequest = store.getAll();
      keysRequest.onsuccess = () => {
        valuesRequest.onsuccess = () => {
          const result: Record<string, string> = {};
          const keys = keysRequest.result as IDBValidKey[];
          for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const keyStr = typeof key === 'string' ? key : String(key);
            result[keyStr] = valuesRequest.result[i];
          }
          resolve(result);
        };
      };
      keysRequest.onerror = () => reject(keysRequest.error);
      valuesRequest.onerror = () => reject(valuesRequest.error);
    });
  } catch {
    return {};
  }
}

/** 清空存储（扩展卸载/重置时） */
export async function fsClear(): Promise<void> {
  try {
    const db = await getDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch { /* ignore */ }
}

/** 获取存储使用量估算（bytes） */
export async function fsGetUsage(): Promise<number> {
  try {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      const estimate = await navigator.storage.estimate();
      return estimate.usage ?? 0;
    }
  } catch { /* ignore */ }
  return 0;
}

// 兼容旧 API：同步版本（内部用异步，外部按需 await）
export const storage = {
  read: fsRead,
  write: fsWrite,
  delete: fsDelete,
  clear: fsClear,
  getUsage: fsGetUsage,
};

export {}; // make it a module