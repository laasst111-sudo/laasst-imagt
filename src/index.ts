// eslint-disable-next-line @typescript-eslint/no-explicit-any, no-var
declare var $: any;
// @ts-expect-error — ST provides this module at runtime
import { getContext } from "../../../../../scripts/st-context.js";
// @ts-expect-error — ST provides this module at runtime
import { appendMediaToMessage, saveChatConditional, eventSource, event_types } from "../../../../../script.js";
// @ts-expect-error — ST provides this module at runtime
import { extension_settings } from "../../../../../scripts/extensions.js";
// @ts-expect-error — ST provides this module at runtime
import { saveBase64AsFile } from "../../../../../scripts/utils.js";
// @ts-expect-error — ST provides this module at runtime
import { SCROLL_BEHAVIOR, MEDIA_SOURCE, MEDIA_TYPE } from "../../../../../scripts/constants.js";
import { logger } from "./logger.js";
import { downscaleImageToThumbnail } from "./image.js";
import { initGeneratedMediaManager, enforceGeneratedMediaQuota, cleanupGeneratedMediaManager } from "./mediaManager.js";
import { terminateLexiconWorker } from "./lexiconWorker.js";
import { PromptTag, processTextPipeline, getTextCleaningConfig } from "./prompt.js";
import { detectPov, stripNarrator, parseJson, buildPrompt, buildCorrectionInfo, stripChineseFallback } from "./promptBuilder.js";
import { composePrompt } from "./promptPost.js";
import type { PovInfo } from "./promptBuilder.js";
import { ensureFullLexicon, getDefaultLexicon, hasPersistedLexicon, isFullLexiconReady } from "./defaultLexicon.js";
import { generateComfyImage, DEFAULTS, SETTINGS_KEY } from "./comfy.js";
import { generateLatentMoeImage, getGenerationBackend, isLatentMoeConfigured, generateRunningHubImage, isRunningHubConfigured } from "./onlineApi.js";
import { refreshMvuData, extractMvuInfoSegment, migrateMvuPaths, getMvuSelections } from "./characterLib.js";
import { refreshDatabaseData, extractDatabaseInfoSegment, getDbSelections, migrateDbSelections, getDatabaseStatus } from "./databaseLib.js";
import { LLM_URL_DEFAULT, LLM_MODEL_DEFAULT, getLastCacheInfo, callLLM, type CallLLMOptions, LlmError } from "./api.js";
import type { LlmMessage, LlmToolDefinition } from "./api.js";
import {
    collectTagCandidates,
    buildCandidatesBlock,
    searchViaMcp,
    relatedViaMcp,
    animaFormatViaMcp,
    listMcpTools,
    DEFAULT_MCP_URL,
} from "./tagTool.js";
import { McpClient } from "./mcpClient.js";
import { createSettingsUI, currentStage, setProgress, resetProgress, initFloatingButton, initWandButton, floatingBtn, ensureValidLoraSlots, setCancelHandler, showPipelineReports, initDrawerObserver } from "./ui.js";
import {
  loadAllCompletedLibraries,
  injectLocalCharacters,
  clearLocalLibrary,
  getLocalLibraryStatus,
  selectRelevantLibraries,
  loadEntrySelection,
} from "./localLib.js";
import { refreshBaibaiData, extractBaibaiSegments, configureBaibai } from "./baibaiLib.js";
import {
    migratePipelineSettings,
    getModuleSwitches,
    isModuleEnabled,
    runTagPipeline,
    reviewShapeFor,
    shouldRunReview,
    type ExtractMode,
    type StageReport,
} from "./pipeline.js";
import { buildExtractSystemPrompt, buildReviewSystemPrompt, resolveExtractPreset } from "./promptPreset.ts";
declare const toastr: {
    info: (msg: string, title?: string, options?: Record<string, unknown>) => void;
    success: (msg: string, title?: string, options?: Record<string, unknown>) => void;
    warning: (msg: string, title?: string, options?: Record<string, unknown>) => void;
    error: (msg: string, title?: string, options?: Record<string, unknown>) => void;
    clear: (toast?: unknown, options?: Record<string, unknown>) => void;
};

function loadSettings() {
  if (!extension_settings[SETTINGS_KEY]) {
    extension_settings[SETTINGS_KEY] = { apiKey: "", comfy_url: DEFAULTS.comfyUrl };
  }
  const s = extension_settings[SETTINGS_KEY];
  if (s.steps === undefined) s.steps = DEFAULTS.steps;
  if (s.width === undefined) s.width = DEFAULTS.width;
  if (s.height === undefined) s.height = DEFAULTS.height;
  if (s.seed === undefined) s.seed = DEFAULTS.seed;
  if (s.model === undefined) s.model = DEFAULTS.model;
  if (s.first_steps === undefined) s.first_steps = DEFAULTS.first_steps;
  if (s.first_cfg === undefined) s.first_cfg = DEFAULTS.first_cfg;
  if (s.first_sampler === undefined) s.first_sampler = DEFAULTS.first_sampler;
  if (s.first_scheduler === undefined) s.first_scheduler = DEFAULTS.first_scheduler;
  if (s.second_cfg === undefined) s.second_cfg = DEFAULTS.second_cfg;
  if (s.second_sampler === undefined) s.second_sampler = DEFAULTS.second_sampler;
  if (s.second_scheduler === undefined) s.second_scheduler = DEFAULTS.second_scheduler;
  if (s.negative_prompt === undefined) s.negative_prompt = "";
  if (s.fixed_prompt_prefix === undefined) s.fixed_prompt_prefix = "";
  if (s.fixed_prompt_suffix === undefined) s.fixed_prompt_suffix = "";
  if (s.llm_url === undefined) s.llm_url = LLM_URL_DEFAULT;
  if (s.llm_model === undefined) s.llm_model = LLM_MODEL_DEFAULT;
  if (s.llm_max_tokens === undefined) s.llm_max_tokens = 1024;
  if (s.llm_reasoning_effort === undefined) s.llm_reasoning_effort = "none";
  if (s.llm_temperature === undefined) s.llm_temperature = 1;
  if (s.llm_top_p === undefined) s.llm_top_p = 1;
  if (!Array.isArray(s.regex_rules)) s.regex_rules = [];
  if (s.floor_count === undefined) s.floor_count = 1;
  if (s.truncate_direction === undefined) s.truncate_direction = "top";
  if (s.truncate_percent === undefined) s.truncate_percent = 100;
  if (s.truncate_mode === undefined) s.truncate_mode = "percent";
  if (s.truncate_chars === undefined) s.truncate_chars = 2000;
  if (s.truncate_tolerance === undefined) s.truncate_tolerance = 100;
  ensureValidLoraSlots(s);
  if (s.mvu_enabled === undefined) s.mvu_enabled = false;
  if (!Array.isArray(s.mvu_paths)) s.mvu_paths = [];
  migrateMvuPaths(s); // v1.3: 旧 mvu_paths → mvu_selections 一次性迁移（保留旧键）
  if (s.db_enabled === undefined) s.db_enabled = false;
  if (s.auto_generate_enabled === undefined) s.auto_generate_enabled = false;
  // v2.x: 自动生成模式（off | default | charlib），由旧布尔开关迁移
  if (s.auto_generate_mode === undefined) {
    s.auto_generate_mode = s.auto_generate_enabled === true ? 'default' : 'off';
  }
  if (s.floating_btn_enabled === undefined) s.floating_btn_enabled = true;
  if (s.progress_enabled === undefined) s.progress_enabled = true;
  if (s.image_align === undefined) s.image_align = 'center';
  if (s.image_size === undefined) s.image_size = 'medium';
  if (s.progress_in_chat === undefined) s.progress_in_chat = true;
  if (s.anchor_text === undefined) s.anchor_text = "";
  if (s.anchor_position === undefined) s.anchor_position = "above";
  if (s.db_selection === undefined) {
    s.db_selection = [];
  }
  migrateDbSelections(s); // 旧 { cols: string[] } → DbTableSelection[] 迁移
  if (s.prompt_tags_enabled === undefined) s.prompt_tags_enabled = false;
  if (!Array.isArray(s.prompt_tags)) s.prompt_tags = [];
  // v1.x: 预设风格提示词
  if (s.style_preset_enabled === undefined) s.style_preset_enabled = false;
  if (s.style_preset_overall === undefined) s.style_preset_overall = "custom";
  if (s.style_preset_aesthetic === undefined) s.style_preset_aesthetic = "";
  if (s.style_preset_medium === undefined) s.style_preset_medium = "";
  if (s.style_preset_mood === undefined) s.style_preset_mood = "";
  if (s.style_preset_material === undefined) s.style_preset_material = "";
  if (s.style_preset_lighting === undefined) s.style_preset_lighting = "";
  // v1.2.1: 纯文本后端兼容 — 发送前剥离 content 数组中的 image_url 等多模态部分
  if (s.strip_inline_media === undefined) s.strip_inline_media = true;
  if (s.injection_order === undefined) s.injection_order = "info_first";
  if (s.thinking_budget === undefined) s.thinking_budget = 0;
  if (s.local_enabled === undefined) s.local_enabled = false;
  if (s.local_thinking_enabled === undefined) s.local_thinking_enabled = false;
  if (s.nsfw_enabled === undefined) s.nsfw_enabled = false;
  if (s.pov_triggers === undefined) s.pov_triggers = "";
  // v2.2: 旧版角色串格式开关已废弃移除（v3.x 起人数标签恒定输出、性别恒并入括号）
  // v2.0: 生成链路（current=现有 BREAK 逗号格式 | extool=外部工具纯标签格式）
  if (s.gen_pipeline === undefined) s.gen_pipeline = "current";  // v2.0: LLM 调用优化
  if (s.llm_json_mode === undefined) s.llm_json_mode = false;   // 纯 JSON(response_format)，与 <thinking> 文本链二选一
  if (s.retry_json_fail === undefined) s.retry_json_fail = false; // parseJson 失败自动重发一次
  // v2.0: 公共后处理开关（默认全开，低风险）
  if (s.pp_sanitize === undefined) s.pp_sanitize = true;
  if (s.pp_dedup === undefined) s.pp_dedup = true;
  if (s.pp_emotion === undefined) s.pp_emotion = true;
  if (s.pp_process === undefined) s.pp_process = true;
  if (s.pp_cjk === undefined) s.pp_cjk = true;
  if (s.pp_scene === undefined) s.pp_scene = true;
  if (s.pp_budget === undefined) s.pp_budget = true;
  // v2.2 P0: 词库校验告警（零覆盖短语仅告警不删，控制台查看，诊断"模型可能不认识"）
  if (s.pp_validate === undefined) s.pp_validate = true;
  // v2.0: 外部工具格式选项（仅 gen_pipeline=extool 生效）
  if (s.ext_space === undefined) s.ext_space = true;
  if (s.ext_order === undefined) s.ext_order = true;
  if (s.ext_weight === undefined) s.ext_weight = false;
  if (!s.ext_weight_map) s.ext_weight_map = {};
  // v2.1: 词库层（链路 B 的准确性来源）。默认开启内嵌精选；
  //       勾选「导入 词库.bmz」后会用外部大词库构建完整 5 层，替代内嵌。
  if (s.ext_dict === undefined) s.ext_dict = true;          // 词库校验/贪心分解/分类排序
  if (s.ext_dict_imported === undefined) s.ext_dict_imported = false; // 已导入完整 词库.bmz
  if (s.ext_enrich === undefined) s.ext_enrich = false;     // 共现联想补标签（默认关，所见即所得）
  // v2.1: 柏宝书（ST-BaiBai-Book）信息源 —— 只用【角色】功能，不使用 vars 自定义变量
  if (s.bbs_enabled === undefined) s.bbs_enabled = false;
  if (s.bbs_include_nearby === undefined) s.bbs_include_nearby = false;
  if (s.bbs_include_absent === undefined) s.bbs_include_absent = false;
  if (s.bbs_include_other_scenes === undefined) s.bbs_include_other_scenes = false;
  if (s.bbs_include_distant_items === undefined) s.bbs_include_distant_items = false;
  if (s.bbs_name_gate === undefined) s.bbs_name_gate = false;
  if (!s.bbs_selection || typeof s.bbs_selection !== "object") {
    s.bbs_selection = { roles: {}, scenes: {}, items: {} };
  }
  // ── v2.2 统一生成管线 ──
// 提示词可编辑（预设留空=用内置默认；自定义片段追加；契约块由 promptPreset 强制追加）
// v2.6：四模式各自一份可编辑预设（留空 = 该模式内置默认层）
if (s.extract_preset_tags === undefined) s.extract_preset_tags = "";
if (s.extract_preset_description === undefined) s.extract_preset_description = "";
if (s.extract_preset_mixed === undefined) s.extract_preset_mixed = "";
if (s.extract_preset_custom === undefined) s.extract_preset_custom = "";
if (s.review_prompt_preset === undefined) s.review_prompt_preset = "";
if (s.review_prompt_custom === undefined) s.review_prompt_custom = "";
// 第二阶段 LLM 审核（默认关闭）
if (s.review_enabled === undefined) s.review_enabled = false;
if (s.review_include_source === undefined) s.review_include_source = false;
if (s.review_format_guard === undefined) s.review_format_guard = true;
if (s.review_keep_original === undefined) s.review_keep_original = false;
// 输出模式（description=只自然语言 / tags=只 Danbooru / mixed=混合，默认混合）
if (s.extract_output_mode === undefined) s.extract_output_mode = "mixed";
  // Danbooru 标签工具（MCP 在线服务）
  if (s.tagtool_enabled === undefined) s.tagtool_enabled = true;
  if (s.tagtool_source === undefined) s.tagtool_source = "auto";
  if (s.tagtool_mcp_url === undefined) s.tagtool_mcp_url = DEFAULT_MCP_URL;
  if (s.tagtool_max_candidates === undefined) s.tagtool_max_candidates = 12;
  if (s.tagtool_max_rounds === undefined) s.tagtool_max_rounds = 3;
  // v2.3：标签预算上限（阶段7 fmt.budget；此前硬编码 25，用户无法调整）
  if (s.budget_max === undefined) s.budget_max = 45;   // v2.4：实测热门提示词单角色 25~45 标签、中位 39 → 25 会砍掉一半
  // v3.x：人数标签冲突时是否允许规则引擎覆盖 LLM 直出（默认 false = 只告警）
  if (s.override_llm_count_tags === undefined) s.override_llm_count_tags = false;
  // v2.5: 生成后端选择（comfyui | latent_moe | runninghub）
  if (s.generation_backend === undefined) s.generation_backend = "comfyui";
  // latent.moe 设置
  if (s.latent_api_key === undefined) s.latent_api_key = "";
  if (s.latent_resolution === undefined) s.latent_resolution = "portrait";
  if (s.latent_steps === undefined) s.latent_steps = 12;
  if (s.latent_sampler === undefined) s.latent_sampler = "euler";
  if (s.latent_scheduler === undefined) s.latent_scheduler = "sgm_uniform";
  if (s.latent_negative_prompt === undefined) s.latent_negative_prompt = "low quality, blurry, malformed hands, bad anatomy, extra limbs, missing limbs, fused fingers, too many fingers, long neck, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry, bad feet";
  // RunningHub 设置
  if (s.rh_api_key === undefined) s.rh_api_key = "";
  if (s.rh_workflow_id === undefined) s.rh_workflow_id = "";
  if (s.rh_prompt_node_id === undefined) s.rh_prompt_node_id = "";
  if (s.rh_negative_node_id === undefined) s.rh_negative_node_id = "";
  if (s.rh_negative_prompt === undefined) s.rh_negative_prompt = "low quality, blurry, malformed hands, bad anatomy, extra limbs, missing limbs, fused fingers, too many fingers, long neck, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry, bad feet";
  // v2.1 → v2.2 开关迁移（一次性）
  migratePipelineSettings(s as Record<string, unknown>);
  // API Profile Management 初始化
  if (!Array.isArray(s.api_profiles)) s.api_profiles = [];
  if (s.use_api_profile === undefined) s.use_api_profile = false;
}

