// ============================================================
// lexiconWorker.ts —— Web Worker 封装（主线程侧）
// 负责与 lexicon.worker.ts 通信，反序列化返回的 Lexicon
// ============================================================

import { BUILTIN_DICT_RAW } from "./builtinDict.js";
import type { Lexicon } from "./lexicon.js";

interface SerializedLexicon {
  order: string[];
  builtinZh: [string, string][];
  manualZh: [string, string][];
  mtZh: [string, string][];
  customZh: [string, string][];
  bigZh: [string, string][];
  groups: [string, [string, string]][];
  cooc: [string, string[]][];
  allKeys: string[];
  bigLines?: string[];
}

let worker: Worker | null = null;

/** 获取或创建 Worker 实例 */
function getWorker(): Worker {
  if (!worker) {
    // 构建时 worker 会被编译到 dist/worker/lexicon.worker.js
    worker = new Worker(new URL("./worker/lexicon.worker.ts", import.meta.url), { type: "module" });
  }
  return worker;
}

/** 在 Worker 中解码 BMZ 并构建词库索引 */
export async function decodeBmzInWorker(buffer: ArrayBuffer): Promise<Lexicon> {
  const w = getWorker();
  const serialized = await new Promise<SerializedLexicon>((resolve, reject) => {
    const id = Math.random();
    const handler = (e: MessageEvent) => {
      if (e.data.id !== id) return;
      w.removeEventListener("message", handler);
      if (e.data.type === "success") resolve(e.data.data);
      else reject(new Error(e.data.error || "Worker decode failed"));
    };
    w.addEventListener("message", handler);
    w.postMessage({ id, type: "decode", buffer, builtinText: BUILTIN_DICT_RAW }, [buffer]);
  });
  return deserializeLexicon(serialized);
}

/** 反序列化 Worker 返回的扁平结构为 Lexicon 实例 */
function deserializeLexicon(s: SerializedLexicon): Lexicon {
  const lex: Lexicon = {
    order: s.order,
    builtinZh: new Map(s.builtinZh),
    manualZh: new Map(s.manualZh),
    mtZh: new Map(s.mtZh),
    customZh: new Map(s.customZh),
    bigZh: new Map(s.bigZh),
    groups: new Map(s.groups),
    cooc: new Map(s.cooc),
    allKeys: new Set(s.allKeys),
  };
  if (s.bigLines) lex.bigLines = s.bigLines;
  return lex;
}

/** 终止 Worker（扩展卸载时调用） */
export function terminateLexiconWorker(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
}