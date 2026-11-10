// @ts-expect-error — resolved at runtime by ST
import { extension_settings } from "../../../../../scripts/extensions.js";
import { logger } from "./logger.js";
export const SETTINGS_KEY = "image_st";
function createLatentMoeError(message, options = { retryable: false }) {
    const err = new Error(message);
    err.retryable = options.retryable;
    err.status = options.status;
    err.code = options.code;
    return err;
}
const LATENT_MOE_DEFAULTS = {
    apiKey: "",
    resolution: "portrait",
    steps: 12,
    sampler: "euler",
    scheduler: "sgm_uniform",
    negativePrompt: "low quality, blurry, malformed hands, bad anatomy, extra limbs, missing limbs, fused fingers, too many fingers, long neck, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry, bad feet",
};
const POLL_INTERVAL_MS = 1000;
const MAX_POLL_RETRIES = 3;
const POLL_BACKOFF_BASE_MS = 2000;
function getLatentMoeSettings() {
    const s = extension_settings[SETTINGS_KEY];
    if (!s)
        return LATENT_MOE_DEFAULTS;
    return {
        apiKey: String(s.latent_api_key ?? ""),
        resolution: s.latent_resolution ?? LATENT_MOE_DEFAULTS.resolution,
        steps: Number(s.latent_steps ?? LATENT_MOE_DEFAULTS.steps),
        sampler: s.latent_sampler ?? LATENT_MOE_DEFAULTS.sampler,
        scheduler: s.latent_scheduler ?? LATENT_MOE_DEFAULTS.scheduler,
        negativePrompt: String(s.latent_negative_prompt ?? LATENT_MOE_DEFAULTS.negativePrompt),
    };
}
/**
 * 具备 CORS 回退机制的 fetch：直连失败时自动走 ST 服务端代理 /proxy/<encoded-url>
 * 用于 generateViaNativeAPI 中的轮询请求
 */
async function fetchWithProxyFallback(url, options) {
    try {
        return await fetch(url, options);
    }
    catch (err) {
        if (!(err instanceof TypeError))
            throw err;
        // CORS / 网络错误 → 走 ST 服务端代理
        const proxyOpts = { ...options };
        delete proxyOpts.signal;
        const targetHeaders = options.headers instanceof Headers
            ? Object.fromEntries(options.headers.entries())
            : options.headers ?? {};
        proxyOpts.headers = targetHeaders;
        proxyOpts.credentials = "include";
        return await fetch(`/proxy/${encodeURIComponent(url)}`, proxyOpts);
    }
}
/**
 * 带退避重试的 fetchWithProxyFallback
 */
async function fetchWithProxyFallbackRetry(url, options, maxRetries = MAX_POLL_RETRIES) {
    let lastErr;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fetchWithProxyFallback(url, options);
        }
        catch (err) {
            lastErr = err;
            if (attempt < maxRetries) {
                const delay = POLL_BACKOFF_BASE_MS * Math.pow(2, attempt) + Math.random() * 500;
                logger.debug(`[latent.moe] Poll fetch failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${Math.round(delay)}ms:`, err);
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }
    throw lastErr;
}
const BASE_URL = "https://latent.moe";
const NOVELAI_ENDPOINT = "/api/novelai/ai/generate-image";
/**
 * 安全的 Uint8Array 转 Base64，分块处理避免栈溢出（iOS Safari 对大数组展开有限制）
 * 参考: test-latent-moe.mjs 中的分块回退方案
 */
function uint8ArrayToBase64(bytes) {
    const chunkSize = 0x8000; // 32KB chunks
    const chunks = [];
    for (let i = 0; i < bytes.length; i += chunkSize) {
        chunks.push(String.fromCharCode(...bytes.slice(i, i + chunkSize)));
    }
    return btoa(chunks.join(""));
}
/**
 * 安全地将 Blob 转为 Base64，使用 FileReader 避免大数组展开
 * 返回不含 data: 前缀的 base64 字符串
 */
async function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1] ?? "");
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}
/**
 * 从 ZIP 数据中提取第一个 PNG 图片
 * 支持 image_0.png、image_*.png 或直接返回的 PNG
 */