// ============================================================
// v1.2.1: Strip inline media (image_url/video_url/audio_url) from outgoing
// Chat Completion payloads. ST inlines every extra.media image whenever
// media_inlining is on; for CUSTOM sources it never checks model capability,
// so text-only backends (e.g. localhost:8000) fail with:
// "unknown variant `image_url`, expected `text`".
// We mutate eventData.chat in place: array content -> plain text string.
// ============================================================
interface ChatCompletionPromptReadyData {
    chat?: Array<{ role?: string; content?: unknown; name?: string }>;
    dryRun?: boolean;
}

const INLINE_MEDIA_TYPES = new Set(['image_url', 'video_url', 'audio_url']);

function stripInlineMediaFromChat(data: ChatCompletionPromptReadyData): void {
    const s = extension_settings[SETTINGS_KEY];
    if (!s?.strip_inline_media) return;
    if (!Array.isArray(data?.chat)) return;
    for (const msg of data.chat) {
        if (!msg || !Array.isArray(msg.content)) continue;
        const parts = msg.content as Array<{ type?: string; text?: string }>;
        if (!parts.some(p => p && INLINE_MEDIA_TYPES.has(String(p.type)))) continue;
        const text = parts
            .filter(p => p && p.type === 'text' && typeof p.text === 'string')
            .map(p => p.text as string)
            .join('\n');
        msg.content = text.trim() ? text : '[图片]';
    }
}

let stripInlineMediaRegistered = false;

function initStripInlineMedia() {
    if (stripInlineMediaRegistered) return;
    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, (data: unknown) => {
        try {
            stripInlineMediaFromChat(data as ChatCompletionPromptReadyData);
        } catch (err) {
            console.warn('[image_st] strip inline media failed', err);
        }
    });
    stripInlineMediaRegistered = true;
}


// ============================================================
// v1.9: 注入输入组装（onGenerate 与 previewInjectionPipeline 共用）
// 职责：角色信息段组装（MVU/数据库/本地）→ POV 判定 + 叙述者剔除 → 段组合截断
// ============================================================
async function buildInjectionInput(processedText: string): Promise<{ llmInput: string; povInfo: PovInfo; povWarnings: string[] }> {
  const s = extension_settings[SETTINGS_KEY];
  const context = getContext();
  const charParts: string[] = [];
  if (s.mvu_enabled) {
    const mvuSelections = getMvuSelections();
    if (mvuSelections.length > 0) {
      const mvuSegment = extractMvuInfoSegment(processedText, mvuSelections);
      if (mvuSegment) charParts.push(`【角色信息·MVU】\n${mvuSegment}`);
    }
  }
  if (s.db_enabled) {
    const dbSelections = getDbSelections();
    if (dbSelections.length > 0) {
      const raw = extractDatabaseInfoSegment(processedText, dbSelections);
      if (raw) charParts.push(`【角色信息·数据库】\n${raw}`);
    }
  }
  if (s.local_enabled) {
    const charName = context.name2 || '';
    if (charName) {
      const allLocalLibs = await loadAllCompletedLibraries(charName);
      if (allLocalLibs.length > 0) {
        const selection = await loadEntrySelection(charName);
        const relevantLibs = selectRelevantLibraries(processedText, allLocalLibs, selection.selections);
        const localSegment = injectLocalCharacters(processedText, relevantLibs);
        if (localSegment) charParts.push(`【角色信息·本地】\n${localSegment}`);
      }
    }
  }
  // v2.1: 柏宝书信息源（角色 / 场景 / 物品 三段）
  // 只消费柏宝书【角色】功能；不使用其自定义变量系统（vars）
  let bbsProtagonistSegment = "";
  if (s.bbs_enabled) {
    const bbsOpts = {
      isPov: false,
      includeNearby: s.bbs_include_nearby === true,
      includeAbsent: s.bbs_include_absent === true,
      includeOtherScenes: s.bbs_include_other_scenes === true,
      includeDistantItems: s.bbs_include_distant_items === true,
      nameGate: s.bbs_name_gate === true,
    };
    const bbsSeg = extractBaibaiSegments(processedText, bbsOpts);
    if (bbsSeg.roles) charParts.push(`【角色信息·柏宝书】\n${bbsSeg.roles}`);
    if (bbsSeg.scenes) charParts.push(`【场景信息·柏宝书】\n${bbsSeg.scenes}`);
    if (bbsSeg.items) charParts.push(`【物品信息·柏宝书】\n${bbsSeg.items}`);
    bbsProtagonistSegment = bbsSeg.protagonist;
  }
  // v1.9: POV 前置判定 + 叙述者剔除
  // v2.3: 接入「POV 判定」「叙述者剔除」模块开关（此前两个开关未参与运行）。
  //       判定改为三态（pov / third / uncertain）；uncertain 保守按第三人称处理且不删任何角色档案。
  let charInfoText = charParts.join("\n\n");
  const povTriggers = String(s.pov_triggers ?? "").split(/[,，\n]/).map((t: string) => t.trim()).filter(Boolean);
  const povInfo: PovInfo = isModuleEnabled(s, "pov.detect")
    ? detectPov(processedText, charInfoText, povTriggers)
    : { isPov: false, verdict: "third", narratorName: "", reason: "「POV 判定」模块已关闭 → 强制按第三人称处理", matchedTrigger: "", invalidTriggers: [], firstPersonCount: 0 };
  const povWarnings: string[] = [];
  if (povInfo.invalidTriggers.length > 0) {
    povWarnings.push(`已忽略无效触发词：${povInfo.invalidTriggers.join("、")}`);
  }
  if (povInfo.verdict === "uncertain") {
    povWarnings.push(povInfo.reason);
  }
  if (povInfo.isPov && povInfo.narratorName && isModuleEnabled(s, "pov.strip")) {
    const stripped = stripNarrator(charInfoText, povInfo.narratorName);
    charInfoText = stripped.text;
    if (stripped.failed) {
      povWarnings.push(`叙述者「${povInfo.narratorName}」在角色信息中未找到匹配条目，未剔除任何档案`);
    } else {
      povWarnings.push(`已剔除叙述者「${stripped.matched}」的 ${stripped.removedBlocks} 条角色档案`);
      if (!charInfoText.trim()) {
        povWarnings.push(`⚠ 剔除后角色信息为空，LLM 只能从正文判定其他角色外观`);
      }
    }
  } else if (!povInfo.isPov && bbsProtagonistSegment) {
    // 非 POV：主角可能在画面内，追加主角档案（POV 下叙述者即镜头、外观不入画，故不并入）
    charInfoText = charInfoText ? `${charInfoText}\n\n${bbsProtagonistSegment}` : bbsProtagonistSegment;
  }
  const bodyPart = `【正文】\n${processedText}`;
  const segments: string[] = s.injection_order === 'body_first'
    ? [bodyPart, ...(charInfoText ? [charInfoText] : [])]
    : [...(charInfoText ? [charInfoText] : []), bodyPart];
  const COMBINED_MAX = 5000;
  const filtered: string[] = [];
  let combinedLen = 0;
  for (const seg of segments) {
    if (seg.length <= COMBINED_MAX - combinedLen) {
      filtered.push(seg);
      combinedLen += seg.length;
    } else {
      if (combinedLen === 0 && seg === bodyPart) {
        filtered.push(seg.substring(0, COMBINED_MAX) + "\n(注入信息已截断)");
        combinedLen = COMBINED_MAX;
      } else if (combinedLen > 0) {
        const remain = COMBINED_MAX - combinedLen;
        const cut = seg.substring(0, remain);
        const ends = [...cut.matchAll(/[。.!！?？\n]/g)].map(m => m.index + 1);
        const best = ends.filter(p => p <= remain).pop() ?? remain;
        filtered.push(cut.substring(0, best) + "\n(注入信息已截断)");
        combinedLen = COMBINED_MAX;
      }
    }
  }
  return { llmInput: filtered.join("\n\n"), povInfo, povWarnings };
}

// ============================================================
// v1.0.4: Generation timing (stays in index.ts — only used in onGenerate)
// Progress display state (currentStage / setProgress / resetProgress) in ui.ts
// ============================================================
interface GenTiming {
    start: number;
    promptStart: number;
    renderStart: number;
    end: number;
}
let genTiming: GenTiming | null = null;
let lastFinalPrompt: string | null = null;  // 存储上一次成功生成的最终提示词

// v2.7: 最后一次失败的 LLM 调用上下文（用于「重试 LLM 调用」按钮）
interface LastFailedLLMContext {
    systemPrompt: string;
    llmInput: string;
    mode: ExtractMode;
    settings: Record<string, unknown>;
    signal?: AbortSignal;
    tools: LlmToolDefinition[];
    mcpUrl: string;
    maxRounds: number;
    jsonMode: boolean;
    model: string;
    reasoningEffort: string;
    temperature?: number;
    topP?: number;
    thinkingBudget: number;
    maxTokens: number;
}
let lastFailedLLMContext: LastFailedLLMContext | null = null;

function formatDuration(ms: number): string {
    if (ms <= 0) return "0秒";
    if (ms < 1000) return "<1秒";
    const totalSeconds = Math.round(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const parts: string[] = [];
    if (hours > 0) parts.push(`${hours}时`);
    if (minutes > 0) parts.push(`${minutes}分`);
    parts.push(`${seconds}秒`);
    return parts.join("");
}

// ============================================================
// v0.9.9: Auto Generate
// ============================================================
let isGenerating = false;
// v2.0: 指向当前活跃生成的 AbortController，供「取消生成」按钮中断（LLM + 渲染）。
let activeAbort: AbortController | null = null;
let lastFinishTime = 0;

// v2.0: 判断异常是否为用户「取消生成」所致（AbortError / 取消息）；用于显示「已取消」而非「失败」。
function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException) return err.name === "AbortError";
  return err instanceof Error &&
    (err.name === "AbortError" || /cancel|abort/i.test(err.message));
}
const AUTO_GEN_COOLDOWN = 30000;
let autoGenRegistered = false;

