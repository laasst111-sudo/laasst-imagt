// ============================================================
// lexicon.worker.ts —— Web Worker 词库解码与索引构建
// 将 PBKDF2 120k + AES-GCM + gzip + 34万词建索引移出主线程
// 仅保留 decodeBmz + createLexiconFromEntries 所需的最小依赖
// ============================================================
const BMZ_PW = "bmz-dict-pack-2026-9f3c1a7e5b2d8046c1afe37b95";
const BMZ_ITER = 120000;
async function decodeBmzWorker(buf) {
    const u8 = new Uint8Array(buf);
    if (u8.length < 40)
        throw new Error("词库包不完整");
    const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
    if (magic !== "BMZ1")
        throw new Error("这不是词库包（文件头认不出来）");
    const salt = u8.subarray(4, 20), iv = u8.subarray(20, 32), ct = u8.subarray(32);
    const enc = new TextEncoder();
    const km = await crypto.subtle.importKey("raw", enc.encode(BMZ_PW), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: salt, iterations: BMZ_ITER, hash: "SHA-256" }, km, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const gz = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(iv) }, key, ct);
    const ds = new DecompressionStream("gzip");
    const st = new Blob([gz]).stream().pipeThrough(ds);
    const raw = await new Response(st).arrayBuffer();
    const b = new Uint8Array(raw), te = new TextDecoder();
    const out = [];
    let p = 0;
    while (p + 2 <= b.length) {
        const nl = b[p] | (b[p + 1] << 8);
        p += 2;
        const nm = te.decode(b.subarray(p, p + nl));
        p += nl;
        const dl = (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;
        p += 4;
        const txt = te.decode(b.subarray(p, p + dl));
        p += dl;
        out.push({ name: nm, text: txt });
    }
    if (!out.length)
        throw new Error("词库包里没有内容");
    return out;
}
function createLexiconFromEntriesWorker(entries, builtinText) {
    const byName = {};
    for (const e of entries)
        byName[e.name] = e.text;
    const line = (n) => (byName[n] || "").split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
    // builtin
    const builtinZh = [];
    for (const l of String(builtinText ?? "").split("\n")) {
        if (!l)
            continue;
        const i = l.indexOf("\u0001");
        if (i < 1)
            continue;
        builtinZh.push([l.slice(0, i), l.slice(i + 1)]);
    }
    // mtZh
    const mtZh = line("机翻词表.tsv").map((l) => { const p = l.split("\t"); return [p[0], p[1]]; });
    // manualZh
    const manualZh = line("手动翻译.tsv").map((l) => { const p = l.split("\t"); return [p[0], p[1]]; });
    // customZh (empty by default)
    const customZh = [];
    // bigLines -> bigZh + allKeys
    const bigLines = line("danbooru_tags.txt");
    const bigZh = [];
    const allKeysSet = new Set();
    for (const l of bigLines) {
        const tab = l.indexOf("\t");
        if (tab < 1)
            continue;
        const en = l.slice(0, tab);
        const zh = l.slice(tab + 1);
        bigZh.push([en, zh]);
        allKeysSet.add(en);
    }
    for (const [k] of builtinZh)
        allKeysSet.add(k);
    for (const [k] of mtZh)
        allKeysSet.add(k);
    for (const [k] of manualZh)
        allKeysSet.add(k);
    // groups
    const groups = [];
    for (const l of line("标签分类.tsv")) {
        const p = l.split("\t");
        if (p.length < 3)
            continue;
        const en = p[0].trim().toLowerCase();
        if (!en)
            continue;
        groups.push([en, [p[1].trim(), p[2].trim()]]);
        allKeysSet.add(en);
    }
    // cooc
    const cooc = [];
    for (const l of line("共现邻居.tsv")) {
        const tab = l.indexOf("\t");
        if (tab < 1)
            continue;
        const es = l.slice(0, tab).trim().toLowerCase();
        const arr = l.slice(tab + 1).split("|").map((x) => x.trim().toLowerCase()).filter(Boolean);
        if (es && arr.length)
            cooc.push([es, arr]);
    }
    return {
        order: ["manual", "mt", "custom", "builtin", "big"],
        builtinZh,
        manualZh,
        mtZh,
        customZh,
        bigZh,
        groups,
        cooc,
        allKeys: Array.from(allKeysSet),
        bigLines,
    };
}
self.onmessage = async (e) => {
    const msg = e.data;
    try {
        if (msg.type === "decode" || msg.type === "restore") {
            const entries = await decodeBmzWorker(msg.buffer);
            const serialized = createLexiconFromEntriesWorker(entries, msg.builtinText);
            self.postMessage({ type: "success", data: serialized });
        }
    }
    catch (err) {
        self.postMessage({ type: "error", error: err instanceof Error ? err.message : String(err) });
    }
};
export {};
