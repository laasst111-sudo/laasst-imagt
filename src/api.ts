import { logger } from "./logger.js";
import {
  buildThinkingFields,
  clampMaxTokens,
  detectGateway,
  detectModelFamily,
  familySupportsThinking,
  getModelContextLength,
  isGLMForcedThinking,
  normalizeEffort,
} from "./modelProfile.js";

export const LLM_URL_DEFAULT = "https://api.siliconflow.cn/v1/chat/completions";
export const LLM_MODEL_DEFAULT = "Qwen/Qwen2.5-7B-Instruct";
/** 首字节超时：发出请求 → 收到首个 SSE chunk */
export const LLM_FIRST_BYTE_TIMEOUT_MS = 15000;
/** Token 间隔超时：两个内容 token（非 keepalive）之间 */
export const LLM_INTER_TOKEN_TIMEOUT_MS = 90000;
/** 整体硬上限：无论是否有数据，超过即中止（推理模型流式推理阶段可能持续数分钟） */
export const LLM_MAX_DURATION_MS = 300000;

/** 兼容旧常量名（v2.x 废弃，保留给外部引用不报错） */
export const LLM_TIMEOUT_MS = LLM_INTER_TOKEN_TIMEOUT_MS;

// v2.x: 消息类型定义（含工具往返）
export type LlmToolCall =
    | { id: string; name: string; arguments: string }  // 内部简化格式
    | { id: string; type: "function"; function: { name: string; arguments: string } }; // OpenAI 兼容格式

export type LlmToolDefinition = {
    type: "function";
    function: {
        name: string;
        description?: string;
        parameters: Record<string, unknown>;
    };
};

export type LlmMessage =
    | {
        role: "system" | "user" | "assistant";
        content: string | null;
        tool_calls?: Array<{ id: string; name?: string; arguments?: string; type?: "function"; function?: { name: string; arguments: string } }>;
    }
    | { role: "tool"; tool_call_id: string; content: string };

// v2.x: 结构化错误类型 —— 调用方可据此判断是否可重试
export type LlmErrorKind =
    | "network"      // fetch 本身抛 TypeError（CORS / 断网）
    | "timeout"      // idle / hard timer abort
    | "rate_limit"   // 429
    | "auth"         // 401 / 403
    | "quota"        // 402
    | "bad_request"  // 400 / 422
    | "server"       // 5xx
    | "aborted";     // 用户取消

export class LlmError extends Error {
    constructor(
        public kind: LlmErrorKind,
        message: string,
        public status?: number,
        public retryAfterMs?: number,   // 来自 Retry-After 头
        public retryable: boolean = ["network", "timeout", "rate_limit", "server"].includes(kind),
    ) { super(message); this.name = "LlmError"; }
}

// v1.0.6: 缓存命中状态（模块级，跨请求隔离）
interface CacheInfo {
  hit: boolean;
  hitTokens?: number;
}
let lastCacheInfo: CacheInfo = { hit: false };

/** v2.0: 可读的 HTTP 错误映射（借鉴外部工具 aiHttpErr 文案表），替换生抛 status */
export function formatLLMError(status: number, detail?: string): string {
  const brief = (d: string | undefined, n: number) => String(d ?? "").replace(/\s+/g, " ").slice(0, n);
  const b = brief(detail, 200);
  switch (status) {
    case 401: return "LLM 密钥不对（401）——请检查 API Key";
    case 402: return "LLM 账户余额不足（402）——请去服务商充值";
    case 403: return "LLM 这个密钥没权限（403）" + (b ? `：${b}` : "");
    case 404: return "LLM 接口地址不对（404）——多半少了 /v1/chat/completions" + (b ? `：${b}` : "");
    case 429: return "LLM 请求太频繁或额度用完（429）" + (b ? `：${b}` : "");
    case 400: return "LLM 请求被拒（400）——多半是模型名或参数不对" + (b ? `：${b}` : "");
    default:
      if (status >= 500) return `LLM 服务端出错（${status}）——稍后再试` + (b ? `：${b}` : "");
      return `LLM 接口返回 ${status}` + (b ? `：${b}` : "");
  }
}