/**
 * 联动角色库：匹配一次本地角色库，返回本轮对话正文是否命中库内角色名。
 * 复用 buildInjectionInput 中本地角色库的同一条匹配链（selectRelevantLibraries → injectLocalCharacters）。
 */
async function matchLocalCharacterLib(): Promise<boolean> {
    const s = extension_settings[SETTINGS_KEY];
    if (!s?.local_enabled) return false;
    const context = getContext();
    const charName = context.name2 || '';
    if (!charName) return false;
    const libraries = await loadAllCompletedLibraries(charName);
    if (libraries.length === 0) return false;
    const messages = context.chat ?? [];
    const processedText = processTextPipeline(messages, getTextCleaningConfig(s));
    if (!processedText) return false;
    const selection = await loadEntrySelection(charName);
    const relevantLibs = selectRelevantLibraries(processedText, libraries, selection.selections);
    const injected = injectLocalCharacters(processedText, relevantLibs);
    return !!injected;
}

async function handleAutoGenerate() {
    const s = extension_settings[SETTINGS_KEY];
    const mode = (s?.auto_generate_mode as string) ?? 'off';
    if (mode === 'off') return;
    if (Date.now() - lastFinishTime < AUTO_GEN_COOLDOWN) return;
    if (mode === 'charlib') {
        const matched = await matchLocalCharacterLib();
        if (!matched) {
            logger.debug('[image_st] 自动生成（联动角色库）：本轮对话未命中角色库角色，跳过');
            return;
        }
    }
    await onGenerate(true);
}

function cleanupAutoGenerate() {
    if (autoGenRegistered) {
        eventSource.off(event_types.GENERATION_ENDED, handleAutoGenerate);
        autoGenRegistered = false;
    }
}

function initAutoGenerate() {
    if (autoGenRegistered) return;
    eventSource.on(event_types.GENERATION_ENDED, () => {
        handleAutoGenerate();
    });
    autoGenRegistered = true;
}

// v1.0.7 B2: 从消息数据层取原文 — 锚点若为 HTML 标签形态（如 </正文>），
// 浏览器解析后会从 DOM textContent 中消失，DOM 匹配永远失败；数据层原文不受影响
function getMesRawText(mesBlock: HTMLElement): string {
    const mesId = mesBlock.getAttribute('mesid');
    if (mesId !== null && mesId !== '') {
        const chat = getContext().chat ?? [];
        const msg = chat[Number(mesId)];
        if (msg && typeof msg.mes === 'string') return msg.mes;
    }
    return '';
}

// v1.0.4: Apply anchor text positioning
// v1.0.7 B2: 增强健壮性 — mesBlock 需仍在 DOM 中；锚点匹配优先数据层原文；media 未就绪时有限重试
// v1.0.8: 从下往上匹配锚点文本 — 找到锚点文本最后一次出现位置进行定位
function applyAnchorPosition(mesBlock: HTMLElement, attempt = 0) {
  if (!document.contains(mesBlock)) return;
  const s = extension_settings[SETTINGS_KEY];
  const anchor = ((s.anchor_text as string) ?? "").trim();
  if (!anchor) return;
  const textEl = mesBlock.querySelector('.mes_text') as HTMLElement | null;
  if (!textEl) return;
  const rawMes = getMesRawText(mesBlock);
  const domText = (textEl.textContent ?? '').trim();
  if (!rawMes.includes(anchor) && !domText.includes(anchor)) return;
  const media = mesBlock.querySelector('.mes_media_wrapper') as HTMLElement | null;
  if (!media) {
    if (attempt < 5) {
      setTimeout(() => applyAnchorPosition(mesBlock, attempt + 1), 100);
    }
    return;
  }
  const position = (s.anchor_position as string) ?? 'above';
  if (position === 'above') {
    textEl.parentNode?.insertBefore(media, textEl);
  } else {
    textEl.parentNode?.insertBefore(media, textEl.nextElementSibling);
  }
}

// v1.0.3: Apply alignment + size CSS to the attached image
function applyImagePosition(mesBlock: HTMLElement) {
    const s = extension_settings[SETTINGS_KEY];
    const media = mesBlock.querySelector('.mes_media_wrapper') as HTMLElement | null;
    if (!media) return;
    media.classList.remove('image-st-align-left', 'image-st-align-center', 'image-st-align-right');
    media.classList.remove('image-st-size-small', 'image-st-size-medium', 'image-st-size-large');
    const align = (s.image_align as string) ?? 'center';
    media.classList.add(`image-st-align-${align}`);
    const size = (s.image_size as string) ?? 'medium';
    media.classList.add(`image-st-size-${size}`);
}

// v1.9.1 缩略图链路：保存原图 + 生成 JPEG 缩略图；url=缩略图，original_url=原图。
// 缩略图失败时回退到原图（不阻断生成）。
async function saveGeneratedImage(
  data: string,
  format: string,
  charName: string,
): Promise<{ url: string; original_url: string }> {
  const filename = `${charName}_${Date.now()}`;
  const originalPath = await saveBase64AsFile(data, charName, filename, format);
  let thumbPath = originalPath;

  try {
    const thumb = await downscaleImageToThumbnail(data, format);
    thumbPath = await saveBase64AsFile(thumb.data, charName, `${filename}_thumb`, "jpg");
  } catch (err) {
    logger.warn("[image_st] 缩略图生成失败，回退原图:", err);
  }
  return { url: thumbPath, original_url: originalPath };
}

// ============================================================
// v2.2 阶段9：第二阶段 LLM 审核（对最终 prompt 审查优化）
// ------------------------------------------------------------
// 位置：插件全部处理完成之后、送 ComfyUI 之前。
// 任何异常都不阻断生成 —— 保留审核前的 prompt 并告警。
// ============================================================

let lastPipelineReports: StageReport[] = [];
/**
 * v2.3：最近一次第一阶段 LLM 的抽取结果（缓存）。
 * 用途：「管线预览」用它离线重跑阶段5-7 并逐段展示产物 —— 不额外调用 LLM、不消耗额度。
 * （设计文档 P10「预览链路残缺」的收口）
 */
let lastExtraction: ReturnType<typeof parseJson> | null = null;

// ============================================================
// v2.6：三模式 → 三份提示词
// ------------------------------------------------------------
// 一次生成里可跑多个「变体」（= 解析模式），每个变体：
//   ① 用**自己那份**可编辑预设 + 模式专属固定层/契约块 → 各自的系统提示词；
//   ② 各跑一次第一阶段 LLM（只产出本模式那一种输出）；
//   ③ 各走一遍阶段5-9（管线 → 合成 → 审核）。
// 结果：一次拿到 tags / description / mixed 三份可对比的提示词，默认渲染其中一份。
// ============================================================

/** 一个变体（= 一个解析模式）的生成结果 */
interface VariantResult {
    mode: ExtractMode;
    prompt: string;
    reports: StageReport[];
    extraction: ReturnType<typeof parseJson>;
}

/** 最近一次生成的全部变体（结果面板展示 / 换版渲染） */
let lastVariantResults: VariantResult[] = [];

/**
 * v2.6：决定本次要生成哪些变体。
 * - `gen_variants` 为空 → 只跑当前解析模式（默认行为，零变化）
 * - `gen_variants` 有值 → 按其顺序跑（去重、剔除非法值）
 */
function resolveVariants(s: Record<string, unknown>, currentMode: ExtractMode): ExtractMode[] {
    const raw = Array.isArray(s.gen_variants) ? s.gen_variants : [];
    const valid: ExtractMode[] = [];
    for (const v of raw) {
        const m = String(v) as ExtractMode;
        if ((m === "tags" || m === "description" || m === "mixed" || m === "custom") && !valid.includes(m)) valid.push(m);
    }
    if (!valid.length) return [currentMode];
    // 当前解析模式排前面（渲染时优先用它那份），其余按用户顺序
    const head = valid.filter(m => m === currentMode);
    const rest = valid.filter(m => m !== currentMode);
    return [...head, ...rest];
}

/** 模式的展示名 */
const MODE_LABEL: Record<ExtractMode, string> = {
    tags: "只解析 Danbooru 标签",
    description: "只解析自然语言描述",
    mixed: "混合式（描述 + 标签）",
    custom: "完全自定义",
};

async function runFinalReview(params: {
    finalPrompt: string;
    sourceText: string;
    settings: Record<string, unknown>;
    signal?: AbortSignal;
    /** v2.4：送审形态（tags / description / mixed）—— 决定审核基准用哪一套条目 */
    shape?: "tags" | "description" | "mixed";
}): Promise<string> {
    const s = params.settings;
    const before = params.finalPrompt;
    const pushReport = (label: string, ok: boolean, note: string) => {
        lastPipelineReports.push({
            stage: "review",
            id: "llm.review",
            label,
            enabled: true,
            inLen: before.length,
            outLen: ok ? note.length : before.length,
            warnings: ok ? [] : [note],
        });
    };
    try {
        const reviewPrompt = buildReviewSystemPrompt({
            preset: String(s.review_prompt_preset ?? ""),
            custom: String(s.review_prompt_custom ?? ""),
            prompt: before,
            source: s.review_include_source === true ? params.sourceText : "",
            shape: params.shape,
        });
        const userMsg = s.review_include_source === true
            ? `【原始正文】\n${params.sourceText}\n\n【待审核提示词】\n${before}`
            : `【待审核提示词】\n${before}`;
        // v2.2: 审核阶段同样可调用标签工具（补/换更贴切的标签）
        let reviewTools: LlmToolDefinition[] = [];
        const mcpUrl = String(s.tagtool_mcp_url ?? DEFAULT_MCP_URL);
        if (isModuleEnabled(s, "tagtool.review")) {
            try {
                const tools = await listMcpTools(mcpUrl);
                reviewTools = McpClient.toFunctionDefs(
                    tools.filter(t => ["search_tags", "get_related_tags"].includes(t.name)),
                );
            } catch {
                reviewTools = [];
            }
        }
        const raw = await callLlmWithTools({
            messages: [
                { role: "system", content: reviewPrompt },
                { role: "user", content: userMsg },
            ],
            settings: s,
            signal: params.signal,
            tools: reviewTools,
            mcpUrl,
            maxRounds: reviewTools.length ? (Number(s.tagtool_max_rounds) || 2) : 0,
            jsonMode: s.llm_json_mode === true,
            model: String(s.llm_model ?? ""),
            reasoningEffort: (s.llm_reasoning_effort as string) ?? "none",
            temperature: s.llm_temperature !== undefined ? Number(s.llm_temperature) : undefined,
            topP: s.llm_top_p !== undefined ? Number(s.llm_top_p) : undefined,
            thinkingBudget: s.thinking_budget as number,
            maxTokens: s.llm_max_tokens as number,
        });
        if (!raw || !raw.trim()) {
            pushReport("第二阶段 LLM 审核", false, "审核返回空内容，已保留审核前提示词");
            return before;
        }
        let revised = "";
        let notes: string[] = [];
        try {
            const obj = parseJson(raw) as unknown as { prompt?: string; notes?: string[] };
            revised = typeof obj.prompt === "string" ? obj.prompt.trim() : "";
            notes = Array.isArray(obj.notes) ? obj.notes.map(n => String(n)) : [];
        } catch {
            // 回退：模型给了纯文本
            revised = String(raw).replace(/```[a-z]*|```/gi, "").trim();
        }
        if (!revised) {
            pushReport("第二阶段 LLM 审核", false, "审核结果为空，已保留审核前提示词");
            return before;
        }
        // 格式守卫：分段结构/分隔符风格变化 → 丢弃修订版（开关 = 「审核格式守卫」模块）
        //
        // v2.5 修复（判别力不足）：旧实现只看「整段是否含逗号」。
        //   v2.5 之前 Hard Tags 段是空格分隔、整段无逗号 → 这个粗判恰好能拦住
        //   「审核把标签段改成逗号串」；但 v2.5 起 Hard Tags 段本身就是逗号分隔，
        //   而 Natural Language 段本来就含逗号 → 整段永远含逗号 →
        //   「审核把 Hard Tags 改成空格分隔（1girl solo black hair）」这类破坏**再也拦不住**。
        // 现在改为**逐段签名比对**：段数 + 每段的形态（comma / space / sentence）都必须一致。
        if (isModuleEnabled(s, "review.format_guard")) {
            const sigIn = promptSectionSignature(before);
            const sigOut = promptSectionSignature(revised);
            if (sigIn !== sigOut) {
                pushReport("第二阶段 LLM 审核", false,
                    `审核结果格式与原提示词不一致（结构 ${sigIn} → ${sigOut}），已丢弃修订版`);
                return before;
            }
        }
        // 关键标签丢失检查（格式守卫通过后、返回修订版前）
        // 使用非捕获组 + 全局匹配，查找提示词中所有关键标签（作为独立词）
        const CRITICAL_TAGS = /\b(?:safe|sensitive|nsfw|explicit|solo|1girl|1boy|2girls|2boys)\b/gi;
        const beforeCritical = Array.from(before.matchAll(CRITICAL_TAGS)).map(m => m[0]);
        const afterCritical = Array.from(revised.matchAll(CRITICAL_TAGS)).map(m => m[0]);
        if (beforeCritical.length > 0 && afterCritical.length === 0) {
            pushReport("第二阶段 LLM 审核", true,
                `审核修订版丢失关键标签 ${beforeCritical.join(",")}（已保留修订版但记录告警）`);
        }
        if (revised === before) {
            pushReport("第二阶段 LLM 审核", true, "审核无改动");
            return before;
        }
        pushReport("第二阶段 LLM 审核", true, notes.length ? `审核改动：${notes.join("；")}` : "审核已优化");
        return revised;
    } catch (err) {
        if (isAbortError(err)) throw err;
        pushReport("第二阶段 LLM 审核", false, `审核失败（已保留原提示词）：${(err as Error).message}`);
        return before;
    }
}