function extractPngFromZip(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const decoder = new TextDecoder();
    let pos = 0;
    while (pos < bytes.length - 30) {
        if (view.getUint32(pos, true) === 0x04034b50) { // Local file header signature
            const nameLen = view.getUint16(pos + 26, true);
            const extraLen = view.getUint16(pos + 28, true);
            const compressedSize = view.getUint32(pos + 18, true);
            const headerSize = 30 + nameLen + extraLen;
            const nameBytes = bytes.slice(pos + 30, pos + 30 + nameLen);
            const name = decoder.decode(nameBytes);
            if (name.endsWith(".png") || name === "image_0.png") {
                const fileData = bytes.slice(pos + headerSize, pos + headerSize + compressedSize);
                return fileData;
            }
            pos += headerSize + compressedSize;
        }
        else {
            pos++;
        }
    }
    return null;
}
/**
 * 使用 NovelAI 兼容端点（支持 CORS，浏览器可直接调用）
 * 返回 ZIP 包含 image_0.png 或直接返回 PNG
 */
async function generateViaNovelAIEndpoint(prompt, settings, signal) {
    const { apiKey, resolution, steps, sampler, scheduler, negativePrompt } = settings;
    if (!apiKey)
        throw createLatentMoeError("latent.moe API Key 未配置", { retryable: false, code: "NO_API_KEY" });
    // NovelAI 端点参数映射
    // width/height 会被服务端 clamp 到三种标准尺寸之一
    const sizeMap = {
        square: { width: 1024, height: 1024 },
        portrait: { width: 920, height: 1536 }, // 服务端实际返回 920×1536
        landscape: { width: 1536, height: 920 },
    };
    const { width, height } = sizeMap[resolution];
    // sampler 映射：NovelAI sampler -> latent.moe sampler
    const samplerMap = {
        "k_euler": "euler",
        "k_euler_ancestral": "euler",
        "k_dpmpp_2s_ancestral": "res_multistep",
        "k_dpmpp_2m": "res_multistep",
        "k_dpmpp_sde": "er_sde",
        "k_dpmpp_2m_sde": "er_sde",
        "ddim": "er_sde",
    };
    const naiSampler = Object.keys(samplerMap).find(k => samplerMap[k] === sampler) ?? "k_euler_ancestral";
    // noise_schedule 映射
    const schedulerMap = {
        "karras": "sgm_uniform",
        "exponential": "beta",
        "polyexponential": "beta57",
        "normal": "sgm_uniform",
    };
    const naiScheduler = Object.keys(schedulerMap).find(k => schedulerMap[k] === scheduler) ?? "karras";
    // steps clamp: 8-12 (服务端会 clamp，30 会变成 16)
    const clampedSteps = Math.max(8, Math.min(12, steps));
    const payload = {
        input: prompt,
        model: "nai-diffusion-4-5-full", // 必填，但服务端只跑一个 checkpoint
        parameters: {
            width,
            height,
            steps: clampedSteps,
            sampler: naiSampler,
            noise_schedule: naiScheduler,
            cfg_scale: 4, // 服务端固定 CFG，忽略该参数
            negative_prompt: negativePrompt,
        },
    };
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000); // 3 分钟超时
    // 合并信号
    if (signal) {
        signal.addEventListener("abort", () => controller.abort());
    }
    /** 带 CORS 回退的 fetch：直连失败时走 ST 服务端代理 /proxy/<encoded-url> */
    async function latentFetch(url, options) {
        try {
            return await fetch(url, options);
        }
        catch (err) {
            if (!(err instanceof TypeError))
                throw err;
            // CORS / 网络错误 → 走 ST 代理（需 config.yaml: enableCorsProxy: true）
            const proxyOpts = { ...options };
            delete proxyOpts.signal; // signal 不透传给代理
            // 只保留目标服务需要的头；credentials: include 让浏览器自动带 ST basicAuth
            const targetHeaders = options.headers instanceof Headers
                ? Object.fromEntries(options.headers.entries())
                : options.headers ?? {};
            proxyOpts.headers = targetHeaders;
            proxyOpts.credentials = "include";
            return await fetch(`/proxy/${encodeURIComponent(url)}`, proxyOpts);
        }
    }
    try {
        const resp = await latentFetch(`${BASE_URL}${NOVELAI_ENDPOINT}`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (!resp.ok) {
            const errText = await resp.text().catch(() => "");
            let msg = `latent.moe 生成失败: ${resp.status}`;
            let retryable = false;
            if (resp.status === 401)
                msg = "API Key 无效或已撤销";
            else if (resp.status === 402)
                msg = "本周额度已用完";
            else if (resp.status === 429) {
                msg = "有任务正在进行中或队列已满";
                retryable = true;
            }
            else if (resp.status === 504) {
                msg = "渲染超时，任务仍在后台继续";
                retryable = true;
            }
            else if (resp.status >= 500) {
                msg = `服务端错误 (${resp.status})`;
                retryable = true;
            }
            if (errText)
                msg += ` — ${errText.slice(0, 200)}`;
            throw createLatentMoeError(msg, { retryable, status: resp.status });
        }
        // ReadableStream 分块读取 ZIP，避免一次性 arrayBuffer 撑爆内存
        if (!resp.body)
            throw createLatentMoeError("Response body is null", { retryable: false });
        const reader = resp.body.getReader();
        const chunks = [];
        let total = 0;
        const MAX_ZIP_SIZE = 15 * 1024 * 1024; // 15MB
        let readTimeoutId;
        const READ_CHUNK_TIMEOUT_MS = 30000; // 单次读取超时 30 秒
        const readWithTimeout = async () => {
            const promise = reader.read();
            const timeoutPromise = new Promise((_, reject) => {
                readTimeoutId = setTimeout(() => reject(new Error("Read chunk timeout")), READ_CHUNK_TIMEOUT_MS);
            });
            try {
                return await Promise.race([promise, timeoutPromise]);
            }
            finally {
                clearTimeout(readTimeoutId);
            }
        };
        try {
            while (true) {
                if (controller.signal.aborted)
                    throw createLatentMoeError("生成已取消", { retryable: false, code: "ABORTED" });
                const { done, value } = await readWithTimeout();
                if (done)
                    break;
                if (value) {
                    chunks.push(value);
                    total += value.length;
                    if (total > MAX_ZIP_SIZE)
                        throw createLatentMoeError("ZIP too large (>15MB)", { retryable: false });
                }
            }
        }
        finally {
            reader.releaseLock();
        }
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
        }
        // 优先尝试作为 ZIP 解析，找第一个 PNG
        let pngData = extractPngFromZip(bytes);
        // 如果不是 ZIP 或 ZIP 中没找到 PNG，检查是否直接是 PNG
        if (!pngData) {
            if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
                pngData = bytes;
            }
            else {
                throw createLatentMoeError("响应中未找到 PNG 图片数据", { retryable: false });
            }
        }
        const base64 = uint8ArrayToBase64(pngData);
        return { format: "png", data: base64 };
    }
    catch (err) {
        clearTimeout(timeoutId);
        if (err instanceof DOMException && err.name === "AbortError") {
            throw createLatentMoeError("生成已取消或超时", { retryable: false, code: "ABORTED" });
        }
        if (err && typeof err === "object" && "retryable" in err)
            throw err;
        throw createLatentMoeError(`NovelAI 端点调用失败: ${err.message}`, { retryable: true });
    }
}
/**
 * 使用原生 /api/generate 流程（需服务端代理，不支持 CORS）
 * 适合后端调用或配置了代理的环境
 * 失败回退到 ST 服务端代理 /proxy/<encoded-url>
 */