/** v1.0.6: CORS 回退 fetch — 直接请求失败时走 ST 服务端代理 */
async function llmFetch(url: string, options: RequestInit): Promise<Response> {
  try {
    return await fetch(url, options);
  } catch (err) {
    if (!(err instanceof TypeError)) throw err;
    // CORS 错误 → 通过 ST 服务端代理重试
    const proxyOpts: RequestInit = { ...options };
    delete (proxyOpts as Record<string, unknown>).signal;
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

export function getLastCacheInfo(): CacheInfo {
  return { ...lastCacheInfo };
}

function stripPrefillContent(raw: string): string {
  const structuredPattern = /^\s*(?:\d+\s*(?:girls?|boys?|characters?|persons?|man|men|woman|women)(?:\s*[,，]\s*\d+\s*(?:girls?|boys?|characters?|persons?|man|men|woman|women))*\s*\.|\[?[Nn]o\s+visible\s+characters\]?\s*\.)/;
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (structuredPattern.test(lines[i])) {
      const stripped = lines.slice(i).join('\n');
      if (stripped !== raw) {
        logger.debug(`[image_st] 已剥离前导推理/预填充文本 (${raw.length - stripped.length} chars)`);
      }
      return stripped;
    }
  }
  const cleaned = raw.replace(/^[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\s，。、；：？！""''（）【】《》——……·]+/, '');
  if (cleaned !== raw) {
    logger.debug(`[image_st] 已剥离前导中文字符 (${raw.length - cleaned.length} chars)`);
    return cleaned;
  }
  return raw;
}

export interface CallLLMOptions {
    messages: LlmMessage[];
    apiKey: string;
    url?: string;
    model?: string;
    maxTokens?: number;
    signal?: AbortSignal;
    reasoningEffort?: string;
    temperature?: number;
    top_p?: number;
    thinkingBudget?: number;
    jsonMode?: boolean;
    tools?: LlmToolDefinition[];
    toolCallsOut?: LlmToolCall[];
    onProgress?: (info: { chars: number; reasoningChars: number; elapsedMs: number }) => void;
}

export async function callLLM(options: CallLLMOptions): Promise<string> {
    const {
        messages,
        apiKey,
        url = LLM_URL_DEFAULT,
        model = LLM_MODEL_DEFAULT,
        maxTokens = 0,
        signal,
        reasoningEffort,
        temperature,
        top_p,
        thinkingBudget,
        jsonMode = false,
        tools,
        toolCallsOut,
        onProgress,
    } = options;

    // v1.0.6: 重置缓存状态，防止跨请求污染
    lastCacheInfo = { hit: false };
    const startTime = performance.now();
    let firstByteReceived = false;
    let _lastContentAt = startTime;
    let content = "";
    let reasoningFallback = "";
    logger.debug(`[image_st] LLM timing: request start (0ms)`);

    const ctrl = new AbortController();
    let firstByteTimer: ReturnType<typeof setTimeout> | undefined;
    let interTokenTimer: ReturnType<typeof setTimeout> | undefined;
    let lastProgressAt = 0;

    const emitProgress = (force = false) => {
        if (!onProgress) return;
        const now = Date.now();
        if (!force && now - lastProgressAt < 100) return;
        lastProgressAt = now;
        onProgress({
            chars: content.length,
            reasoningChars: reasoningFallback.length,
            elapsedMs: now - startTime,
        });
    };

    const abortWithError = (err: LlmError) => {
        ctrl.abort(err);
    };

    const startFirstByteTimer = () => {
        if (firstByteTimer) clearTimeout(firstByteTimer);
        firstByteTimer = setTimeout(() => {
            abortWithError(new LlmError("timeout", `首字节超时 (${LLM_FIRST_BYTE_TIMEOUT_MS / 1000}s)`, undefined, undefined, true));
        }, LLM_FIRST_BYTE_TIMEOUT_MS);
    };

    const resetInterTokenTimer = () => {
        if (interTokenTimer) clearTimeout(interTokenTimer);
        interTokenTimer = setTimeout(() => {
            abortWithError(new LlmError("timeout", `Token 间隔超时 (${LLM_INTER_TOKEN_TIMEOUT_MS / 1000}s)`, undefined, undefined, true));
        }, LLM_INTER_TOKEN_TIMEOUT_MS);
    };

    startFirstByteTimer();
    const hardTimer = setTimeout(() => {
        abortWithError(new LlmError("timeout", `总时长超时 (${LLM_MAX_DURATION_MS / 1000}s)`, undefined, undefined, true));
    }, LLM_MAX_DURATION_MS);

    if (signal) {
        if (signal.aborted) {
            ctrl.abort(new LlmError("aborted", "用户取消"));
        } else {
            signal.addEventListener("abort", () => ctrl.abort(new LlmError("aborted", "用户取消")), { once: true });
        }
    }

    try {
        const body: Record<string, unknown> = { model, messages, stream: true };
        // v2.2: function calling（工具定义由调用方提供；模型可请求调用 MCP 标签检索）
        if (tools && tools.length) {
            body.tools = tools;
            body.tool_choice = "auto";
            // 有工具时不发 response_format（部分网关不允许同时启用）
            if (jsonMode) {
                logger.warn("[image_st] llm_json_mode=true 但检测到工具调用，将回退到 <thinking>+<json> 标签格式（原生 response_format 被禁用）。建议：关闭标签工具或使用支持 tools+json_object 共存的网关");
            }
        }
        // 后续原 jsonMode 分支改为：
        if (jsonMode && !(tools && tools.length)) {
            body.response_format = { type: "json_object" };
        }
        const contextLength = getModelContextLength(model);
        if (maxTokens > 0) {
            body.max_tokens = clampMaxTokens(maxTokens, contextLength);
        }

        // v2.x: 按「模型家族」适配参数（硅基流动 GLM/Kimi/Qwen/DeepSeek）。
        // 不再用 URL 字符串猜测网关；仅对未知家族(generic)保留旧的 URL 判断兜底。
        const family = detectModelFamily(model);
        const knownFamily = familySupportsThinking(family);

        if (knownFamily) {
            // 已知思考型家族 —— 用模型自身的思考字段形态
            const mapped = normalizeEffort(reasoningEffort);
            if (mapped) {
                // v2.6：DeepSeek 两家网关的思考字段形态不同 → 按 URL 判定
                const gateway = detectGateway(url);
                Object.assign(body, buildThinkingFields({ model, reasoningEffort, thinkingBudget, gateway }));
                // v2.6（DeepSeek V4.1-Flash）：**思考模式下 top_p 依然生效**（官方：deepseek-flash
                //   在 thinking mode 下 top_p 有效，<0.95 会被抬到 0.95），官方推荐 temperature 1.0 +
                //   top_p 0.95~1.0；但 temperature 在思考模式下被模型忽略（传了也无效）。
                //   → 只补发 top_p，不补发 temperature。
                if (family === "deepseek" && top_p !== undefined) body.top_p = top_p;
                logger.debug(
                    `[image_st] [${family}/${gateway}] thinking=enabled effort=${mapped} budget=${thinkingBudget ?? 0} ctx=${contextLength}${family === "deepseek" ? ` top_p=${top_p}` : ""}`,
                );
            } else {
                Object.assign(body, buildThinkingFields({ model, gateway: detectGateway(url) }));
                if (temperature !== undefined) body.temperature = temperature;
                if (top_p !== undefined) body.top_p = top_p;
                if (jsonMode && !(tools && tools.length)) body.response_format = { type: "json_object" };
                // v2.1: GLM-5.3 系为强制思考模型，此分支实际仍会 enabled+low（buildThinkingFields 内处理）
                const forcedGLM = isGLMForcedThinking(model);
                logger.debug(`[image_st] [${family}] thinking=${forcedGLM ? "forced(enabled, effort=low)" : "disabled"} ctx=${contextLength}${jsonMode ? ", json_mode=enabled" : ""}`);
            }
        } else {
            // generic —— 保留旧逻辑：URL 含 openrouter/openai/anthropic 时剥离 DeepSeek 专属字段
            const urlLower = (url ?? "").toLowerCase();
            const isDeepSeekCompat = !/(openrouter|openai|api\.anthropic|\/openai\/)/.test(urlLower);
            const mapped = normalizeEffort(reasoningEffort);
            if (mapped) {
                if (isDeepSeekCompat) {
                    body.reasoning_effort = mapped;
                    body.thinking = { type: "enabled" };
                    if (thinkingBudget && thinkingBudget > 0) {
                        body.extra_body = { thinking_budget: thinkingBudget };
                    }
                } else {
                    // 非 DeepSeek 网关：映射为 OpenAI 兼容的 reasoning 参数（OpenRouter 透传 reasoning）
                    body.reasoning = { effort: mapped };
                }
                logger.debug(`[image_st] [generic] thinking=enabled, mapped=${mapped}`);
            } else {
                if (temperature !== undefined) body.temperature = temperature;
                if (top_p !== undefined) body.top_p = top_p;
                if (isDeepSeekCompat) body.thinking = { type: "disabled" };
                if (jsonMode && !(tools && tools.length)) {
                    body.response_format = { type: "json_object" };
                    if (isDeepSeekCompat) body.enable_thinking = false;
                } else if (jsonMode && tools && tools.length) {
                    logger.warn("[image_st] llm_json_mode=true 但检测到工具调用，将回退到 <thinking>+<json> 标签格式（原生 response_format 被禁用）");
                }
                logger.debug(`[image_st] [generic] thinking=disabled${jsonMode ? ", json_mode=enabled" : ""}`);
            }
        }

        const response = await llmFetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: ctrl.signal,
        });

        // 首字节已收到
        firstByteReceived = true;
        if (firstByteTimer) clearTimeout(firstByteTimer);
        resetInterTokenTimer();
        logger.debug(`[image_st] LLM timing: response headers received (${Math.round(performance.now() - startTime)}ms)`);

        if (!response.ok) {
            const elapsed = Math.round(performance.now() - startTime);
            const detail = await response.text().catch(() => "");
            const retryAfter = response.headers.get("Retry-After");
            const retryAfterMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : undefined;

            let kind: LlmErrorKind;
            switch (response.status) {
                case 401:
                case 403:
                    kind = "auth";
                    break;
                case 402:
                    kind = "quota";
                    break;
                case 429:
                    kind = "rate_limit";
                    break;
                case 400:
                case 422:
                    kind = "bad_request";
                    break;
                default:
                    if (response.status >= 500) kind = "server";
                    else kind = "bad_request";
            }
            throw new LlmError(kind, `${formatLLMError(response.status, detail)} (after ${elapsed}ms)`, response.status, retryAfterMs);
        }

        const contentType = response.headers.get("content-type") ?? "";
        logger.debug(`[image_st] LLM response content-type: "${contentType}", status: ${response.status}`);
        if (!response.body || !contentType.includes("text/event-stream")) {
            logger.debug(`[image_st] LLM timing: non-stream path (body=${!!response.body}, contentType=${contentType})`);
            const data = await response.json();
            const msg = data.choices?.[0]?.message ?? {};
            const nonContent = msg.content ?? "";
            // v2.2: 非流式也可能有工具调用
            if (toolCallsOut && Array.isArray(msg.tool_calls)) {
                for (const tc of msg.tool_calls) {
                    toolCallsOut.push({
                        id: String(tc.id ?? ""),
                        name: String(tc.function?.name ?? ""),
                        arguments: String(tc.function?.arguments ?? ""),
                    });
                }
            }
            if (!nonContent) {
                console.warn(`[image_st] LLM non-stream response empty content, choices keys: ${Object.keys(data.choices?.[0] ?? {}).join(",")}`);
            }
            logger.debug(`[image_st] LLM timing: response parsed (${Math.round(performance.now() - startTime)}ms, non-stream fallback), content length: ${nonContent.length}`);
            return stripPrefillContent(nonContent);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let done = false;
        /** v2.2: 流式工具调用增量（按 index 聚合） */
        // 内部使用简化格式 { id, name, arguments }
        const toolAcc = new Map<number, { id: string; name: string; arguments: string }>();

        const processPayload = (payload: string) => {
            if (payload === "[DONE]") { done = true; return; }
            try {
                const chunk = JSON.parse(payload);
                if (chunk.usage) {
                    const hit = chunk.usage.prompt_cache_hit_tokens || chunk.usage.cache_read_input_tokens || 0;
                    if (hit > 0) lastCacheInfo = { hit: true, hitTokens: hit };
                }
                const delta = chunk.choices?.[0]?.delta;
                if (!delta) return;
                if (typeof delta.content === "string" && delta.content.length > 0) {
                    content += delta.content;
                    _lastContentAt = Date.now();
                    resetInterTokenTimer();
                    emitProgress();
                }
                if (typeof delta.reasoning_content === "string") {
                    reasoningFallback += delta.reasoning_content;
                    // reasoning_content 只更新 _lastContentAt（用于 total timeout 判断"还在动"）
                    // 但不重置 interToken 计时（否则模型只输出 reasoning 时永远不超时）
                    _lastContentAt = Date.now();
                }
                // 工具调用增量：{ index, id, function: { name, arguments } }
                if (toolCallsOut && Array.isArray(delta.tool_calls)) {
                    for (const tc of delta.tool_calls) {
                        const idx = typeof tc.index === "number" ? tc.index : 0;
                        const acc = toolAcc.get(idx) ?? { id: "", name: "", arguments: "" };
                        if (tc.id) acc.id = String(tc.id);
                        if (tc.function?.name) acc.name = String(tc.function.name);
                        if (typeof tc.function?.arguments === "string") acc.arguments += tc.function.arguments;
                        toolAcc.set(idx, acc);
                    }
                }
            } catch {
                // 忽略不完整的 SSE 行
            }
        };

        try {
            while (!done) {
                const { value, done: streamDone } = await reader.read();
                if (streamDone) {
                    const remaining = buffer.trim();
                    if (remaining && remaining.startsWith("data:")) {
                        processPayload(remaining.slice(5).trim());
                    }
                    break;
                }
                buffer += decoder.decode(value, { stream: true });

                let lineEnd;
                while ((lineEnd = buffer.indexOf("\n")) >= 0) {
                    const line = buffer.slice(0, lineEnd).trim();
                    buffer = buffer.slice(lineEnd + 1);
                    if (!line.startsWith("data:")) continue;
                    processPayload(line.slice(5).trim());
                }
            }
        } finally {
            reader.releaseLock();
        }

        emitProgress(true);

        if (!content && reasoningFallback) {
            logger.debug(`[image_st] 使用 reasoning_content 作为提示词 (${reasoningFallback.length} chars)`);
            content = reasoningFallback;
        }
        if (toolCallsOut) {
            for (const acc of toolAcc.values()) {
                if (acc.name) toolCallsOut.push(acc);
            }
            if (toolCallsOut.length) {
                logger.debug(`[image_st] LLM 发起 ${toolCallsOut.length} 次工具调用`);
            }
        }
        content = stripPrefillContent(content);
        logger.debug(`[image_st] LLM timing: response parsed (${Math.round(performance.now() - startTime)}ms), content length: ${content.length}`);
        return content;
    } catch (err) {
        // 将非 LlmError 的异常转换为结构化错误
        if (err instanceof LlmError) throw err;

        if (err instanceof DOMException) {
            if (err.name === "AbortError") {
                // 区分用户取消 vs 内部超时
                if (ctrl.signal.reason instanceof LlmError) throw ctrl.signal.reason;
                throw new LlmError("aborted", "请求被中止");
            }
            if (err.name === "TimeoutError") {
                if (firstByteReceived) {
                    throw new LlmError("timeout", `请求超时 (${LLM_INTER_TOKEN_TIMEOUT_MS / 1000}s 无内容)`, undefined, undefined, true);
                } else {
                    throw new LlmError("timeout", `首字节超时 (${LLM_FIRST_BYTE_TIMEOUT_MS / 1000}s)`, undefined, undefined, true);
                }
            }
        }
        if (err instanceof TypeError) {
            // 网络错误 / CORS
            throw new LlmError("network", `网络错误: ${err.message}`, undefined, undefined, true);
        }
        throw new LlmError("server", String(err), undefined, undefined, false);
    } finally {
        if (firstByteTimer) clearTimeout(firstByteTimer);
        if (interTokenTimer) clearTimeout(interTokenTimer);
        clearTimeout(hardTimer);
    }
}