/**
 * v2.5：提示词的**逐段结构签名**（用于审核格式守卫）。
 *
 * 形态判定（按段）：
 *   - "sentence" 段：句号/问号/叹号后跟空格+字母 → 完整英文句子段
 *   - "comma"   段：含「逗号+空格」→ 逗号分隔（Hard Tags 段 / 逗号短语段）
 *   - "space"   段：其余 → 空格分隔（旧的 Hard Tags 形态，已废弃）
 * 签名 = 段数 + 各段形态拼接。审核前后签名不一致 → 格式被改坏 → 丢弃修订版。
 * v2.6：标签段增加标签数分桶（每 5 个一档），防止审核大幅增删标签。
 */
function promptSectionSignature(prompt: string): string {
    const secs = String(prompt ?? "").split(/\nBREAK\n/).map(s => s.trim()).filter(Boolean);
    return secs.map(s => {
        if (/[.!?]\s+[A-Za-z]/.test(s)) return "sentence";
        if (/,\s/.test(s)) {
            const count = s.split(/,\s+/).filter(Boolean).length;
            // 标签数分桶：每 5 个一档，防止审核大幅增删标签
            return `comma:${Math.floor(count / 5) * 5}`;
        }
        if (/,\S/.test(s)) {
            // 逗号无空格
            const count = s.split(/,\s*/).filter(Boolean).length;
            return `comma:${Math.floor(count / 5) * 5}`;
        }
        return "space";
    }).join("|");
}

/**
 * v2.2：执行 LLM 发起的 MCP 工具调用（标签检索）。
 * 返回给模型的文本：候选标签清单（紧凑）或工具错误说明（不抛出，避免中断生成）。
 */
async function runTagToolCall(call: { id: string; name: string; arguments: string }, mcpUrl: string): Promise<string> {
    try {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(call.arguments || "{}"); } catch { /* 用空参数 */ }
        if (call.name === "search_tags") {
            const query = String(args.query ?? "").slice(0, 200);
            const r = await searchViaMcp(mcpUrl, query, 12);
            if (!r) return "（标签检索服务暂不可用，请基于已有知识输出标签）";
            if (!r.candidates.length) return "（未找到匹配标签）";
            return buildCandidatesBlock(r.candidates);
        }
        if (call.name === "get_related_tags") {
            const tags = Array.isArray(args.tags) ? args.tags.map(String) : [];
            const r = await relatedViaMcp(mcpUrl, tags, 12);
            if (!r) return "（标签检索服务暂不可用）";
            if (!r.length) return "（未找到关联标签）";
            return buildCandidatesBlock(r);
        }
        if (call.name === "get_anima_format") {
            const t = await animaFormatViaMcp(mcpUrl);
            return t ?? "（Anima 格式规范暂不可用）";
        }
        return `（未知工具：${call.name}）`;
    } catch (e) {
        return `（工具执行失败：${(e as Error).message}）`;
    }
}

/**
 * v2.2：带工具往返的 LLM 调用。
 * 模型请求调用工具 → 插件执行 MCP 工具 → 结果回灌 → 继续（最多 maxRounds 轮）。
 * 服务不支持 tools 时自动降级为「无工具单轮调用」（不抛错）。
 * v2.7：统一重试逻辑 —— 基于 LlmError.kind 判断是否可重试，支持 Retry-After。
 * v2.8：支持流式进度回调。
 */
async function callLlmWithTools(params: {
    messages: LlmMessage[];
    settings: Record<string, unknown>;
    signal?: AbortSignal;
    tools: LlmToolDefinition[];
    mcpUrl: string;
    maxRounds: number;
    jsonMode: boolean;
    model: string;
    reasoningEffort: string;
    temperature?: number;
    topP?: number;
    thinkingBudget: number;
    maxTokens: number;
    onProgress?: (info: { chars: number; reasoningChars: number; elapsedMs: number }) => void;
}): Promise<string> {
    const s = params.settings;
    // API Profile 支持：如果启用了 use_api_profile，从 profile 获取配置
    const useApiProfile = s.use_api_profile === true;
    const currentProfileId = s.current_api_profile_id as string | undefined;
    const apiProfiles = (s.api_profiles as Array<{id: string, apiKey: string, url: string, model: string}>) ?? [];
    const selectedProfile = useApiProfile && currentProfileId
        ? apiProfiles.find(p => p.id === currentProfileId)
        : null;

    const effectiveApiKey = useApiProfile && selectedProfile ? selectedProfile.apiKey : String(s.apiKey ?? "");
    const effectiveUrl = useApiProfile && selectedProfile ? selectedProfile.url : String(s.llm_url ?? "");
    const effectiveModel = useApiProfile && selectedProfile ? selectedProfile.model : params.model;

    const convo: LlmMessage[] = [...params.messages];
    const maxRounds = Math.max(0, Math.min(10, params.maxRounds));
    let content = "";

    for (let round = 0; round <= maxRounds; round++) {
        // 内部使用简化格式 { id, name, arguments }
        let calls: Array<{ id: string; name: string; arguments: string }> = [];
        let attempt = 0;
        const maxAttempts = 3; // 最多重试 2 次
        while (true) {
            try {
                calls = [];
                const callOptions: CallLLMOptions = {
                    messages: convo,
                    apiKey: effectiveApiKey,
                    url: effectiveUrl,
                    model: effectiveModel,
                    maxTokens: params.maxTokens,
                    signal: params.signal,
                    reasoningEffort: params.reasoningEffort,
                    temperature: params.temperature,
                    top_p: params.topP,
                    thinkingBudget: params.thinkingBudget,
                    jsonMode: params.jsonMode,
                    tools: params.tools.length ? params.tools : undefined,
                    toolCallsOut: calls,
                    onProgress: params.onProgress,
                };
                content = await callLLM(callOptions);
                // 成功，跳出重试循环
                break;
            } catch (e) {
                if (!(e instanceof LlmError) || !e.retryable || attempt >= maxAttempts - 1) throw e;
                const delay = e.retryAfterMs ?? Math.min(8000, 1000 * 2 ** attempt) + Math.random() * 300;
                logger.warn(`[LLM] ${e.kind} retry in ${Math.round(delay)}ms (attempt ${attempt + 1}/${maxAttempts})`);
                await new Promise(r => setTimeout(r, delay));
                attempt++;
            }
        }

        if (!calls.length) break;
        if (round === maxRounds) break;
        // calls 内部使用简化格式 { id, name, arguments }，转为 OpenAI 兼容格式
        convo.push({
            role: "assistant",
            content: content ?? null,
            tool_calls: calls.map(c => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: c.arguments } })),
        });
        for (const c of calls) {
            const result = await runTagToolCall(c, params.mcpUrl);
            convo.push({ role: "tool", tool_call_id: c.id, content: result });
        }
    }
    return content;
}

/**
 * v2.6：把「最终提示词 → 后端 → 贴回聊天」抽成独立函数。
 * 主生成流程与结果面板里的「换版渲染」共用同一段逻辑（避免两份渲染代码走偏）。
 * v2.5：支持多后端（comfyui | latent_moe）
 */
async function renderPromptToChat(params: {
    finalPrompt: string;
    s: Record<string, unknown>;
    resultDiv: HTMLElement;
    targetMesBlock?: HTMLElement;
    isAuto: boolean;
    signal?: AbortSignal;
    cleanupProgress?: () => void;
    /** 不覆盖 resultDiv.textContent（用于换版渲染，保留变体面板） */
    skipResultDivUpdate?: boolean;
}): Promise<void> {
    const { finalPrompt, s, resultDiv, targetMesBlock, isAuto, signal } = params;
    const context = getContext();
    const backend = getGenerationBackend();

    let format: string;
    let data: string;

    if (genTiming) genTiming.renderStart = performance.now();
    setProgress('rendering');

    if (backend === "latent_moe") {
        if (!isLatentMoeConfigured()) {
            throw new Error("latent.moe 后端已选择但未配置 API Key，请在设置中填写 latent_api_key");
        }
        resultDiv.textContent = "🌐 正在通过 latent.moe 生成图片...";
        const result = await generateLatentMoeImage(finalPrompt, signal);
        format = result.format;
        data = result.data;
    } else if (backend === "runninghub") {
        if (!isRunningHubConfigured()) {
            throw new Error("RunningHub 后端已选择但配置不完整，请在设置中填写 API Key、工作流 ID 和提示词节点 ID");
        }
        resultDiv.textContent = "☁️ 正在通过 RunningHub 生成图片...";
        const result = await generateRunningHubImage(finalPrompt, signal);
        format = result.format;
        data = result.data;
    } else {
        // ComfyUI 本地后端
        const loraSlots = Array.isArray(s.lora_slots) ? s.lora_slots : [];
        const workflowSettings = {
            model: String(s.model ?? ""),
            steps: Number(s.steps),
            first_steps: Number(s.first_steps),
            first_cfg: Number(s.first_cfg),
            first_sampler: String(s.first_sampler ?? ""),
            first_scheduler: String(s.first_scheduler ?? ""),
            second_cfg: Number(s.second_cfg),
            second_sampler: String(s.second_sampler ?? ""),
            second_scheduler: String(s.second_scheduler ?? ""),
            width: Number(s.width),
            height: Number(s.height),
            seed: s.seed !== undefined ? Number(s.seed) : -1,
            negative_prompt: String(s.negative_prompt ?? ""),
            loras: loraSlots,
        };
        const result = await generateComfyImage(finalPrompt, String(s.comfy_url ?? ""), workflowSettings, signal);
        format = result.format;
        data = result.data;
    }

    const charName = context.name2 || "image_st";
    const { url: mediaUrl, original_url: mediaOriginalUrl } = await saveGeneratedImage(data, format, charName);
    const chatMessages = context.chat ?? [];
    const lastMsg = chatMessages[chatMessages.length - 1];
    if (!lastMsg.extra) lastMsg.extra = {};
    if (!Array.isArray(lastMsg.extra.media)) lastMsg.extra.media = [];
    lastMsg.extra.inline_image = true;
    lastMsg.extra.media.push({
        url: mediaUrl,
        original_url: mediaOriginalUrl,
        title: finalPrompt,
        type: MEDIA_TYPE.IMAGE,
        source: MEDIA_SOURCE.GENERATED,
    });
    lastMsg.extra.media_index = lastMsg.extra.media.length - 1;
    logger.debug('[image_st] Final prompt:', finalPrompt.substring(0, 500) + (finalPrompt.length > 500 ? '...' : ''), '(length:', finalPrompt.length, ')');
    if (!targetMesBlock || !document.contains(targetMesBlock)) {
        throw new Error("目标消息已从 DOM 中移除，请重试");
    }
    appendMediaToMessage(lastMsg, $(targetMesBlock), SCROLL_BEHAVIOR.KEEP);
    toastr.info(`提示词已存储 (${finalPrompt.length} 字符)，点击图片后使用“复制”按钮获取完整内容`, 'ST Image Plugin', { timeOut: 5000 });
    params.cleanupProgress?.();
    applyImagePosition(targetMesBlock);
    applyAnchorPosition(targetMesBlock);
    // v1.9.1: 会话配额——超 N 张卸载最早生成图（appendMediaToMessage 异步挂 DOM，延迟执行）
    setTimeout(() => enforceGeneratedMediaQuota(), 350);
    await saveChatConditional();
    if (genTiming) genTiming.end = performance.now();
    const promptMs = genTiming ? genTiming.renderStart - genTiming.promptStart : 0;
    const renderMs = genTiming ? genTiming.end - genTiming.renderStart : 0;
    const totalMs = genTiming ? genTiming.end - genTiming.start : 0;
    const backendLabel = backend === "latent_moe" ? "latent.moe (在线)" : backend === "runninghub" ? "RunningHub (在线)" : "ComfyUI (本地)";
    if (!params.skipResultDivUpdate) {
        resultDiv.textContent = `图片已发送到聊天 (${backendLabel})\n\n--- 生成耗时 ---\n提示词生成: ${formatDuration(promptMs)}\n图片渲染: ${formatDuration(renderMs)}\n总耗时: ${formatDuration(totalMs)}`;
    }
    if (!isAuto) resultDiv.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/** 复制到剪贴板（优先 async API，失败回退 execCommand） */
function copyToClipboard(text: string): void {
    try {
        if (navigator.clipboard?.writeText) {
            void navigator.clipboard.writeText(text);
            toastr.success("已复制该版本提示词", "生成管线");
            return;
        }
    } catch { /* 回退 */ }
    try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        toastr.success("已复制该版本提示词", "生成管线");
    } catch {
        toastr.warning("复制失败，请手动选中文本复制", "生成管线");
    }
}