async function generateViaNativeAPI(prompt, settings, signal) {
    const { apiKey, resolution, steps, sampler, scheduler, negativePrompt } = settings;
    if (!apiKey)
        throw createLatentMoeError("latent.moe API Key 未配置", { retryable: false, code: "NO_API_KEY" });
    // 1. 提交生成任务 - 尝试直连，CORS失败时回退到 ST 代理
    const submitUrl = `${BASE_URL}/api/generate`;
    const submitOpts = {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            prompt,
            negativePrompt,
            resolution,
            steps: Math.max(8, Math.min(12, steps)),
            sampler,
            scheduler,
        }),
        signal,
    };
    let submitResp;
    try {
        submitResp = await fetch(submitUrl, submitOpts);
    }
    catch (err) {
        if (!(err instanceof TypeError))
            throw err;
        // CORS / 网络错误 → 走 ST 服务端代理
        const proxyOpts = { ...submitOpts };
        delete proxyOpts.signal;
        const targetHeaders = submitOpts.headers instanceof Headers
            ? Object.fromEntries(submitOpts.headers.entries())
            : submitOpts.headers ?? {};
        proxyOpts.headers = targetHeaders;
        proxyOpts.credentials = "include";
        submitResp = await fetch(`/proxy/${encodeURIComponent(submitUrl)}`, proxyOpts);
    }
    if (!submitResp.ok) {
        const err = await submitResp.text().catch(() => "");
        const retryable = submitResp.status >= 500 || submitResp.status === 429;
        throw createLatentMoeError(`提交任务失败: ${submitResp.status} ${err}`, { retryable, status: submitResp.status });
    }
    const { id: jobId } = await submitResp.json();
    logger.debug("[latent.moe] Job queued:", jobId);
    // 2. 轮询状态 - 带退避重试和显式状态处理
    const maxPolls = 180; // 3 分钟
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 5;
    // 可见性感知：后台暂停轮询
    let hidden = false;
    if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", () => { hidden = document.hidden; });
        hidden = document.hidden;
    }
    for (let i = 0; i < maxPolls; i++) {
        if (signal?.aborted)
            throw createLatentMoeError("生成已取消", { retryable: false, code: "ABORTED" });
        // 后台：长轮询 5s，不发请求
        if (hidden) {
            await new Promise(r => setTimeout(r, 5000));
            continue;
        }
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
        try {
            const pollResp = await fetchWithProxyFallbackRetry(`${BASE_URL}/api/generate/${jobId}`, {
                headers: { "Authorization": `Bearer ${apiKey}` },
                signal,
            });
            if (!pollResp.ok) {
                consecutiveErrors++;
                if (consecutiveErrors >= maxConsecutiveErrors) {
                    throw createLatentMoeError(`轮询连续失败 ${maxConsecutiveErrors} 次`, { retryable: true, status: pollResp.status });
                }
                logger.debug(`[latent.moe] Poll HTTP ${pollResp.status}, retrying... (${consecutiveErrors}/${maxConsecutiveErrors})`);
                continue;
            }
            consecutiveErrors = 0;
            const job = await pollResp.json();
            logger.debug("[latent.moe] Job status:", job.status);
            if (job.status === "completed" && job.artwork_id) {
                // 3. 获取图片
                const mediaResp = await fetchWithProxyFallbackRetry(`${BASE_URL}/api/media/${job.artwork_id}?size=preview`, {
                    headers: { "Authorization": `Bearer ${apiKey}` },
                    signal,
                });
                if (!mediaResp.ok) {
                    throw createLatentMoeError("获取图片失败", { retryable: true, status: mediaResp.status });
                }
                const blob = await mediaResp.blob();
                const format = blob.type === "image/png" ? "png" : "webp";
                const data = await blobToBase64(blob);
                return { format, data };
            }
            if (job.status === "failed" || job.status === "cancelled") {
                throw createLatentMoeError(`生成失败: ${job.error ?? job.status}`, { retryable: false, code: job.status.toUpperCase() });
            }
            // queued, leased, running - 继续轮询
        }
        catch (err) {
            if (signal?.aborted)
                throw createLatentMoeError("生成已取消", { retryable: false, code: "ABORTED" });
            if (err && typeof err === "object" && "retryable" in err)
                throw err;
            consecutiveErrors++;
            if (consecutiveErrors >= maxConsecutiveErrors) {
                throw createLatentMoeError(`轮询异常: ${err.message}`, { retryable: true });
            }
            logger.debug(`[latent.moe] Poll error, retrying... (${consecutiveErrors}/${maxConsecutiveErrors}):`, err);
        }
    }
    throw createLatentMoeError("生成超时（超过 3 分钟）", { retryable: true, code: "TIMEOUT" });
}
/**
 * 统一入口：优先尝试 NovelAI 端点（浏览器直连），失败回退原生 API（需代理）
 */
