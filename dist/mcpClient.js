// ============================================================
// v2.2 mcpClient.ts —— MCP（Model Context Protocol）Streamable HTTP 客户端
// ------------------------------------------------------------
// 用途：让 LLM 通过 function calling 调用在线 MCP 工具（Danbooru 标签检索）。
// 端点示例：https://sakizuki-danboorusearch.hf.space/mcp/mcp
//
// 协议要点（Streamable HTTP）：
//   1) POST initialize            → 响应头 Mcp-Session-Id（后续请求必须带）
//   2) POST notifications/initialized
//   3) POST tools/list            → 工具清单
//   4) POST tools/call            → { content: [{ type:"text", text }] }
//   响应可能是 application/json，也可能是 SSE（event: message / data: {...}）→ 两种都解析。
// ============================================================
export class McpClient {
    constructor(url) {
        this.sessionId = null;
        this.initialized = false;
        this.toolsCache = null;
        this.url = url;
    }
    headers() {
        const h = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        };
        if (this.sessionId)
            h["Mcp-Session-Id"] = this.sessionId;
        return h;
    }
    /** 从 JSON 或 SSE 响应中取出 JSON-RPC payload */
    static extractJson(text) {
        const trimmed = text.trim();
        if (!trimmed)
            return null;
        if (trimmed.startsWith("{")) {
            try {
                return JSON.parse(trimmed);
            }
            catch { /* fallthrough */ }
        }
        // SSE：逐行找 data:
        for (const line of trimmed.split(/\r?\n/)) {
            const t = line.trim();
            if (!t.startsWith("data:"))
                continue;
            const payload = t.slice(5).trim();
            if (!payload || payload === "[DONE]")
                continue;
            try {
                return JSON.parse(payload);
            }
            catch { /* continue */ }
        }
        return null;
    }
    async post(body, timeoutMs = 30000) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            const resp = await fetch(this.url, {
                method: "POST",
                headers: this.headers(),
                body: JSON.stringify(body),
                signal: ctrl.signal,
            });
            const sid = resp.headers.get("mcp-session-id");
            if (sid)
                this.sessionId = sid;
            if (!resp.ok) {
                const detail = await resp.text().catch(() => "");
                throw new Error(`MCP ${resp.status}: ${detail.slice(0, 160)}`);
            }
            const text = await resp.text();
            return { payload: McpClient.extractJson(text), sessionId: sid };
        }
        finally {
            clearTimeout(timer);
        }
    }
    /** initialize + initialized 通知（幂等） */
    async connect() {
        if (this.initialized)
            return true;
        try {
            await this.post({
                jsonrpc: "2.0",
                id: 1,
                method: "initialize",
                params: {
                    protocolVersion: "2025-06-18",
                    capabilities: {},
                    clientInfo: { name: "st-image-plugin-gen2", version: "2.2" },
                },
            });
            // initialized 通知（无 id，服务端一般返回 202）
            try {
                await this.post({ jsonrpc: "2.0", method: "notifications/initialized" }, 10000);
            }
            catch {
                // 通知失败不影响后续
            }
            this.initialized = true;
            return true;
        }
        catch {
            this.initialized = false;
            return false;
        }
    }
    async listTools() {
        if (this.toolsCache)
            return this.toolsCache;
        if (!await this.connect())
            return [];
        const { payload } = await this.post({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        const result = payload?.result;
        this.toolsCache = result?.tools ?? [];
        return this.toolsCache;
    }
    async callTool(name, args, timeoutMs = 30000) {
        if (!await this.connect())
            throw new Error("MCP 连接失败");
        const { payload } = await this.post({
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: { name, arguments: args },
        }, timeoutMs);
        const res = payload;
        if (res?.error)
            throw new Error(res.error.message ?? "MCP 调用出错");
        const parts = (res?.result?.content ?? [])
            .filter(c => c.type === "text" && typeof c.text === "string")
            .map(c => c.text);
        return { text: parts.join("\n"), isError: res?.result?.isError === true };
    }
    /** 把 MCP 工具清单转成 OpenAI 兼容的 function 工具定义 */
    static toFunctionDefs(tools) {
        return tools.map(t => ({
            type: "function",
            function: {
                name: t.name,
                description: (t.description ?? "").slice(0, 900),
                parameters: (t.inputSchema ?? { type: "object", properties: {} }),
            },
        }));
    }
}
/** 进程内共享的 MCP 客户端缓存（同一端点只握手一次） */
const clients = new Map();
export function getMcpClient(url) {
    let c = clients.get(url);
    if (!c) {
        c = new McpClient(url);
        clients.set(url, c);
    }
    return c;
}
/** 端点可用性探测（失败不抛） */
export async function probeMcp(url) {
    try {
        const c = getMcpClient(url);
        const tools = await c.listTools();
        return tools.length > 0;
    }
    catch {
        return false;
    }
}