/**
 * v2.6：结果面板展示多份变体提示词（复制 / 换版渲染）。
 * 追加在结果文本之后（不改写已有内容）。
 */
function showVariantPanel(resultDiv: HTMLElement, variants: VariantResult[], primaryMode: ExtractMode): void {
    // 清理旧面板，防止连续生成叠加
    resultDiv.querySelectorAll(".image-st-variant-panel").forEach(el => el.remove());
    const box = document.createElement("div");
    box.className = "image-st-variant-panel";
    const title = document.createElement("div");
    title.className = "image-st-variant-title";
    title.textContent = `本次共生成 ${variants.length} 份提示词（每个模式的 LLM 只产出自己那一种输出）`;
    box.appendChild(title);
    for (const v of variants) {
        const row = document.createElement("div");
        row.className = "image-st-variant-row";
        const head = document.createElement("div");
        head.className = "image-st-variant-head";
        head.textContent = `${MODE_LABEL[v.mode]}${v.mode === primaryMode ? "（本次已渲染）" : ""} · ${v.prompt.length} 字符`;
        const ta = document.createElement("textarea");
        ta.className = "text_pole textarea_compact";
        ta.readOnly = true;
        ta.value = v.prompt;
        const btns = document.createElement("div");
        btns.className = "image-st-variant-btns";
        const copy = document.createElement("span");
        copy.className = "image-st-mvu-chip";
        copy.style.cursor = "pointer";
        copy.textContent = "复制";
        copy.addEventListener("click", () => copyToClipboard(v.prompt));
        const render = document.createElement("span");
        render.className = "image-st-mvu-chip";
        render.style.cursor = "pointer";
        render.textContent = "用此版本渲染";
        render.addEventListener("click", () => { void renderVariantPrompt(v.prompt, v.mode); });
        btns.append(copy, render);
        row.append(head, ta, btns);
        box.appendChild(row);
    }
    resultDiv.appendChild(box);
}

/** v2.6：用某一份变体提示词重新出图（不重新调用 LLM） */
async function renderVariantPrompt(prompt: string, mode?: ExtractMode): Promise<void> {
    if (isGenerating) {
        toastr.warning('已有图片正在生成中，请等待完成', 'ST Image Plugin');
        return;
    }
    const s = extension_settings[SETTINGS_KEY];
    const resultDiv = document.getElementById("image_st_result");
    if (!resultDiv || !s) {
        return;
    }
    isGenerating = true;
    resetProgress();
    const abort = new AbortController();
    activeAbort = abort;
    // 为换版渲染创建独立的进度元素（避免污染主生成流程的 genProgressEl）
    const progressEl = document.createElement("div");
    progressEl.className = "image-st-progress-inline";
    progressEl.textContent = "🎨 正在渲染变体...";
    resultDiv.prepend(progressEl);
    try {
        const lastMesBlocks = document.querySelectorAll(".mes");
        const targetMesBlock = lastMesBlocks[lastMesBlocks.length - 1] as HTMLElement | undefined;
        await renderPromptToChat({
            finalPrompt: prompt,
            s: s as Record<string, unknown>,
            resultDiv,
            targetMesBlock,
            isAuto: false,
            signal: abort.signal,
            skipResultDivUpdate: true,
            cleanupProgress: () => progressEl.remove(),
        });
        lastFinalPrompt = prompt;
        // v2.6：把该模式的「当前版本」记下来 → 之后点「重新生成」用的是这一份
        const rec = lastVariantResults.find(x => x.mode === mode);
        if (rec) rec.prompt = prompt;
        setProgress('done');
        // 重新显示变体面板（保留在结果区域）
        showVariantPanel(resultDiv, lastVariantResults, mode ?? String(s.extract_output_mode ?? "mixed") as ExtractMode);
    } catch (err) {
        progressEl.remove();
        if (isAbortError(err)) {
            // 不覆盖 resultDiv，保留变体面板
            toastr.info("生成已取消", "ST Image Plugin");
            resetProgress();
        } else {
            setProgress('failed', `生成失败: ${err instanceof Error ? err.message : String(err)}`);
            // 错误时显示错误信息但保留变体面板
            const errDiv = document.createElement("div");
            errDiv.className = "image-st-progress-inline";
            errDiv.style.color = "var(--SmartThemeQuoteColor)";
            errDiv.textContent = `❌ 生成失败: ${err instanceof Error ? err.message : String(err)}`;
            resultDiv.prepend(errDiv);
            setTimeout(() => errDiv.remove(), 5000);
        }
    } finally {
        abort.abort();
        if (activeAbort === abort) activeAbort = null;
        isGenerating = false;
        setTimeout(() => {
            if (currentStage === 'done' || currentStage === 'failed') resetProgress();
        }, 3000);
    }
}

/**
 * v2.7: 重试最后一次失败的 LLM 调用（跳过清洗/注入重建，直接复用已保存的上下文）
 */
async function retryLastLLMCall(
    resultDiv: HTMLElement,
    targetMesBlock: HTMLElement | undefined,
    isAuto: boolean
): Promise<void> {
    if (!lastFailedLLMContext) {
        toastr.warning("没有可重试的上下文", "ST Image Plugin");
        return;
    }

    // 禁用重试按钮防止重复点击
    const retryBtn = resultDiv.querySelector(".menu_button") as HTMLElement;
    if (retryBtn) {
        retryBtn.textContent = "重试中...";
        retryBtn.style.pointerEvents = "none";
    }

    // 创建新的中止控制器
    const abortController = new AbortController();
    activeAbort = abortController;

    const ctx = lastFailedLLMContext;
    const s = ctx.settings;
    const mode = ctx.mode;

    try {
        setProgress('prompting');
        resultDiv.textContent = "正在重试 LLM 调用...";

        // 重新调用 LLM
        const rawJson = await callLlmWithTools({
            messages: [
                { role: "system", content: ctx.systemPrompt },
                { role: "user", content: ctx.llmInput },
            ],
            settings: ctx.settings,
            signal: abortController.signal,
            tools: ctx.tools,
            mcpUrl: ctx.mcpUrl,
            maxRounds: ctx.maxRounds,
            jsonMode: ctx.jsonMode,
            model: ctx.model,
            reasoningEffort: ctx.reasoningEffort,
            temperature: ctx.temperature,
            topP: ctx.topP,
            thinkingBudget: ctx.thinkingBudget,
            maxTokens: ctx.maxTokens,
            onProgress: ({ chars, reasoningChars: _reasoningChars, elapsedMs }) => {
                const progressEl = resultDiv.querySelector(".image-st-inline-progress");
                if (progressEl) {
                    const span = progressEl.querySelector("span");
                    if (span) span.textContent = `生成中 (${chars} 字符 / ${formatDuration(elapsedMs)})`;
                }
            },
        });

        // 解析 JSON
        const extraction = parseJson(rawJson);
        if (!extraction || !extraction.mainSubject) {
            throw new Error(`JSON 缺少 mainSubject 字段（模式：${mode}）`);
        }
        extraction.isPovScene = false; // 重试时不重新做 POV 判定

        // 走后续管线（阶段5-9）
        const built = buildPrompt(extraction);
        if (built.warnings.length > 0) {
            console.warn(`[image_st] 规则引擎告警(${mode}):`, built.warnings);
        }

        // 校正层：规则引擎不再被丢弃，而是把确定性要素（人数/镜头/景别）叠加到 LLM 产物上
        const correction = buildCorrectionInfo(extraction);
        if (correction.warnings.length) {
            console.warn(`[image_st] 规则引擎告警(${mode}):`, correction.warnings);
        }

        // 自然语言链
        const llmDescription = (mode !== "tags" && typeof extraction.description === "string" && extraction.description.trim())
            ? extraction.description
            : built.prompt;

        const { head, tail } = computeHeadTail(s as Record<string, unknown>);

        // 标签层后处理 + 格式化（统一 TagDoc 管线）
        const pipeline = runTagPipeline({
            descriptionPrompt: llmDescription,
            descriptionIsSentence: !!llmDescription,
            llmTags: Array.isArray(extraction.tags) ? extraction.tags : [],
            mode: mode,
            modules: getModuleSwitches(s as Record<string, unknown>),
            lexicon: undefined,
            separator: "comma",
            budgetMax: Math.max(0, Math.floor(Number(s.budget_max) || 45)),
            weightMap: (s.ext_weight_map as Record<string, number>) ?? {},
            qualityWords: String(s.anima_quality_words ?? "").split(",").map(x => x.trim()).filter(Boolean),
            corrections: {
                countTags: correction.countTags,
                opticsWords: correction.opticsWords,
                opticsWordsV2: correction.opticsWordsV2,
                distance: correction.distance,
                isPov: correction.isPov,
            },
            subjects: [extraction.mainSubject, ...(extraction.secondarySubjects ?? [])],
            overrideLlmCountTags: s.override_llm_count_tags === true,
            candidateSourceNote: undefined,
        });
        let vPrompt = composePrompt(pipeline.prompt, head, tail, mode);
        const vReports = [...pipeline.reports, ...built.warnings.map(w => ({ stage: "format" as const, id: "build.warning", label: "构建告警", enabled: true, inLen: 0, outLen: 0, unit: "chars" as const, warnings: [w] }))];

        // 第二阶段 LLM 审核
        if (shouldRunReview(s as Record<string, unknown>)) {
            vPrompt = await runFinalReview({
                finalPrompt: vPrompt,
                sourceText: "", // 重试时没有原始正文，留空
                settings: s as Record<string, unknown>,
                signal: abortController.signal,
                shape: reviewShapeFor(mode),
            });
        }

        // 更新结果
        const _primary = { mode, prompt: vPrompt, reports: vReports, extraction };
        lastPipelineReports = vReports;
        showPipelineReports(lastPipelineReports);
        lastExtraction = extraction;

        const finalPrompt = vPrompt;
        logger.debug(`[image_st] 重试后最终 prompt（${finalPrompt.length} 字符）:\n${finalPrompt}`);

        // 清除重试按钮
        if (retryBtn && retryBtn.parentNode) retryBtn.parentNode.removeChild(retryBtn);

        // 渲染到聊天
        await renderPromptToChat({
            finalPrompt,
            s: s as Record<string, unknown>,
            resultDiv,
            targetMesBlock,
            isAuto,
            signal: abortController.signal,
            cleanupProgress: () => {
                const progressEl = resultDiv.querySelector(".image-st-inline-progress");
                if (progressEl && progressEl.parentNode) progressEl.parentNode.removeChild(progressEl);
            },
        });

        lastFinishTime = Date.now();
        lastFinalPrompt = finalPrompt;
        setProgress('done');
        toastr.success("重试成功", "ST Image Plugin");

    } catch (err) {
        if (isAbortError(err)) {
            resultDiv.textContent = "重试已取消";
            resetProgress();
        } else {
            setProgress('failed', `重试失败: ${err instanceof Error ? err.message : String(err)}`);
            // 重新显示重试按钮
            if (retryBtn) {
                retryBtn.textContent = "重试 LLM 调用";
                retryBtn.style.pointerEvents = "";
            }
        }
    } finally {
        if (activeAbort === abortController) activeAbort = null;
    }
}

// 需要导入 computeHeadTail 函数
function computeHeadTail(s: Record<string, unknown>): { head: string; tail: string } {
    const prefix = isModuleEnabled(s, "cmp.prefix") ? (s.fixed_prompt_prefix ?? "") : "";
    const suffix = isModuleEnabled(s, "cmp.suffix") ? (s.fixed_prompt_suffix ?? "") : "";
    let customPart = "";
    if (isModuleEnabled(s, "cmp.tags") && s.prompt_tags_enabled) {
        const tags = (s.prompt_tags as PromptTag[]) ?? [];
        customPart = tags.filter(t => t.enabled && t.prompt.trim()).map(t => t.prompt.trim()).join(", ");
    }
    let stylePart = "";
    if (isModuleEnabled(s, "cmp.style") && s.style_preset_enabled) {
        const styleFields: string[] = [
            String(s.style_preset_aesthetic ?? ""),
            String(s.style_preset_medium ?? ""),
            String(s.style_preset_mood ?? ""),
            String(s.style_preset_material ?? ""),
            String(s.style_preset_lighting ?? ""),
        ];
        stylePart = styleFields.filter((v: string) => v.trim()).join(", ");
    }
    const head = [prefix, customPart].map(x => String(x ?? "").trim()).filter(Boolean).join(", ");
    const tail = [stylePart, suffix].map(x => String(x ?? "").trim()).filter(Boolean).join(", ");
    return { head, tail };
}