export async function generateLatentMoeImage(prompt, signal) {
    const settings = getLatentMoeSettings();
    // 优先 NovelAI 端点（CORS OK）
    try {
        logger.debug("[latent.moe] Trying NovelAI endpoint...");
        return await generateViaNovelAIEndpoint(prompt, settings, signal);
    }
    catch (err) {
        const latentErr = err;
        logger.warn("[latent.moe] NovelAI endpoint failed, trying native API:", err);
        // 如果是不可重试的错误（如 API Key 无效），直接抛出
        if (latentErr?.retryable === false)
            throw err;
        // 回退原生 API（需要 ST 代理支持）
        return await generateViaNativeAPI(prompt, settings, signal);
    }
}
/** 获取当前选择的后端 */
export function getGenerationBackend() {
    const s = extension_settings[SETTINGS_KEY];
    return s?.generation_backend ?? "comfyui";
}
/** 检查 latent.moe 是否已配置 */
export function isLatentMoeConfigured() {
    const s = extension_settings[SETTINGS_KEY];
    return !!s?.latent_api_key?.trim();
}
const RUNNINGHUB_BASE = "https://www.runninghub.ai";
function getRunningHubSettings() {
    const s = extension_settings[SETTINGS_KEY];
    if (!s)
        return { apiKey: "", workflowId: "", promptNodeId: "", negativeNodeId: "", negativePrompt: "" };
    return {
        apiKey: String(s.rh_api_key ?? ""),
        workflowId: String(s.rh_workflow_id ?? ""),
        promptNodeId: String(s.rh_prompt_node_id ?? ""),
        negativeNodeId: String(s.rh_negative_node_id ?? ""),
        negativePrompt: String(s.rh_negative_prompt ?? ""),
    };
}
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
/** 将远程图片 URL 下载并转为 base64 字符串（带大小限制防 OOM） */
async function fetchImageAsBase64(url, signal) {
    const resp = await fetch(url, { signal });
    if (!resp.ok)
        throw new Error(`图片下载失败: ${resp.status}`);
    if (!resp.body)
        throw new Error("Response body is null");
    const reader = resp.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        if (value) {
            chunks.push(value);
            total += value.length;
            if (total > MAX_IMAGE_SIZE)
                throw new Error("Image too large (>10MB)");
        }
    }
    const blob = new Blob(chunks);
    const format = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "jpg";
    const data = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result.split(",")[1]);
        fr.onerror = reject;
        fr.readAsDataURL(blob);
    });
    return { data, format };
}
/**
 * RunningHub 生成入口。
 *
 * 流程：
 *   1. POST /task/openapi/create  → taskId
 *   2. 轮询 POST /task/openapi/outputs（1 秒间隔，最多 5 分钟）
 *      - code=0 且 data 数组非空 → 取 fileUrl，完成
 *      - code=0 且 data 为空   → 仍在运行，继续轮询
 *      - code 非 0              → 任务失败
 *   3. 下载 fileUrl → base64
 */
