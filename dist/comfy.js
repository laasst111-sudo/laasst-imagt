// @ts-expect-error — resolved at runtime by ST
import { extension_settings } from "../../../../../scripts/extensions.js";
import { getGenerationBackend } from "./onlineApi.js";
import { logger } from "./logger.js";
export const SETTINGS_KEY = "image_st";
export const LORA_SLOT_COUNT = 4;
const WORKFLOW_PATH = "/scripts/extensions/third-party/image-st/%EF%BC%88%E8%87%AA%E7%94%A8%EF%BC%89Anima%E6%AD%A3%E5%BC%8F%E7%89%88-%E6%96%87%E7%94%9F%E5%9B%BE%E5%B7%A5%E4%BD%9C%E6%B5%81.json";
let cachedWorkflow = null;
let cachedLoraList = [];
export const DEFAULTS = {
    comfyUrl: "http://127.0.0.1:8188",
    model: "animaFinalV2.Sqsh(2).safetensors",
    steps: 16,
    first_steps: 0,
    first_cfg: 4,
    first_sampler: "er_sde",
    first_scheduler: "simple",
    second_cfg: 1,
    second_sampler: "euler_ancestral",
    second_scheduler: "simple",
    width: 1280,
    height: 720,
    seed: 1,
    loraStrength: 0.6,
};
const EXPECTED_WORKFLOW_NODES = new Set([
    "348", "361", "562", "633", "580", "605", "604",
    "588", "579", "616", "617", "624", "619",
    "628", "627",
]);
function validateWorkflowNodes(workflow) {
    const p = JSON.parse(workflow);
    const missing = [];
    for (const nodeId of EXPECTED_WORKFLOW_NODES) {
        if (!(nodeId in p)) {
            missing.push(nodeId);
        }
    }
    if (missing.length > 0) {
        console.warn("[image_st] Workflow missing expected nodes:", missing.join(", "));
        throw new Error(`工作流结构不兼容: 缺失节点 ${missing.join(", ")}。\n` +
            `请确认内置工作流文件未被修改或替换。`);
    }
}
export const SAMPLERS = [
    "euler", "euler_cfg_pp", "euler_ancestral", "euler_ancestral_cfg_pp",
    "heun", "heunpp2", "exp_heun_2_x0", "exp_heun_2_x0_sde",
    "dpm_2", "dpm_2_ancestral",
    "lms", "dpm_fast", "dpm_adaptive",
    "dpmpp_2s_ancestral", "dpmpp_2s_ancestral_cfg_pp",
    "dpmpp_sde", "dpmpp_sde_gpu",
    "dpmpp_2m", "dpmpp_2m_cfg_pp",
    "dpmpp_2m_sde", "dpmpp_2m_sde_gpu", "dpmpp_2m_sde_heun", "dpmpp_2m_sde_heun_gpu",
    "dpmpp_3m_sde", "dpmpp_3m_sde_gpu",
    "ddpm", "lcm",
    "ipndm", "ipndm_v", "deis",
    "res_multistep", "res_multistep_cfg_pp", "res_multistep_ancestral", "res_multistep_ancestral_cfg_pp",
    "gradient_estimation", "gradient_estimation_cfg_pp",
    "er_sde", "seeds_2", "seeds_3",
    "sa_solver", "sa_solver_pece",
    "ddim", "uni_pc", "uni_pc_bh2",
];
export const SCHEDULERS = [
    "normal", "karras", "exponential", "sgm_uniform", "simple",
    "ddim_uniform", "beta", "linear_quadratic", "kl_optimal",
];
function getComfyUrl() {
    return extension_settings[SETTINGS_KEY]?.comfy_url ?? DEFAULTS.comfyUrl;
}
function randomSeed() {
    return Math.floor(Math.random() * 2 ** 32);
}
async function comfyFetch(path, options, retries = 2) {
    const baseUrl = getComfyUrl();
    const url = path.startsWith("http") ? path : `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fetch(url, options);
        }
        catch (err) {
            if (!(err instanceof TypeError) || attempt === retries)
                throw err;
            // CORS/网络错误 → 退避后走 ST 服务端代理
            await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
            const proxyOptions = options ? { ...options } : {};
            delete proxyOptions.signal;
            const proxyResp = await fetch(`/proxy/${encodeURIComponent(url)}`, {
                ...proxyOptions,
                credentials: "include",
                headers: options?.headers instanceof Headers
                    ? Object.fromEntries(options.headers.entries())
                    : options?.headers,
            });
            if (proxyResp.ok)
                return proxyResp;
            if (attempt === retries) {
                throw new Error(`ComfyUI 连接失败（直连与代理均不可用）：${proxyResp.status}`);
            }
        }
    }
    throw new Error("ComfyUI 连接失败（未知错误）");
}
function injectWorkflowPlaceholders(rawJson) {
    const p = JSON.parse(rawJson);
    p["348"].inputs.unet_name = "%model%";
    p["361"].inputs.width = "%width%";
    p["361"].inputs.height = "%height%";
    p["562"].inputs.value = "%prompt%";
    p["633"].inputs.value = "%negative_prompt%";
    p["580"].inputs.value = "%seed%";
    p["605"].inputs.value = "%steps%";
    p["604"].inputs.value = "%first_steps%";
    p["588"].inputs.cfg = "%first_cfg%";
    p["588"].inputs.sampler_name = "%first_sampler%";
    p["588"].inputs.scheduler = "%first_scheduler%";
    p["579"].inputs.cfg = "%second_cfg%";
    p["579"].inputs.sampler_name = "%second_sampler%";
    p["579"].inputs.scheduler = "%second_scheduler%";
    p["616"].inputs.lora_name = "%lora_1_name%";
    p["617"].inputs.lora_name = "%lora_2_name%";
    p["624"].inputs.lora_name = "%lora_3_name%";
    p["619"].inputs.lora_name = "%lora_4_name%";
    p["628"].inputs.strength_01 = "%lora_1_first_strength%";
    p["628"].inputs.strength_02 = "%lora_2_first_strength%";
    p["628"].inputs.strength_03 = "%lora_3_first_strength%";
    p["628"].inputs.strength_04 = "%lora_4_first_strength%";
    p["627"].inputs.strength_01 = "%lora_1_second_strength%";
    p["627"].inputs.strength_02 = "%lora_2_second_strength%";
    p["627"].inputs.strength_03 = "%lora_3_second_strength%";
    p["627"].inputs.strength_04 = "%lora_4_second_strength%";
    return JSON.stringify(p, null, 2);
}
function replacePlaceholders(raw, prompt, settings) {
    const seed = settings.seed !== undefined && settings.seed >= 0 ? settings.seed : randomSeed();
    let result = raw
        .replaceAll('"%prompt%"', JSON.stringify(prompt))
        .replaceAll('"%negative_prompt%"', JSON.stringify(settings.negative_prompt ?? ""))
        .replaceAll('"%seed%"', JSON.stringify(seed))
        .replaceAll('"%model%"', JSON.stringify(settings.model ?? DEFAULTS.model))
        .replaceAll('"%steps%"', JSON.stringify(settings.steps ?? DEFAULTS.steps))
        .replaceAll('"%first_steps%"', JSON.stringify(settings.first_steps ?? 0))
        .replaceAll('"%first_cfg%"', JSON.stringify(settings.first_cfg ?? DEFAULTS.first_cfg))
        .replaceAll('"%first_sampler%"', JSON.stringify(settings.first_sampler ?? DEFAULTS.first_sampler))
        .replaceAll('"%first_scheduler%"', JSON.stringify(settings.first_scheduler ?? DEFAULTS.first_scheduler))
        .replaceAll('"%second_cfg%"', JSON.stringify(settings.second_cfg ?? DEFAULTS.second_cfg))
        .replaceAll('"%second_sampler%"', JSON.stringify(settings.second_sampler ?? DEFAULTS.second_sampler))
        .replaceAll('"%second_scheduler%"', JSON.stringify(settings.second_scheduler ?? DEFAULTS.second_scheduler))
        .replaceAll('"%width%"', JSON.stringify(settings.width ?? DEFAULTS.width))
        .replaceAll('"%height%"', JSON.stringify(settings.height ?? DEFAULTS.height));
    const loras = settings.loras ?? [];
    for (let i = 0; i < LORA_SLOT_COUNT; i++) {
        const idx = i + 1;
        const slot = loras[i];
        let name = slot?.name ?? "";
        const mode = slot?.mode ?? "none";
        let firstStr = 0, secondStr = 0;
        if (mode === "first" || mode === "both")
            firstStr = slot?.first_strength ?? DEFAULTS.loraStrength;
        if (mode === "second" || mode === "both")
            secondStr = slot?.second_strength ?? DEFAULTS.loraStrength;
        if (!name) {
            name = cachedLoraList[0] ?? "";
            firstStr = 0;
            secondStr = 0;
        }
        result = result
            .replaceAll(`"%lora_${idx}_name%"`, JSON.stringify(name))
            .replaceAll(`"%lora_${idx}_first_strength%"`, JSON.stringify(firstStr))
            .replaceAll(`"%lora_${idx}_second_strength%"`, JSON.stringify(secondStr));
    }
    return result;
}
export async function loadDefaultWorkflow() {
    if (cachedWorkflow)
        return cachedWorkflow;
    const resp = await fetch(WORKFLOW_PATH);
    if (!resp.ok)
        throw new Error("无法加载默认工作流");
    const raw = await resp.text();
    const wf = injectWorkflowPlaceholders(raw);
    validateWorkflowNodes(wf);
    cachedWorkflow = wf;
    return cachedWorkflow;
}
export async function fetchModelList() {
    if (getGenerationBackend() !== "comfyui")
        return [];
    if (comfyProbeCooldown())
        return [];
    const resp = await comfyFetch("object_info").catch(() => null);
    if (!resp || !resp.ok) {
        markComfyProbeFailed();
        return [];
    }
    let info;
    try {
        info = await resp.json();
    }
    catch {
        markComfyProbeFailed();
        return [];
    }
    const unetNode = info["UNETLoader"];
    if (!unetNode) {
        markComfyProbeFailed();
        return [];
    }
    const required = unetNode.input?.required;
    if (!required) {
        markComfyProbeFailed();
        return [];
    }
    const unetName = required["unet_name"];
    if (!Array.isArray(unetName) || !Array.isArray(unetName[0])) {
        markComfyProbeFailed();
        return [];
    }
    return unetName[0];
}
export async function fetchLoraList() {
    if (getGenerationBackend() !== "comfyui")
        return cachedLoraList;
    if (comfyProbeCooldown())
        return cachedLoraList;
    const resp = await comfyFetch("object_info").catch(() => null);
    if (!resp || !resp.ok) {
        cachedLoraList = [];
        markComfyProbeFailed();
        return [];
    }
    let info;
    try {
        info = await resp.json();
    }
    catch {
        cachedLoraList = [];
        markComfyProbeFailed();
        return [];
    }
    const types = ["LoraLoader", "LoraLoaderModelOnly"];
    for (const t of types) {
        const node = info[t];
        if (!node)
            continue;
        const required = node.input?.required;
        if (!required)
            continue;
        const loraName = required["lora_name"];
        if (Array.isArray(loraName) && Array.isArray(loraName[0])) {
            cachedLoraList = loraName[0];
            return cachedLoraList;
        }
    }
    cachedLoraList = [];
    markComfyProbeFailed();
    return [];
}
let comfyProbeFailedAt = 0;
const COMFY_PROBE_COOLDOWN_MS = 30000;
function markComfyProbeFailed() {
    if (!comfyProbeFailedAt)
        comfyProbeFailedAt = Date.now();
}
function comfyProbeCooldown() {
    if (comfyProbeFailedAt && Date.now() - comfyProbeFailedAt < COMFY_PROBE_COOLDOWN_MS)
        return true;
    comfyProbeFailedAt = 0;
    return false;
}
export async function testComfyConnection() {
    const start = performance.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
        const resp = await comfyFetch("system_stats", { signal: controller.signal });
        clearTimeout(timeoutId);
        const elapsed = Math.round(performance.now() - start);
        if (resp.ok)
            return { ok: true, elapsed };
        const detail = await resp.text().catch(() => "");
        return { ok: false, elapsed, error: `${resp.status}${detail ? ` — ${detail.slice(0, 100)}` : ""}` };
    }
    catch (err) {
        clearTimeout(timeoutId);
        const elapsed = Math.round(performance.now() - start);
        return { ok: false, elapsed, error: err instanceof Error ? err.message : String(err) };
    }
}
async function fetchImageAsBase64(imageUrl) {
    const resp = await comfyFetch(imageUrl);
    if (!resp.ok)
        throw new Error(`Image fetch failed: ${resp.status}`);
    if (!resp.body)
        throw new Error("Response body is null");
    // ReadableStream 分块读取，设上限防恶意/损坏响应撑爆内存
    const reader = resp.body.getReader();
    const chunks = [];
    let total = 0;
    const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        chunks.push(value);
        total += value.length;
        if (total > MAX_IMAGE_SIZE)
            throw new Error("Image too large (>10MB)");
    }
    const blob = new Blob(chunks);
    const format = blob.type === "image/png" ? "png" : "jpeg";
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const data = reader.result.split(",")[1] ?? "";
            resolve({ format, data });
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}
export async function generateComfyImage(userPrompt, comfyUrl, settings = {}, signal) {
    const rawWorkflow = await loadDefaultWorkflow();
    const url = comfyUrl ?? getComfyUrl();
    const workflow = replacePlaceholders(rawWorkflow, userPrompt, settings);
    const genResp = await comfyFetch(`${url}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: JSON.parse(workflow) }),
    });
    if (!genResp.ok) {
        const detail = await genResp.text().catch(() => "");
        throw new Error(`ComfyUI 提交失败: ${genResp.status}${detail ? ` — ${detail}` : ""}`);
    }
    const { prompt_id } = (await genResp.json());
    const MAX_POLL = 300;
    // 单次轮询的 fetch 超时：防止 ComfyUI 断连/未响应时把整个生图锁死在这一轮（阻塞后续生成）
    const POLL_FETCH_TIMEOUT = 20000;
    const POLL_INTERVAL_MS = 1000;
    const MAX_POLL_RETRIES = 3;
    const POLL_BACKOFF_BASE_MS = 2000;
    let outputFilename = "";
    let outputSubfolder = "";
    let outputType = "output";
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 5;
    // 可见性感知：后台暂停轮询
    let hidden = false;
    if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", () => { hidden = document.hidden; });
        hidden = document.hidden;
    }
    for (let i = 0; i < MAX_POLL; i++) {
        if (signal?.aborted)
            throw new Error("ComfyUI 生成已取消");
        // 后台：长轮询 5s，不发请求
        if (hidden) {
            await new Promise(r => setTimeout(r, 5000));
            continue;
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        // 带退避重试的单次轮询
        let histResp = null;
        let fetchErr;
        for (let attempt = 0; attempt <= MAX_POLL_RETRIES; attempt++) {
            const ctrl = new AbortController();
            const fetchTimeout = setTimeout(() => ctrl.abort(), POLL_FETCH_TIMEOUT);
            try {
                histResp = await comfyFetch(`${url}/history/${prompt_id}`, { signal: ctrl.signal });
            }
            catch (err) {
                fetchErr = err;
                histResp = null;
            }
            clearTimeout(fetchTimeout);
            if (histResp && histResp.ok) {
                consecutiveErrors = 0;
                break;
            }
            if (attempt < MAX_POLL_RETRIES) {
                const delay = POLL_BACKOFF_BASE_MS * Math.pow(2, attempt) + Math.random() * 500;
                logger.debug(`[ComfyUI] History poll failed (attempt ${attempt + 1}/${MAX_POLL_RETRIES + 1}), retrying in ${Math.round(delay)}ms:`, fetchErr);
                await new Promise(r => setTimeout(r, delay));
            }
        }
        if (!histResp || !histResp.ok) {
            consecutiveErrors++;
            if (consecutiveErrors >= maxConsecutiveErrors) {
                throw new Error(`ComfyUI 历史轮询连续失败 ${maxConsecutiveErrors} 次`);
            }
            logger.debug(`[ComfyUI] Poll HTTP ${histResp?.status ?? 'network error'}, retrying... (${consecutiveErrors}/${maxConsecutiveErrors})`);
            continue;
        }
        const history = (await histResp.json());
        const entry = history[prompt_id];
        if (!entry)
            continue;
        const status = entry.status;
        if (status?.completed !== true)
            continue;
        const outputs = entry.outputs;
        if (!outputs)
            continue;
        for (const nodeId of Object.keys(outputs)) {
            const node = outputs[nodeId];
            const images = node?.images;
            if (images?.length) {
                outputFilename = images[0].filename;
                outputSubfolder = images[0].subfolder ?? "";
                outputType = images[0].type ?? "output";
                break;
            }
        }
        if (outputFilename)
            break;
    }
    if (!outputFilename)
        throw new Error("ComfyUI 生成超时或未产生输出图片");
    const imageUrl = `${url}/view?filename=${encodeURIComponent(outputFilename)}&type=${outputType}&subfolder=${encodeURIComponent(outputSubfolder)}`;
    return await fetchImageAsBase64(imageUrl);
}