async function onGenerate(isAuto = false) {
  // v0.9.9: Lock check
  if (isGenerating) {
    toastr.warning('已有图片正在生成中，请等待完成', 'ST Image Plugin');
    return;
  }
  isGenerating = true;
  // v1.0.4: Initialize timing
  genTiming = { start: performance.now(), promptStart: 0, renderStart: 0, end: 0 };

  const resultDiv = document.getElementById("image_st_result");
  if (!resultDiv) { 
    isGenerating = false; 
    resetProgress(); 
    return; 
  }

  // v1.0.4: Inline progress element at anchor position
  // v1.0.7 B3: 取消 anchor_text 非空限制 — 无锚点时在 mes_text 之后插入进度元素
  const lastMesBlocks = document.querySelectorAll(".mes");
  const targetMesBlock = lastMesBlocks[lastMesBlocks.length - 1] as HTMLElement | undefined;
  let genProgressEl: HTMLElement | null = null;
  if (targetMesBlock) {
    const s_tmp = extension_settings[SETTINGS_KEY];
    const anchorText = ((s_tmp.anchor_text as string) ?? "").trim();
    const textEl = targetMesBlock.querySelector('.mes_text') as HTMLElement | null;
    if (textEl) {
      // v1.0.7 B2/B3: 锚点匹配优先数据层原文（标签形态锚点在 DOM 中不可见），DOM 文本作回退
      const rawMes = getMesRawText(targetMesBlock);
      const anchorMatched = anchorText.length > 0 && (rawMes.includes(anchorText) || (textEl.textContent?.trim().includes(anchorText) ?? false));
      let refNode: Node | null;
      if (anchorMatched) {
        const pos = (s_tmp.anchor_position as string) ?? 'above';
        refNode = pos === 'above' ? textEl : textEl.nextElementSibling;
      } else {
        // 无锚点/未匹配：插入 mes_text 之后、mes_media_wrapper 之前
        refNode = textEl.nextElementSibling;
      }
      genProgressEl = document.createElement('div');
      genProgressEl.className = 'image-st-inline-progress';
      genProgressEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin-pulse"></i> <span>生成中...</span>';
      textEl.parentNode?.insertBefore(genProgressEl, refNode);
      if (!isAuto) genProgressEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  // v1.0.4: 1-second progress timer (resultDiv + floating button tooltip + inline progress)
  let genProgressTimer: ReturnType<typeof setInterval> | null = null;
  let genProgressTimerCancelled = false;
  if (resultDiv) {
    genProgressTimer = setInterval(() => {
      if (genProgressTimerCancelled || !genTiming) return;
      const elapsed = formatDuration(performance.now() - genTiming.start);
      if (currentStage === 'prompting' || currentStage === 'rendering') {
        const prefix = currentStage === 'prompting' ? '🖋 正在生成 Prompt' : '🎨 正在渲染图片';
        resultDiv.textContent = `${prefix}... (${elapsed})`;
      }
      if (floatingBtn) {
        floatingBtn.title = `生成中... ${elapsed}`;
      }
      if (genProgressEl) {
        const span = genProgressEl.querySelector('span');
        if (span) span.textContent = `生成中 (${elapsed})`;
      }
    }, 1000);
  }

  let promptReminderTimer: ReturnType<typeof setInterval> | null = null;
  let abortController: AbortController | null = null;

  // 统一清理函数，确保所有路径都能正确释放资源
  const cleanup = (keepGeneratingLock = false) => {
    genProgressTimerCancelled = true;
    if (genProgressTimer) {
      clearInterval(genProgressTimer);
      genProgressTimer = null;
    }
    if (genProgressEl && genProgressEl.parentNode) {
      genProgressEl.parentNode.removeChild(genProgressEl);
      genProgressEl = null;
    }
    if (floatingBtn) {
      floatingBtn.title = '生成图片';
    }
    if (promptReminderTimer) {
      clearInterval(promptReminderTimer);
      promptReminderTimer = null;
    }
    if (abortController) {
      abortController.abort();
      if (activeAbort === abortController) activeAbort = null;
      abortController = null;
    }
    if (!keepGeneratingLock) {
      isGenerating = false;
    }
    setTimeout(() => {
      if (currentStage === 'done' || currentStage === 'failed') {
        resetProgress();
      }
    }, 3000);
  };

  try {
    const s = extension_settings[SETTINGS_KEY];
    if (!s?.apiKey) {
      resultDiv.textContent = "请先在设置中配置 API Key";
      cleanup();
      return;
    }
    const context = getContext();
    const messages = context.chat ?? [];
    const config = getTextCleaningConfig(s);

    abortController = new AbortController();
    activeAbort = abortController;
    const refreshPromises: Promise<unknown>[] = [];
    if (s.mvu_enabled) refreshPromises.push(refreshMvuData());
    if (s.db_enabled) refreshPromises.push(refreshDatabaseData());
    if (s.bbs_enabled) refreshPromises.push(refreshBaibaiData());
    await Promise.all(refreshPromises);
    if (s.db_enabled) {
        const dbSt = getDatabaseStatus();
        if (!dbSt.available) {
            toastr.warning('数据库信息刷新失败，已跳过数据库上下文注入', 'ST Image Plugin', { timeOut: 3000 });
        }
    }

    const processedText = processTextPipeline(messages, config);
    if (!processedText) {
      resultDiv.textContent = "没有 LLM 回复消息可用";
      cleanup();
      return;
    }

    const { llmInput, povInfo, povWarnings } = await buildInjectionInput(processedText);
    // v2.3: POV 判定进阶段报告（可在「生成管线」tab 的诊断区看到判定依据）
    const povReport: StageReport = {
        stage: "pov",
        id: "pov.detect",
        label: "POV 判定",
        enabled: isModuleEnabled(s, "pov.detect"),
        inLen: processedText.length,
        outLen: llmInput.length,
        warnings: povWarnings,
    };

    if (genTiming) genTiming.promptStart = performance.now();
    setProgress('prompting');
    resultDiv.textContent = "正在生成 Prompt...";
    // v1.0.3: 长时间生成定时提醒（每 5 分钟）
    promptReminderTimer = setInterval(() => {
      if (currentStage === 'prompting') {
        toastr.info('⏳ 正在生成 Prompt… 请耐心等待', 'ST Image Plugin', { timeOut: 3000 });
      } else if (currentStage === 'rendering') {
        toastr.info('🎨 正在渲染图片… 请耐心等待', 'ST Image Plugin', { timeOut: 3000 });
      } else {
        if (promptReminderTimer) {
          clearInterval(promptReminderTimer);
          promptReminderTimer = null;
        }
      }
    }, 300000);
    const llmModel = s.llm_model;
    const reasoningEffort = (s.llm_reasoning_effort as string) ?? "none";
    const llmTemperature = s.llm_temperature !== undefined ? Number(s.llm_temperature) : undefined;
    const llmTopP = s.llm_top_p !== undefined ? Number(s.llm_top_p) : undefined;
    // v2.2: 输出模式与模块开关（统一管线）
    const mode = (s.extract_output_mode as ExtractMode) ?? "mixed";
    const modules = getModuleSwitches(s as Record<string, unknown>);
    // v2.6：生成变体 —— 三种模式各跑一次第一阶段 LLM，各出一份提示词。
    //   默认仍只跑当前解析模式（行为完全不变）；开启「三模式各一份」后一次拿到 3 份可对比的提示词。
    const variants = resolveVariants(s as Record<string, unknown>, mode);
    // ── v2.2 阶段8 合成用的固定片段（与模式无关，先算好）──
    // v2.5 修复（句尾拼接破坏句子）：头部并入**首段**、尾部并入**末段句尾**，
    //   避免 ", " 拼在句号之后（`…mattress., watercolor illustration`）。
    const prefix = isModuleEnabled(s, "cmp.prefix") ? (s.fixed_prompt_prefix ?? "") : "";
    const suffix = isModuleEnabled(s, "cmp.suffix") ? (s.fixed_prompt_suffix ?? "") : "";
    let customPart = "";
    if (isModuleEnabled(s, "cmp.tags") && s.prompt_tags_enabled) {
        const tags = (s.prompt_tags as PromptTag[]) ?? [];
        customPart = tags.filter(t => t.enabled && t.prompt.trim()).map(t => t.prompt.trim()).join(", ");
    }
    // v1.x: 预设风格提示词 — 插入在 llmPrompt 之后、suffix 之前
    let stylePart = "";
    if (isModuleEnabled(s, "cmp.style") && s.style_preset_enabled) {
        const styleFields = [
            s.style_preset_aesthetic ?? "",
            s.style_preset_medium ?? "",
            s.style_preset_mood ?? "",
            s.style_preset_material ?? "",
            s.style_preset_lighting ?? "",
        ];
        stylePart = styleFields.filter((v: string) => v.trim()).join(", ");
    }
    const head = [prefix, customPart].map(x => String(x ?? "").trim()).filter(Boolean).join(", ");
    const tail = [stylePart, suffix].map(x => String(x ?? "").trim()).filter(Boolean).join(", ");
    const variantResults: VariantResult[] = [];
    try {
      // v1.9: 结构化 JSON 抽取（POV 感知系统提示词 + json_mode 请求）→ 规则引擎 → 多行 prompt
      // v2.3: 不再有独立的 NSFW 适配块 —— 单一链路按「所见即所得」如实描写正文内容。
      // v2.2: Danbooru 标签工具 —— MCP 在线服务（function calling 真调用 + 候选预注入兜底）
      const mcpUrl = String(s.tagtool_mcp_url ?? DEFAULT_MCP_URL);
      let tagCandidates: string[] = [];
      let toolDefs: LlmToolDefinition[] = [];
      // v2.4：标签候选只在需要 tags 的模式里检索并注入。
      //   description 模式根本不输出 tags → 注入「只能从中挑选」的候选块既是噪声，
      //   又与「不要输出 tags」自相矛盾。
      // v2.6：只要**任一变体**需要 tags 就检索一次（三份变体共用同一批候选，不再重复调 MCP）。
      const needTags = variants.some((m) => m !== "description");
      // 候选来源备注（用于告警归因）
      let candidateSourceNote: string | undefined;
      // v2.7 性能：完整词库**按需加载**。
      // 只有真正依赖词典的环节开启时才解码词库包（首次 ≈240ms / ≈94MB 堆，之后本会话复用）；
      // 不再在页面加载时抢占主线程，也不再无条件常驻内存。
      const dictPipelineOn = isModuleEnabled(s, "resolve.danbooru") || isModuleEnabled(s, "pp.dict");
      const tagtoolOn = isModuleEnabled(s, "tagtool.call") && needTags;
      if (dictPipelineOn || tagtoolOn) {
        await ensureFullLexicon();
      }
      if (isModuleEnabled(s, "tagtool.call") && needTags) {
        try {
          const tools = await listMcpTools(mcpUrl);
          toolDefs = McpClient.toFunctionDefs(
            // v2.4：**不再向模型暴露 get_anima_format**。
            //   该工具返回的规范要求 Hard Tags「包含质量词与 @artist」，与插件的
            //   全局输出禁令（不写画师串 / 不写质量咒语）直接冲突 —— 模型一旦调用它，
            //   就会拿到一份相冲突的格式规范并可能照做。
            //   插件已把格式规则写进系统提示词，不需要再让模型去查。
            tools.filter(t => ["search_tags", "get_related_tags"].includes(t.name)),
          );
          if (!toolDefs.length) console.warn("[image_st] 标签工具：MCP 未提供可用工具");
        } catch (e) {
          console.warn("[image_st] 标签工具：MCP 工具清单获取失败", (e as Error).message);
        }
        // 兜底：预检索候选并注入提示词（服务不支持 function calling 时仍可用）
        try {
          const res = await collectTagCandidates({
            query: processedText.slice(0, 800),
            lex: getDefaultLexicon(),
            limit: Number(s.tagtool_max_candidates) || 12,
            source: (s.tagtool_source as "auto" | "mcp" | "local") ?? "auto",
            mcpUrl,
          });
          tagCandidates = res.candidates.map(c => c.tag);
          if (res.note) {
            console.warn(`[image_st] 标签工具：${res.note}`);
            candidateSourceNote = res.note;
          }
        } catch (e) {
          console.warn("[image_st] 标签工具检索失败（已跳过）:", (e as Error).message);
        }
      }
      // v2.0: llm_json_mode=true → response_format=json_object（抑制 <thinking>，用纯 JSON）；
      //   默认 false → 文本思维链 + parseJson 提取（现有行为不变）。
      const jsonMode = s.llm_json_mode === true;
      // v2.2: 带工具往返的调用（模型可请求调用 MCP 标签检索）
      const toolMaxRounds = Number(s.tagtool_max_rounds) || 3;
      // v2.0: parseJson 失败自动重试一次（retry_json_fail 开时）
      const retryOnce = s.retry_json_fail === true;
      // 词库状态：v2.7 起为**按需加载** —— 上面 ensureFullLexicon() 已在需要时完成解码。
      // 若仍未就绪（未导入 / 解码失败），本次降级用内嵌精选（阶段报告会标注）。
      const lexReady = isFullLexiconReady();
      const lexForPipeline = dictPipelineOn
        ? getDefaultLexicon()
        : undefined;
      if (!lexReady && dictPipelineOn) {
        console.warn("[image_st] 完整词库不可用（未导入或解码失败），本次使用内嵌精选词库");
      }
// ── v2.6：逐变体生成（每个变体一次独立的第一阶段 LLM 调用 + 各自模式的管线）──
      for (const vMode of variants) {
        // v2.2: 提示词 = 预设(可改写) + 自定义 + 契约块(强制)
        // v2.6: 预设**按模式取**（三份互不影响的可编辑预设；缺省回退旧单份预设 → 内置默认层）
        const systemPrompt = buildExtractSystemPrompt({
            preset: resolveExtractPreset(vMode, {
                tags: s.extract_preset_tags,
                description: s.extract_preset_description,
                mixed: s.extract_preset_mixed,
                custom: s.extract_preset_custom,
            }, s.prompt_preset),
            custom: String(s.prompt_custom ?? ""),
            isPov: povInfo.isPov,
            narratorName: povInfo.narratorName,
            mode: vMode,
            tagCandidates,
        });
        // 保存上下文用于重试
        lastFailedLLMContext = {
            systemPrompt,
            llmInput,
            mode: vMode,
            settings: s as Record<string, unknown>,
            signal: abortController.signal,
            tools: toolDefs,
            mcpUrl,
            maxRounds: toolMaxRounds,
            jsonMode,
            model: llmModel,
            reasoningEffort,
            temperature: llmTemperature,
            topP: llmTopP,
            thinkingBudget: s.thinking_budget as number,
            maxTokens: s.llm_max_tokens as number,
        };
        const rawJson = await callLlmWithTools({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: llmInput },
            ],
            settings: s as Record<string, unknown>,
            signal: abortController.signal,
            tools: toolDefs,
            mcpUrl,
            maxRounds: toolMaxRounds,
            jsonMode,
            model: llmModel,
            reasoningEffort,
            temperature: llmTemperature,
            topP: llmTopP,
            thinkingBudget: s.thinking_budget as number,
            maxTokens: s.llm_max_tokens as number,
onProgress: ({ chars, reasoningChars: _reasoningChars, elapsedMs }) => {
                if (genProgressEl) {
                    const span = genProgressEl.querySelector("span");
                    if (span) span.textContent = `生成中 (${chars} 字符 / ${formatDuration(elapsedMs)})`;
                }
            },
        });
// v1.0.6: 缓存命中提示
        const cacheInfo = getLastCacheInfo();
        if (cacheInfo.hit) {
          toastr.success(`缓存命中！节省 ${cacheInfo.hitTokens ?? "?"} tokens`, 'ST Image Plugin', { timeOut: 4000 });
        }
        if (!rawJson || !rawJson.trim()) {
          throw new Error(`LLM 返回空 JSON（模式：${vMode}）`);
        }
        let extraction: ReturnType<typeof parseJson> | null = null;
        try {
          extraction = parseJson(rawJson);
        } catch (e) {
          // 记录完整原始响应用于调试
          logger.error('[image_st] JSON 解析失败', {
              mode: vMode,
              rawLength: rawJson.length,
              rawPreview: rawJson.slice(0, 1000),
              error: (e as Error).message,
              model: llmModel,
              jsonMode,
              hasTools: !!toolDefs.length,
          });
          if (!retryOnce) throw e;
          console.warn("[image_st] 首次解析失败，自动重试一次（降温、加 token、严格指令）:", (e as Error).message);
          
          // 重试：更严格的参数 + 追加指令
          const retrySystemPrompt = systemPrompt + 
              "\n\n⚠ 上一次输出不是合法 JSON。本次**必须只输出 <json>{...}</json>**，不得包含任何推理文本、解释、Markdown 或其他字符。";
          const retryMaxTokens = Math.max(Number(s.llm_max_tokens) || 2048, 3072);
          const rawJson2 = await callLlmWithTools({
              messages: [
                  { role: "system", content: retrySystemPrompt },
                  { role: "user", content: llmInput },
              ],
              settings: s as Record<string, unknown>,
              signal: abortController.signal,
              tools: toolDefs,
              mcpUrl,
              maxRounds: toolMaxRounds,
              jsonMode,
              model: llmModel,
              reasoningEffort,
              temperature: 0.1,  // 重试时大幅降温
              topP: llmTopP !== undefined ? Math.min(Number(llmTopP), 0.9) : 0.9,
              thinkingBudget: s.thinking_budget as number,
              maxTokens: retryMaxTokens,
onProgress: ({ chars, reasoningChars: _reasoningChars, elapsedMs }) => {
                  if (genProgressEl) {
                      const span = genProgressEl.querySelector("span");
                      if (span) span.textContent = `重试中 (${chars} 字符 / ${formatDuration(elapsedMs)})`;
                  }
              },
          });
          if (!rawJson2 || !rawJson2.trim()) throw new Error(`LLM 重试仍返回空 JSON（模式：${vMode}）`);
          extraction = parseJson(rawJson2);
        }
        if (!extraction || !extraction.mainSubject) {
          if (vMode === "custom" && extraction && "prompt" in extraction) {
            // custom 模式：LLM 返回 {prompt, notes}，直接使用 prompt，跳过后续管线
            const customPrompt = String((extraction as Record<string, unknown>).prompt).trim();
            if (!customPrompt) {
              throw new Error(`custom 模式：LLM 返回的 prompt 为空`);
            }
            const vReports: StageReport[] = [{
              stage: "format", id: "fmt.custom_direct", label: "Custom 模式直通", enabled: true, applied: true,
              inLen: customPrompt.length, outLen: customPrompt.length, unit: "chars", warnings: [],
            }];
            let vPrompt = composePrompt(customPrompt, head, tail, vMode);
            if (isModuleEnabled(s, "cmp.cjk_fallback")) {
              const before = vPrompt;
              const cleaned = stripChineseFallback(vPrompt);
              if (cleaned !== vPrompt) {
                const hadBreak = before.includes("\nBREAK\n");
                const stillHasBreak = cleaned.includes("\nBREAK\n");
                if (hadBreak && !stillHasBreak) {
                  vReports.push({
                    stage: "compose", id: "cmp.cjk_fallback",
                    label: "中文兜底剔除", enabled: true, applied: true,
                    inLen: before.length, outLen: cleaned.length, unit: "chars",
                    warnings: [`[中文兜底] custom 模式 NL 段被整段剔除（${before.length - cleaned.length} 字符）`],
                  });
                } else {
                  console.warn(`[image_st] 检测到中文残留（custom），已兜底剔除 ${before.length - cleaned.length} 字符`);
                }
                vPrompt = cleaned;
              }
              if (!vPrompt.trim()) {
                throw new Error(`custom 模式中文兜底后为空`);
              }
            }
            variantResults.push({ mode: vMode, prompt: vPrompt, reports: vReports, extraction });
            continue;
          }
          throw new Error(`JSON 缺少 mainSubject 字段（模式：${vMode}）`);
        }
        extraction.isPovScene = povInfo.isPov;
        const built = buildPrompt(extraction);
        if (built.warnings.length > 0) {
          console.warn(`[image_st] 规则引擎告警(${vMode}):`, built.warnings);
        }
        // ── v2.2 阶段5-7：解析分流 + 标签层后处理 + 格式化（统一 TagDoc 管线）──
        // 自然语言链：LLM 直出 description（完整英文句子）优先；缺失时回退规则引擎组装产物。
        const llmDescription = (vMode !== "tags" && typeof extraction.description === "string" && extraction.description.trim())
          ? extraction.description
          : "";
        const naturalPrompt = llmDescription || built.prompt;
        // 校正层：规则引擎不再被丢弃，而是把确定性要素（人数/镜头/景别）叠加到 LLM 产物上
        const correction = buildCorrectionInfo(extraction);
        if (llmDescription && correction.warnings.length) {
          console.warn(`[image_st] 规则引擎告警(${vMode}):`, correction.warnings);
        }
        const pipeline = runTagPipeline({
          descriptionPrompt: naturalPrompt,
          descriptionIsSentence: !!llmDescription,
          llmTags: Array.isArray(extraction.tags) ? extraction.tags : [],
          mode: vMode,
          modules,
          lexicon: lexForPipeline,
          separator: "comma",   // v2.4：Hard Tags 统一逗号分隔（Anima 规范），separator 仅作兼容字段
          budgetMax: Math.max(0, Math.floor(Number(s.budget_max) || 45)),
          weightMap: (s.ext_weight_map as Record<string, number>) ?? {},
          // v2.6：用户手动提供的质量/评分词 → 插件放到标签段风格位（分级与人数之后）
          qualityWords: String(s.anima_quality_words ?? "").split(",").map(x => x.trim()).filter(Boolean),
          // 无条件传入 corrections（即使无 llmDescription 也需共享校正层：人数/POV/景别/sexWith）
          corrections: {
            countTags: correction.countTags,
            opticsWords: correction.opticsWords,
            opticsWordsV2: correction.opticsWordsV2,
            distance: correction.distance,
            isPov: correction.isPov,
          },
          // 确定性校正层需要的角色信息
          subjects: [extraction.mainSubject, ...(extraction.secondarySubjects ?? [])],
          overrideLlmCountTags: s.override_llm_count_tags === true,
          candidateSourceNote,
        });
        if (pipeline.warnings.length > 0) {
          console.warn(`[image_st] 管线告警(${vMode}):`, pipeline.warnings);
        }
        const vReports: StageReport[] = [...pipeline.reports];
        let vPrompt = pipeline.prompt;
        if (!vPrompt || !vPrompt.trim()) {
          console.warn(`[image_st] ${vMode} 模式生成的提示词为空，取消该变体`);
          toastr.error(`[${vMode}] 生成的提示词为空，已跳过该变体`, 'ST Image Plugin', { timeOut: 5000 });
          continue;
        }
        // ── v2.2 阶段8 合成（按段的性质拼接，不破坏句子边界）──
        vPrompt = composePrompt(vPrompt, head, tail, vMode);
        // v1.9 兜底：剔除规则引擎输出中偶发混入的中文/CJK 标点
        // v2.3：兜底把整段剥光时给出**可归因**的报错（此前直接落到「提示词为空」，
        // 真实原因在阶段6 的自然语言段中文残留，隔了 4 个阶段）。
        if (isModuleEnabled(s, "cmp.cjk_fallback")) {
          const before = vPrompt;
          const cleaned = stripChineseFallback(vPrompt);
          if (cleaned !== vPrompt) {
            const removedChars = before.length - cleaned.length;
            const hadBreak = before.includes("\nBREAK\n");
            const stillHasBreak = cleaned.includes("\nBREAK\n");
            if (hadBreak && !stillHasBreak) {
              vReports.push({
                stage: "compose", id: "cmp.cjk_fallback", label: "中文兜底剔除",
                enabled: true, applied: true, inLen: before.length, outLen: cleaned.length, unit: "chars",
                warnings: [`[中文兜底] NL 段被整段剔除（${removedChars} 字符）—— 阶段6 已告警自然语言段含中文`],
              });
            } else {
              console.warn(`[image_st] 检测到中文残留（${vMode}），已兜底剔除 ${removedChars} 字符`);
            }
            vPrompt = cleaned;
          }
          if (!vPrompt.trim()) {
            const reason = `最终提示词在【中文兜底】后为空（模式：${vMode}）—— 阶段6 的自然语言段整句是中文（阶段6 已告警）。请检查 LLM 抽取结果的 description 字段。`;
            console.warn("[image_st]", reason);
            vReports.push({
              stage: "compose", id: "cmp.cjk_fallback", label: "中文兜底剔除",
              enabled: true, applied: true, inLen: 0, outLen: 0, unit: "chars",
              warnings: [reason],
            });
            throw new Error(reason);
          }
        }
        // ── v2.2 阶段9：第二阶段 LLM 审核（对最终 prompt 审查优化；默认关闭）──
        // v2.3: 启用开关统一为「第二阶段 LLM 审核」模块开关（旧的重复复选框已移除）。
        // v2.4: 送审形态与「是否参与审核」都取自矩阵定义（pipeline.enumerateImageMatrix），
        //       保证「3 模式 × 审核开/关」6 个格子在提示词与调用点两侧完全一致。
        // v2.6: 每个变体按**自己的形态**送审（tags/description/mixed 各自一套审查条目）。
        if (shouldRunReview(s as Record<string, unknown>)) {
          vPrompt = await runFinalReview({
            finalPrompt: vPrompt,
            sourceText: processedText,
            settings: s as Record<string, unknown>,
            signal: abortController?.signal,
            shape: reviewShapeFor(vMode),
          });
        }
variantResults.push({ mode: vMode, prompt: vPrompt, reports: vReports, extraction });
      }
} catch (err) {
      // v2.0: 用户取消 LLM 生成时不当作错误
      if (isAbortError(err)) throw err;
      resultDiv.textContent = `Prompt 生成错误: ${err instanceof Error ? err.message : String(err)}`;
      // 添加重试按钮
      if (lastFailedLLMContext) {
          const retryBtn = document.createElement("span");
          retryBtn.className = "menu_button";
          retryBtn.style.marginLeft = "8px";
          retryBtn.textContent = "重试 LLM 调用";
          retryBtn.onclick = () => retryLastLLMCall(resultDiv, targetMesBlock, isAuto);
          resultDiv.appendChild(document.createTextNode(" "));
          resultDiv.appendChild(retryBtn);
      }
      throw err;
    }

    if (!variantResults.length) {
      console.warn("[image_st] 生成的提示词为空，取消后续生图");
      toastr.error('生成的提示词为空，已取消图片生成', 'ST Image Plugin', { timeOut: 5000 });
      throw new Error("生成的提示词为空");
    }
    // v2.6：主变体 = 当前解析模式那一份（不在列表里则取第一个成功的）
    const primary = variantResults.find(v => v.mode === mode) ?? variantResults[0];
    const finalPrompt = primary.prompt;
    lastPipelineReports = [povReport, ...primary.reports];
    showPipelineReports(lastPipelineReports);
    // v2.3：缓存本次抽取结果 → 「管线预览」可用它离线重跑阶段5-7（不额外调用 LLM）
    lastExtraction = primary.extraction;
    // v2.6：缓存全部变体 → 结果面板可切换/复制/换版渲染
    lastVariantResults = variantResults;
    const backendLabel0 = getGenerationBackend() === "latent_moe" ? "latent.moe..." : getGenerationBackend() === "runninghub" ? "RunningHub..." : "ComfyUI...";
    resultDiv.textContent = `正在发送到 ${backendLabel0}`;
    logger.debug(`[image_st] 最终 prompt（${finalPrompt.length} 字符）:\n${finalPrompt}`);
try {
      await renderPromptToChat({
        finalPrompt,
        s: s as Record<string, unknown>,
        resultDiv,
        targetMesBlock,
        isAuto,
        signal: abortController?.signal,
        cleanupProgress: () => {
          if (genProgressEl && genProgressEl.parentNode) {
            genProgressEl.parentNode.removeChild(genProgressEl);
            genProgressEl = null;
          }
        },
      });
      // v2.6：多份变体 → 结果面板展示三份提示词（复制 / 换版渲染）
      if (variantResults.length > 1) {
        showVariantPanel(resultDiv, variantResults, primary.mode);
      }
    } catch (err) {
      // v2.0: 用户取消渲染时不显示为错误，交由外层统一按「已取消」处理
      if (isAbortError(err)) {
        throw err;
      }
      resultDiv.textContent = `生成后端错误: ${err instanceof Error ? err.message : String(err)}`;
      throw err;
    }
    lastFinishTime = Date.now();
    lastFinalPrompt = finalPrompt;
    setProgress('done');
  } catch (err) {
    // v2.0: 用户取消时不当作失败
    if (isAbortError(err)) {
      resultDiv.textContent = "生成已取消";
      resetProgress();
    } else {
      setProgress('failed', `生成失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  } finally {
    cleanup();
  }
}

async function onRegenerate() {
  if (isGenerating) {
    toastr.warning('已有图片正在生成中，请等待完成', 'ST Image Plugin');
    return;
  }
  if (!lastFinalPrompt) {
    toastr.error('没有可用的上一轮提示词，请先手动生图一次', 'ST Image Plugin', { timeOut: 5000 });
    return;
  }

  const s = extension_settings[SETTINGS_KEY];
  if (!s) return;

  isGenerating = true;
  resetProgress();

  const resultDiv = document.getElementById("image_st_result");
  if (resultDiv) resultDiv.textContent = "正在重新生成图片...";

  const regenAbort = new AbortController();
  activeAbort = regenAbort;

  try {
    const lastMesBlocks = document.querySelectorAll(".mes");
    const targetMesBlock = lastMesBlocks[lastMesBlocks.length - 1] as HTMLElement | undefined;

    await renderPromptToChat({
      finalPrompt: lastFinalPrompt,
      s: s as Record<string, unknown>,
      resultDiv: resultDiv ?? document.createElement("div"),
      targetMesBlock,
      isAuto: false,
      signal: regenAbort.signal,
    });

    toastr.success('重新生成完成，新图片已追加到消息末尾', 'ST Image Plugin', { timeOut: 4000 });
    setProgress('done');
  } catch (err) {
    if (isAbortError(err)) {
      if (resultDiv) resultDiv.textContent = "重新生成已取消";
      resetProgress();
    } else {
      if (resultDiv) resultDiv.textContent = `重新生成失败: ${err instanceof Error ? err.message : String(err)}`;
      setProgress('failed', `重新生成失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  } finally {
    regenAbort.abort();
    if (activeAbort === regenAbort) activeAbort = null;
    isGenerating = false;
    setTimeout(() => {
      if (currentStage === 'done' || currentStage === 'failed') resetProgress();
    }, 3000);
  }
}

async function previewInjectionPipeline(): Promise<string> {
    const s = extension_settings[SETTINGS_KEY];
    const context = getContext();
    const messages = context.chat ?? [];
    // Refresh caches to match onGenerate() fidelity (avoids stale preview after CHAT_CHANGED)
    const previewRefresh: Promise<unknown>[] = [];
    if (s.mvu_enabled) previewRefresh.push(refreshMvuData());
    if (s.db_enabled) previewRefresh.push(refreshDatabaseData());
    if (s.bbs_enabled) previewRefresh.push(refreshBaibaiData());
    await Promise.all(previewRefresh);
    const config = getTextCleaningConfig(s);
    const processedText = processTextPipeline(messages, config);
    if (!processedText) return "(无有效文本)";
    const { llmInput } = await buildInjectionInput(processedText);
    return llmInput;
}

/**
 * v2.3：管线预览（阶段5-7 逐段产物 + 阶段报告）
 * 用**缓存的最近一次抽取结果**离线重跑管线 —— 不额外调用 LLM、不消耗额度。
 * 收口设计文档 P10「预览链路残缺」：此前预览只到 llmInput，
 * 看不到阶段5-7 到底把提示词改成了什么样（也无法在不生图的情况下验证开关效果）。
 */
function previewTagPipeline(): string {
    const s = extension_settings[SETTINGS_KEY];
    const extraction = lastExtraction;
    if (!extraction) {
        return "尚无抽取结果缓存 —— 请先执行一次生成（第一阶段 LLM 的抽取结果会被缓存），之后即可离线预览阶段5-7（不额外调用 LLM）。";
    }
    const mode = (s.extract_output_mode ?? "mixed") as "mixed" | "description" | "tags" | "custom";
    if (mode === "custom") {
        return "【自定义模式预览】完全自定义模式不走标签层管线（阶段5-7 旁路直通）。\n最终 prompt = 用户系统提示词 → LLM → 直接送生图。\n如需预览效果，请直接执行生成。";
    }
    const llmDescription = (mode !== "tags" && typeof extraction.description === "string" && extraction.description.trim())
        ? extraction.description
        : "";
    const built = buildPrompt(extraction);
    const naturalPrompt = llmDescription || built.prompt;
    const correction = buildCorrectionInfo(extraction);
    const modules = getModuleSwitches(s as Record<string, unknown>);
    const lexForPipeline = isModuleEnabled(s, "resolve.danbooru") || isModuleEnabled(s, "pp.dict")
        ? getDefaultLexicon()
        : undefined;
    const pipeline = runTagPipeline({
        descriptionPrompt: naturalPrompt,
        descriptionIsSentence: !!llmDescription,
        llmTags: Array.isArray(extraction.tags) ? extraction.tags : [],
        mode,
        modules,
        lexicon: lexForPipeline,
        separator: "comma",   // v2.4：Hard Tags 统一逗号分隔（Anima 规范），separator 仅作兼容字段
        budgetMax: Math.max(0, Math.floor(Number(s.budget_max) || 45)),
        weightMap: (s.ext_weight_map as Record<string, number>) ?? {},
        // 与 onGenerate 保持一致：qualityWords / subjects / overrideLlmCountTags
        qualityWords: String(s.anima_quality_words ?? "").split(",").map(x => x.trim()).filter(Boolean),
        corrections: {
            countTags: correction.countTags,
            opticsWords: correction.opticsWords,
            opticsWordsV2: correction.opticsWordsV2,
            distance: correction.distance,
            isPov: correction.isPov,
        },
        subjects: [extraction.mainSubject, ...(extraction.secondarySubjects ?? [])],
        overrideLlmCountTags: s.override_llm_count_tags === true,
        // 预览模式下无候选来源信息
        candidateSourceNote: undefined,
    });
    const lines: string[] = [];
    lines.push("【阶段5-7 管线预览】用缓存的抽取结果离线重跑（未调用 LLM）");
    lines.push(`自然语言语义：${llmDescription ? "完整英文句子（LLM 直出 description）" : "逗号短语（LLM 未返回 description → 回退规则引擎产物）"}`);
    lines.push("");
    lines.push("── 最终提示词（阶段5-7 产物）──");
    lines.push(pipeline.prompt || "(空)");
    lines.push("");
    lines.push("── 阶段报告 ──");
    for (const r of pipeline.reports) {
        const state = !r.enabled ? "已跳过" : (r.applied === false ? "未执行" : "已执行");
        const size = r.unit === "chars" ? `${r.outLen} 字符` : `${r.inLen} → ${r.outLen} 条`;
        lines.push(`· [${r.label}] ${state}（${size}）`);
        for (const w of r.warnings ?? []) lines.push(`    ! ${w}`);
    }
    return lines.join("\n");
}

async function init() {
  loadSettings();
  // v2.1: 注入柏宝书模块的设置访问器（该模块不静态依赖 ST 运行时，便于离线单测）
  configureBaibai(() => extension_settings[SETTINGS_KEY]);
  // v2.7 性能：完整词库改为**惰性加载**。
  // 旧实现：页面一加载就后台解密 15MB 词库包（PBKDF2 12 万次 + AES-GCM + gzip）
  // 并建 34 万词索引 —— 实测 ≈180ms 主线程阻塞 + ≈94MB 常驻堆，手机端首屏直接卡住。
  // 新实现：启动时只做一次**廉价探测**（IndexedDB count，不读 blob、不解密）；
  // 真正的解码建索引推迟到「打开插件设置面板」或「点击生成」时才发生。
  // 行为不变：导入过的词库仍然自动生效，只是加载时机推后。
  void hasPersistedLexicon().then(present => {
    if (present) console.info("[image_st] 已持久化的完整词库将在打开面板或生成时按需加载");
  });

  // 延迟初始化设置面板：仅在用户首次打开扩展设置抽屉时构建 DOM
  // 这避免了启动时渲染 68KB HTML + 绑定 200+ 事件监听器的阻塞
  let settingsUIInitialized = false;
  const initSettingsUILazy = async () => {
    if (settingsUIInitialized) return;
    settingsUIInitialized = true;
    await createSettingsUI(onGenerate, previewInjectionPipeline, previewTagPipeline);
  };

  initAutoGenerate();
  initFloatingButton(onGenerate);
  initWandButton(onGenerate, onRegenerate);
  // v2.0: 浮窗「取消生成」按钮 → 中断当前生成的 LLM/渲染
  setCancelHandler(() => {
    if (!activeAbort) return;
    activeAbort.abort();
    toastr.warning('已发送取消请求，正在终止当前生成…', 'ST Image Plugin', { timeOut: 2500 });
  });
  initStripInlineMedia();
  initGeneratedMediaManager();
  // 初始化抽屉观察器，监听扩展设置面板打开事件，触发惰性初始化设置 UI
  initDrawerObserver();

  // 本地角色库的 CHAT_CHANGED 刷新由 createSettingsUI 内的统一 handler 负责（v1.9.1 去重），
  // 此处不再重复注册，避免每条消息面板刷新跑两遍。

  // 将延迟初始化函数挂载到 window 供 ui.ts 抽屉观察器调用
  const win = window as unknown as { image_st?: Record<string, unknown> };
  const api = win.image_st ?? (win.image_st = {});
  api.clearLocalLibrary = clearLocalLibrary;
  api.getLocalLibraryStatus = getLocalLibraryStatus;
  api.loadAllCompletedLibraries = loadAllCompletedLibraries;
  api._lazyInitSettingsUI = initSettingsUILazy;

  // 页面卸载/扩展重载时清理所有监听器，防止内存泄漏
  window.addEventListener('beforeunload', () => {
    try { cleanupGeneratedMediaManager(); } catch { /* ignore */ }
    try { cleanupAutoGenerate(); } catch { /* ignore */ }
    try { terminateLexiconWorker(); } catch { /* ignore */ }
  });

  // 移除启动时的初始数据刷新（延迟到首次打开面板时触发，避免启动阻塞）
  // 原 setTimeout 150ms 刷新已移至 ui.ts 首次打开抽屉时
}

export { init, onRegenerate };