export async function generateRunningHubImage(prompt, signal) {
    const settings = getRunningHubSettings();
    const { apiKey, workflowId, promptNodeId, negativeNodeId, negativePrompt } = settings;
    if (!apiKey)
        throw new Error("RunningHub API Key 未配置");
    if (!workflowId)
        throw new Error("RunningHub 工作流 ID 未配置");
    if (!promptNodeId)
        throw new Error("RunningHub 提示词节点 ID 未配置");
    const headers = {
        "Content-Type": "application/json",
    };
    // 1. 构造 nodeInfoList
    const nodeInfoList = [
        { nodeId: promptNodeId, fieldName: "text", fieldValue: prompt },
    ];
    if (negativeNodeId.trim() && negativePrompt.trim()) {
        nodeInfoList.push({ nodeId: negativeNodeId, fieldName: "text", fieldValue: negativePrompt });
    }
    // 2. 提交任务
    if (signal?.aborted)
        throw new Error("生成已取消");
    logger.debug("[runninghub] Submitting task, workflowId:", workflowId);
    const createResp = await fetch(`${RUNNINGHUB_BASE}/task/openapi/create`, {
        method: "POST",
        headers,
        body: JSON.stringify({ apiKey, workflowId, nodeInfoList }),
        signal,
    });
    if (!createResp.ok) {
        const errText = await createResp.text().catch(() => "");
        let msg = `RunningHub 任务提交失败: ${createResp.status}`;
        if (createResp.status === 401 || createResp.status === 403)
            msg = "RunningHub API Key 无效或权限不足";
        else if (createResp.status === 429)
            msg = "RunningHub 请求过于频繁，请稍后重试";
        if (errText)
            msg += ` — ${errText.slice(0, 200)}`;
        throw new Error(msg);
    }
    const createBody = await createResp.json();
    if (createBody.code !== 0) {
        throw new Error(`RunningHub 任务提交失败 (code=${createBody.code}): ${createBody.msg}`);
    }
    const taskId = createBody.data?.taskId;
    if (!taskId)
        throw new Error("RunningHub 未返回 taskId");
    logger.debug("[runninghub] Task created, taskId:", taskId, "status:", createBody.data?.taskStatus);
    // 3. 轮询输出（最多 300 次 = 5 分钟）
    const MAX_POLLS = 300;
    // 可见性感知：后台暂停轮询
    let hidden = false;
    if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", () => { hidden = document.hidden; });
        hidden = document.hidden;
    }
    for (let i = 0; i < MAX_POLLS; i++) {
        if (signal?.aborted)
            throw new Error("生成已取消");
        // 后台：长轮询 5s，不发请求
        if (hidden) {
            await new Promise(r => setTimeout(r, 5000));
            continue;
        }
        await new Promise(r => setTimeout(r, 1000));
        if (signal?.aborted)
            throw new Error("生成已取消");
        let pollBody;
        try {
            const pollResp = await fetch(`${RUNNINGHUB_BASE}/task/openapi/outputs`, {
                method: "POST",
                headers,
                body: JSON.stringify({ apiKey, taskId }),
                signal,
            });
            if (!pollResp.ok) {
                logger.debug(`[runninghub] Poll HTTP ${pollResp.status}, retrying...`);
                continue;
            }
            pollBody = await pollResp.json();
        }
        catch (e) {
            if (signal?.aborted)
                throw new Error("生成已取消");
            logger.debug("[runninghub] Poll error, retrying:", e);
            continue;
        }
        if (pollBody.code !== 0) {
            // 常见：任务仍在运行时返回非 0 code（如 "task is running"）→ 继续等
            logger.debug(`[runninghub] Poll code=${pollBody.code} msg="${pollBody.msg}", retrying...`);
            continue;
        }
        // code=0 但 data 为空数组或 null → 任务尚未完成
        if (!Array.isArray(pollBody.data) || pollBody.data.length === 0) {
            logger.debug("[runninghub] Poll code=0 but no output yet, retrying...");
            continue;
        }
        // 取第一个有 fileUrl 的输出
        const output = pollBody.data.find(o => o.fileUrl);
        if (!output?.fileUrl) {
            logger.debug("[runninghub] Poll output has no fileUrl, retrying...");
            continue;
        }
        logger.debug("[runninghub] Task completed, fileUrl:", output.fileUrl);
        return await fetchImageAsBase64(output.fileUrl, signal);
    }
    throw new Error("RunningHub 任务超时（超过 5 分钟仍未完成）");
}
/** 检查 RunningHub 是否已完成最小配置（apiKey + workflowId + promptNodeId） */
export function isRunningHubConfigured() {
    const s = extension_settings[SETTINGS_KEY];
    return !!(s?.rh_api_key?.trim() && s?.rh_workflow_id?.trim() && s?.rh_prompt_node_id?.trim());
}
