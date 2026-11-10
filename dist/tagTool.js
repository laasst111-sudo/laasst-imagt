// ============================================================
// v2.2 tagTool.ts —— Danbooru 标签检索工具
// ------------------------------------------------------------
// 供 LLM 挑选「更适合的标签」使用（两阶段：抽取 / 审核）。
//
// 数据来源（auto 策略：MCP 在线优先，其次本地词库）：
//   A. MCP 在线服务 —— DanbooruSearch（HF Space）Streamable HTTP MCP
//      默认端点：https://sakizuki-danboorusearch.hf.space/mcp/mcp
//      工具：search_tags（自然语言→Danbooru 标签）、get_related_tags（共现关联）、
//            get_anima_format（Anima 模型格式规范）
//      该端点已开启 CORS（反射 Origin），浏览器可直连，无需本地服务。
//   B. 本地词库 —— 用户导入的 词库.bmz（34.7 万词 / 共现 / 分类）或内嵌精选
//
// 注：不再使用任何本地端口的外部服务地址（127.0.0.1:xxxx）。
// ============================================================
import { normTag } from "./lexicon.js";
import { isAcceptableTag } from "./promptPost.js";
import { getMcpClient } from "./mcpClient.js";
export const DEFAULT_MCP_URL = "https://sakizuki-danboorusearch.hf.space/mcp/mcp";
// ------------------------------------------------------------
// 本地词库检索
// ------------------------------------------------------------
/** 从中文释义与英文词面检索本地词库 */
export function searchLocalTags(query, lex, limit = 12) {
    const q = String(query ?? "").trim();
    if (!q || !lex)
        return [];
    const out = [];
    const seen = new Set();
    const push = (tag, cn) => {
        const key = normTag(tag);
        if (!key || seen.has(key))
            return;
        seen.add(key);
        const grp = lex.groups.get(key);
        out.push({
            tag: key,
            cn,
            category: grp ? grp[1] || grp[0] : undefined,
            neighbors: lex.cooc.get(key)?.slice(0, 5),
        });
    };
    const lower = q.toLowerCase();
    for (const tag of lex.allKeys) {
        if (out.length >= limit * 2)
            break;
        if (tag.includes(lower) || lower.includes(tag))
            push(tag, lex.builtinZh.get(tag));
    }
    if (out.length < limit) {
        const zhMaps = [lex.manualZh, lex.mtZh, lex.customZh, lex.builtinZh];
        for (const map of zhMaps) {
            for (const [en, zh] of map) {
                if (out.length >= limit * 2)
                    break;
                if (zh && zh.includes(q))
                    push(en, zh);
            }
        }
    }
    return out.slice(0, limit);
}
// ------------------------------------------------------------
// MCP 在线检索
// ------------------------------------------------------------
/** 从 MCP 工具返回的 JSON 文本里抽取标签 */
function parseTagsFromMcp(text, limit) {
    const out = [];
    const seen = new Set();
    const push = (tag, cn, category) => {
        const key = normTag(tag);
        if (!key || seen.has(key))
            return;
        seen.add(key);
        out.push({ tag: key, cn, category });
    };
    const pushFrom = (v, cn, category) => {
        if (typeof v === "string")
            push(v, cn, category);
        else if (Array.isArray(v))
            v.forEach(x => pushFrom(x, cn, category));
        else if (v && typeof v === "object") {
            const rec = v;
            const tag = rec.tag ?? rec.raw_tag ?? rec.name ?? rec.en;
            if (typeof tag === "string") {
                push(tag, typeof rec.cn_name === "string" ? rec.cn_name : (typeof rec.cn === "string" ? rec.cn : undefined), typeof rec.category === "string" ? rec.category : undefined);
            }
        }
    };
    // ① 结构化 JSON（resolved_tags / candidates / results 等）
    try {
        const data = JSON.parse(text);
        for (const key of ["resolved_tags", "resolved", "tags", "candidates", "results", "output", "related_tags"]) {
            if (data[key] !== undefined)
                pushFrom(data[key]);
        }
        // candidates 可能是 {raw_tag: {...}} 字典
        if (data.candidates && typeof data.candidates === "object" && !Array.isArray(data.candidates)) {
            for (const [k, v] of Object.entries(data.candidates)) {
                pushFrom(v ?? k);
            }
        }
        if (out.length)
            return out.slice(0, limit);
    }
    catch {
        // 非 JSON → 走文本解析
    }
    // ② 文本兜底：提取形如 tag / tag(cn) / `tag` 的词
    const re = /(^|[\s,;、"'`(（])([a-z0-9][a-z0-9_]{1,48})(?:\s*\(([^)]{1,40})\))?/g;
    let m;
    while ((m = re.exec(text)) !== null && out.length < limit) {
        const tag = m[2];
        if (/^\d+$/.test(tag))
            continue;
        push(tag, m[3]);
    }
    return out.slice(0, limit);
}
/** MCP：自然语言 → Danbooru 标签 */
export async function searchViaMcp(url, query, limit = 12, timeoutMs = 25000) {
    try {
        const client = getMcpClient(url);
        const res = await client.callTool("search_tags", {
            query: String(query ?? "").slice(0, 200),
            search_mode: "full_scene",
            category: "all",
            show_nsfw: true,
            include_wiki: false,
        }, timeoutMs);
        if (!res.text)
            return null;
        return { candidates: parseTagsFromMcp(res.text, limit), raw: res.text };
    }
    catch {
        return null;
    }
}
/** MCP：共现关联标签 */
export async function relatedViaMcp(url, tags, limit = 12, timeoutMs = 25000) {
    try {
        const client = getMcpClient(url);
        const res = await client.callTool("get_related_tags", {
            tags: tags.map(t => normTag(t)).filter(Boolean).slice(0, 16),
            limit,
            show_nsfw: true,
        }, timeoutMs);
        if (!res.text)
            return null;
        return parseTagsFromMcp(res.text, limit);
    }
    catch {
        return null;
    }
}
/** MCP：Anima 模型格式规范（缓存于调用方） */
export async function animaFormatViaMcp(url, timeoutMs = 25000) {
    try {
        const client = getMcpClient(url);
        const res = await client.callTool("get_anima_format", {}, timeoutMs);
        return res.text?.trim() || null;
    }
    catch {
        return null;
    }
}
/** MCP 可用工具清单 */
export async function listMcpTools(url) {
    try {
        return await getMcpClient(url).listTools();
    }
    catch {
        return [];
    }
}
// ------------------------------------------------------------
// 统一入口
// ------------------------------------------------------------
/**
 * 统一检索：MCP 在线优先，其次本地词库。
 * @param source auto=MCP 可用则 MCP，否则本地；mcp=仅 MCP；local=仅本地
 */
export async function collectTagCandidates(params) {
    const limit = params.limit ?? 12;
    const source = params.source ?? "auto";
    const url = params.mcpUrl || DEFAULT_MCP_URL;
    if (source !== "local") {
        const mcp = await searchViaMcp(url, params.query, limit);
        if (mcp?.candidates.length) {
            return { candidates: mcp.candidates, source: "mcp", raw: mcp.raw };
        }
        if (source === "mcp") {
            return { candidates: [], source: "none", degraded: true, note: "MCP 标签检索不可用" };
        }
    }
    if (params.lex) {
        const local = searchLocalTags(params.query, params.lex, limit);
        return {
            candidates: local,
            source: "local",
            degraded: source === "auto",
            note: source === "auto" ? "MCP 不可用，已回退本地词库" : undefined,
        };
    }
    return { candidates: [], source: "none", degraded: true, note: "未加载词库（Danbooru 链为降级模式）" };
}
/** 候选清单 → 提示词区块 */
export function buildCandidatesBlock(candidates) {
    if (!candidates.length)
        return "";
    const lines = candidates.map(c => {
        const meta = [c.cn, c.category].filter(Boolean).join(" / ");
        const nb = c.neighbors?.length ? `（共现：${c.neighbors.slice(0, 3).join(", ")}）` : "";
        return `- ${c.tag}${meta ? ` — ${meta}` : ""}${nb}`;
    });
    return ["# 可用 Danbooru 标签候选（请从中挑选；需要更多时用 danbooru_search 工具检索）", ...lines].join("\n");
}
/** 过滤出「可上画」的候选（词库已收录） */
export function filterModelable(candidates, lex) {
    if (!lex)
        return candidates;
    return candidates.filter(c => isAcceptableTag(lex, c.tag));
}
