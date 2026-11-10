/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-ignore — ST 提供的全局类型定义，运行时由宿主注入
/// <reference types="exported.sillytavern.d.ts" />
// ============================================================
// ui.ts — 设置面板 UI + 运行时 UI
// v1.1: 自 index.ts 提取（TD-001 + TD-003）
// 职责：所有 DOM 渲染与交互（设置面板、进度、浮动按钮、MVU/DB 渲染、连接测试 UI 等）
// 依赖方向：index.ts → ui.ts → 底层模块（单向，不得反向导入 index.ts）
//
// 回调注入说明：
//   createSettingsUI(onGenerate, getPreview) — onGenerate 和 previewInjectionPipeline
//   由 index.ts 传入而非直接导入，保持单向依赖。
// ============================================================
// @ts-expect-error — ST provides these modules at runtime
import { saveSettingsDebounced } from "../../../../../script.js";
// @ts-expect-error — ST provides this module at runtime
import { extension_settings, renderExtensionTemplateAsync } from "../../../../../scripts/extensions.js";
// @ts-expect-error — ST provides this module at runtime
import { getContext } from "../../../../../scripts/st-context.js";
// @ts-expect-error — ST provides this module at runtime
import { eventSource, event_types } from "../../../../../script.js";
import { SETTINGS_KEY, LORA_SLOT_COUNT, DEFAULTS, SAMPLERS, SCHEDULERS, fetchModelList, fetchLoraList, testComfyConnection, loadDefaultWorkflow, EXTENSION_FOLDER } from "./comfy.js";
import { LLM_URL_DEFAULT, LLM_MODEL_DEFAULT } from "./api.js";
import { detectModelFamily, getModelContextLength, familySupportsThinking, isGLMForcedThinking } from "./modelProfile.js";
import { logger } from "./logger.js";
import { scheduleIdle } from "./utils.js";
import { buildMvuTree, resolveObjectPath, getMvuData, refreshMvuData, clearMvuCache, isMvuAvailable, getMvuStatus, migrateMvuPaths, inferNameSegment, isCollectionNode, expandSelection, MVU_WILDCARD, extractMvuInfoSegment, getMvuSelections } from "./characterLib.js";
import type { MvuTreeBranch, MvuSelection } from "./characterLib.js";
import { scanDatabaseTables, refreshDatabaseData, clearDatabaseCache, getDatabaseStatus, getDbSelections, extractDatabaseInfoSegment } from "./databaseLib.js";
import type { DbTableInfo } from "./databaseLib.js";
import {
    BBS_ITEM_FIELDS,
    BBS_ROLE_FIELDS,
    BBS_SCENE_FIELDS,
    buildBaibaiTree,
    clearBaibaiCache,
    configureBaibai,
    defaultFieldKeys,
    getBaibaiStatus,
    getBbsSelection,
    getBbsStaleSelections,
    getSelectedFields,
    refreshBaibaiData,
    waitBaiBaiReady,
    extractBaibaiSegments,
} from "./baibaiLib.js";
import {
    PIPELINE_MODULES,
    STAGE_LABEL,
    getModuleStatus,
    isModuleActive,
    isModuleEnabled,
    moduleDepsSatisfied,
    setModuleEnabled,
    type StageId as PipelineStageId,
} from "./pipeline.js";
import type { StageReport } from "./pipeline.js";
import { describePovTriggers, testPovDetection, POV_TRIGGER_RULES } from "./promptBuilder.js";
import { DEFAULT_MCP_URL, listMcpTools } from "./tagTool.js";
import { DEFAULT_EXTRACT_PRESETS, DEFAULT_REVIEW_PRESET } from "./promptPreset.js";
import type { BbsFieldDef, BbsTreeGroup, BbsTreeNode } from "./baibaiLib.js";
import { processTextPipeline, extractTagsFromText, getTextCleaningConfig } from "./prompt.js";
import type { RegexRule, PromptTag } from "./prompt.js";
import {
    ensureFullLexicon,
    getDefaultLexicon,
    getLexiconLoadState,
    hasPersistedLexicon,
    installFullLexicon,
    isFullLexiconReady,
    isLexiconPersisted,
    removePersistedLexicon,
    saveBmzRaw,
} from "./defaultLexicon.js";
import {
  executeBuild,
  isBuildLocked,
  getCurrentBuildingTarget,
  cancelBuild as cancelLocalBuild,
  loadEntrySelection,
  saveEntrySelection,
  getWorldInfoNames,
  getWorldInfoEntries,
  getLocalLibraryStatus,
  getEmbeddedWorldbooks,
  isEmbeddedWorldbookName,
  stripEmbeddedSuffix,
  getCharStorageDir,
  CHUNK_STRATEGY,
  loadAllCompletedLibraries,
  injectLocalCharacters,
  selectRelevantLibraries,
} from "./localLib.js";
import type { BuildOptions, ChunkStrategy } from "./localLib.js";

declare const toastr: {
    info: (msg: string, title?: string, options?: Record<string, unknown>) => void;
    success: (msg: string, title?: string, options?: Record<string, unknown>) => void;
    warning: (msg: string, title?: string, options?: Record<string, unknown>) => void;
    error: (msg: string, title?: string, options?: Record<string, unknown>) => void;
    clear: (toast?: unknown, options?: Record<string, unknown>) => void;
};

// ============================================================
// Progress System (移自 index.ts)
// 注：formatDuration / GenTiming / genTiming 因仅在 onGenerate (index.ts)
// 中使用，留在 index.ts 以避免跨文件写入绑定问题
// ============================================================
type ProgressStage = 'idle' | 'prompting' | 'rendering' | 'done' | 'failed';

let currentStage: ProgressStage = 'idle';

function setProgress(stage: ProgressStage, message?: string) {
    currentStage = stage;
    const s = extension_settings[SETTINGS_KEY];
    if (!s?.progress_enabled) return;
    const defaultMessages: Record<ProgressStage, string> = {
        idle: '',
        prompting: '🖋 正在生成提示词…',
        rendering: '🎨 正在渲染图片…',
        done: '✅ 生成完成',
        failed: '❌ 生成失败',
    };
    const msg = message ?? defaultMessages[stage];
    if (stage === 'idle') return;
    if (stage === 'done') {
        toastr.success(msg, 'ST Image Plugin', { timeOut: 3000 });
        return;
    }
    if (stage === 'failed') {
        toastr.error(msg, 'ST Image Plugin', { timeOut: 3000 });
        return;
    }
    toastr.info(msg, 'ST Image Plugin', { timeOut: 0, extendedTimeOut: 0 });
    updateFloatingButtonStage(stage);
}

function resetProgress() {
    currentStage = 'idle';
    toastr.clear();
    updateFloatingButtonStage('idle');
}

// ============================================================
// Floating Button (移自 index.ts)
// ============================================================
// v2.0: 取消生成支持 —— 生成中浮窗按钮切换为「取消」态，点击调用取消回调。
let cancelHandler: (() => void) | null = null;
let floatingBtn: HTMLElement | null = null;
let floatingBtnDragging = false;
let floatingBtnMoved = false;
const floatingBtnDragOffset = { x: 0, y: 0 };
let floatingBtnPos = { x: 20, y: 80 };
let floatingDragHandlers: { mousemove: (e: MouseEvent) => void; mouseup: () => void; touchmove: (e: TouchEvent) => void; touchend: () => void } | null = null;

const FLOATING_BTN_ID = 'image_st_floating_div';
const FLOATING_STORAGE_KEY = 'image_st_floating_pos_v2';
const FLOATING_BTN_SIZE = 56;  // iOS HIG: 44pt 最小点击区，56px 更安全
const DRAG_THRESHOLD = 5;

function clampFloatingPos() {
    const vw = window.visualViewport?.width ?? window.innerWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    floatingBtnPos.x = Math.max(0, Math.min(floatingBtnPos.x, vw - FLOATING_BTN_SIZE));
    floatingBtnPos.y = Math.max(0, Math.min(floatingBtnPos.y, vh - FLOATING_BTN_SIZE));
}

function applyFloatingBtnPos(btn: HTMLElement) {
    btn.style.left = 'auto';
    btn.style.top = 'auto';
    btn.style.right = `${floatingBtnPos.x}px`;
    btn.style.bottom = `${floatingBtnPos.y}px`;
}

function initWandButton(onGenerate: () => Promise<void>, onRegenerate: () => Promise<void>) {
    if (document.getElementById('image_st_wand_generate')) return;
    const menu = document.getElementById('extensionsMenu');
    if (!menu) return;
    const container = document.createElement('div');
    container.id = 'image_st_wand_container';
    container.className = 'extension_container';
    const button = document.createElement('div');
    button.id = 'image_st_wand_generate';
    button.className = 'list-group-item flex-container flexGap5';
    const icon = document.createElement('div');
    icon.className = 'fa-solid fa-magic extensionsMenuExtensionButton';
    icon.title = '手动生图';
    const text = document.createElement('span');
    text.textContent = '手动生图';
    button.appendChild(icon);
    button.appendChild(text);
    container.appendChild(button);

    const regenBtn = document.createElement('div');
    regenBtn.id = 'image_st_wand_regenerate';
    regenBtn.className = 'list-group-item flex-container flexGap5';
    const regenIcon = document.createElement('div');
    regenIcon.className = 'fa-solid fa-rotate extensionsMenuExtensionButton';
    regenIcon.title = '重新生成';
    const regenText = document.createElement('span');
    regenText.textContent = '重新生成';
    regenBtn.appendChild(regenIcon);
    regenBtn.appendChild(regenText);
    container.appendChild(regenBtn);

    menu.appendChild(container);
    button.addEventListener('click', () => { onGenerate(); });
    regenBtn.addEventListener('click', () => { onRegenerate(); });
}

function initFloatingButton(onGenerate: () => Promise<void>) {
    if (document.getElementById(FLOATING_BTN_ID)) return;
    const s = extension_settings[SETTINGS_KEY];
    if (!s?.floating_btn_enabled) return;
    
    // iOS PWA viewport meta 注入（只注入一次）
    if (!document.querySelector('meta[name="apple-mobile-web-app-capable"]')) {
        const metaViewport = document.createElement('meta');
        metaViewport.name = 'viewport';
        metaViewport.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
        document.head.appendChild(metaViewport);
        
        const metaCapable = document.createElement('meta');
        metaCapable.name = 'apple-mobile-web-app-capable';
        metaCapable.content = 'yes';
        document.head.appendChild(metaCapable);
        
        const metaStatusBar = document.createElement('meta');
        metaStatusBar.name = 'apple-mobile-web-app-status-bar-style';
        metaStatusBar.content = 'black-translucent';
        document.head.appendChild(metaStatusBar);
        
        const metaTitle = document.createElement('meta');
        metaTitle.name = 'apple-mobile-web-app-title';
        metaTitle.content = 'ST Image';
        document.head.appendChild(metaTitle);
        
        const linkIcon = document.createElement('link');
        linkIcon.rel = 'apple-touch-icon';
        linkIcon.href = `/scripts/extensions/${EXTENSION_FOLDER}/icon-192.png`;
        document.head.appendChild(linkIcon);
    }
    
    try {
        const saved = localStorage.getItem(FLOATING_STORAGE_KEY);
        if (saved) {
            const pos = JSON.parse(saved);
            floatingBtnPos = { x: pos.x ?? 20, y: pos.y ?? 80 };
        }
    } catch { /* ignore */ }
    clampFloatingPos();
    const btn = document.createElement('div');
    btn.id = FLOATING_BTN_ID;
    btn.className = 'image-st-floating-btn';
    btn.title = '生成图片';
    btn.style.touchAction = 'none';
    btn.innerHTML = '<i class="fa-solid fa-magic"></i><span style="display:none;">Img</span>';
    applyFloatingBtnPos(btn);
    btn.addEventListener('mousedown', (e) => {
        floatingBtnDragging = true;
        floatingBtnMoved = false;
        const rect = btn.getBoundingClientRect();
        floatingBtnDragOffset.x = e.clientX - rect.left;
        floatingBtnDragOffset.y = e.clientY - rect.top;
        btn.style.cursor = 'grabbing';
        btn.style.transition = 'none';
        e.preventDefault();
    });
    btn.addEventListener('touchstart', (e: TouchEvent) => {
        floatingBtnDragging = true;
        floatingBtnMoved = false;
        const rect = btn.getBoundingClientRect();
        floatingBtnDragOffset.x = e.touches[0].clientX - rect.left;
        floatingBtnDragOffset.y = e.touches[0].clientY - rect.top;
        btn.style.cursor = 'grabbing';
        btn.style.transition = 'none';
        e.preventDefault();
    });
    const onMouseMove = (e: MouseEvent) => {
        if (!floatingBtnDragging || !floatingBtn) return;
        const newLeft = e.clientX - floatingBtnDragOffset.x;
        const newTop = e.clientY - floatingBtnDragOffset.y;
        if (!floatingBtnMoved) {
            const rect = floatingBtn.getBoundingClientRect();
            if (Math.hypot(newLeft - rect.left, newTop - rect.top) < DRAG_THRESHOLD) return;
            floatingBtnMoved = true;
        }
        floatingBtn.style.left = `${newLeft}px`;
        floatingBtn.style.top = `${newTop}px`;
        floatingBtn.style.right = 'auto';
        floatingBtn.style.bottom = 'auto';
    };
    const onMouseUp = () => {
        if (!floatingBtnDragging) return;
        floatingBtnDragging = false;
        if (!floatingBtn) return;
        floatingBtn.style.cursor = 'grab';
        floatingBtn.style.transition = '';
        if (floatingBtnMoved) {
            const rect = floatingBtn.getBoundingClientRect();
            floatingBtnPos = {
                x: window.innerWidth - rect.right,
                y: window.innerHeight - rect.bottom,
            };
            clampFloatingPos();
            applyFloatingBtnPos(floatingBtn);
            try {
                localStorage.setItem(FLOATING_STORAGE_KEY, JSON.stringify(floatingBtnPos));
            } catch { /* ignore */ }
        }
        setTimeout(() => { floatingBtnMoved = false; }, 0);
    };
    const onTouchMove = (e: TouchEvent) => {
        if (!floatingBtnDragging || !floatingBtn) return;
        const newLeft = e.touches[0].clientX - floatingBtnDragOffset.x;
        const newTop = e.touches[0].clientY - floatingBtnDragOffset.y;
        if (!floatingBtnMoved) {
            const rect = floatingBtn.getBoundingClientRect();
            if (Math.hypot(newLeft - rect.left, newTop - rect.top) < DRAG_THRESHOLD) return;
            floatingBtnMoved = true;
        }
        floatingBtn.style.left = `${newLeft}px`;
        floatingBtn.style.top = `${newTop}px`;
        floatingBtn.style.right = 'auto';
        floatingBtn.style.bottom = 'auto';
        e.preventDefault();
    };
    const onTouchEnd = () => {
        if (!floatingBtnDragging) return;
        floatingBtnDragging = false;
        if (!floatingBtn) return;
        floatingBtn.style.cursor = 'grab';
        floatingBtn.style.transition = '';
        if (floatingBtnMoved) {
            const rect = floatingBtn.getBoundingClientRect();
            floatingBtnPos = {
                x: window.innerWidth - rect.right,
                y: window.innerHeight - rect.bottom,
            };
            clampFloatingPos();
            applyFloatingBtnPos(floatingBtn);
            try {
                localStorage.setItem(FLOATING_STORAGE_KEY, JSON.stringify(floatingBtnPos));
            } catch { /* ignore */ }
        } else {
            onGenerate();
        }
        setTimeout(() => { floatingBtnMoved = false; }, 0);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', onTouchEnd);
    floatingDragHandlers = { mousemove: onMouseMove, mouseup: onMouseUp, touchmove: onTouchMove, touchend: onTouchEnd };
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (floatingBtnMoved) return;
        // v2.0: 生成进行中 → 点击改为「取消」
        if (cancelHandler && (currentStage === 'prompting' || currentStage === 'rendering')) {
            const cb = cancelHandler;
            cb();
            return;
        }
        onGenerate();
    });
    document.body.appendChild(btn);
    floatingBtn = btn;
}

function destroyFloatingButton() {
    const el = floatingBtn ?? document.getElementById(FLOATING_BTN_ID);
    if (el) el.remove();
    floatingBtn = null;
    if (floatingDragHandlers) {
        document.removeEventListener('mousemove', floatingDragHandlers.mousemove);
        document.removeEventListener('mouseup', floatingDragHandlers.mouseup);
        document.removeEventListener('touchmove', floatingDragHandlers.touchmove);
        document.removeEventListener('touchend', floatingDragHandlers.touchend);
        floatingDragHandlers = null;
    }
}

function updateFloatingButtonStage(stage: ProgressStage) {
    if (!floatingBtn) return;
    const s = extension_settings[SETTINGS_KEY];
    const icon = floatingBtn.querySelector('i');
    const showAnimation = s?.progress_in_chat !== false;

    // v2.0: prompting/rendering 阶段浮窗按钮切换为「取消」——点击即中断当前生成
    const isBusy = stage === 'prompting' || stage === 'rendering';
    if (isBusy && showAnimation && cancelHandler) {
        floatingBtn.title = '点击取消生成';
        floatingBtn.classList.remove(
            'image-st-floating-btn-done', 'image-st-floating-btn-failed');
        floatingBtn.classList.add('image-st-floating-btn-busy', 'image-st-animate-pulse');
        if (icon) icon.className = 'fa-solid fa-stop';
        return;
    }

    // 非生成中：恢复默认生成/状态外观（取消点击态已由事件委托移除）
    floatingBtn.title = '生成图片';
    floatingBtn.classList.remove('image-st-floating-btn-busy');
    floatingBtn.className = floatingBtn.className.replace(/\s*image-st-animate-pulse\s*/g, '').trim();
    floatingBtn.className = 'image-st-floating-btn';
    if (stage !== 'idle') {
        floatingBtn.classList.add(`image-st-floating-btn-${stage}`);
    }
    if (icon) {
        if (showAnimation) {
            switch (stage) {
                case 'done':
                    icon.className = 'fa-solid fa-check';
                    break;
                case 'failed':
                    icon.className = 'fa-solid fa-xmark';
                    break;
                default:
                    icon.className = 'fa-solid fa-magic';
            }
        } else {
            icon.className = 'fa-solid fa-magic';
        }
    }
}

/**
 * 注册浮窗「取消生成」回调。传入 null 关闭取消态。
 * 由 index.ts 注入（引用当前活跃的 AbortController）。
 */
function setCancelHandler(cb: (() => void) | null) {
    cancelHandler = cb;
    // 若当前处于生成中，同步刷新浮窗状态；否则恢复默认外观
    if (floatingBtn) updateFloatingButtonStage(currentStage);
}

// ============================================================
// ensureValidLoraSlots (移自 settingsUi.ts)
// ============================================================
function ensureValidLoraSlots(s: Record<string, unknown>) {
    if (!Array.isArray(s.lora_slots) || s.lora_slots.length !== LORA_SLOT_COUNT) {
        s.lora_slots = Array.from({ length: LORA_SLOT_COUNT }, () => ({
            name: "",
            mode: "none",
            first_strength: DEFAULTS.loraStrength,
            second_strength: DEFAULTS.loraStrength,
        }));
        saveSettingsDebounced();
    }
}

// ============================================================
// LoRA UI Builder (移自 settingsUi.ts，事件绑定已分离)
// ============================================================
const MODE_LABELS: Record<string, string> = {
  none: "无（跳过）",
  first: "仅首次",
  second: "仅二次",
  both: "全部",
};

const MODE_ORDER = ["none", "first", "second", "both"];

function rebuildLoraUI() {
  const container = document.getElementById("image_st_lora_container");
  if (!container) return;
  const s = extension_settings[SETTINGS_KEY];
  ensureValidLoraSlots(s);
  container.innerHTML = "";
  for (let i = 0; i < LORA_SLOT_COUNT; i++) {
    const slot = s.lora_slots[i];
    const idx = i + 1;

    const section = document.createElement("div");
    section.className = "image-st-lora-section";
    section.setAttribute("data-lora-index", String(i));

    const headerRow = document.createElement("div");
    headerRow.className = "flex-container alignitemscenter image-st-lora-header";

    const label = document.createElement("span");
    label.className = "flex1 image-st-lora-name-label";
    label.textContent = `LoRA ${idx}:`;
    headerRow.appendChild(label);

    const nameSelect = document.createElement("select");
    nameSelect.className = "text_pole flex1";
    nameSelect.innerHTML = '<option value="">无（跳过）</option>';
    if (slot.name) {
        const opt = document.createElement("option");
        opt.value = slot.name;
        opt.textContent = slot.name;
        opt.selected = true;
        nameSelect.appendChild(opt);
    }
    nameSelect.value = slot.name ?? "";
    nameSelect.setAttribute("data-field", "name");
    headerRow.appendChild(nameSelect);

    const modeSelect = document.createElement("select");
    modeSelect.className = "text_pole image-st-lora-mode";
    modeSelect.setAttribute("data-field", "mode");
    MODE_ORDER.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = MODE_LABELS[m];
      if (m === (slot.mode ?? "none")) opt.selected = true;
      modeSelect.appendChild(opt);
    });
    headerRow.appendChild(modeSelect);

    section.appendChild(headerRow);

    const strengthRow = document.createElement("div");
    strengthRow.className = "flex-container alignitemscenter image-st-lora-strength-row";

    const firstStrengthWrapper = document.createElement("div");
    firstStrengthWrapper.className = "flex-container alignitemscenter image-st-lora-strength-wrapper";
    firstStrengthWrapper.id = `image_st_lora_${idx}_first_str_wrapper`;

    const firstLabel = document.createElement("span");
    firstLabel.className = "image-st-lora-strength-label";
    firstLabel.textContent = "首次:";
    firstStrengthWrapper.appendChild(firstLabel);

    const firstMs = document.createElement("input");
    firstMs.type = "number";
    firstMs.min = "-1";
    firstMs.max = "2";
    firstMs.step = "0.05";
    firstMs.className = "text_pole image-st-lora-strength-input";
    firstMs.placeholder = "强度";
    firstMs.value = String(slot.first_strength ?? 0);
    firstMs.setAttribute("data-field", "first_strength");
    firstStrengthWrapper.appendChild(firstMs);

    strengthRow.appendChild(firstStrengthWrapper);

    const secondStrengthWrapper = document.createElement("div");
    secondStrengthWrapper.className = "flex-container alignitemscenter image-st-lora-strength-wrapper";
    secondStrengthWrapper.id = `image_st_lora_${idx}_second_str_wrapper`;

    const secondLabel = document.createElement("span");
    secondLabel.className = "image-st-lora-strength-label";
    secondLabel.textContent = "二次:";
    secondStrengthWrapper.appendChild(secondLabel);

    const secondMs = document.createElement("input");
    secondMs.type = "number";
    secondMs.min = "-1";
    secondMs.max = "2";
    secondMs.step = "0.05";
    secondMs.className = "text_pole image-st-lora-strength-input";
    secondMs.placeholder = "强度";
    secondMs.value = String(slot.second_strength ?? 0);
    secondMs.setAttribute("data-field", "second_strength");
    secondStrengthWrapper.appendChild(secondMs);

    strengthRow.appendChild(secondStrengthWrapper);

    section.appendChild(strengthRow);
    container.appendChild(section);

    const updateStrengthVisibility = () => {
      const mode = modeSelect.value;
      firstStrengthWrapper.style.display = (mode === "first" || mode === "both") ? "" : "none";
      secondStrengthWrapper.style.display = (mode === "second" || mode === "both") ? "" : "none";
    };
    updateStrengthVisibility();
  }
}

// ============================================================
// Regex UI Builder (移自 settingsUi.ts，事件绑定已分离)
// ============================================================
function rebuildRegexRulesUI() {
  const container = document.getElementById("image_st_regex_rules_container");
  if (!container) return;
  const s = extension_settings[SETTINGS_KEY];
  const rules = s.regex_rules ?? [];
  container.innerHTML = "";
  if (rules.length === 0) {
    const empty = document.createElement("div");
    empty.className = "image-st-regex-empty";
    empty.textContent = "暂无正则规则。点击「+ 添加规则」创建。";
    container.appendChild(empty);
    return;
  }
  rules.forEach((rule: RegexRule, i: number) => {
    const row = document.createElement("div");
    row.className = "flex-container alignitemscenter image-st-regex-row";
    row.setAttribute("data-regex-index", String(i));
    if (!rule.enabled) row.classList.add("image-st-regex-collapsed");

    const headerPart = document.createElement("div");
    headerPart.className = "flex-container alignitemscenter image-st-regex-header";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "名称";
    nameInput.className = "text_pole image-st-regex-name";
    nameInput.value = rule.name ?? "";
    nameInput.setAttribute("data-field", "name");
    if (!rule.enabled) nameInput.disabled = true;
    headerPart.appendChild(nameInput);

    const enabledLabel = document.createElement("label");
    enabledLabel.className = "checkbox_label";
    const enabledCheck = document.createElement("input");
    enabledCheck.type = "checkbox";
    enabledCheck.checked = rule.enabled;
    enabledCheck.setAttribute("data-field", "enabled");
    enabledLabel.appendChild(enabledCheck);
    const enabledSpan = document.createElement("span");
    enabledSpan.textContent = " 启用";
    enabledLabel.appendChild(enabledSpan);
    headerPart.appendChild(enabledLabel);

    // Type select after enabled checkbox
    const typeSelect = document.createElement("select");
    typeSelect.className = "text_pole image-st-regex-type";
    typeSelect.setAttribute("data-field", "type");
    typeSelect.style.minWidth = "160px";
    typeSelect.style.marginLeft = "8px";
    if (!rule.enabled) typeSelect.disabled = true;
    const typeOptions: Array<{value: RegexRule["type"]; label: string}> = [
      { value: "custom", label: "自定义正则" },
      { value: "extract", label: "提取 (开始/结束标记间)" },
      { value: "exclude", label: "剔除 (含开始/结束标记)" },
      { value: "exclude_before", label: "剔除之前 (保留标记及后)" },
      { value: "exclude_after", label: "剔除之后 (保留标记及前)" },
    ];
    for (const opt of typeOptions) {
      const option = document.createElement("option");
      option.value = opt.value ?? "";
      option.textContent = opt.label;
      typeSelect.appendChild(option);
    }
    typeSelect.value = rule.type ?? "extract"; // 默认 extract
    headerPart.appendChild(typeSelect);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "menu_button image-st-regex-delete";
    deleteBtn.textContent = "✕";
    deleteBtn.setAttribute("data-action", "delete");
    headerPart.appendChild(deleteBtn);

    const arrow = document.createElement("span");
    arrow.className = "image-st-fold-arrow";
    arrow.textContent = "▶";
    headerPart.appendChild(arrow);

    row.appendChild(headerPart);

    const bodyPart = document.createElement("div");
    bodyPart.className = "flex-container alignitemscenter image-st-regex-body";

    // Render fields based on type - only create needed inputs
    const type = rule.type ?? "extract";
    
    if (type === "custom") {
      // Custom regex: pattern + replacement
      const patternInput = document.createElement("input");
      patternInput.type = "text";
      patternInput.placeholder = "正则表达式";
      patternInput.className = "text_pole flex1 image-st-regex-pattern";
      patternInput.value = rule.pattern ?? "";
      patternInput.setAttribute("data-field", "pattern");
      if (!rule.enabled) patternInput.disabled = true;
      bodyPart.appendChild(patternInput);

      const replacementInput = document.createElement("input");
      replacementInput.type = "text";
      replacementInput.placeholder = "替换文本 (留空=删除)";
      replacementInput.className = "text_pole image-st-regex-replacement";
      replacementInput.value = rule.replacement ?? "";
      replacementInput.setAttribute("data-field", "replacement");
      if (!rule.enabled) replacementInput.disabled = true;
      bodyPart.appendChild(replacementInput);
    }
    else if (type === "extract" || type === "exclude") {
      // Tag block: startTag + endTag
      const startTagInput = document.createElement("input");
      startTagInput.type = "text";
      startTagInput.placeholder = "开始标记 例: (content) 或 <content>";
      startTagInput.className = "text_pole flex1 image-st-regex-start-tag";
      startTagInput.value = rule.startTag ?? "";
      startTagInput.setAttribute("data-field", "startTag");
      if (!rule.enabled) startTagInput.disabled = true;
      bodyPart.appendChild(startTagInput);

      const endTagInput = document.createElement("input");
      endTagInput.type = "text";
      endTagInput.placeholder = "结束标记 例: (/content) 或 </content>";
      endTagInput.className = "text_pole flex1 image-st-regex-end-tag";
      endTagInput.value = rule.endTag ?? "";
      endTagInput.setAttribute("data-field", "endTag");
      if (!rule.enabled) endTagInput.disabled = true;
      bodyPart.appendChild(endTagInput);
    }
    else if (type === "exclude_before" || type === "exclude_after") {
      // Single tag: tag
      const tagInput = document.createElement("input");
      tagInput.type = "text";
      tagInput.placeholder = "标记 例: (content) 或 <content>";
      tagInput.className = "text_pole flex1 image-st-regex-tag";
      tagInput.value = rule.tag ?? "";
      tagInput.setAttribute("data-field", "tag");
      if (!rule.enabled) tagInput.disabled = true;
      bodyPart.appendChild(tagInput);
    }

    row.appendChild(bodyPart);
    container.appendChild(row);
  });
}

// ============================================================
// 一次性事件绑定（v1.1: 与 DOM 重建分离，消除监听器叠加）
// ============================================================
function bindLoraEvents() {
  const container = document.getElementById("image_st_lora_container");
  if (!container) return;
  const s = extension_settings[SETTINGS_KEY];
  container.addEventListener("change", (e) => {
    const section = (e.target as HTMLElement).closest("[data-lora-index]") as HTMLElement | null;
    if (!section) return;
    const idx = parseInt(section.getAttribute("data-lora-index") ?? "", 10);
    if (isNaN(idx)) return;
    const slot = s.lora_slots[idx];
    if (!slot) return;
    const field = (e.target as HTMLElement).getAttribute("data-field");
    if (field === "name") slot.name = (e.target as HTMLSelectElement).value;
    else if (field === "mode") {
      slot.mode = (e.target as HTMLSelectElement).value as "none" | "first" | "second" | "both";
      const wrapper1 = section.querySelector(`#image_st_lora_${idx + 1}_first_str_wrapper`) as HTMLElement;
      const wrapper2 = section.querySelector(`#image_st_lora_${idx + 1}_second_str_wrapper`) as HTMLElement;
      if (wrapper1) wrapper1.style.display = (slot.mode === "first" || slot.mode === "both") ? "" : "none";
      if (wrapper2) wrapper2.style.display = (slot.mode === "second" || slot.mode === "both") ? "" : "none";
    }
    else if (field === "first_strength") slot.first_strength = (e.target as HTMLInputElement).value === "" ? 0 : Number((e.target as HTMLInputElement).value);
    else if (field === "second_strength") slot.second_strength = (e.target as HTMLInputElement).value === "" ? 0 : Number((e.target as HTMLInputElement).value);
    else return;
    saveSettingsDebounced();
  });
}

function bindRegexEvents() {
  const container = document.getElementById("image_st_regex_rules_container");
  if (!container) return;
  const s = extension_settings[SETTINGS_KEY];
  container.addEventListener("change", (e) => {
    const row = (e.target as HTMLElement).closest("[data-regex-index]") as HTMLElement | null;
    if (!row) return;
    const idx = parseInt(row.getAttribute("data-regex-index") ?? "", 10);
    if (isNaN(idx)) return;
    const rules = s.regex_rules ?? [];
    const rule = rules[idx];
    if (!rule) return;
    const field = (e.target as HTMLElement).getAttribute("data-field");
    if (field === "name") rule.name = (e.target as HTMLInputElement).value;
    else if (field === "pattern") rule.pattern = (e.target as HTMLInputElement).value;
    else if (field === "replacement") rule.replacement = (e.target as HTMLInputElement).value;
    else if (field === "startTag") rule.startTag = (e.target as HTMLInputElement).value;
    else if (field === "endTag") rule.endTag = (e.target as HTMLInputElement).value;
    else if (field === "tag") rule.tag = (e.target as HTMLInputElement).value;
    else if (field === "enabled") {
      rule.enabled = (e.target as HTMLInputElement).checked;
      const subInputs = row.querySelectorAll<HTMLInputElement>("[data-field]:not([data-field=\"enabled\"])");
      subInputs.forEach(el => el.disabled = !rule.enabled);
      const typeSelect = row.querySelector<HTMLSelectElement>("[data-field=\"type\"]");
      if (typeSelect) typeSelect.disabled = !rule.enabled;
      row.classList.toggle("image-st-regex-collapsed", !rule.enabled);
    }
    else if (field === "type") {
      rule.type = (e.target as HTMLSelectElement).value as RegexRule["type"];
      saveSettingsDebounced();
      rebuildRegexRulesUI();
      refreshPipelineModulesStatus();
      return;
    }
    else return;
    saveSettingsDebounced();
    refreshPipelineModulesStatus();
  });

  container.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("[data-action=\"delete\"]") as HTMLElement | null;
    if (!btn) return;
    const row = btn.closest("[data-regex-index]") as HTMLElement | null;
    if (!row) return;
    const idx = parseInt(row.getAttribute("data-regex-index") ?? "", 10);
    if (isNaN(idx)) return;
    const rules = s.regex_rules ?? [];
    rules.splice(idx, 1);
    saveSettingsDebounced();
    rebuildRegexRulesUI();
    refreshPipelineModulesStatus();
  });
}

// ============================================================
// Prompt Tag UI Builder (v1.1.2)
// ============================================================
function rebuildPromptTagsUI() {
  const container = document.getElementById("image_st_prompt_tags_container");
  if (!container) return;
  const s = extension_settings[SETTINGS_KEY];
  const tags = s.prompt_tags ?? [];
  container.innerHTML = "";
  if (tags.length === 0) {
    const empty = document.createElement("div");
    empty.className = "image-st-hint-text";
    empty.textContent = "暂无标签。点击「添加标签」创建。";
    container.appendChild(empty);
    return;
  }
  tags.forEach((tag: PromptTag, i: number) => {
    const section = document.createElement("div");
    section.className = "image-st-prompt-tag-section";
    section.setAttribute("data-tag-index", String(i));
    if (!tag.enabled) section.classList.add("image-st-tag-collapsed");

    const headerRow = document.createElement("div");
    headerRow.className = "flex-container alignitemscenter image-st-prompt-tag-header";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "标签名称";
    nameInput.className = "text_pole image-st-prompt-tag-name";
    nameInput.value = tag.name ?? "";
    nameInput.setAttribute("data-field", "name");
    if (!tag.enabled) nameInput.disabled = true;
    headerRow.appendChild(nameInput);

    const enabledLabel = document.createElement("label");
    enabledLabel.className = "checkbox_label";
    const enabledCheck = document.createElement("input");
    enabledCheck.type = "checkbox";
    enabledCheck.checked = tag.enabled;
    enabledCheck.setAttribute("data-field", "enabled");
    enabledLabel.appendChild(enabledCheck);
    const enabledSpan = document.createElement("span");
    enabledSpan.textContent = " 启用";
    enabledLabel.appendChild(enabledSpan);
    headerRow.appendChild(enabledLabel);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "menu_button image-st-prompt-tag-delete";
    deleteBtn.textContent = "✕";
    deleteBtn.setAttribute("data-action", "delete");
    headerRow.appendChild(deleteBtn);

    const arrow = document.createElement("span");
    arrow.className = "image-st-fold-arrow";
    arrow.textContent = "▶";
    headerRow.appendChild(arrow);

    section.appendChild(headerRow);

    const bodyDiv = document.createElement("div");
    bodyDiv.className = "image-st-tag-body";

    const promptInput = document.createElement("textarea");
    promptInput.className = "text_pole textarea_compact autoSetHeight";
    promptInput.rows = 2;
    promptInput.placeholder = "输入提示词内容...";
    promptInput.value = tag.prompt ?? "";
    promptInput.setAttribute("data-field", "prompt");
    if (!tag.enabled) promptInput.disabled = true;
    bodyDiv.appendChild(promptInput);

    section.appendChild(bodyDiv);

    container.appendChild(section);
  });
}

function bindPromptTagEvents() {
  const container = document.getElementById("image_st_prompt_tags_container");
  if (!container) return;
  const s = extension_settings[SETTINGS_KEY];

  container.addEventListener("change", (e) => {
    const section = (e.target as HTMLElement).closest("[data-tag-index]") as HTMLElement | null;
    if (!section) return;
    const idx = parseInt(section.getAttribute("data-tag-index") ?? "", 10);
    if (isNaN(idx)) return;
    const tags = s.prompt_tags ?? [];
    const tag = tags[idx];
    if (!tag) return;
    const field = (e.target as HTMLElement).getAttribute("data-field");
    if (field === "name") tag.name = (e.target as HTMLInputElement).value;
    else if (field === "prompt") tag.prompt = (e.target as HTMLTextAreaElement).value;
    else if (field === "enabled") {
      tag.enabled = (e.target as HTMLInputElement).checked;
      const subInputs = section.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input[data-field=\"name\"], textarea[data-field=\"prompt\"]");
      subInputs.forEach(el => el.disabled = !tag.enabled);
      section.classList.toggle("image-st-tag-collapsed", !tag.enabled);
    }
    else return;
    saveSettingsDebounced();
  });

  container.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("[data-action=\"delete\"]") as HTMLElement | null;
    if (!btn) return;
    const section = btn.closest("[data-tag-index]") as HTMLElement | null;
    if (!section) return;
    const idx = parseInt(section.getAttribute("data-tag-index") ?? "", 10);
    if (isNaN(idx)) return;
    const tags = s.prompt_tags ?? [];
    tags.splice(idx, 1);
    saveSettingsDebounced();
    rebuildPromptTagsUI();
  });
}

// ============================================================
// Style Preset System (v1.x)
// ============================================================
interface StyleOption {
  label: string;
  value: string;
}

interface StylePreset {
  id: string;
  label: string;
  aesthetic: string;
  medium: string;
  mood: string;
  material: string;
  lighting: string;
  [key: string]: string;
}

const STYLE_CATEGORIES: Record<string, StyleOption[]> = {
  aesthetic: [
    { label: "无", value: "" },
    { label: "【汉】汉代雄风", value: "han dynasty" },
    { label: "【魏晋】魏晋风骨", value: "wei jin" },
    { label: "【唐】盛唐华彩", value: "tang dynasty" },
    { label: "【宋】宋韵雅致", value: "song dynasty" },
    { label: "【元】草原霸气", value: "yuan dynasty" },
    { label: "【明】明制端庄", value: "ming dynasty" },
    { label: "【清】清宫繁华", value: "qing dynasty" },
    { label: "历史正剧", value: "historical drama" },
    { label: "边塞史诗", value: "frontier epic" },
    { label: "暗黑武侠", value: "dark wuxia" },
    { label: "正统武侠", value: "classic wuxia" },
    { label: "仙侠飞升", value: "xianxia" },
    { label: "玄幻洪荒", value: "mythology fantasy" },
    { label: "文人意境", value: "literati" },
    { label: "工笔重彩", value: "gongbi" },
    { label: "写意大写意", value: "xieyi" },
    { label: "敦煌壁画", value: "dunhuang" },
    { label: "现代国风", value: "modern guofeng" },
    { label: "民国旗袍", value: "republican" },
    { label: "大正/民国摩登", value: "taisho modern" },
    { label: "新中式极简", value: "neo chinese" },
    { label: "赛博国风", value: "cyber guofeng" },
    { label: "赛博朋克", value: "cyberpunk" },
    { label: "蒸汽朋克", value: "steampunk" },
    { label: "洛可可", value: "rococo" },
    { label: "包豪斯", value: "bauhaus" },
    { label: "新艺术运动", value: "art nouveau" },
    { label: "极简主义", value: "minimalism" },
    { label: "超现实主义", value: "surrealism" },
    { label: "波普艺术", value: "pop art" },
    { label: "印象派", value: "impressionism" },
    { label: "哥特式", value: "gothic" },
    { label: "古典主义", value: "classical" },
    { label: "日式侘寂", value: "wabi sabi" },
    { label: "复古未来主义", value: "retrofuturism" },
    { label: "暗黑浪漫", value: "dark romanticism" },
    { label: "废土朋克", value: "dieselpunk" },
  ],
  medium: [
    { label: "无", value: "" },
    { label: "水墨画", value: "ink wash" },
    { label: "工笔画", value: "gongbi" },
    { label: "写意水墨", value: "xieyi" },
    { label: "青绿山水", value: "landscape" },
    { label: "金碧山水", value: "golden green" },
    { label: "绢本重彩", value: "silk scroll" },
    { label: "刺绣风格", value: "embroidery" },
    { label: "剪纸风格", value: "paper cutting" },
    { label: "版画木刻", value: "woodblock" },
    { label: "壁画彩绘", value: "frescos" },
    { label: "数字绘画", value: "digital painting" },
    { label: "水彩", value: "watercolor" },
    { label: "油画", value: "oil painting" },
    { label: "素描铅笔画", value: "pencil sketch" },
    { label: "像素艺术", value: "pixel art" },
    { label: "3D渲染", value: "3d render" },
    { label: "丙烯画", value: "acrylic" },
    { label: "蜡笔", value: "crayon" },
    { label: "照片写实", value: "photorealistic" },
    { label: "动漫风格", value: "anime" },
    { label: "漫画风格", value: "comic" },
    { label: "概念艺术", value: "concept art" },
    { label: "插画", value: "illustration" },
  ],
  mood: [
    { label: "无", value: "" },
    { label: "江湖豪迈", value: "jianghu" },
    { label: "家国悲壮", value: "patriotic" },
    { label: "离愁别绪", value: "melancholy" },
    { label: "隐逸超然", value: "tranquil" },
    { label: "儿女情长", value: "romantic" },
    { label: "庙堂之威", value: "imperial" },
    { label: "刀光剑影", value: "sword soul" },
    { label: "道骨仙风", value: "immortal" },
    { label: "宁静祥和", value: "serene" },
    { label: "神秘莫测", value: "mysterious" },
    { label: "浪漫温馨", value: "romantic" },
    { label: "史诗壮阔", value: "epic" },
    { label: "阴郁压抑", value: "gloomy" },
    { label: "欢快活泼", value: "cheerful" },
    { label: "孤独忧郁", value: "lonely" },
    { label: "紧张刺激", value: "tense" },
    { label: "奇幻梦境", value: "dreamlike" },
    { label: "恐怖惊悚", value: "horror" },
    { label: "温馨治愈", value: "healing" },
    { label: "庄严肃穆", value: "solemn" },
  ],
  material: [
    { label: "无", value: "" },
    { label: "青花瓷纹", value: "porcelain" },
    { label: "漆器朱红", value: "lacquer" },
    { label: "翡翠玉石", value: "jade" },
    { label: "竹简纸韵", value: "bamboo paper" },
    { label: "云锦织物", value: "brocade" },
    { label: "铜器铸纹", value: "bronze" },
    { label: "宣纸晕染", value: "rice paper" },
    { label: "玻璃质感", value: "glass" },
    { label: "金属光泽", value: "metal" },
    { label: "皮革纹理", value: "leather" },
    { label: "木纹质感", value: "wood" },
    { label: "石材雕刻", value: "stone" },
    { label: "丝绸丝滑", value: "silk" },
    { label: "磨砂哑光", value: "matte" },
    { label: "珍珠光泽", value: "pearl" },
    { label: "霓虹发光", value: "neon" },
    { label: "水晶透明", value: "crystal" },
    { label: "锈蚀斑驳", value: "rusty" },
    { label: "毛绒柔软", value: "furry" },
  ],
  lighting: [
    { label: "无", value: "" },
    { label: "烟雨江南", value: "misty rain" },
    { label: "塞外大漠光", value: "desert sunlight" },
    { label: "宫灯红烛", value: "candlelight" },
    { label: "晨钟暮鼓光", value: "temple light" },
    { label: "月色如霜", value: "moonlight" },
    { label: "金色黄昏", value: "golden hour" },
    { label: "蓝调晨光", value: "blue hour" },
    { label: "戏剧性阴影", value: "dramatic shadows" },
    { label: "柔和漫射光", value: "soft lighting" },
    { label: "霓虹色调", value: "neon" },
    { label: "黑白单色", value: "monochrome" },
    { label: "冷蓝色调", value: "cool blue" },
    { label: "暖橙棕色调", value: "warm amber" },
    { label: "梦幻粉紫", value: "pastel" },
    { label: "幽灵绿光", value: "eerie green" },
    { label: "工作室灯光", value: "studio lighting" },
    { label: "体积光丁达尔", value: "god rays" },
    { label: "轮廓逆光", value: "rim light" },
  ],
};

const STYLE_PRESETS: StylePreset[] = [
  {
    id: "custom",
    label: "自定义",
    aesthetic: "", medium: "", mood: "", material: "", lighting: "",
  },
  {
    id: "tang_imperial",
    label: "盛唐华彩宫廷",
    aesthetic: "tang dynasty", medium: "silk scroll", mood: "imperial", material: "brocade", lighting: "candlelight",
  },
  {
    id: "song_literati",
    label: "大宋文人雅集",
    aesthetic: "song dynasty", medium: "xieyi", mood: "tranquil", material: "rice paper", lighting: "moonlight",
  },
  {
    id: "qing_imperial",
    label: "清宫锦绣华年",
    aesthetic: "qing dynasty", medium: "gongbi", mood: "imperial", material: "brocade", lighting: "candlelight",
  },
  {
    id: "han_patriotic",
    label: "汉家铁骑雄风",
    aesthetic: "han dynasty", medium: "frescos", mood: "patriotic", material: "bronze", lighting: "desert sunlight",
  },
  {
    id: "weijin_tranquil",
    label: "魏晋竹林风骨",
    aesthetic: "wei jin", medium: "xieyi", mood: "tranquil", material: "bamboo paper", lighting: "temple light",
  },
  {
    id: "modern_guofeng",
    label: "现代国风写实",
    aesthetic: "modern guofeng", medium: "concept art", mood: "solemn", material: "jade", lighting: "golden hour",
  },
  {
    id: "cyber_guofeng",
    label: "赛博国风霓虹",
    aesthetic: "cyber guofeng", medium: "digital painting", mood: "mysterious", material: "neon", lighting: "neon",
  },
  {
    id: "dunhuang_immortal",
    label: "敦煌飞天壁画",
    aesthetic: "dunhuang", medium: "frescos", mood: "immortal", material: "lacquer", lighting: "temple light",
  },
  {
    id: "literati_tranquil",
    label: "文人山水意境",
    aesthetic: "literati", medium: "landscape", mood: "tranquil", material: "rice paper", lighting: "misty rain",
  },
  {
    id: "dark_wuxia",
    label: "暗黑武侠江湖",
    aesthetic: "dark wuxia", medium: "digital painting", mood: "sword soul", material: "lacquer", lighting: "dramatic shadows",
  },
];

function initStylePresetUI(): void {
  const s = extension_settings[SETTINGS_KEY];

  const overallEl = document.getElementById("image_st_style_overall") as HTMLSelectElement | null;
  if (overallEl) {
    overallEl.innerHTML = "";
    STYLE_PRESETS.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.label;
      overallEl.appendChild(opt);
    });
    overallEl.value = s.style_preset_overall_id ?? "custom";
  }

  const catKeys: Array<keyof typeof STYLE_CATEGORIES> = ["aesthetic", "medium", "mood", "material", "lighting"];
  catKeys.forEach(key => {
    const el = document.getElementById(`image_st_style_${key}`) as HTMLSelectElement | null;
    if (!el) return;
    el.innerHTML = "";
    (STYLE_CATEGORIES[key] ?? []).forEach(opt => {
      const option = document.createElement("option");
      option.value = opt.value;
      option.textContent = opt.label;
      el.appendChild(option);
    });
    const savedVal = (s as Record<string, string>)[`style_preset_${key}`] ?? "";
    el.value = savedVal;
  });

  const enabledEl = document.getElementById("image_st_style_preset_enabled") as HTMLInputElement | null;
  if (enabledEl) enabledEl.checked = s.style_preset_enabled ?? false;

  updateStylePreviewHint();
}

function updateStylePreviewHint(): void {
  const hintEl = document.getElementById("image_st_style_preview_hint");
  if (!hintEl) return;
  const s = extension_settings[SETTINGS_KEY];
  if (!s.style_preset_enabled) {
    hintEl.textContent = "";
    return;
  }
  const parts = [
    (s.style_preset_aesthetic ?? "").trim(),
    (s.style_preset_medium ?? "").trim(),
    (s.style_preset_mood ?? "").trim(),
    (s.style_preset_material ?? "").trim(),
    (s.style_preset_lighting ?? "").trim(),
  ].filter(Boolean);
  hintEl.textContent = parts.length ? `预览: ${parts.join(", ")}` : "";
}

function matchStylePreset(): string | null {
  const s = extension_settings[SETTINGS_KEY];
  // 优先按 id 匹配（保留用户自定义语义），fallback 按字段组合匹配
  const currentId = s.style_preset_overall_id as string | undefined;
  if (currentId) {
    const byId = STYLE_PRESETS.find(p => p.id === currentId);
    if (byId) return byId.label;
  }
  for (const preset of STYLE_PRESETS) {
    if (
      (s.style_preset_aesthetic ?? "") === preset.aesthetic &&
      (s.style_preset_medium ?? "") === preset.medium &&
      (s.style_preset_mood ?? "") === preset.mood &&
      (s.style_preset_material ?? "") === preset.material &&
      (s.style_preset_lighting ?? "") === preset.lighting
    ) {
      return preset.label;
    }
  }
  return null;
}

function bindStylePresetEvents(): void {
  const s = extension_settings[SETTINGS_KEY];
  const enabledEl = document.getElementById("image_st_style_preset_enabled") as HTMLInputElement | null;
  const overallEl = document.getElementById("image_st_style_overall") as HTMLSelectElement | null;

  if (enabledEl) {
    enabledEl.addEventListener("change", () => {
      s.style_preset_enabled = enabledEl.checked;
      saveSettingsDebounced();
      updateStylePreviewHint();
    });
  }

  if (overallEl) {
    overallEl.addEventListener("change", () => {
      const selected = STYLE_PRESETS.find(p => p.id === overallEl.value);
      if (!selected) return;
      s.style_preset_overall_id = selected.id;
      s.style_preset_overall = selected.label;
      (s as Record<string, string>).style_preset_aesthetic = selected.aesthetic;
      (s as Record<string, string>).style_preset_medium = selected.medium;
      (s as Record<string, string>).style_preset_mood = selected.mood;
      (s as Record<string, string>).style_preset_material = selected.material;
      (s as Record<string, string>).style_preset_lighting = selected.lighting;
      const catKeys: Array<keyof typeof STYLE_CATEGORIES> = ["aesthetic", "medium", "mood", "material", "lighting"];
      catKeys.forEach(key => {
        const el = document.getElementById(`image_st_style_${key}`) as HTMLSelectElement | null;
        if (el) el.value = (selected as Record<string, string>)[key] ?? "";
      });
      saveSettingsDebounced();
      updateStylePreviewHint();
    });
  }

  const catKeys: Array<keyof typeof STYLE_CATEGORIES> = ["aesthetic", "medium", "mood", "material", "lighting"];
  catKeys.forEach(key => {
    const el = document.getElementById(`image_st_style_${key}`) as HTMLSelectElement | null;
    if (!el) return;
    el.addEventListener("change", () => {
      (s as Record<string, string>)[`style_preset_${key}`] = el.value;
      const matched = matchStylePreset();
      s.style_preset_overall = matched ?? "自定义";
      // 同时更新 id（如果匹配到预设，用预设的 id；否则标记为自定义）
      const matchedPreset = STYLE_PRESETS.find(p => p.label === matched);
      s.style_preset_overall_id = matchedPreset?.id ?? "custom";
      if (overallEl) overallEl.value = s.style_preset_overall_id;
      saveSettingsDebounced();
      updateStylePreviewHint();
    });
  });
}

// ============================================================
// API Profile Management (多模型 API 管理)
// ============================================================
interface ApiProfile {
  id: string;
  name: string;
  apiKey: string;
  url: string;
  model: string;
}

function getApiProfiles(): ApiProfile[] {
  const s = extension_settings[SETTINGS_KEY];
  return (s.api_profiles as ApiProfile[]) ?? [];
}

function saveApiProfiles(profiles: ApiProfile[]): void {
  const s = extension_settings[SETTINGS_KEY];
  s.api_profiles = profiles;
  saveSettingsDebounced();
}

// 从 settings 获取当前选中的 profile id（单一事实来源）
function getCurrentProfileId(): string | undefined {
  return extension_settings[SETTINGS_KEY]?.current_api_profile_id;
}

// 设置当前选中的 profile id 并持久化
function setCurrentProfileId(id: string | undefined): void {
  const s = extension_settings[SETTINGS_KEY];
  s.current_api_profile_id = id;
  saveSettingsDebounced();
}

// 从主字段读取当前配置
function readMainFields(): {name: string; url: string; model: string; apiKey: string} {
  const urlEl = document.getElementById("image_st_llm_url") as HTMLInputElement;
  const modelEl = document.getElementById("image_st_llm_model") as HTMLInputElement;
  const keyEl = document.getElementById("image_st_api_key") as HTMLInputElement;
  return {
    name: "",
    url: urlEl?.value.trim() ?? "",
    model: modelEl?.value.trim() ?? "",
    apiKey: keyEl?.value.trim() ?? "",
  };
}

// 填充主字段
function fillMainFields(profile: ApiProfile): void {
  const urlEl = document.getElementById("image_st_llm_url") as HTMLInputElement;
  const modelEl = document.getElementById("image_st_llm_model") as HTMLInputElement;
  const keyEl = document.getElementById("image_st_api_key") as HTMLInputElement;
  if (urlEl) urlEl.value = profile.url;
  if (modelEl) modelEl.value = profile.model;
  if (keyEl) keyEl.value = profile.apiKey;
}

// 检查主字段是否与指定 profile 不同（用于保存时的变更检测）
function hasFieldsChanged(profile: ApiProfile): boolean {
  const fields = readMainFields();
  return fields.url !== profile.url
    || fields.model !== profile.model
    || fields.apiKey !== profile.apiKey;
}

// 清除编辑态高亮
function clearEditHighlight(): void {
  const fields = document.querySelectorAll("#image_st_llm_url, #image_st_llm_model, #image_st_api_key");
  fields.forEach(el => {
    (el as HTMLElement).style.outline = "";
    (el as HTMLElement).style.outlineOffset = "";
  });
}

function rebuildApiProfilesUI(): void {
  const select = document.getElementById("image_st_api_profile_select") as HTMLSelectElement;
  const deleteBtn = document.getElementById("image_st_api_profile_delete") as HTMLButtonElement | null;
  const saveBtn = document.getElementById("image_st_api_profile_save") as HTMLButtonElement | null;
  if (!select) return;

  const profiles = getApiProfiles();
  const currentId = getCurrentProfileId();

  // 重建下拉选项
  select.innerHTML = "";
  if (profiles.length === 0) {
    select.innerHTML = '<option value="">-- 手动输入 / 选择已保存配置 --</option>';
    select.disabled = false;
    if (deleteBtn) deleteBtn.disabled = true;
    if (saveBtn) saveBtn.disabled = false; // 允许新建
    clearEditHighlight();
    updatePreview();
    return;
  }

  select.disabled = false;
  profiles.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    select.appendChild(opt);
  });

  // 恢复选中状态：仅读取 settings，不写入
  const targetId = currentId && profiles.some(p => p.id === currentId) ? currentId : profiles[0].id;
  select.value = targetId;
  // 注意：不调用 setCurrentProfileId，避免重建 UI 时误覆盖用户选择

  // 填充主字段
  const profile = profiles.find(p => p.id === targetId);
  if (profile) fillMainFields(profile);

  if (deleteBtn) deleteBtn.disabled = false; // 允许删除最后一个
  if (saveBtn) saveBtn.disabled = false;
  clearEditHighlight();
  updatePreview();
}

// 更新预览文本
function updatePreview(): void {
  const preview = document.getElementById("image_st_current_profile_preview");
  if (!preview) return;
  const profiles = getApiProfiles();
  const currentId = getCurrentProfileId();
  if (!currentId) {
    preview.textContent = "";
    return;
  }
  const current = profiles.find(p => p.id === currentId);
  if (current) {
    preview.textContent = `当前: ${current.name} (${current.url} / ${current.model})`;
  }
}

function bindApiProfileEvents(): void {
  const select = document.getElementById("image_st_api_profile_select") as HTMLSelectElement;
  const newBtn = document.getElementById("image_st_api_profile_new") as HTMLButtonElement | null;
  const deleteBtn = document.getElementById("image_st_api_profile_delete") as HTMLButtonElement | null;
  const saveBtn = document.getElementById("image_st_api_profile_save") as HTMLButtonElement | null;

  // 下拉切换 -> 填充主字段并持久化选中状态
  select?.addEventListener("change", () => {
    const profileId = select.value;
    const s = extension_settings[SETTINGS_KEY];
    if (!profileId) {
      setCurrentProfileId(undefined);
      s.use_api_profile = false;
      saveSettingsDebounced();
      if (deleteBtn) deleteBtn.disabled = true;
      clearEditHighlight();
      updatePreview();
      return;
    }
    const profiles = getApiProfiles();
    const profile = profiles.find(p => p.id === profileId);
    if (profile) {
      fillMainFields(profile);
      setCurrentProfileId(profileId);
      // 选中 profile 时自动启用 use_api_profile
      s.use_api_profile = true;
      saveSettingsDebounced();
    }
    if (deleteBtn) deleteBtn.disabled = false;
    clearEditHighlight();
    updatePreview();
  });

  // 新建：清空主字段，准备保存
  newBtn?.addEventListener("click", () => {
    const urlEl = document.getElementById("image_st_llm_url") as HTMLInputElement;
    const modelEl = document.getElementById("image_st_llm_model") as HTMLInputElement;
    const keyEl = document.getElementById("image_st_api_key") as HTMLInputElement;
    const selectEl = document.getElementById("image_st_api_profile_select") as HTMLSelectElement;
    const s = extension_settings[SETTINGS_KEY];

    // 重置下拉到手动输入模式
    selectEl.value = "";
    setCurrentProfileId(undefined);
    s.use_api_profile = false;
    saveSettingsDebounced();

    // 清空主字段（保留默认值）
    if (urlEl) urlEl.value = "https://api.siliconflow.cn/v1/chat/completions";
    if (modelEl) modelEl.value = "Qwen/Qwen2.5-7B-Instruct";
    if (keyEl) keyEl.value = "";

    if (deleteBtn) deleteBtn.disabled = true;
    clearEditHighlight();
    updatePreview();
    toastr.info("已进入新建模式，填写字段后点击「保存配置」", "API 管理");
  });

  // 删除：确认后删除当前选中的 profile（允许删除最后一个）
  deleteBtn?.addEventListener("click", () => {
    const currentId = getCurrentProfileId();
    if (!currentId) return;
    const profiles = getApiProfiles();
    const profile = profiles.find(p => p.id === currentId);
    if (!profile) return;
    if (!confirm(`确定删除配置「${profile.name}」？`)) return;
    const idx = profiles.findIndex(p => p.id === currentId);
    if (idx >= 0) profiles.splice(idx, 1);
    saveApiProfiles(profiles);
    // 清除当前选中并重建 UI
    setCurrentProfileId(undefined);
    const s = extension_settings[SETTINGS_KEY];
    s.use_api_profile = false;
    saveSettingsDebounced();
    rebuildApiProfilesUI();
    toastr.success(`配置已删除: ${profile.name}`, "API 管理");
  });

  // 保存：统一处理新建和更新
  // - 若当前选中了 profile 且字段有变化 -> 询问是否覆盖
  // - 若当前未选中 profile (新建模式) -> 直接新建
  saveBtn?.addEventListener("click", () => {
    const mainFields = readMainFields();
    const profiles = getApiProfiles();
    const currentId = getCurrentProfileId();

    if (!mainFields.url || !mainFields.model || !mainFields.apiKey) {
      toastr.error("请先填写 URL、模型、Key", "API 管理");
      return;
    }

    if (currentId && profiles.some(p => p.id === currentId)) {
      // 当前选中了现有 profile
      const profile = profiles.find(p => p.id === currentId);
      if (!profile) return;
      
      if (hasFieldsChanged(profile)) {
        // 字段有变化 -> 询问是否覆盖
        if (!confirm(`字段已修改，确定要覆盖配置「${profile.name}」吗？`)) {
          toastr.info("已取消保存", "API 管理");
          return;
        }
        // 覆盖更新
        profile.url = mainFields.url;
        profile.model = mainFields.model;
        profile.apiKey = mainFields.apiKey;
        // 名称不变（如需改名，可先删除再新建，或后续添加改名功能）
        saveApiProfiles(profiles);
        toastr.success(`配置已更新: ${profile.name} (已设为当前)`, "API 管理");
      } else {
        // 无变化
        toastr.info("未检测到变化，无需保存", "API 管理");
        return;
      }
    } else {
      // 新建模式：输入名称创建新配置
      const name = prompt("请输入新配置名称：", "新配置");
      if (!name) return;
      
      // 重名检测
      const duplicate = profiles.find(p => p.name === name);
      if (duplicate) {
        toastr.error(`配置名称「${name}」已存在`, "API 管理");
        return;
      }

      const newProfile: ApiProfile = {
        id: (typeof crypto.randomUUID === "function")
            ? crypto.randomUUID()
            : `profile_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        name,
        url: mainFields.url,
        model: mainFields.model,
        apiKey: mainFields.apiKey,
      };
      profiles.push(newProfile);
      setCurrentProfileId(newProfile.id);
      saveApiProfiles(profiles);
      
      const s = extension_settings[SETTINGS_KEY];
      s.use_api_profile = true;
      saveSettingsDebounced();
      
      toastr.success(`配置已创建: ${name} (已设为当前)`, "API 管理");
    }
    
    clearEditHighlight();
    rebuildApiProfilesUI();
  });
}

// ============================================================
// UI Helper Functions (移自 index.ts)
// ============================================================
function populateSelect(el: HTMLSelectElement, items: string[], current: string): void {
  el.innerHTML = "";
  items.forEach(item => {
    const option = document.createElement("option");
    option.value = item;
    option.textContent = item;
    if (item === current) option.selected = true;
    el.appendChild(option);
  });
}

function populateDropdown(id: string, items: string[], current: string): void {
  const el = document.getElementById(id) as HTMLSelectElement;
  if (el) populateSelect(el, items, current);
}

async function populateModelDropdown() {
  const el = document.getElementById("image_st_model") as HTMLSelectElement;
  if (!el) return;
  const s = extension_settings[SETTINGS_KEY];
  const current = s.model;
  let models: string[] = [];
  try {
    models = await fetchModelList();
  } catch {
    models = [];
  }
  if (models.length === 0) {
    populateSelect(el, [current], current);
    return;
  }
  populateSelect(el, models, current);
}

async function populateLoraDropdowns() {
  let loras: string[] = [];
  try {
    loras = await fetchLoraList();
  } catch {
    loras = [];
  }
  const s = extension_settings[SETTINGS_KEY];
  for (let i = 0; i < LORA_SLOT_COUNT; i++) {
    const sections = document.querySelectorAll(`#image_st_lora_container > div`);
    const section = sections[i] as HTMLElement | undefined;
    if (!section) continue;
    const nameSelect = section.querySelector("select") as HTMLSelectElement;
    if (!nameSelect) continue;
    // 只填充一次，防止异步完成后覆盖用户选择
    if (nameSelect.dataset.loraPopulated === "1") continue;
    nameSelect.dataset.loraPopulated = "1";
    const current = s?.lora_slots?.[i]?.name ?? "";
    nameSelect.innerHTML = '<option value="">无（跳过）</option>';
    loras.forEach(item => {
      const option = document.createElement("option");
      option.value = item;
      option.textContent = item;
      if (item === current) option.selected = true;
      nameSelect.appendChild(option);
    });
    if (current && !loras.includes(current)) {
      const option = document.createElement("option");
      option.value = current;
      option.textContent = current;
      option.selected = true;
      nameSelect.appendChild(option);
    }
  }
}

// ============================================================
// MVU Tree Renderers (v1.3 P1: 三态级联 + 叶子可选 + 原位状态更新)
// ============================================================
interface MvuCheckboxRef {
  el: HTMLInputElement;
  node: MvuTreeBranch;
  /** 自身 + 全部子孙路径（JSON 序列化），构建时一次性计算 */
  universe: string[];
}

function collectUniverse(node: MvuTreeBranch): string[] {
  const out: string[] = [];
  const walk = (n: MvuTreeBranch): void => {
    out.push(JSON.stringify(n.path));
    for (const c of n.children) walk(c);
  };
  walk(node);
  return out;
}

/** 仅具体路径（不含通配）参与树的勾选状态 */
function getConcreteSelectionSet(): Set<string> {
  const s = extension_settings[SETTINGS_KEY];
  const selections = migrateMvuPaths(s);
  return new Set(
    selections
      .filter(sel => !sel.path.includes(MVU_WILDCARD))
      .map(sel => JSON.stringify(sel.path))
  );
}

function refreshAllCheckboxStates(refs: MvuCheckboxRef[]): void {
  const selSet = getConcreteSelectionSet();
  for (const ref of refs) {
    let count = 0;
    for (const p of ref.universe) if (selSet.has(p)) count++;
    ref.el.checked = count === ref.universe.length && ref.universe.length > 0;
    ref.el.indeterminate = count > 0 && count < ref.universe.length;
  }
  refreshMvuPanelExtras();
}

function createMvuNodeCheckbox(node: MvuTreeBranch, universe: string[], refs: MvuCheckboxRef[]): HTMLInputElement {
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.addEventListener("change", () => {
    const s = extension_settings[SETTINGS_KEY];
    const selections = migrateMvuPaths(s);
    const selSet = new Set(
      selections
        .filter(sel => !sel.path.includes(MVU_WILDCARD))
        .map(sel => JSON.stringify(sel.path))
    );
    const allSelected = universe.every(p => selSet.has(p));
    if (allSelected) {
      // 全选状态下点击 → 取消该节点及全部子孙（通配选择不受影响）
      const uniSet = new Set(universe);
      s.mvu_selections = selections.filter(
        sel => sel.path.includes(MVU_WILDCARD) || !uniSet.has(JSON.stringify(sel.path))
      );
    } else {
      // 未全选 → 补齐自身及全部子孙为具体选择（含匹配名段推断）；既有选择原样保留
      const statData = getMvuData();
      const added: MvuSelection[] = [];
      const walk = (n: MvuTreeBranch): void => {
        const pStr = JSON.stringify(n.path);
        if (!selSet.has(pStr)) {
          added.push({ path: [...n.path], nameSegment: inferNameSegment(n.path, statData) });
        }
        for (const c of n.children) walk(c);
      };
      walk(node);
      s.mvu_selections = [...selections, ...added];
    }
    saveSettingsDebounced();
    refreshAllCheckboxStates(refs);
  });
  refs.push({ el: cb, node, universe });
  return cb;
}

function createPathCopyBtn(path: string[]): HTMLSpanElement {
  const copyBtn = document.createElement("span");
  copyBtn.className = "image-st-tree-path-copy";
  copyBtn.title = "复制路径";
  copyBtn.innerHTML = '<i class="fa-solid fa-copy"></i>';
  copyBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(JSON.stringify(path));
  });
  return copyBtn;
}

// ============================================================
// MVU Field Matrix (v1.3 P2: 集合节点字段矩阵)
// ============================================================
interface MvuMatrixContext {
  node: MvuTreeBranch;
  collPath: string[];
  members: MvuTreeBranch[];
  fields: string[];
  fieldKind: Map<string, 'leaf' | 'object'>;
  container: HTMLElement;
  refresh: () => void;
}

/** 集合判定：真实集合（isCollectionNode）或 R2 潜在集合（仅 1 个对象子节点） */
function getCollectionMembers(node: MvuTreeBranch): MvuTreeBranch[] {
  if (node.children.length === 0) return [];
  const statData = getMvuData();
  const value = statData ? resolveObjectPath(statData, node.path) : undefined;
  if (isCollectionNode(value)) {
    return node.children.filter(c => c.type === 'branch');
  }
  if (node.children.length === 1 && node.children[0].type === 'branch' && node.children[0].children.length > 0) {
    return node.children;
  }
  return [];
}

function findColumnWildcard(selections: MvuSelection[], collPath: string[], field: string): boolean {
  const target = JSON.stringify([...collPath, MVU_WILDCARD, field]);
  return selections.some(sel => JSON.stringify(sel.path) === target);
}

function isColumnConcrete(sel: MvuSelection, collPath: string[], field: string): boolean {
  if (sel.path.length !== collPath.length + 2) return false;
  if (sel.path.includes(MVU_WILDCARD)) return false;
  if (sel.path[sel.path.length - 1] !== field) return false;
  return collPath.every((seg, i) => sel.path[i] === seg);
}

function toggleMatrixColumn(ctx: MvuMatrixContext, field: string): void {
  const s = extension_settings[SETTINGS_KEY];
  const selections = migrateMvuPaths(s);
  const wildPath = [...ctx.collPath, MVU_WILDCARD, field];
  const wildStr = JSON.stringify(wildPath);
  if (findColumnWildcard(selections, ctx.collPath, field)) {
    // 已全选 → 移除通配及该列所有具体选择
    s.mvu_selections = selections.filter(
      sel => JSON.stringify(sel.path) !== wildStr && !isColumnConcrete(sel, ctx.collPath, field)
    );
  } else {
    // 未全选 → 该列具体选择被通配吸收，写入单条通配（一条覆盖所有成员，未来新增成员自动生效）
    const kept = selections.filter(sel => !isColumnConcrete(sel, ctx.collPath, field));
    kept.push({ path: wildPath, nameSegment: ctx.collPath.length });
    s.mvu_selections = kept;
  }
  saveSettingsDebounced();
  ctx.refresh();
}

function toggleMatrixCell(ctx: MvuMatrixContext, member: string, field: string): void {
  const s = extension_settings[SETTINGS_KEY];
  const selections = migrateMvuPaths(s);
  const cellPath = [...ctx.collPath, member, field];
  const cellStr = JSON.stringify(cellPath);
  const wildStr = JSON.stringify([...ctx.collPath, MVU_WILDCARD, field]);
  if (selections.some(sel => JSON.stringify(sel.path) === wildStr)) {
    // 通配覆盖下点击 → 炸开为具体选择（保留其他成员），本成员取消（实现"全员除TA"）
    const kept = selections.filter(sel => JSON.stringify(sel.path) !== wildStr);
    for (const m of ctx.members) {
      if (m.key === member) continue;
      if (!m.children.some(c => c.key === field)) continue;
      const p = [...ctx.collPath, m.key, field];
      if (!kept.some(sel => JSON.stringify(sel.path) === JSON.stringify(p))) {
        kept.push({ path: p, nameSegment: ctx.collPath.length });
      }
    }
    s.mvu_selections = kept;
  } else if (selections.some(sel => JSON.stringify(sel.path) === cellStr)) {
    s.mvu_selections = selections.filter(sel => JSON.stringify(sel.path) !== cellStr);
  } else {
    selections.push({ path: cellPath, nameSegment: ctx.collPath.length });
    s.mvu_selections = selections;
  }
  saveSettingsDebounced();
  ctx.refresh();
}

function renderMvuMatrix(ctx: MvuMatrixContext): void {
  ctx.container.innerHTML = "";
  const selections = migrateMvuPaths(extension_settings[SETTINGS_KEY]);
  const concreteSet = new Set(
    selections.filter(sel => !sel.path.includes(MVU_WILDCARD)).map(sel => JSON.stringify(sel.path))
  );

  const table = document.createElement("table");
  table.className = "image-st-mvu-matrix";

  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  const corner = document.createElement("th");
  corner.textContent = `${ctx.node.key} (${ctx.members.length})`;
  hr.appendChild(corner);
  for (const field of ctx.fields) {
    const th = document.createElement("th");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.title = `整列${field}（通配：覆盖所有${ctx.node.key}成员，含未来新增）`;
    const hasWild = findColumnWildcard(selections, ctx.collPath, field);
    const holders = ctx.members.filter(m => m.children.some(c => c.key === field));
    const concreteCount = holders.filter(m => concreteSet.has(JSON.stringify([...ctx.collPath, m.key, field]))).length;
    cb.checked = hasWild || (holders.length > 0 && concreteCount === holders.length);
    cb.indeterminate = !hasWild && concreteCount > 0 && concreteCount < holders.length;
    cb.addEventListener("change", () => toggleMatrixColumn(ctx, field));
    th.appendChild(cb);
    th.appendChild(document.createTextNode(` ${field}`));
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const m of ctx.members) {
    const tr = document.createElement("tr");
    const rowHead = document.createElement("th");
    rowHead.textContent = m.key;
    tr.appendChild(rowHead);
    const memberFields = new Set(m.children.map(c => c.key));
    for (const field of ctx.fields) {
      const td = document.createElement("td");
      if (!memberFields.has(field)) {
        td.textContent = "—";
        td.className = "image-st-mvu-matrix-na";
      } else if (ctx.fieldKind.get(field) === 'object') {
        const drill = document.createElement("span");
        drill.className = "image-st-mvu-matrix-drill";
        drill.textContent = "▸对象";
        drill.title = "该字段为对象，请在列表视图中展开选择";
        td.appendChild(drill);
      } else {
        const cb = document.createElement("input");
        cb.type = "checkbox";
        const cellStr = JSON.stringify([...ctx.collPath, m.key, field]);
        const covered = findColumnWildcard(selections, ctx.collPath, field);
        cb.checked = covered || concreteSet.has(cellStr);
        if (covered && !concreteSet.has(cellStr)) cb.classList.add("image-st-mvu-matrix-covered");
        cb.title = covered ? "通配覆盖中：点击可炸开为具体选择并排除本成员" : "";
        cb.addEventListener("change", () => toggleMatrixCell(ctx, m.key, field));
        td.appendChild(cb);
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  ctx.container.appendChild(table);
}

function renderMvuNode(node: MvuTreeBranch, refs: MvuCheckboxRef[]): HTMLElement {
  const universe = collectUniverse(node);

  if (node.type === 'leaf') {
    const el = document.createElement("div");
    el.className = "image-st-tree-leaf";
    el.setAttribute("data-path", JSON.stringify(node.path));

    const cbLabel = document.createElement("label");
    cbLabel.className = "checkbox_label";
    cbLabel.appendChild(createMvuNodeCheckbox(node, universe, refs));
    const statData = getMvuData();
    const val = statData ? resolveObjectPath(statData, node.path) : "";
    const span = document.createElement("span");
    span.textContent = ` ${node.key}: ${val ?? ""}`;
    cbLabel.appendChild(span);
    el.appendChild(cbLabel);
    el.appendChild(createPathCopyBtn(node.path));
    return el;
  }

  const wrapper = document.createElement("div");

  const header = document.createElement("div");
  header.className = "image-st-tree-branch";
  header.setAttribute("data-path", JSON.stringify(node.path));

  const toggle = document.createElement("span");
  toggle.className = "image-st-tree-toggle";
  toggle.textContent = "▶";
  header.appendChild(toggle);

  const cbLabel = document.createElement("label");
  cbLabel.className = "checkbox_label";
  cbLabel.appendChild(createMvuNodeCheckbox(node, universe, refs));
  const span = document.createElement("span");
  span.textContent = ` ${node.key}`;
  cbLabel.appendChild(span);
  header.appendChild(cbLabel);
  header.appendChild(createPathCopyBtn(node.path));

  // P2: 集合节点提供字段矩阵入口；空集合显示占位徽标（R3）
  const collMembers = getCollectionMembers(node);
  let matrixBtn: HTMLSpanElement | null = null;
  if (collMembers.length > 0) {
    matrixBtn = document.createElement("span");
    matrixBtn.className = "image-st-tree-matrix-btn";
    matrixBtn.title = "字段矩阵视图（按字段批量勾选所有成员）";
    matrixBtn.innerHTML = '<i class="fa-solid fa-table-cells"></i>';
    header.appendChild(matrixBtn);
  } else if (node.children.length === 0) {
    span.textContent = ` ${node.key} （空）`;
  }

  wrapper.appendChild(header);

  if (node.children.length > 0) {
    const childrenContainer = document.createElement("div");
    childrenContainer.className = "image-st-tree-children";
    for (const child of node.children) {
      childrenContainer.appendChild(renderMvuNode(child, refs));
    }

    let matrixContainer: HTMLElement | null = null;
    let matrixMode = false;
    if (matrixBtn) {
      matrixContainer = document.createElement("div");
      matrixContainer.className = "image-st-mvu-matrix-container";
      const fieldKind = new Map<string, 'leaf' | 'object'>();
      for (const m of collMembers) {
        for (const c of m.children) {
          const kind = c.type === 'branch' ? 'object' : 'leaf';
          if (!fieldKind.has(c.key) || kind === 'object') fieldKind.set(c.key, kind);
        }
      }
      const matrixCtx: MvuMatrixContext = {
        node,
        collPath: node.path,
        members: collMembers,
        fields: Array.from(fieldKind.keys()),
        fieldKind,
        container: matrixContainer,
        refresh: () => { renderMvuMatrix(matrixCtx); refreshAllCheckboxStates(refs); },
      };
      renderMvuMatrix(matrixCtx);
      wrapper.appendChild(matrixContainer);
      const mxBtn = matrixBtn;
      const mxBox = matrixContainer;
      matrixBtn.addEventListener("click", () => {
        matrixMode = !matrixMode;
        mxBtn.classList.toggle("active", matrixMode);
        toggle.classList.add("expanded");
        if (matrixMode) {
          childrenContainer.classList.remove("show");
          mxBox.classList.add("show");
        } else {
          mxBox.classList.remove("show");
          childrenContainer.classList.add("show");
        }
      });
    }

    toggle.addEventListener("click", () => {
      const expanded = toggle.classList.toggle("expanded");
      if (!expanded) {
        childrenContainer.classList.remove("show");
        matrixContainer?.classList.remove("show");
        matrixBtn?.classList.remove("active");
        matrixMode = false;
      } else if (matrixMode && matrixContainer) {
        matrixContainer.classList.add("show");
      } else {
        childrenContainer.classList.add("show");
      }
    });
    wrapper.appendChild(childrenContainer);
  }

  return wrapper;
}

let lastTreeRefs: MvuCheckboxRef[] | null = null;

function renderMvuTree(tree: MvuTreeBranch[]): void {
  const container = document.getElementById("image_st_mvu_tree");
  if (!container) return;
  container.innerHTML = "";
  if (tree.length === 0) {
    lastTreeRefs = null;
    container.innerHTML = '<div class="image-st-hint-text">MVU 数据为空或未就绪（若未打开含 MVU 的角色聊天，请先打开聊天）</div>';
    return;
  }
  const refs: MvuCheckboxRef[] = [];
  for (const node of tree) {
    container.appendChild(renderMvuNode(node, refs));
  }
  lastTreeRefs = refs;
  refreshAllCheckboxStates(refs);
  // 自动展开到含已选项的分支
  const selSet = getConcreteSelectionSet();
  container.querySelectorAll(".image-st-tree-branch").forEach(el => {
    const dp = el.getAttribute("data-path");
    if (!dp) return;
    let arr: string[];
    try { arr = JSON.parse(dp) as string[]; } catch { return; }
    const hit = [...selSet].some(p => {
      try {
        const a = JSON.parse(p) as string[];
        return arr.length <= a.length && arr.every((seg, i) => a[i] === seg);
      } catch { return false; }
    });
    if (hit) {
      const cc = el.parentElement?.querySelector(":scope > .image-st-tree-children");
      cc?.classList.add("show");
      el.querySelector(":scope > .image-st-tree-toggle")?.classList.add("expanded");
    }
  });
}

// ============================================================
// MVU Panel Extras (v1.3 P3: 状态汇总 / 已选清单 / 失效检测 / 搜索)
// ============================================================

/** 失效判定：展开零产出即失效（空对象也会展开为零产出，不再豁免） */
function computeInvalidSelections(): MvuSelection[] {
  const statData = getMvuData();
  if (!statData) return [];
  const selections = migrateMvuPaths(extension_settings[SETTINGS_KEY]);
  return selections.filter(sel => {
    if (expandSelection(sel).length > 0) return false;
    for (let i = sel.path.length - 1; i >= 1; i--) {
      const prefixVal = resolveObjectPath(statData, sel.path.slice(0, i));
      if (prefixVal !== undefined) return true;
    }
    return true;
  });
}

function updateMvuStatusSummary(): void {
  const statusEl = document.getElementById("image_st_mvu_status");
  const foldStatusEl = document.getElementById("image_st_mvu_fold_status");
  if (!statusEl) return;
  const s = extension_settings[SETTINGS_KEY];
  if (!s?.mvu_enabled) {
    statusEl.textContent = "MVU 状态：未启用";
    if (foldStatusEl) { foldStatusEl.textContent = "未启用"; foldStatusEl.title = ""; }
    return;
  }
  if (!isMvuAvailable()) {
    statusEl.textContent = "MVU 状态：不可用（MVU 框架未加载——请确认已打开含 MVU 的角色聊天）";
    if (foldStatusEl) { foldStatusEl.textContent = "不可用"; foldStatusEl.title = statusEl.textContent; }
    return;
  }
  const st = getMvuStatus();
  const selections = migrateMvuPaths(s);
  const wildCount = selections.filter(sel => sel.path.includes(MVU_WILDCARD)).length;
  const invalidCount = computeInvalidSelections().length;
  let text = `MVU 状态：已就绪 (${st.size} B${st.source && st.source !== 'latest' ? `, 数据来自 ${st.source}` : ''}) · 已选 ${selections.length} 项`;
  if (wildCount > 0) text += `（含 ${wildCount} 条通配）`;
  if (invalidCount > 0) text += ` · 失效 ${invalidCount} 条`;
  statusEl.textContent = text;
  if (foldStatusEl) {
    const short = invalidCount > 0 ? `⚠ 已选 ${selections.length}` : `已选 ${selections.length}`;
    foldStatusEl.textContent = `✓ ${short}`;
    foldStatusEl.title = text;
  }
}

function updateMvuInvalidBar(): void {
  const bar = document.getElementById("image_st_mvu_invalid");
  const textEl = document.getElementById("image_st_mvu_invalid_text");
  if (!bar || !textEl) return;
  const invalid = isMvuAvailable() ? computeInvalidSelections() : [];
  if (invalid.length === 0) {
    bar.style.display = "none";
    return;
  }
  bar.style.display = "";
  textEl.textContent = `⚠ ${invalid.length} 条已选在当前卡的变量结构中不存在`;
}

function locateInTree(path: string[]): void {
  const tree = document.getElementById("image_st_mvu_tree");
  if (!tree) return;
  const concrete = path.filter(seg => seg !== MVU_WILDCARD);
  let target: HTMLElement | null = null;
  for (let len = concrete.length; len >= 1; len--) {
    const p = JSON.stringify(concrete.slice(0, len));
    target = tree.querySelector(`[data-path='${p}']`);
    if (target) break;
  }
  if (!target) {
    toastr.info("该路径在当前变量树中不存在（可能已失效）", "ST Image Plugin", { timeOut: 3000 });
    return;
  }
  // 展开祖先
  let node: HTMLElement | null = target.parentElement;
  while (node && node.id !== "image_st_mvu_tree") {
    if (node.classList.contains("image-st-tree-children")) {
      node.classList.add("show");
      const headerToggle = node.parentElement?.querySelector(":scope > .image-st-tree-branch .image-st-tree-toggle");
      headerToggle?.classList.add("expanded");
    }
    node = node.parentElement;
  }
  target.scrollIntoView({ block: "center", behavior: "smooth" });
  target.classList.add("image-st-search-hit");
  const t = target;
  setTimeout(() => t.classList.remove("image-st-search-hit"), 1600);
}

function renderMvuSelectedChips(): void {
  const box = document.getElementById("image_st_mvu_selected");
  if (!box) return;
  box.innerHTML = "";
  const s = extension_settings[SETTINGS_KEY];
  const selections = migrateMvuPaths(s);
  if (selections.length === 0) return;
  const invalidSet = new Set(computeInvalidSelections().map(sel => JSON.stringify(sel.path)));

  const clearAll = document.createElement("span");
  clearAll.className = "image-st-mvu-chip image-st-mvu-chip-clear";
  clearAll.textContent = "清空全部";
  clearAll.title = `清除全部 ${selections.length} 条已选`;
  clearAll.addEventListener("click", () => {
    if (confirm(`确定清除全部 ${selections.length} 条已选？`)) {
      s.mvu_selections = [];
      saveSettingsDebounced();
      refreshMvuPanelExtras();
      if (lastTreeRefs) refreshAllCheckboxStates(lastTreeRefs);
    }
  });
  box.appendChild(clearAll);

  selections.forEach((sel, idx) => {
    const chip = document.createElement("span");
    const isWild = sel.path.includes(MVU_WILDCARD);
    chip.className = "image-st-mvu-chip" + (isWild ? " image-st-mvu-chip-wild" : "");
    if (invalidSet.has(JSON.stringify(sel.path))) chip.classList.add("image-st-mvu-chip-invalid");
    const label = sel.path.join(".");
    const nsDesc = sel.nameSegment === null ? "命中即注入" : `匹配名段: 第 ${sel.nameSegment + 1} 段`;
    chip.title = `${label}（${nsDesc}）`;

    const loc = document.createElement("i");
    loc.className = "fa-solid fa-crosshairs";
    loc.title = "在树中定位";
    loc.addEventListener("click", (e) => { e.stopPropagation(); locateInTree(sel.path); });

    const nsBtn = document.createElement("span");
    nsBtn.className = "image-st-mvu-chip-ns";
    nsBtn.textContent = sel.nameSegment === null ? "∅" : `#${sel.nameSegment + 1}`;
    nsBtn.title = `${nsDesc}（点击循环切换）`;
    nsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const cur = sel.nameSegment === null ? -1 : sel.nameSegment;
      const next = cur + 1 >= sel.path.length ? -1 : cur + 1;
      sel.nameSegment = next < 0 ? null : next;
      saveSettingsDebounced();
      refreshMvuPanelExtras();
    });

    const rm = document.createElement("i");
    rm.className = "fa-solid fa-xmark";
    rm.title = "移除";
    rm.addEventListener("click", (e) => {
      e.stopPropagation();
      s.mvu_selections = migrateMvuPaths(s).filter((_, i) => i !== idx);
      saveSettingsDebounced();
      refreshMvuPanelExtras();
      if (lastTreeRefs) refreshAllCheckboxStates(lastTreeRefs);
    });

    chip.appendChild(loc);
    chip.appendChild(document.createTextNode(` ${label} `));
    chip.appendChild(nsBtn);
    chip.appendChild(rm);
    box.appendChild(chip);
  });
}

function refreshMvuPanelExtras(): void {
  updateMvuStatusSummary();
  updateMvuInvalidBar();
  renderMvuSelectedChips();
}

function setupMvuSearch(): void {
  const input = document.getElementById("image_st_mvu_search") as HTMLInputElement | null;
  if (!input) return;
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    const tree = document.getElementById("image_st_mvu_tree");
    if (!tree) return;
    // 清理上次搜索状态
    tree.querySelectorAll(".image-st-search-hide").forEach(el => el.classList.remove("image-st-search-hide"));
    tree.querySelectorAll(".image-st-search-hit").forEach(el => el.classList.remove("image-st-search-hit"));
    tree.querySelectorAll(".image-st-search-show").forEach(el => {
      el.classList.remove("image-st-search-show");
      el.classList.remove("show");
    });
    if (!q) return;
    const rows = Array.from(tree.querySelectorAll(".image-st-tree-branch, .image-st-tree-leaf")) as HTMLElement[];
    const matchSelf = (r: HTMLElement): boolean => {
      const dp = r.getAttribute("data-path");
      if (!dp) return false;
      try {
        const arr = JSON.parse(dp) as string[];
        return String(arr[arr.length - 1]).toLowerCase().includes(q);
      } catch { return false; }
    };
    const hits = rows.filter(matchSelf);
    const visible = new Set<HTMLElement>(hits);
    for (const h of hits) {
      let p = h.parentElement;
      while (p && p !== tree) {
        if (p.classList.contains("image-st-tree-children")) {
          p.classList.add("show");
          p.classList.add("image-st-search-show");
          const header = p.parentElement?.querySelector(":scope > .image-st-tree-branch") as HTMLElement | null;
          if (header) {
            visible.add(header);
            header.querySelector(":scope > .image-st-tree-toggle")?.classList.add("expanded");
          }
        }
        p = p.parentElement;
      }
    }
    rows.forEach(r => { if (!visible.has(r)) r.classList.add("image-st-search-hide"); });
    hits.forEach(h => h.classList.add("image-st-search-hit"));
  });
}

function setAllTreeExpanded(expanded: boolean): void {
  const tree = document.getElementById("image_st_mvu_tree");
  if (!tree) return;
  tree.querySelectorAll(".image-st-tree-children").forEach(el => el.classList.toggle("show", expanded));
  tree.querySelectorAll(".image-st-tree-toggle").forEach(el => el.classList.toggle("expanded", expanded));
}

// ============================================================
// Database Table Tree Builder (对标 MVU 三态树)
// ============================================================

interface DbCheckboxRef {
  el: HTMLInputElement;
  universe: string[];
}

function collectDbUniverse(sheetKey: string, fields: string[]): string[] {
  return fields.map(f => JSON.stringify([sheetKey, f]));
}

function getDbSelectionSet(): Set<string> {
  const selections = getDbSelections();
  const result = new Set<string>();
  for (const sel of selections) {
    for (const field of sel.fields) {
      result.add(JSON.stringify([sel.sheetKey, field]));
    }
  }
  return result;
}

function refreshDbCheckboxStates(refs: DbCheckboxRef[]): void {
  const selSet = getDbSelectionSet();
  for (const ref of refs) {
    let count = 0;
    for (const p of ref.universe) if (selSet.has(p)) count++;
    ref.el.checked = count === ref.universe.length && ref.universe.length > 0;
    ref.el.indeterminate = count > 0 && count < ref.universe.length;
  }
  refreshDbPanelExtras();
}

function createDbTableCheckbox(table: DbTableInfo, universe: string[], refs: DbCheckboxRef[]): HTMLInputElement {
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.addEventListener("change", () => {
    const s = extension_settings[SETTINGS_KEY];
    const selections = getDbSelections();
    const selSet = getDbSelectionSet();
    const allSelected = universe.every(p => selSet.has(p));
    if (allSelected) {
      // 全选→取消该表全部字段
      const uniSet = new Set(universe);
      s.db_selection = selections.filter(sel => {
        if (sel.sheetKey !== table.key) return true;
        return !sel.fields.some(f => uniSet.has(JSON.stringify([table.key, f])));
      }).filter(sel => sel.fields.length > 0);
    } else {
      // 未全选→补齐该表全部字段
      const others = selections.filter(sel => sel.sheetKey !== table.key);
      s.db_selection = [...others, { sheetKey: table.key, fields: [...table.fields] }];
    }
    saveSettingsDebounced();
    refreshDbCheckboxStates(refs);
  });
  refs.push({ el: cb, universe });
  return cb;
}

function renderDbTableNode(table: DbTableInfo, refs: DbCheckboxRef[]): HTMLElement {
  const universe = collectDbUniverse(table.key, table.fields);
  const wrapper = document.createElement("div");

  // --- 表 header（分支节点）---
  const header = document.createElement("div");
  header.className = "image-st-tree-branch";
  header.setAttribute("data-db-sheet", table.key);

  const toggle = document.createElement("span");
  toggle.className = "image-st-tree-toggle";
  toggle.textContent = "▶";
  header.appendChild(toggle);

  const cbLabel = document.createElement("label");
  cbLabel.className = "checkbox_label";
  cbLabel.appendChild(createDbTableCheckbox(table, universe, refs));
  const span = document.createElement("span");
  span.textContent = ` ${table.name} (${table.fields.length} 字段)`;
  cbLabel.appendChild(span);
  header.appendChild(cbLabel);

  wrapper.appendChild(header);

  // --- 字段列表（叶子节点）---
  if (table.fields.length > 0) {
    const childrenContainer = document.createElement("div");
    childrenContainer.className = "image-st-tree-children";

    for (const field of table.fields) {
      const leaf = document.createElement("div");
      leaf.className = "image-st-tree-leaf";
      leaf.setAttribute("data-db-field", field);
      leaf.setAttribute("data-db-sheet", table.key);

      const fieldCb = document.createElement("input");
      fieldCb.type = "checkbox";
      fieldCb.addEventListener("change", () => {
        const s = extension_settings[SETTINGS_KEY];
        const selections = getDbSelections();
        const existing = selections.find(sel => sel.sheetKey === table.key);
        if (fieldCb.checked) {
          if (existing) {
            if (!existing.fields.includes(field)) existing.fields.push(field);
          } else {
            selections.push({ sheetKey: table.key, fields: [field] });
            s.db_selection = selections;
          }
        } else {
          if (existing) {
            existing.fields = existing.fields.filter(f => f !== field);
            if (existing.fields.length === 0) {
              s.db_selection = selections.filter(sel => sel.sheetKey !== table.key);
            }
          }
        }
        saveSettingsDebounced();
        refreshDbCheckboxStates(refs);
      });

      leaf.appendChild(fieldCb);
      refs.push({ el: fieldCb, universe: [JSON.stringify([table.key, field])] });
      const fieldSpan = document.createElement("span");
      fieldSpan.textContent = ` ${field}`;
      leaf.appendChild(fieldSpan);
      childrenContainer.appendChild(leaf);
    }

    // 展开/收起
    toggle.addEventListener("click", () => {
      const expanded = toggle.classList.toggle("expanded");
      childrenContainer.classList.toggle("show", expanded);
    });

    wrapper.appendChild(childrenContainer);
  }

  return wrapper;
}

let lastDbTreeRefs: DbCheckboxRef[] | null = null;

function rebuildDatabaseTableTree() {
  const treeEl = document.getElementById("image_st_db_tree");
  if (!treeEl) return;
  const tables = scanDatabaseTables();
  if (tables.length === 0) {
    lastDbTreeRefs = null;
    treeEl.innerHTML = '<div class="image-st-hint-text">未找到数据库表格（数据库插件可能未就绪或当前聊天无数据）</div>';
    return;
  }
  const refs: DbCheckboxRef[] = [];
  treeEl.innerHTML = "";
  for (const table of tables) {
    treeEl.appendChild(renderDbTableNode(table, refs));
  }
  lastDbTreeRefs = refs;
  refreshDbCheckboxStates(refs);
}

// ============================================================
// Database Panel Extras (状态汇总 / 已选 Chip / 搜索 / 失效)
// ============================================================

function renderDbSelectedChips(): void {
  const box = document.getElementById("image_st_db_selected");
  if (!box) return;
  box.innerHTML = "";
  const s = extension_settings[SETTINGS_KEY];
  const selections = getDbSelections();
  if (selections.length === 0) return;
  const tables = scanDatabaseTables();
  const nameMap = new Map(tables.map(t => [t.key, t.name]));

  const clearAll = document.createElement("span");
  clearAll.className = "image-st-mvu-chip image-st-mvu-chip-clear";
  clearAll.textContent = "清空全部";
  clearAll.title = `清除全部 ${selections.length} 表已选`;
  clearAll.addEventListener("click", () => {
    if (confirm(`确定清除全部 ${selections.length} 个表的字段选择？`)) {
      s.db_selection = [];
      saveSettingsDebounced();
      refreshDbPanelExtras();
      if (lastDbTreeRefs) refreshDbCheckboxStates(lastDbTreeRefs);
    }
  });
  box.appendChild(clearAll);

  selections.forEach(sel => {
    const chip = document.createElement("span");
    chip.className = "image-st-mvu-chip";
    const label = `${nameMap.get(sel.sheetKey) ?? sel.sheetKey} (${sel.fields.length} 字段)`;
    chip.title = label;

    const rm = document.createElement("i");
    rm.className = "fa-solid fa-xmark";
    rm.title = "移除该表选择";
    rm.addEventListener("click", () => {
      s.db_selection = getDbSelections().filter(s2 => s2.sheetKey !== sel.sheetKey);
      saveSettingsDebounced();
      refreshDbPanelExtras();
      if (lastDbTreeRefs) refreshDbCheckboxStates(lastDbTreeRefs);
    });

    chip.appendChild(document.createTextNode(` ${label} `));
    chip.appendChild(rm);
    box.appendChild(chip);
  });
}

function refreshDbPanelExtras(): void {
  updateDbStatusSummary();
  renderDbSelectedChips();
}

// ============================================================
// 柏宝书（ST-BaiBai-Book）面板 v2.1
// 三组勾选树：角色（按在场分档）/ 场景（按地点链）/ 物品（按可达性）
// 交互形态对齐 MVU 与「神·数据库」面板：分组标题 → 条目分支（三态 checkbox）→ 字段叶子
// 只读公开 API；不使用柏宝书自定义变量系统（vars）
// ============================================================

type BbsKind = "role" | "scene" | "item";

interface BbsCheckboxRef {
    el: HTMLInputElement;
    kind: BbsKind;
    key: string;
    /** 条目字段全集（分组级 checkbox 以此判定三态） */
    fields: string[];
    /** 分组级引用：null 表示条目级 */
    group?: BbsTreeGroup;
}

function bbsSelectionMap(kind: BbsKind): Record<string, string[]> {
    const sel = getBbsSelection();
    return kind === "role" ? sel.roles : kind === "scene" ? sel.scenes : sel.items;
}

function bbsStoreSelection(kind: BbsKind, key: string, fields: string[]): void {
    const s = extension_settings[SETTINGS_KEY];
    const sel = getBbsSelection();
    const map = kind === "role" ? sel.roles : kind === "scene" ? sel.scenes : sel.items;
    const next: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(map)) {
        if (k === key) continue;
        next[k] = v;
    }
    if (fields.length > 0) next[key] = fields;
    if (kind === "role") sel.roles = next;
    else if (kind === "scene") sel.scenes = next;
    else sel.items = next;
    s.bbs_selection = { roles: sel.roles, scenes: sel.scenes, items: sel.items };
    saveSettingsDebounced();
}

/** 某条目的已勾选字段（仅显式勾选） */
function bbsSelectedFields(kind: BbsKind, key: string): string[] {
    return getSelectedFields(bbsSelectionMap(kind), key);
}

function bbsRefreshCheckboxStates(refs: BbsCheckboxRef[]): void {
    for (const ref of refs) {
        let count = 0;
        let universe = ref.fields;
        if (ref.group) {
            // 分组级：三态由组内所有条目的勾选情况决定
            universe = [];
            for (const node of ref.group.nodes) {
                for (const f of node.fields) universe.push(`${node.key}::${f.key}`);
            }
            count = universe.filter(u => {
                const [key, fkey] = u.split("::");
                return bbsSelectedFields(ref.kind, key).includes(fkey);
            }).length;
        } else {
            const selected = new Set(bbsSelectedFields(ref.kind, ref.key));
            count = ref.fields.filter(f => selected.has(f)).length;
        }
        ref.el.checked = universe.length > 0 && count === universe.length;
        ref.el.indeterminate = count > 0 && count < universe.length;
    }
    renderBbsSelectedChips();
}

/** 条目节点：标题 checkbox（全选/全不选该条目的所有字段）+ 字段子叶 */
function renderBbsNode(node: BbsTreeNode, refs: BbsCheckboxRef[]): HTMLElement {
    const wrapper = document.createElement("div");

    const header = document.createElement("div");
    header.className = "image-st-tree-branch";
    header.setAttribute("data-bbs-key", node.key);
    header.setAttribute("data-bbs-search", `${node.label} ${node.hint ?? ""}`);

    const toggle = document.createElement("span");
    toggle.className = "image-st-tree-toggle";
    toggle.textContent = "▶";
    header.appendChild(toggle);

    const cbLabel = document.createElement("label");
    cbLabel.className = "checkbox_label";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.addEventListener("change", () => {
        bbsStoreSelection(node.kind, node.key, cb.checked ? node.fields.map(f => f.key) : []);
        bbsRefreshCheckboxStates(refs);
    });
    cbLabel.appendChild(cb);
    const span = document.createElement("span");
    span.textContent = ` ${node.label} (${node.fields.length} 字段)${node.hint ? ` — ${node.hint}` : ""}`;
    cbLabel.appendChild(span);
    header.appendChild(cbLabel);
    wrapper.appendChild(header);

    refs.push({ el: cb, kind: node.kind, key: node.key, fields: node.fields.map(f => f.key) });

    const children = document.createElement("div");
    children.className = "image-st-tree-children";
    for (const field of node.fields) {
        const leaf = document.createElement("div");
        leaf.className = "image-st-tree-leaf";
        leaf.setAttribute("data-bbs-key", node.key);
        leaf.setAttribute("data-bbs-search", `${node.label} ${field.label}`);
        const leafCb = document.createElement("input");
        leafCb.type = "checkbox";
        leafCb.addEventListener("change", () => {
            const selected = new Set(bbsSelectedFields(node.kind, node.key));
            if (leafCb.checked) selected.add(field.key); else selected.delete(field.key);
            bbsStoreSelection(node.kind, node.key, [...selected]);
            bbsRefreshCheckboxStates(refs);
        });
        leaf.appendChild(leafCb);
        const leafSpan = document.createElement("span");
        leafSpan.textContent = ` ${field.label}`;
        leaf.appendChild(leafSpan);
        children.appendChild(leaf);
    }

    toggle.addEventListener("click", () => {
        const expanded = toggle.classList.toggle("expanded");
        children.classList.toggle("show", expanded);
    });
    wrapper.appendChild(children);
    return wrapper;
}

/** 分档分组（主要角色 / 在场 / 当前地点 …）：分组 checkbox 一键选/清组内所有字段 */
function renderBbsGroup(group: BbsTreeGroup, kind: BbsKind, refs: BbsCheckboxRef[]): HTMLElement {
    const wrapper = document.createElement("div");

    const header = document.createElement("div");
    header.className = "image-st-tree-branch";
    header.setAttribute("data-bbs-group", group.id);

    const toggle = document.createElement("span");
    toggle.className = "image-st-tree-toggle";
    toggle.textContent = "▶";
    header.appendChild(toggle);

    const cbLabel = document.createElement("label");
    cbLabel.className = "checkbox_label";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.addEventListener("change", () => {
        const all = cb.checked;
        for (const node of group.nodes) {
            bbsStoreSelection(kind, node.key, all ? node.fields.map(f => f.key) : []);
        }
        bbsRefreshCheckboxStates(refs);
    });
    cbLabel.appendChild(cb);
    const span = document.createElement("span");
    const notes: string[] = [];
    if (!group.included) notes.push("默认不注入");
    if (group.note) notes.push(group.note);
    span.textContent = ` ${group.label} (${group.nodes.length})${notes.length ? ` · ${notes.join(" · ")}` : ""}`;
    cbLabel.appendChild(span);
    header.appendChild(cbLabel);

    refs.push({ el: cb, kind, key: group.id, fields: [], group });

    wrapper.appendChild(header);

    const children = document.createElement("div");
    children.className = "image-st-tree-children";
    for (const node of group.nodes) {
        children.appendChild(renderBbsNode(node, refs));
    }
    toggle.addEventListener("click", () => {
        const expanded = toggle.classList.toggle("expanded");
        children.classList.toggle("show", expanded);
    });
    wrapper.appendChild(children);
    return wrapper;
}

/** 分组小节标题（角色 / 场景 / 物品） */
function renderBbsSectionTitle(title: string, count: number): HTMLElement {
    const el = document.createElement("div");
    el.className = "image-st-hint-text";
    el.style.cssText = "margin:6px 0 2px;font-weight:600;opacity:0.9;";
    el.textContent = `${title}（${count}）`;
    return el;
}

function rebuildBaibaiTree(): void {
    const container = document.getElementById("image_st_bbs_tree");
    if (!container) return;
    container.innerHTML = "";
    const refs: BbsCheckboxRef[] = [];
    const tree = buildBaibaiTree();
    if (!tree.roles.length && !tree.scenes.length && !tree.items.length) {
        container.innerHTML = '<div class="image-st-hint-text">未读取到柏宝书数据（点击「读取名册」，或确认已安装柏宝书插件并打开聊天）</div>';
        renderBbsSelectedChips();
        return;
    }
    const renderGroups = (groups: BbsTreeGroup[], kind: BbsKind) => {
        for (const group of groups) {
            container.appendChild(renderBbsGroup(group, kind, refs));
        }
    };
    if (tree.roles.length) {
        container.appendChild(renderBbsSectionTitle("角色", tree.roles.reduce((n, g) => n + g.nodes.length, 0)));
        renderGroups(tree.roles, "role");
    }
    if (tree.scenes.length) {
        container.appendChild(renderBbsSectionTitle("场景", tree.scenes.reduce((n, g) => n + g.nodes.length, 0)));
        renderGroups(tree.scenes, "scene");
    }
    if (tree.items.length) {
        container.appendChild(renderBbsSectionTitle("物品", tree.items.reduce((n, g) => n + g.nodes.length, 0)));
        renderGroups(tree.items, "item");
    }
    bbsRefreshCheckboxStates(refs);
    // 自动展开到含已选项的分支（与 MVU 面板一致）
    const sel = getBbsSelection();
    for (const [kind, map] of [["role", sel.roles], ["scene", sel.scenes], ["item", sel.items]] as Array<[BbsKind, Record<string, string[]>]>) {
        void kind;
        for (const [key, fields] of Object.entries(map)) {
            if (!fields?.length) continue;
            container.querySelectorAll<HTMLElement>(`[data-bbs-key="${cssEscape(key)}"]`).forEach(el => {
                const parent = el.parentElement;
                const cc = parent?.querySelector(":scope > .image-st-tree-children");
                cc?.classList.add("show");
                el.querySelector(":scope > .image-st-tree-toggle")?.classList.add("expanded");
            });
        }
    }
}

/** CSS 属性选择器转义（键可能含中文/引号） */
function cssEscape(value: string): string {
    return String(value).replace(/["\\]/g, "\\$&");
}

function updateBbsStatusSummary(): void {
    const statusEl = document.getElementById("image_st_bbs_status");
    const foldStatusEl = document.getElementById("image_st_bbs_fold_status");
    const s = extension_settings[SETTINGS_KEY];
    const enabled = s?.bbs_enabled ?? false;
    if (!statusEl) return;
    if (!enabled) {
        statusEl.textContent = "柏宝书状态：未启用";
        if (foldStatusEl) { foldStatusEl.textContent = "未启用"; foldStatusEl.title = ""; }
        return;
    }
    const st = getBaibaiStatus();
    if (!st.available) {
        statusEl.textContent = "柏宝书状态：不可用（未检测到插件或当前聊天无记忆数据）";
        if (foldStatusEl) { foldStatusEl.textContent = "不可用"; foldStatusEl.title = statusEl.textContent; }
        return;
    }
    const sel = getBbsSelection();
    const entries = Object.values(sel.roles).concat(Object.values(sel.scenes), Object.values(sel.items))
        .filter(f => Array.isArray(f) && f.length > 0);
    const entryCount = Object.keys(sel.roles).filter(k => sel.roles[k]?.length).length
        + Object.keys(sel.scenes).filter(k => sel.scenes[k]?.length).length
        + Object.keys(sel.items).filter(k => sel.items[k]?.length).length;
    const fieldCount = entries.reduce((n, f) => n + f.length, 0);
    const cov = st.coverage === false ? ` · 摘要缺口 ${st.missing} 楼` : "";
    const full = `柏宝书状态：已就绪 (${st.characters} 角色 / ${st.scenes} 地点 / ${st.items} 物品) · 已选 ${entryCount} 条 / ${fieldCount} 字段${cov}`;
    statusEl.textContent = full;
    if (foldStatusEl) {
        foldStatusEl.textContent = `✓ ${entryCount} 条 / ${fieldCount} 字段`;
        foldStatusEl.title = full;
    }
}

/** 已选条目 chips（与数据库面板一致：条目 chip + × 移除 + 清空全部） */
function renderBbsSelectedChips(): void {
    const box = document.getElementById("image_st_bbs_selected");
    if (!box) return;
    box.innerHTML = "";
    const s = extension_settings[SETTINGS_KEY];
    const sel = getBbsSelection();
    const kinds: Array<[BbsKind, string, Record<string, string[]>]> = [
        ["role", "角色", sel.roles],
        ["scene", "场景", sel.scenes],
        ["item", "物品", sel.items],
    ];
    const total = kinds.reduce((n, [, , map]) =>
        n + Object.keys(map).filter(k => map[k]?.length).length, 0);
    if (total === 0) {
        const hint = document.createElement("span");
        hint.className = "image-st-hint-text";
        hint.textContent = "未勾选字段 → 不注入任何柏宝书信息";
        box.appendChild(hint);
        return;
    }

    const clearAll = document.createElement("span");
    clearAll.className = "image-st-mvu-chip image-st-mvu-chip-clear";
    clearAll.textContent = "清空全部";
    clearAll.title = `清除全部 ${total} 个条目的字段选择`;
    clearAll.addEventListener("click", () => {
        if (!confirm(`确定清除全部 ${total} 个条目的字段选择？`)) return;
        s.bbs_selection = { roles: {}, scenes: {}, items: {} };
        saveSettingsDebounced();
        rebuildBaibaiTree();
        refreshBbsPanelExtras();
    });
    box.appendChild(clearAll);

    for (const [kind, label, map] of kinds) {
        for (const [key, fields] of Object.entries(map)) {
            if (!fields?.length) continue;
            const chip = document.createElement("span");
            chip.className = "image-st-mvu-chip";
            const text = `${label}·${key} (${fields.length})`;
            chip.title = text;
            const rm = document.createElement("i");
            rm.className = "fa-solid fa-xmark";
            rm.title = "移除该条目的字段选择";
            rm.addEventListener("click", () => {
                bbsStoreSelection(kind, key, []);
                rebuildBaibaiTree();
                refreshBbsPanelExtras();
            });
            chip.appendChild(document.createTextNode(` ${text} `));
            chip.appendChild(rm);
            box.appendChild(chip);
        }
    }
}

/** 搜索过滤（与数据库面板同一套 class 机制：hide / hit / show） */
function setupBbsSearch(): void {
    const input = document.getElementById("image_st_bbs_search") as HTMLInputElement | null;
    const tree = document.getElementById("image_st_bbs_tree");
    if (!input || !tree) return;
    input.addEventListener("input", () => {
        const q = input.value.trim().toLowerCase();
        tree.querySelectorAll(".image-st-search-hide").forEach(el => el.classList.remove("image-st-search-hide"));
        tree.querySelectorAll(".image-st-search-hit").forEach(el => el.classList.remove("image-st-search-hit"));
        tree.querySelectorAll(".image-st-search-show").forEach(el => {
            el.classList.remove("image-st-search-show");
            el.classList.remove("show");
        });
        if (!q) return;
        const branches = Array.from(tree.querySelectorAll(".image-st-tree-branch")) as HTMLElement[];
        const leaves = Array.from(tree.querySelectorAll(".image-st-tree-leaf")) as HTMLElement[];
        const allItems = [...branches, ...leaves];
        const matchSelf = (el: HTMLElement): boolean => {
            const key = el.getAttribute("data-bbs-search") || "";
            return key.toLowerCase().includes(q);
        };
        const hits = allItems.filter(matchSelf);
        const visible = new Set<HTMLElement>(hits);
        for (const h of hits) {
            let parent = h.parentElement;
            while (parent && parent !== tree) {
                visible.add(parent as HTMLElement);
                parent = parent.parentElement;
            }
        }
        for (const el of allItems) {
            if (!visible.has(el)) el.classList.add("image-st-search-hide");
            else if (matchSelf(el)) el.classList.add("image-st-search-hit");
        }
        for (const el of visible) {
            if (el.classList.contains("image-st-tree-children")) {
                el.classList.add("image-st-search-show");
                el.classList.add("show");
            }
        }
    });
}

function setBbsTreeExpanded(expanded: boolean): void {
    const tree = document.getElementById("image_st_bbs_tree");
    if (!tree) return;
    tree.querySelectorAll<HTMLElement>(".image-st-tree-toggle").forEach(t => {
        t.classList.toggle("expanded", expanded);
    });
    tree.querySelectorAll<HTMLElement>(".image-st-tree-children").forEach(c => {
        c.classList.toggle("show", expanded);
    });
}

/** 一键按默认字段勾选（视觉相关字段），方便快速起步 */
function bbsSelectDefaults(): void {
    const tree = buildBaibaiTree();
    if (!tree.roles.length && !tree.scenes.length && !tree.items.length) {
        toastr.warning("请先读取柏宝书名册", "柏宝书");
        return;
    }
    const apply = (groups: BbsTreeGroup[], kind: BbsKind, defs: BbsFieldDef[]) => {
        const keys = defaultFieldKeys(defs);
        for (const group of groups) {
            for (const node of group.nodes) {
                const available = node.fields.filter(f => keys.includes(f.key)).map(f => f.key);
                if (available.length) bbsStoreSelection(kind, node.key, available);
            }
        }
    };
    apply(tree.roles, "role", BBS_ROLE_FIELDS);
    apply(tree.scenes, "scene", BBS_SCENE_FIELDS);
    apply(tree.items, "item", BBS_ITEM_FIELDS);
    rebuildBaibaiTree();
    refreshBbsPanelExtras();
}

/** 失效选择检测（条目在当前快照中已不存在） */
function updateBbsInvalidBar(): void {
    const bar = document.getElementById("image_st_bbs_invalid");
    const textEl = document.getElementById("image_st_bbs_invalid_text");
    if (!bar || !textEl) return;
    const stale = getBbsStaleSelections();
    if (stale.length === 0) {
        bar.style.display = "none";
        return;
    }
    bar.style.display = "";
    textEl.textContent = `${stale.length} 条已选条目在当前名册中不存在（角色改名 / 物品移除 / 场景树重建）：${stale.map((e: { key: string }) => e.key).join("、")}`;
}

async function handleBbsRefresh(): Promise<void> {
    const btn = document.getElementById("image_st_bbs_refresh") as HTMLButtonElement | null;
    const s = extension_settings[SETTINGS_KEY];
    if (!s.bbs_enabled) {
        toastr.warning("请先启用柏宝书角色库", "柏宝书");
        return;
    }
    if (btn) btn.disabled = true;
    try {
        const ok = await refreshBaibaiData();
        if (!ok) {
            const ready = await waitBaiBaiReady(3000);
            const ok2 = ready ? await refreshBaibaiData() : false;
            if (!ok2) {
                toastr.warning("未检测到柏宝书插件或当前聊天无记忆数据", "柏宝书");
            }
        }
        rebuildBaibaiTree();
        refreshBbsPanelExtras();
    } finally {
        if (btn) btn.disabled = false;
    }
}

function refreshBbsPanelExtras(): void {
    updateBbsStatusSummary();
    renderBbsSelectedChips();
    updateBbsInvalidBar();
}

// ============================================================
// v2.2 生成管线面板（独立 tab）
// ============================================================

/** 模块 id → 编辑器模板 id（编辑器就地挂在对应模块下方，同一功能的开关与编辑区在一起） */
const PIPELINE_EDITOR_TEMPLATES: Record<string, string> = {
    "pov.detect": "image_st_tpl_pov",
    "llm.extract": "image_st_tpl_extract",
    "tagtool.call": "image_st_tpl_tagtool",
    "fmt.weight": "image_st_tpl_weight",
    "fmt.budget": "image_st_tpl_budget",
    "llm.review": "image_st_tpl_review",
};

/** 标签工具状态文本（模块树重绘后回填，避免每次重绘都探测 MCP） */
let tagToolStatusText = "";

function renderPipelineModules(): void {
    const box = document.getElementById("image_st_pipeline_modules");
    if (!box) return;
    const s = extension_settings[SETTINGS_KEY];

    // 保存用户正在编辑的模板值（防止重建丢失）
    const saveEditorValues = (): Record<string, string> => {
        const ids = [
            "image_st_pov_triggers",
            "image_st_prompt_preset_active",
            "image_st_review_prompt_preset",
            "image_st_review_prompt_custom",
            "image_st_ext_weight_map",
            "image_st_budget_max",
            "image_st_tagtool_source",
            "image_st_tagtool_mcp_url",
            "image_st_tagtool_max_candidates",
            "image_st_tagtool_max_rounds",
        ];
        const values: Record<string, string> = {};
        for (const id of ids) {
            const el = box.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`#${id}`);
            if (el) values[id] = el.value;
        }
        return values;
    };
    const savedValues = saveEditorValues();

    box.innerHTML = "";
    const stages: PipelineStageId[] = [];
    for (const mod of PIPELINE_MODULES) {
        if (!stages.includes(mod.stage)) stages.push(mod.stage);
    }
    for (const stage of stages) {
        const mods = PIPELINE_MODULES.filter(m => m.stage === stage);
        const isInject = stage === "inject";
        const details = document.createElement("details");
        details.className = "image-st-pipeline-stage";
        if (isInject) details.open = true;
        const summary = document.createElement("summary");
        summary.className = "image-st-pipeline-stage-summary";
        const title = document.createElement("b");
        title.textContent = STAGE_LABEL[stage];
        summary.appendChild(title);
        const count = document.createElement("span");
        count.className = "image-st-hint-text";
        count.style.marginLeft = "auto";
        const onCount = mods.filter(m => isModuleActive(s, m.id)).length;
        count.textContent = `${onCount}/${mods.length} 激活`;
        summary.appendChild(count);
        details.appendChild(summary);

        const content = document.createElement("div");
        content.className = "image-st-pipeline-stage-content";

        for (const mod of mods) {
            const depsOk = moduleDepsSatisfied(s, mod.id);
            const status = mod.statusOnly ? getModuleStatus(s, mod.id) : null;
            const row = document.createElement("label");
            row.className = "checkbox_label";
            row.style.flexWrap = "wrap";
            if (status) {
                const badge = document.createElement("span");
                badge.className = `image-st-pipeline-status${status.active ? " on" : " off"}`;
                badge.textContent = status.active ? "已激活" : "未激活";
                row.appendChild(badge);
            } else {
                const cb = document.createElement("input");
                cb.type = "checkbox";
                cb.checked = isModuleEnabled(s, mod.id);
                cb.disabled = !depsOk;
                cb.addEventListener("change", () => {
                    setModuleEnabled(s, mod.id, cb.checked);
                    saveSettingsDebounced();
                    renderPipelineModules();
                });
                row.appendChild(cb);
            }
            const span = document.createElement("span");
            span.textContent = ` ${mod.label}${mod.destructive ? "（会删除内容）" : ""}`;
            row.appendChild(span);
            const hint = document.createElement("span");
            hint.className = "image-st-hint-text";
            hint.style.width = "100%";
            hint.textContent = status
                ? `${mod.desc} —— ${status.detail}（在「${status.panel}」tab 调整）`
                : (depsOk ? mod.desc : `${mod.desc}（依赖未启用：${(mod.requires ?? []).join("、")}）`);
            row.appendChild(hint);
            content.appendChild(row);

            const tplId = PIPELINE_EDITOR_TEMPLATES[mod.id];
            if (tplId) {
                const tpl = document.getElementById(tplId) as HTMLTemplateElement | null;
                if (tpl) content.appendChild(tpl.content.cloneNode(true));
            }
        }
        details.appendChild(content);
        box.appendChild(details);
    }
    const total = PIPELINE_MODULES.length;
    const on = PIPELINE_MODULES.filter(m => isModuleActive(s, m.id)).length;
    const counter = document.getElementById("image_st_pipeline_count");
    if (counter) counter.textContent = `${on}/${total} 模块激活`;
    hydratePipelineEditors(box);

    // 恢复用户正在编辑的值（优先于 settings，因为用户可能还没失焦保存）
    for (const [id, value] of Object.entries(savedValues)) {
        const el = box.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`#${id}`);
        if (el) el.value = value;
    }
}

/** 仅刷新管线模块的激活状态（不重建整个 UI，用于其它 tab 修改设置后同步） */
export function refreshPipelineModulesStatus(): void {
    const box = document.getElementById("image_st_pipeline_modules");
    if (!box) return;
    const s = extension_settings[SETTINGS_KEY];
    // 更新每个模块行的状态徽章
    for (const mod of PIPELINE_MODULES) {
        const row = box.querySelector(`label:has(span:contains("${mod.label}"))`) as HTMLElement | null;
        if (!row) continue;
        const badge = row.querySelector(".image-st-pipeline-status") as HTMLElement | null;
        if (!badge) continue;
        const active = isModuleActive(s, mod.id);
        if (mod.statusOnly) {
            badge.className = `image-st-pipeline-status${active ? " on" : " off"}`;
            badge.textContent = active ? "已激活" : "未激活";
            const hint = row.querySelector(".image-st-hint-text") as HTMLElement | null;
            if (hint) {
                const status = getModuleStatus(s, mod.id);
                hint.textContent = status
                    ? `${mod.desc} —— ${status.detail}（在「${status.panel}」tab 调整）`
                    : mod.desc;
            }
        } else {
            const cb = row.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
            if (cb) cb.checked = active;
        }
    }
    // 更新计数器
    const total = PIPELINE_MODULES.length;
    const on = PIPELINE_MODULES.filter(m => isModuleActive(s, m.id)).length;
    const counter = document.getElementById("image_st_pipeline_count");
    if (counter) counter.textContent = `${on}/${total} 模块激活`;
}

/** 把设置值回填到刚挂载的编辑器（模块树整体重绘后调用） */
function hydratePipelineEditors(box: HTMLElement): void {
    const s = extension_settings[SETTINGS_KEY];
    const setValue = (id: string, value: string) => {
        const el = box.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`#${id}`);
        if (el) el.value = value;
    };
    const setChecked = (id: string, value: boolean) => {
        const el = box.querySelector<HTMLInputElement>(`#${id}`);
        if (el) el.checked = value;
    };
    setValue("image_st_pov_triggers", String(s.pov_triggers ?? ""));
    // v2.6：四模式各一份可编辑预设（通过动态文本框显示当前模式对应的预设）
    const activeMode = String(s.extract_output_mode ?? "mixed");
    const presetMap: Record<string, string> = {
        tags: String(s.extract_preset_tags ?? ""),
        description: String(s.extract_preset_description ?? ""),
        mixed: String(s.extract_preset_mixed ?? ""),
        custom: String(s.extract_preset_custom ?? ""),
    };
    setValue("image_st_prompt_preset_active", presetMap[activeMode] ?? "");
    setValue("image_st_prompt_preset_active_mode", activeMode);
    setValue("image_st_review_prompt_preset", String(s.review_prompt_preset ?? ""));
    setValue("image_st_review_prompt_custom", String(s.review_prompt_custom ?? ""));
    setChecked("image_st_review_include_source", s.review_include_source === true);
    setChecked("image_st_review_keep_original", s.review_keep_original === true);
    setValue("image_st_tagtool_source", String(s.tagtool_source ?? "auto"));
    setValue("image_st_tagtool_mcp_url", String(s.tagtool_mcp_url ?? DEFAULT_MCP_URL));
    setValue("image_st_tagtool_max_candidates", String(s.tagtool_max_candidates ?? 12));
    setValue("image_st_tagtool_max_rounds", String(s.tagtool_max_rounds ?? 3));
    const wm = (s as Record<string, unknown>).ext_weight_map as Record<string, number> | undefined;
    setValue("image_st_ext_weight_map", wm && typeof wm === "object"
        ? Object.entries(wm).map(([k, v]) => `${k}=${v}`).join("\n")
        : "");
    setValue("image_st_budget_max", String(Number(s.budget_max ?? 25)));
    const tagStatus = box.querySelector<HTMLElement>("#image_st_tagtool_status");
    if (tagStatus && tagToolStatusText) tagStatus.textContent = tagToolStatusText;
    // POV 触发词说明：文案由规则表生成（与判定逻辑同源，避免两边说法不一致）
    const povHint = box.querySelector<HTMLElement>("#image_st_pov_triggers_hint");
    if (povHint) {
        const triggers = String(s.pov_triggers ?? "").split(/[,，\n]/).map(t => t.trim()).filter(Boolean);
        povHint.textContent = describePovTriggers(triggers).text;
    }

    // POV 测试按钮
    const povTestBtn = box.querySelector<HTMLButtonElement>("#image_st_test_pov");
    const povTestResult = box.querySelector<HTMLTextAreaElement>("#image_st_pov_test_result");
    if (povTestBtn && povTestResult) {
        povTestBtn.addEventListener("click", async () => {
            const context = getContext();
            const messages = context.chat ?? [];
            const s = extension_settings[SETTINGS_KEY];
            const config = getTextCleaningConfig(s);
            const processedText = processTextPipeline(messages, config);
            
            if (!processedText) {
                povTestResult.style.display = "";
                povTestResult.value = "无有效对话文本可测试";
                return;
            }
            
            // 收集角色信息（同 buildInjectionInput）
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
            }
            const charInfoText = charParts.join("\n\n");
            const triggers = String(s.pov_triggers ?? "").split(/[,，\n]/).map(t => t.trim()).filter(Boolean);
            
            const result = testPovDetection(processedText, charInfoText, triggers);
            
            povTestResult.style.display = "";
            const lines: string[] = [];
            lines.push(`=== POV 判定结果 ===`);
            lines.push(`判定: ${result.povInfo.verdict.toUpperCase()} (isPov: ${result.povInfo.isPov})`);
            lines.push(`叙述者: ${result.povInfo.narratorName || '(无)'}`);
            lines.push(`理由: ${result.povInfo.reason}`);
            lines.push(`第一人称计数: ${result.povInfo.firstPersonCount} (阈值: ${POV_TRIGGER_RULES.fallbackFirstPersonCount}), 第二人称计数: ${result.debug.secondPersonCount} (阈值: ${POV_TRIGGER_RULES.fallbackSecondPersonCount})`);
            lines.push(``);
            lines.push(`=== 触发词验证 ===`);
            lines.push(`有效触发词: ${result.debug.validTriggers.length ? result.debug.validTriggers.join(', ') : '(无)'}`);
            for (const inv of result.debug.invalidTriggers) {
                lines.push(`  ⚠ ${inv.raw}: ${inv.reason}`);
            }
            lines.push(``);
            lines.push(`=== 触发词匹配详情 ===`);
            for (const tm of result.debug.triggerMatches) {
                lines.push(`  「${tm.trigger}」: 在正文=${tm.inBody ? '是' : '否'}, 同句有第一/二人称=${tm.inSameSentence ? '是' : '否'}`);
            }
            lines.push(``);
            lines.push(`=== 包含第一/二人称的句子 (${result.debug.povSentences.length}) ===`);
            for (const sent of result.debug.povSentences.slice(0, 5)) {
                lines.push(`  ${sent}`);
            }
            if (result.debug.povSentences.length > 5) {
                lines.push(`  ... 共 ${result.debug.povSentences.length} 句`);
            }
            lines.push(``);
            lines.push(`=== 正文预览 (前500字) ===`);
            lines.push(processedText.slice(0, 500));
            
            povTestResult.value = lines.join('\n');
        });
    }
}

/** 渲染最近一次运行的管线诊断报告（生成管线 tab 内） */
export function showPipelineReports(reports: StageReport[] | null | undefined): void {
    const box = document.getElementById("image_st_pipeline_reports");
    if (!box) return;
    box.innerHTML = "";
    const list = Array.isArray(reports) ? reports : [];
    if (!list.length) {
        const empty = document.createElement("div");
        empty.className = "image-st-hint-text";
        empty.textContent = "尚无运行记录 —— 生成一次后这里会显示每个阶段的判定与告警。";
        box.appendChild(empty);
        return;
    }
    const table = document.createElement("div");
    table.className = "image-st-pipeline-reports";
    for (const r of list) {
        const row = document.createElement("div");
        row.className = "image-st-pipeline-report-row";
        const head = document.createElement("div");
        head.className = "image-st-pipeline-report-head";
        const name = document.createElement("span");
        name.textContent = `${r.label || r.id}`;
        head.appendChild(name);
        const flag = document.createElement("span");
        // 三态：已跳过（开关关）/ 未执行（开关开但本次无适用对象，如阶段7 无标签段）/ 已执行
        const skipped = !r.enabled;
        const notApplied = !skipped && r.applied === false;
        flag.className = `image-st-pipeline-status${skipped ? " off" : (notApplied ? " off" : " on")}`;
        flag.textContent = skipped ? "已跳过" : (notApplied ? "未执行" : "已执行");
        head.appendChild(flag);
        const size = document.createElement("span");
        size.className = "image-st-hint-text";
        size.textContent = r.unit === "chars" ? `${r.outLen} 字符` : `${r.inLen} → ${r.outLen} 条`;
        head.appendChild(size);
        row.appendChild(head);
        for (const w of r.warnings ?? []) {
            const warn = document.createElement("div");
            warn.className = "image-st-pipeline-report-warn";
            // Handle both string and PipelineWarning
            warn.textContent = typeof w === "string" ? w : w.message;
            row.appendChild(warn);
        }
        table.appendChild(row);
    }
    box.appendChild(table);
}

/** 权重映射文本 → { 标签: 权重 } */
function parseWeightMap(text: string): Record<string, number> {
    const map: Record<string, number> = {};
    for (const line of text.split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        const idx = t.lastIndexOf("=");
        if (idx <= 0) continue;
        const key = t.slice(0, idx).trim();
        const num = Number(t.slice(idx + 1).trim());
        if (!key || !Number.isFinite(num)) continue;
        map[key] = num;
    }
    return map;
}

/** 模块树 change 事件（委托绑定：模块树整体重绘，不会丢事件） */
function onPipelineControlChange(e: Event): void {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    const s = extension_settings[SETTINGS_KEY];
    const isChecked = () => (t as HTMLInputElement).checked === true;
    switch (t.id) {
        case "image_st_review_include_source": s.review_include_source = isChecked(); break;
        case "image_st_review_keep_original": s.review_keep_original = isChecked(); break;
        // v2.6：生成变体下拉（<select> 只会触发 change）
        case "image_st_gen_variants": {
            s.gen_variants = t.value.split(",").map(x => x.trim()).filter(Boolean);
            saveSettingsDebounced();
            return;
        }
        case "image_st_tagtool_source":
            s.tagtool_source = t.value;
            saveSettingsDebounced();
            void refreshTagToolStatus();
            return;
        case "image_st_tagtool_mcp_url":
            s.tagtool_mcp_url = t.value;
            saveSettingsDebounced();
            void refreshTagToolStatus();
            return;
        case "image_st_tagtool_max_candidates": s.tagtool_max_candidates = Number(t.value) || 12; break;
        case "image_st_tagtool_max_rounds": s.tagtool_max_rounds = Number(t.value) || 3; break;
        default: return;
    }
    saveSettingsDebounced();
}

/** 模块树 input 事件（文本框实时保存） */
function onPipelineControlInput(e: Event): void {
    const t = e.target as HTMLElement;
    if (!(t instanceof HTMLTextAreaElement) && !(t instanceof HTMLInputElement)) return;
    const s = extension_settings[SETTINGS_KEY];
    switch (t.id) {
        case "image_st_pov_triggers": {
            s.pov_triggers = t.value;
            // 说明文案由规则表生成 → 输入即刷新（哪些触发词被忽略、为什么）
            const hint = document.getElementById("image_st_pov_triggers_hint");
            if (hint) {
                const triggers = t.value.split(/[,，\n]/).map(x => x.trim()).filter(Boolean);
                hint.textContent = describePovTriggers(triggers).text;
            }
            break;
        }
        case "image_st_prompt_preset_active": {
            const activeMode = String(s.extract_output_mode ?? "mixed");
            const presetKey = `extract_preset_${activeMode}`;
            (s as Record<string, unknown>)[presetKey] = t.value;
            break;
        }
        case "image_st_review_prompt_preset": s.review_prompt_preset = t.value; break;
        case "image_st_review_prompt_custom": s.review_prompt_custom = t.value; break;
        case "image_st_ext_weight_map": s.ext_weight_map = parseWeightMap(t.value); break;
        case "image_st_budget_max": {
            const n = Math.floor(Number(t.value));
            s.budget_max = Number.isFinite(n) && n >= 0 ? n : 25;
            break;
        }
        default: return;
    }
    saveSettingsDebounced();
}

/** 模块树 click 事件（恢复默认模板 / 词库导入移除） */
function onPipelineControlClick(e: Event): void {
    const target = e.target as HTMLElement;
    const el = target.closest("[id]") as HTMLElement | null;
    const id = el?.id ?? "";
    const s = extension_settings[SETTINGS_KEY];
    switch (id) {
        case "image_st_prompt_preset_active_reset": {
            const ta = document.getElementById("image_st_prompt_preset_active") as HTMLTextAreaElement | null;
            if (!ta) return;
            const activeMode = String(s.extract_output_mode ?? "mixed");
            const presetKey = `extract_preset_${activeMode}`;
            const defaultPreset = DEFAULT_EXTRACT_PRESETS[activeMode as keyof typeof DEFAULT_EXTRACT_PRESETS] ?? DEFAULT_EXTRACT_PRESETS.mixed;
            ta.value = defaultPreset;
            (s as Record<string, unknown>)[presetKey] = defaultPreset;
            saveSettingsDebounced();
            toastr.info(`已填入「${activeMode}」的默认模板`, "生成管线");
            return;
        }
        case "image_st_review_prompt_preset_reset": {
            const ta = document.getElementById("image_st_review_prompt_preset") as HTMLTextAreaElement | null;
            if (!ta) return;
            ta.value = DEFAULT_REVIEW_PRESET;
            s.review_prompt_preset = DEFAULT_REVIEW_PRESET;
            saveSettingsDebounced();
            toastr.info("已填入默认审核模板，可直接复制或在此基础上改写", "生成管线");
            return;
        }
        case "image_st_dict_import":
            void onDictImport();
            return;
        case "image_st_dict_remove":
            void onDictRemove();
            return;
        default:
            return;
    }
}

async function refreshTagToolStatus(): Promise<void> {
    const el = document.getElementById("image_st_tagtool_status");
    if (!el) return;
    const s = extension_settings[SETTINGS_KEY];
    const lex = getDefaultLexicon();
    const state = getLexiconLoadState();
    const localInfo =
        state === "full"
            ? `本地词库：完整词库（${lex.allKeys.size} 词）`
            : state === "persisted"
                ? `本地词库：完整词库（已持久化，未加载）`
                : state === "loading"
                    ? `本地词库：完整词库加载中……`
                    : `本地词库：内嵌精选（${lex.allKeys.size} 词）`;
    const url = String(s.tagtool_mcp_url ?? DEFAULT_MCP_URL);
    if ((s.tagtool_source as string) === "local" || !url) {
        tagToolStatusText = localInfo;
        el.textContent = tagToolStatusText;
        return;
    }
    tagToolStatusText = `${localInfo} · MCP 探测中…`;
    el.textContent = tagToolStatusText;
    const tools = await listMcpTools(url);
    tagToolStatusText = tools.length
        ? `${localInfo} · MCP 可用（${tools.length} 个工具：${tools.slice(0, 4).map(t => t.name).join(", ")}）`
        : `${localInfo} · MCP 不可用（${url}），已回退本地词库`;
    el.textContent = tagToolStatusText;
}

/** 词库状态行刷新（状态行位于「标签工具调用」模块内） */
function refreshDictStatus(): void {
    const el = document.getElementById("image_st_dict_status");
    if (!el) return;
    const state = getLexiconLoadState();
    const total = getDefaultLexicon().allKeys.size;
    if (state === "full") {
        el.textContent = isLexiconPersisted()
            ? `✓ 完整词库已加载（${total} 词，已持久化——刷新后按需恢复）`
            : `✓ 完整词库已加载（${total} 词，仅本会话生效——持久化未成功，刷新后需重新导入）`;
    } else if (state === "loading") {
        el.textContent = `正在加载完整词库……（完成后本会话常驻）`;
    } else if (state === "persisted") {
        el.textContent = `完整词库已持久化但**未加载**（按需加载：打开本面板或点击生成时自动加载，≈240ms / ≈94MB 堆）`;
    } else {
        el.textContent = `内嵌精选（${total} 词，始终可用）；导入 外部工具/词库.bmz 后自动持久化（32 万词，准确性对标「提示词工具」）`;
    }
}

/** 导入 词库.bmz（完整词库 + 浏览器持久化） */
function onDictImport(): void {
    const s = extension_settings[SETTINGS_KEY];
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".bmz,.bmz1";
    input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
            const ab = await file.arrayBuffer();
            const lex = await installFullLexicon(ab);
            // 持久化到 IndexedDB（覆盖旧值）：失败仅降级为本次会话可用，不影响已加载的词库
            let persisted = true;
            try {
                await saveBmzRaw(ab);
            } catch (persistErr) {
                persisted = false;
                console.warn("[image_st] 词库持久化失败（仅本会话可用）:", persistErr);
            }
            (s as Record<string, unknown>).ext_dict_imported = persisted;
            saveSettingsDebounced();
            refreshDictStatus();
            if (persisted) {
                toastr?.success?.(`词库已导入（${lex.allKeys.size} 词，已持久化，刷新自动恢复）`, "ST Image Plugin", { timeOut: 4000 });
            } else {
                toastr?.warning?.(`词库已加载（${lex.allKeys.size} 词），但持久化失败（浏览器隐私模式？），刷新后需重新导入`, "ST Image Plugin", { timeOut: 6000 });
            }
        } catch (err) {
            console.error("[image_st] 词库导入失败:", err);
            toastr?.error?.(`词库导入失败: ${err instanceof Error ? err.message : String(err)}`, "ST Image Plugin", { timeOut: 6000 });
        }
    };
    input.click();
}

/** 移除持久化词库（回落到内嵌精选） */
async function onDictRemove(): Promise<void> {
    const s = extension_settings[SETTINGS_KEY];
    try {
        await removePersistedLexicon();
        (s as Record<string, unknown>).ext_dict_imported = false;
        saveSettingsDebounced();
        refreshDictStatus();
        toastr?.success?.("已移除持久化词库，恢复为内嵌精选", "ST Image Plugin", { timeOut: 4000 });
    } catch (err) {
        console.error("[image_st] 移除持久化词库失败:", err);
        toastr?.error?.(`移除失败: ${err instanceof Error ? err.message : String(err)}`, "ST Image Plugin", { timeOut: 6000 });
    }
}

/** 生成管线 tab 的控件绑定 */
function setupPipelinePanel(): void {
    const s = extension_settings[SETTINGS_KEY];

    const modeSel = document.getElementById("image_st_extract_mode") as HTMLSelectElement | null;
    if (modeSel) {
        modeSel.value = String(s.extract_output_mode ?? "mixed");
        modeSel.addEventListener("change", () => {
            s.extract_output_mode = modeSel.value;
            saveSettingsDebounced();
            // 同步动态提示词文本框：切换模式时加载对应模式的预设
            const presetMap: Record<string, string> = {
                tags: String(s.extract_preset_tags ?? ""),
                description: String(s.extract_preset_description ?? ""),
                mixed: String(s.extract_preset_mixed ?? ""),
                custom: String(s.extract_preset_custom ?? ""),
            };
            const activeTextarea = document.getElementById("image_st_prompt_preset_active") as HTMLTextAreaElement | null;
            const modeInput = document.getElementById("image_st_prompt_preset_active_mode") as HTMLInputElement | null;
            if (activeTextarea && modeInput) {
                activeTextarea.value = presetMap[modeSel.value] ?? "";
                modeInput.value = modeSel.value;
            }
        });
    }

    // 模块树整体重绘 → 事件用委托绑定，避免每次重绘都要重新挂载
    const box = document.getElementById("image_st_pipeline_modules");
    if (box) {
        box.addEventListener("change", onPipelineControlChange);
        box.addEventListener("input", onPipelineControlInput);
        box.addEventListener("click", onPipelineControlClick);
    }

    renderPipelineModules();

    document.getElementById("image_st_pipeline_reset")?.addEventListener("click", () => {
        if (!confirm("确定恢复全部管线模块为默认状态？")) return;
        const switches: Record<string, boolean> = {};
        for (const mod of PIPELINE_MODULES) switches[mod.id] = mod.defaultEnabled;
        s.pipeline_modules = switches;
        saveSettingsDebounced();
        renderPipelineModules();
    });

    refreshDictStatus();
    showPipelineReports(null);
    void refreshTagToolStatus();
}

// ============================================================
// Local Library UI (v1.8)
// ============================================================
let localWorldbookEntries: Array<{ id: string; content: string; order: number }> = [];
let localSelectedEntryIds: Set<string> = new Set();
let localBuildState: 'idle' | 'building' | 'completed' | 'cancelled' | 'failed' = 'idle';
// 内嵌世界书数据缓存：displayName (含 [内嵌] 后缀) → entries
const localEmbeddedWorldbooks = new Map<string, Array<{ id: string; content: string; order?: number }>>();
// 当前选中的世界书名称（用于关键词绑定）
let localCurrentWorldbookName = '';
// 本地条目搜索快照（搜索前保存当前勾选状态）
let localSearchSnapshot: Set<string> = new Set();

async function updateLocalStatusText(completed?: number, total?: number, currentIndex?: number): Promise<void> {
  const statusEl = document.getElementById("image_st_local_status");
  const foldStatusEl = document.getElementById("image_st_local_fold_status");
  if (!statusEl) return;
  const s = extension_settings[SETTINGS_KEY];
  const enabled = s?.local_enabled ?? false;
  if (!enabled) {
    statusEl.textContent = '';
    if (foldStatusEl) { foldStatusEl.textContent = '未启用'; foldStatusEl.title = ''; }
    return;
  }
  const progressText = (c?: number, t?: number, idx?: number): string => {
    if (!t || t <= 0) return '';
    const countText = `${c ?? 0}/${t} 段`;
    if (idx && t > 1) return `(${countText} · 当前段 ${idx}/${t})`;
    return `(${countText})`;
  };
  if (isBuildLocked()) {
    const target = getCurrentBuildingTarget();
    const text = target
      ? `⏳ 正在为 [${target.charName}] 构建 [${target.worldbookName}]... ${progressText(completed, total, currentIndex)}`
      : `⏳ 构建中... ${progressText(completed, total, currentIndex)}`;
    statusEl.textContent = text;
    if (foldStatusEl) {
      foldStatusEl.textContent = total && total > 0 ? `构建中 ${completed ?? 0}/${total}` : '构建中';
      foldStatusEl.title = text;
    }
    return;
  }
  if (localBuildState === 'building') {
    const t = total ?? 0;
    const c = completed ?? 0;
    const text = t > 0 ? `⏳ 构建中... (${c}/${t} 段${currentIndex ? ` · 当前段 ${currentIndex}/${t}` : ''})` : '⏳ 构建中...';
    statusEl.textContent = text;
    if (foldStatusEl) { foldStatusEl.textContent = '构建中'; foldStatusEl.title = text; }
    return;
  }
  if (localBuildState === 'cancelled') {
    const c = completed ?? 0;
    const text = `⚠️ 已取消 (${c} 段)`;
    statusEl.textContent = text;
    if (foldStatusEl) { foldStatusEl.textContent = '已取消'; foldStatusEl.title = text; }
    return;
  }
  if (localBuildState === 'failed') {
    statusEl.textContent = '❌ 构建失败';
    if (foldStatusEl) { foldStatusEl.textContent = '失败'; foldStatusEl.title = '构建失败'; }
    return;
  }
  if (localBuildState === 'completed') {
    const charName = getCurrentCharName();
    const libStatus = charName ? await getLocalLibraryStatus(charName) : { hasCompleted: false, libraries: [] };
    const charCount = libStatus.libraries.reduce((sum, lib) => sum + lib.characters.length, 0);
    const text = charCount > 0 ? `✓ 已构建 (${charCount} 个角色)` : '✓ 已构建';
    statusEl.textContent = text;
    if (foldStatusEl) { foldStatusEl.textContent = `✓ ${charCount} 角色`; foldStatusEl.title = text; }
    return;
  }
  statusEl.textContent = '未构建';
  if (foldStatusEl) { foldStatusEl.textContent = '未构建'; foldStatusEl.title = ''; }
}

function getCurrentCharName(): string {
  const ctx = getContext();
  if (ctx.name2) return ctx.name2;
  const chid = ctx.this_chid;
  const characters = ctx.characters;
  if (characters && Array.isArray(characters) && chid != null && characters[chid]) {
    const char = characters[chid];
    const fallback = char.name || char.name2 || '';
    if (fallback) logger.debug('[LocalLib UI] getCurrentCharName fallback from characters:', fallback);
    return fallback;
  }
  return '';
}

async function populateLocalWorldbookSelect(): Promise<void> {
  const select = document.getElementById("image_st_local_worldbook_select") as HTMLSelectElement | null;
  if (!select) return;
  const worldNames = getWorldInfoNames();
  localEmbeddedWorldbooks.clear();
  const charName = getCurrentCharName();
  logger.debug('[LocalLib UI] populateLocalWorldbookSelect charName:', charName, 'worldNames:', worldNames);
  const embedded = charName ? getEmbeddedWorldbooks(charName) : [];
  logger.debug('[LocalLib UI] embedded worldbooks:', embedded);
  embedded.forEach((wb) => {
    localEmbeddedWorldbooks.set(wb.name, wb.entries);
  });
  const allNames = [
    ...worldNames.map(n => ({ name: n, isEmbedded: false })),
    ...embedded.map(wb => ({ name: wb.name, isEmbedded: true })),
  ];
  select.innerHTML = '';
  if (allNames.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '-- 无可用世界书 --';
    select.appendChild(opt);
    select.disabled = true;
    return;
  }
  select.disabled = false;
  allNames.forEach(({ name, isEmbedded }) => {
    const opt = document.createElement('option');
    // value 带 [内嵌] 后缀，供 isEmbeddedWorldbookName() 判断；缓存 key 始终为裸名
    opt.value = isEmbedded ? `${name} [内嵌]` : name;
    opt.textContent = isEmbedded ? `${name} [内嵌]` : name;
    opt.title = isEmbedded ? '内嵌世界书（未在当前角色卡中激活）' : '';
    select.appendChild(opt);
  });
  // 自动选中当前角色对应的世界书（内嵌优先），与角色名精确或前缀匹配
  const embeddedPreferred = `${charName} ${'[内嵌]'}`;
  let matchedIndex = allNames.findIndex(n => `${n.name} ${'[内嵌]'}` === embeddedPreferred && n.isEmbedded);
  if (matchedIndex === -1) {
    matchedIndex = allNames.findIndex(n => n.name === charName || n.name.startsWith(charName));
  }
  if (matchedIndex !== -1) {
    select.selectedIndex = matchedIndex;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

async function renderLocalEntryTree(worldbookName: string): Promise<void> {
  const tree = document.getElementById("image_st_local_entry_tree");
  if (!tree) return;
  localCurrentWorldbookName = worldbookName;
  if (!worldbookName) {
    tree.innerHTML = '<div class="image-st-hint-text">请先选择世界书</div>';
    localWorldbookEntries = [];
    localSelectedEntryIds = new Set();
    loadLocalKeywords('');
    return;
  }
  const cleanName = stripEmbeddedSuffix(worldbookName);
  const isEmbedded = isEmbeddedWorldbookName(worldbookName);
  const fallbackEntries = isEmbedded ? localEmbeddedWorldbooks.get(cleanName) : undefined;
  const entries = await getWorldInfoEntries(cleanName, fallbackEntries);
  localWorldbookEntries = entries;
  loadLocalKeywords(worldbookName);
  // 恢复已选 entryIds
  const charName = getCurrentCharName();
  if (charName) {
    loadEntrySelection(charName).then(sel => {
      const wbSel = sel.selections.find(s => s.worldbookName === cleanName);
      localSelectedEntryIds = new Set(wbSel?.entryIds ?? []);
      renderLocalEntryChips(tree, entries);
    }).catch(() => {
      localSelectedEntryIds = new Set();
      renderLocalEntryChips(tree, entries);
    });
  } else {
    localSelectedEntryIds = new Set();
    renderLocalEntryChips(tree, entries);
  }
}

function setupLocalSearch(): void {
  const input = document.getElementById("image_st_local_search") as HTMLInputElement | null;
  const btn = document.getElementById("image_st_local_search_btn") as HTMLButtonElement | null;
  if (!input || !btn) return;

  btn.addEventListener("click", () => {
    const q = input.value.trim().toLowerCase();
    const tree = document.getElementById("image_st_local_entry_tree");
    if (!tree) return;

    if (!q) {
      toastr.info('请输入搜索关键词', 'ST Image Plugin');
      return;
    }

    const keywords = q.split(',').map(kw => kw.trim().toLowerCase()).filter(kw => kw);
    if (keywords.length === 0) {
      toastr.info('请输入有效的搜索关键词', 'ST Image Plugin');
      return;
    }

    // 清理上次搜索高亮
    tree.querySelectorAll('.image-st-search-hide').forEach(el => el.classList.remove('image-st-search-hide'));
    tree.querySelectorAll('.image-st-search-hit').forEach(el => el.classList.remove('image-st-search-hit'));

    // 每次搜索开始前都重置快照（保留当次搜索前的状态）
    localSearchSnapshot = new Set(localSelectedEntryIds);

    const checkboxes = tree.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-entry-id]');
    let hasMatch = false;

    checkboxes.forEach(cb => {
      const entryId = cb.dataset.entryId ?? '';
      const label = cb.closest('label');
      if (!label) return;

      const span = label.querySelector('span');
      const text = span?.textContent?.toLowerCase() ?? '';
      const match = keywords.every(kw => text.includes(kw));

      if (match) {
        label.classList.remove('image-st-search-hide');
        cb.checked = true;
        localSelectedEntryIds.add(entryId);
        label.classList.add('image-st-search-hit');
        label.classList.add('image-st-local-entry-active');
        hasMatch = true;
      }
    });

    renderLocalSelectedTags();
    saveLocalSelection();

    if (!hasMatch) {
      toastr.info(`未找到匹配条目（${input.value}）`, 'ST Image Plugin');
    }
  });

  // 清空搜索框时恢复快照
  input.addEventListener("input", () => {
    if (!input.value.trim() && localSearchSnapshot.size > 0) {
      // 恢复快照
      localSelectedEntryIds = new Set(localSearchSnapshot);
      localSearchSnapshot = new Set();
      // 刷新 UI
      const select = document.getElementById("image_st_local_worldbook_select") as HTMLSelectElement | null;
      if (select?.value) renderLocalEntryTree(select.value);
      renderLocalSelectedTags();
      saveLocalSelection();
    }
  });

  // 回车触发搜索
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      btn.click();
    }
  });
}

function renderLocalEntryChips(tree: HTMLElement, entries: Array<{ id: string; content: string; order: number }>): void {
  tree.innerHTML = '';
  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'image-st-hint-text';
    empty.textContent = '-- 该世界书无条目 --';
    tree.appendChild(empty);
    return;
  }
  const toolbar = document.createElement('div');
  toolbar.style.cssText = 'display:flex;gap:6px;margin-bottom:4px;flex-wrap:wrap;';
  const makeBtn = (text: string, title: string, onClick: () => void): HTMLElement => {
    const btn = document.createElement('span');
    btn.className = 'image-st-mvu-chip';
    btn.style.cursor = 'pointer';
    btn.style.userSelect = 'none';
    btn.textContent = text;
    btn.title = title;
    btn.addEventListener('click', onClick);
    return btn;
  };
  toolbar.appendChild(makeBtn('☑ 全选', `选中全部 ${entries.length} 条`, () => {
    entries.forEach(e => localSelectedEntryIds.add(e.id));
    saveLocalSelection();
    renderLocalSelectedTags();
    syncCheckboxes(tree);
  }));
  toolbar.appendChild(makeBtn('⇄ 反选', '反转当前选择', () => {
    const all = new Set(entries.map(e => e.id));
    for (const id of all) {
      if (localSelectedEntryIds.has(id)) {
        localSelectedEntryIds.delete(id);
      } else {
        localSelectedEntryIds.add(id);
      }
    }
    saveLocalSelection();
    renderLocalSelectedTags();
    syncCheckboxes(tree);
  }));
  tree.appendChild(toolbar);
  entries.forEach(entry => {
    const label = document.createElement('label');
    label.className = 'checkbox_label image-st-local-entry';
    if (localSelectedEntryIds.has(entry.id)) label.classList.add('image-st-local-entry-active');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.entryId = entry.id;
    cb.checked = localSelectedEntryIds.has(entry.id);
    cb.addEventListener('change', () => {
      if (cb.checked) {
        localSelectedEntryIds.add(entry.id);
      } else {
        localSelectedEntryIds.delete(entry.id);
      }
      label.classList.toggle('image-st-local-entry-active', cb.checked);
      saveLocalSelection();
      renderLocalSelectedTags();
    });
    label.appendChild(cb);
    const span = document.createElement('span');
    span.textContent = ` ${entry.content.substring(0, 60)}${entry.content.length > 60 ? '...' : ''}`;
    span.title = entry.content;
    label.appendChild(span);
    tree.appendChild(label);
  });
}

function syncCheckboxes(tree: HTMLElement): void {
  tree.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(cb => {
    const entryId = cb.dataset.entryId;
    if (!entryId) return;
    cb.checked = localSelectedEntryIds.has(entryId);
    const label = cb.closest('label');
    if (label) label.classList.toggle('image-st-local-entry-active', cb.checked);
  });
}

function renderLocalSelectedTags(): void {
  const box = document.getElementById("image_st_local_selected_tags");
  if (!box) return;
  box.innerHTML = '';
  if (localSelectedEntryIds.size === 0) return;
  const clearAll = document.createElement('span');
  clearAll.className = 'image-st-mvu-chip image-st-mvu-chip-clear';
  clearAll.textContent = '清空全部';
  clearAll.title = `清除全部 ${localSelectedEntryIds.size} 条已选`;
  clearAll.addEventListener('click', () => {
    localSelectedEntryIds.clear();
    saveLocalSelection();
    renderLocalSelectedTags();
    const select = document.getElementById("image_st_local_worldbook_select") as HTMLSelectElement | null;
    if (select?.value) renderLocalEntryTree(select.value);
  });
  box.appendChild(clearAll);
  localWorldbookEntries.forEach(entry => {
    if (!localSelectedEntryIds.has(entry.id)) return;
    const chip = document.createElement('span');
    chip.className = 'image-st-mvu-chip image-st-local-chip';
    chip.title = entry.content;
    const txt = document.createElement('span');
    txt.className = 'image-st-local-chip-txt';
    txt.textContent = entry.content.substring(0, 30) + (entry.content.length > 30 ? '…' : '');
    const rm = document.createElement('span');
    rm.className = 'image-st-local-chip-rm';
    rm.title = '移除';
    rm.setAttribute('role', 'button');
    rm.setAttribute('aria-label', '移除条目');
    rm.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
    rm.addEventListener('click', (e) => {
      e.stopPropagation();
      localSelectedEntryIds.delete(entry.id);
      saveLocalSelection();
      renderLocalSelectedTags();
      const select2 = document.getElementById("image_st_local_worldbook_select") as HTMLSelectElement | null;
      if (select2?.value) renderLocalEntryTree(select2.value);
    });
    chip.appendChild(txt);
    chip.appendChild(rm);
    box.appendChild(chip);
  });
}

async function saveLocalSelection(): Promise<void> {
  const charName = getCurrentCharName();
  if (!charName) return;
  const select = document.getElementById("image_st_local_worldbook_select") as HTMLSelectElement | null;
  const worldbookName = select?.value || '';
  if (!worldbookName) return;
  const cleanName = stripEmbeddedSuffix(worldbookName);
  const existing = await loadEntrySelection(charName);
  const wbSel = existing.selections.find(s => s.worldbookName === cleanName);
  if (wbSel) {
    wbSel.entryIds = Array.from(localSelectedEntryIds);
  } else {
    existing.selections.push({ worldbookName: cleanName, entryIds: Array.from(localSelectedEntryIds) });
  }
  existing.lastUpdated = new Date().toISOString();
  await saveEntrySelection(charName, existing);
}

async function saveLocalKeywords(): Promise<void> {
  const charName = getCurrentCharName();
  if (!charName || !localCurrentWorldbookName) return;
  const keywordsEl = document.getElementById("image_st_local_keywords") as HTMLTextAreaElement | null;
  if (!keywordsEl) return;
  const raw = keywordsEl.value.trim();
  const keywords = raw ? raw.split(/[,，、\s]+/).filter(Boolean) : [];
  const existing = await loadEntrySelection(charName);
  const cleanName = stripEmbeddedSuffix(localCurrentWorldbookName);
  const wbSel = existing.selections.find(s => s.worldbookName === cleanName);
  if (wbSel) {
    wbSel.keywords = keywords;
    if (!wbSel.priority) wbSel.priority = 1;
  } else {
    existing.selections.push({ worldbookName: cleanName, entryIds: [], keywords, priority: 1 });
  }
  existing.lastUpdated = new Date().toISOString();
  await saveEntrySelection(charName, existing);
}

async function loadLocalKeywords(worldbookName: string): Promise<void> {
  const charName = getCurrentCharName();
  const keywordsEl = document.getElementById("image_st_local_keywords") as HTMLTextAreaElement | null;
  if (!keywordsEl) return;
  if (!charName || !worldbookName) {
    keywordsEl.value = '';
    return;
  }
  const cleanName = stripEmbeddedSuffix(worldbookName);
  try {
    const sel = await loadEntrySelection(charName);
    const wbSel = sel.selections.find(s => s.worldbookName === cleanName);
    const kws = wbSel && Array.isArray(wbSel.keywords) ? wbSel.keywords : [];
    keywordsEl.value = kws.join(', ');
  } catch {
    keywordsEl.value = '';
  }
}

function updateLocalBuildUI(state: 'building' | 'cancelled' | 'completed' | 'failed' | 'idle', completed?: number, total?: number, currentIndex?: number): void {
  const buildBtn = document.getElementById("image_st_local_build") as HTMLButtonElement | null;
  const cancelBtn = document.getElementById("image_st_local_cancel") as HTMLButtonElement | null;
  const worldbookSelect = document.getElementById("image_st_local_worldbook_select") as HTMLSelectElement | null;
  if (!buildBtn || !cancelBtn) return;
  if (state === 'building') {
    buildBtn.disabled = true;
    cancelBtn.style.display = '';
    if (worldbookSelect) worldbookSelect.disabled = true;
  } else {
    buildBtn.disabled = false;
    cancelBtn.style.display = 'none';
    if (worldbookSelect) worldbookSelect.disabled = false;
  }
  localBuildState = state;
  updateLocalStatusText(completed, total, currentIndex);
}

async function handleLocalBuild(): Promise<void> {
  if (isBuildLocked()) {
    toastr.warning('已有构建任务在进行中', 'ST Image Plugin');
    return;
  }
  const charName = getCurrentCharName();
  if (!charName) {
    toastr.warning('未检测到当前角色卡', 'ST Image Plugin');
    return;
  }
  const select = document.getElementById("image_st_local_worldbook_select") as HTMLSelectElement | null;
  const worldbookName = select?.value || '';
  if (!worldbookName) {
    toastr.warning('请先选择世界书', 'ST Image Plugin');
    return;
  }
  if (localSelectedEntryIds.size === 0) {
    toastr.warning('请先勾选需要扫描的条目', 'ST Image Plugin');
    return;
  }
  // 保存选择
  await saveLocalSelection();
  updateLocalBuildUI('building', 0, 0);
  try {
    const isEmbedded = isEmbeddedWorldbookName(worldbookName);
    const cleanName = stripEmbeddedSuffix(worldbookName);
    const fallbackEntries = isEmbedded ? localEmbeddedWorldbooks.get(cleanName) : undefined;
    const modeRadio = document.querySelector('input[name="image_st_local_build_mode"]:checked') as HTMLInputElement | null;
    const mode = (modeRadio?.value === 'overwrite' ? 'overwrite' : 'merge') as BuildOptions['mode'];
    const apiSourceRadio = document.querySelector('input[name="image_st_local_api_source"]:checked') as HTMLInputElement | null;
    const apiSource = (apiSourceRadio?.value as BuildOptions['apiSource']) || 'auto';
    const chunkStrategyRadio = document.querySelector('input[name="image_st_local_chunk_strategy"]:checked') as HTMLInputElement | null;
    const chunkStrategy = (chunkStrategyRadio?.value as ChunkStrategy) || CHUNK_STRATEGY.MERGE;
    const result = await executeBuild(charName, cleanName, Array.from(localSelectedEntryIds), fallbackEntries, (completed, total, status, currentIndex) => {
      updateLocalBuildUI(status === 'completed' ? 'completed' : status === 'cancelled' ? 'cancelled' : status === 'failed' ? 'failed' : 'building', completed, total, currentIndex);
    }, { mode, apiSource, chunkStrategy });
    if (result.success) {
      updateLocalBuildUI('completed', result.completedChunks, result.totalChunks);
      toastr.success(`本地角色库构建完成：${result.characters.length} 个角色`, 'ST Image Plugin');
    } else {
      updateLocalBuildUI('failed');
      toastr.error(result.error || '构建失败', 'ST Image Plugin');
    }
  } catch (err) {
    updateLocalBuildUI('failed');
    toastr.error(err instanceof Error ? err.message : String(err), 'ST Image Plugin');
  }
}

function handleLocalCancel(): void {
  cancelLocalBuild();
  localBuildState = 'cancelled';
  updateLocalBuildUI('cancelled');
  toastr.info('构建已取消，已完成段已保留', 'ST Image Plugin');
}

function handleLocalOpenDir(): void {
  const charName = getCurrentCharName();
  if (!charName) return;
  const dir = getCharStorageDir(charName);
  toastr.info(`存储位置（服务器磁盘）: <ST 数据目录>\\user\\files\\ （扁平化文件名，前缀 ist_）\r\n逻辑路径: ${dir}`, 'ST Image Plugin', { timeOut: 6000 });
}

async function refreshLocalPanelOnChatChange(): Promise<void> {
  const charName = getCurrentCharName();
  logger.debug('[LocalLib UI] refreshLocalPanelOnChatChange charName:', charName);
  localWorldbookEntries = [];
  localSelectedEntryIds = new Set();
  localCurrentWorldbookName = '';
  const select = document.getElementById("image_st_local_worldbook_select") as HTMLSelectElement | null;
  if (select) {
    select.innerHTML = '<option value="">-- 选择世界书 --</option>';
    select.disabled = false;
  }
  const tree = document.getElementById("image_st_local_entry_tree");
  if (tree) tree.innerHTML = '<div class="image-st-hint-text">请先选择世界书</div>';
  const tagsBox = document.getElementById("image_st_local_selected_tags");
  if (tagsBox) tagsBox.innerHTML = '';
  const keywordsEl = document.getElementById("image_st_local_keywords") as HTMLTextAreaElement | null;
  if (keywordsEl) keywordsEl.value = '';
  const statusEl = document.getElementById("image_st_local_status");
  const foldStatusEl = document.getElementById("image_st_local_fold_status");
  if (statusEl) statusEl.textContent = '';
  if (foldStatusEl) foldStatusEl.textContent = '未检测';
  // 检查构建锁
  if (isBuildLocked() && charName) {
    const target = getCurrentBuildingTarget();
    if (target) {
      if (statusEl) statusEl.textContent = `⏳ 正在为 [${target.charName}] 构建 [${target.worldbookName}]...`;
      if (foldStatusEl) { foldStatusEl.textContent = '构建中'; foldStatusEl.title = statusEl?.textContent ?? ''; }
      const buildBtn = document.getElementById("image_st_local_build") as HTMLButtonElement | null;
      const cancelBtn = document.getElementById("image_st_local_cancel") as HTMLButtonElement | null;
      const wbSelect = document.getElementById("image_st_local_worldbook_select") as HTMLSelectElement | null;
      if (buildBtn) buildBtn.disabled = true;
      if (cancelBtn) cancelBtn.style.display = 'none';
      if (wbSelect) wbSelect.disabled = true;
    }
  } else if (charName) {
    await populateLocalWorldbookSelect();
    const libStatus = await getLocalLibraryStatus(charName);
    if (libStatus.hasCompleted) {
      localBuildState = 'completed';
    } else {
      localBuildState = 'idle';
    }
    updateLocalStatusText();
  }
}

function updateDbStatusSummary(): void {
  const statusEl = document.getElementById("image_st_db_status");
  const foldStatusEl = document.getElementById("image_st_db_fold_status");
  if (!statusEl) return;
  const s = extension_settings[SETTINGS_KEY];
  if (!s?.db_enabled) {
    statusEl.textContent = "数据库状态：未启用";
    if (foldStatusEl) { foldStatusEl.textContent = "未启用"; foldStatusEl.title = ""; }
    return;
  }
  const st = getDatabaseStatus();
  if (!st.available) {
    statusEl.textContent = "数据库状态：不可用（数据库插件未加载——请确认已安装 AutoCardUpdater）";
    if (foldStatusEl) { foldStatusEl.textContent = "不可用"; foldStatusEl.title = statusEl.textContent; }
    return;
  }
  const selections = getDbSelections();
  const totalFields = selections.reduce((sum, sel) => sum + sel.fields.length, 0);
  const fullText = `数据库状态：已就绪 (${st.sheets} 表 / ${st.rows} 行) · 已选 ${selections.length} 表 / ${totalFields} 字段`;
  statusEl.textContent = fullText;
  if (foldStatusEl) {
    foldStatusEl.textContent = `✓ ${selections.length} 表 / ${totalFields} 字段`;
    foldStatusEl.title = fullText;
  }
}

function setupDbSearch(): void {
  const input = document.getElementById("image_st_db_search") as HTMLInputElement | null;
  if (!input) return;
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    const tree = document.getElementById("image_st_db_tree");
    if (!tree) return;
    tree.querySelectorAll(".image-st-search-hide").forEach(el => el.classList.remove("image-st-search-hide"));
    tree.querySelectorAll(".image-st-search-hit").forEach(el => el.classList.remove("image-st-search-hit"));
    tree.querySelectorAll(".image-st-search-show").forEach(el => {
      el.classList.remove("image-st-search-show");
      el.classList.remove("show");
    });
    if (!q) return;
    const branches = Array.from(tree.querySelectorAll(".image-st-tree-branch")) as HTMLElement[];
    const leaves = Array.from(tree.querySelectorAll(".image-st-tree-leaf")) as HTMLElement[];
    const allItems = [...branches, ...leaves];
    const matchSelf = (el: HTMLElement): boolean => {
      const key = el.getAttribute("data-db-sheet") || el.getAttribute("data-db-field") || "";
      return key.toLowerCase().includes(q);
    };
    const hits = allItems.filter(matchSelf);
    const visible = new Set<HTMLElement>(hits);
    for (const h of hits) {
      let p = h.parentElement;
      while (p && p !== tree) {
        if (p.classList.contains("image-st-tree-children")) {
          p.classList.add("show");
          p.classList.add("image-st-search-show");
          const header = p.parentElement?.querySelector(":scope > .image-st-tree-branch") as HTMLElement | null;
          if (header) {
            visible.add(header);
            header.querySelector(":scope > .image-st-tree-toggle")?.classList.add("expanded");
          }
        }
        p = p.parentElement;
      }
    }
    allItems.forEach(el => { if (!visible.has(el)) el.classList.add("image-st-search-hide"); });
    hits.forEach(h => h.classList.add("image-st-search-hit"));
  });
}

function setDbTreeExpanded(expanded: boolean): void {
  const tree = document.getElementById("image_st_db_tree");
  if (!tree) return;
  tree.querySelectorAll(".image-st-tree-children").forEach(el => el.classList.toggle("show", expanded));
  tree.querySelectorAll(".image-st-tree-toggle").forEach(el => el.classList.toggle("expanded", expanded));
}

// ============================================================
// Gallery / Test / Connection UI (移自 index.ts)
// ============================================================
function onCopyGalleryPath() {
    const context = getContext();
    const charName = context.name2 || 'image_st';
    const path = `user/images/${charName}/`;
    
    const writeText = navigator.clipboard?.writeText;
    if (writeText) {
        writeText.call(navigator.clipboard, path).then(() => {
            const statusEl = document.getElementById('image_st_gallery_path_status');
            if (statusEl) {
                statusEl.textContent = `已复制: ${path}`;
                setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
            }
            toastr.success(`图片目录路径已复制: ${path}`, 'ST Image Plugin', { timeOut: 2000 });
        }).catch(() => {
            toastr.error('复制失败，请手动复制路径', 'ST Image Plugin');
        });
    } else {
        // Fallback for non-secure contexts (HTTP, some iOS PWA)
        const ta = document.createElement("textarea");
        ta.value = path;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand("copy");
            const statusEl = document.getElementById('image_st_gallery_path_status');
            if (statusEl) {
                statusEl.textContent = `已复制: ${path}`;
                setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
            }
            toastr.success(`图片目录路径已复制: ${path}`, 'ST Image Plugin', { timeOut: 2000 });
        } catch {
            toastr.error('复制失败，请手动复制路径', 'ST Image Plugin');
        } finally {
            document.body.removeChild(ta);
        }
    }
}

async function testLLMConnection() {
  const statusEl = document.getElementById("image_st_llm_status");
  const resultEl = document.getElementById("image_st_llm_test_result");
  if (!statusEl || !resultEl) return;
  // 读取当前输入框的值（可能来自 API Profile 选择，也可能是手动输入）
  const urlEl = document.getElementById("image_st_llm_url") as HTMLInputElement;
  const modelEl = document.getElementById("image_st_llm_model") as HTMLInputElement;
  const keyEl = document.getElementById("image_st_api_key") as HTMLInputElement;
  const url = urlEl?.value?.trim() || LLM_URL_DEFAULT;
  const apiKey = keyEl?.value?.trim() || "";
  const model = modelEl?.value?.trim() || LLM_MODEL_DEFAULT;
  if (!apiKey) {
    statusEl.className = "image-st-llm-status image-st-llm-status-error";
    resultEl.textContent = "请先配置 API Key";
    return;
  }
  statusEl.className = "image-st-llm-status image-st-llm-status-testing";
  resultEl.textContent = "测试中...";
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const startTime = performance.now();
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 5,
      }),
      signal: controller.signal,
    });
    const elapsed = Math.round(performance.now() - startTime);
    clearTimeout(timeoutId);
    if (response.ok) {
      statusEl.className = "image-st-llm-status image-st-llm-status-ok";
      resultEl.textContent = `连接成功 (${elapsed}ms)`;
    } else {
      const detail = await response.text().catch(() => "");
      statusEl.className = "image-st-llm-status image-st-llm-status-error";
      resultEl.textContent = `连接失败: ${response.status}${detail ? ` — ${detail.slice(0, 100)}` : ""}`;
    }
  } catch (err) {
    clearTimeout(timeoutId);
    statusEl.className = "image-st-llm-status image-st-llm-status-error";
    resultEl.textContent = `连接失败: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function testComfyUIConnection() {
  const statusEl = document.getElementById("image_st_comfy_status");
  const resultEl = document.getElementById("image_st_comfy_test_result");
  if (!statusEl || !resultEl) return;
  statusEl.className = "image-st-llm-status image-st-llm-status-testing";
  resultEl.textContent = "测试中...";
  const result = await testComfyConnection();
  if (result.ok) {
    statusEl.className = "image-st-llm-status image-st-llm-status-ok";
    resultEl.textContent = `连接成功 (${result.elapsed}ms)`;
  } else {
    statusEl.className = "image-st-llm-status image-st-llm-status-error";
    resultEl.textContent = `连接失败: ${result.error}`;
  }
}

async function testLatentMoeConnection() {
  const resultEl = document.getElementById("image_st_latent_test_result");
  if (!resultEl) return;
  resultEl.textContent = "测试中...";
  resultEl.style.color = "var(--SmartThemeEmColor)";
  try {
    // 验证 API Key 格式
    const s = extension_settings[SETTINGS_KEY];
    const apiKey = s.latent_api_key;
    if (!apiKey || !apiKey.startsWith("lat_sk_")) {
      resultEl.textContent = "API Key 格式不正确，应为 lat_sk_...";
      resultEl.style.color = "var(--SmartThemeQuoteColor)";
      return;
    }

    // latent.moe 不支持浏览器直连（CORS preflight 无响应头）
    // 走 ST 服务端代理 /proxy/<encoded-url>，由 ST 在后端转发请求
    // 需要在 config.yaml 中设置 enableCorsProxy: true
    // credentials: "include" 让浏览器自动携带 ST basicAuth 凭据（若已登录则浏览器缓存中有）
    const targetUrl = "https://latent.moe/api/generate/status";
    const proxyUrl = `/proxy/${encodeURIComponent(targetUrl)}`;

    let resp: Response;
    try {
      resp = await fetch(proxyUrl, {
        credentials: "include",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
        },
      });
    } catch {
      // /proxy/ 路由不存在（未启用 enableCorsProxy），降级为只验证 Key 格式
      resultEl.textContent = "API Key 格式正确 · 连通性验证需在 ST config.yaml 中设置 enableCorsProxy: true";
      resultEl.style.color = "var(--SmartThemeEmColor)";
      return;
    }

    if (resp.status === 404) {
      // /proxy/ 路由不存在
      resultEl.textContent = "API Key 格式正确 · 连通性验证需在 ST config.yaml 中设置 enableCorsProxy: true";
      resultEl.style.color = "var(--SmartThemeEmColor)";
      return;
    }
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      // 判断是 ST 自身拦截（返回 HTML）还是 latent.moe 的错误
      if (errText.includes("<html") || errText.includes("Unauthorized")) {
        throw new Error(`ST 代理认证失败 (${resp.status})，请检查 basicAuth 配置或 enableCorsProxy 是否开启`);
      }
      throw new Error(`${resp.status} ${errText.slice(0, 200)}`);
    }

    const data = await resp.json() as { workers_online?: number; queue_depth?: number };
    resultEl.textContent = `连接成功 · 在线 Worker: ${data.workers_online ?? 0} · 队列: ${data.queue_depth ?? 0}`;
    resultEl.style.color = "var(--active)";
  } catch (err) {
    resultEl.textContent = `连接失败: ${err instanceof Error ? err.message : String(err)}`;
    resultEl.style.color = "var(--SmartThemeQuoteColor)";
  }
}

async function testRunningHubConnection() {
  const resultEl = document.getElementById("image_st_rh_test_result");
  if (!resultEl) return;
  resultEl.textContent = "测试中...";
  resultEl.style.color = "var(--SmartThemeEmColor)";
  try {
    const s = extension_settings[SETTINGS_KEY];
    const apiKey = s.rh_api_key;
    if (!apiKey || !String(apiKey).trim()) {
      resultEl.textContent = "API Key 未填写";
      resultEl.style.color = "var(--SmartThemeQuoteColor)";
      return;
    }
    // 调用账户信息接口验证 API Key 有效性
    // 注意：Host 是 forbidden header，浏览器会静默丢弃，不应由用户代码设置
    const resp = await fetch("https://www.runninghub.ai/task/openapi/account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey }),
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const body = await resp.json() as { code: number; msg: string; data?: { coins?: number | string } };
    if (body.code !== 0) {
      throw new Error(`code=${body.code}: ${body.msg}`);
    }
    const coins = body.data?.coins ?? "?";
    resultEl.textContent = `连接成功 · 账户余额: ${coins} coins`;
    resultEl.style.color = "var(--active)";
  } catch (err) {
    resultEl.textContent = `连接失败: ${err instanceof Error ? err.message : String(err)}`;
    resultEl.style.color = "var(--SmartThemeQuoteColor)";
  }
}

function toggleBackendSettings(backend: string): void {
  // 在线后端专属设置面板的显示/隐藏
  const latentContainer = document.getElementById("image_st_latent_moe_settings");
  const rhContainer = document.getElementById("image_st_runninghub_settings");
  if (latentContainer) latentContainer.style.display = backend === "latent_moe" ? "" : "none";
  if (rhContainer) rhContainer.style.display = backend === "runninghub" ? "" : "none";

  // 仅在 ComfyUI tab 内操作，避免影响其他 tab
  const comfyTab = document.querySelector('.image-st-tab-content[data-tab="comfy"]') as HTMLElement | null;
  if (!comfyTab) return;

  // ComfyUI 专用控件的 wrapper ID 列表（直接给 wrapper 赋 display，而非用 closest 爬父容器）
  // 每个条目：[wrapperId, 是 ComfyUI 专用（true = 在线后端时隐藏）]
  const isOnline = backend !== "comfyui";

  // 通过 data 属性标记 ComfyUI 专用区块，避免 closest() 误伤无关容器
  const comfyOnlyWrapperIds = [
    "image_st_comfy_test_row",
    "image_st_comfy_url_row",
    "image_st_model_row",
    "image_st_workflow_note",
    "image_st_sampling_section",
  ];
  for (const id of comfyOnlyWrapperIds) {
    const el = document.getElementById(id);
    if (el) el.style.display = isOnline ? "none" : "";
  }

  // 没有 wrapper ID 的单个控件：直接操作其最近的有意义父元素
  // 用 data-comfy-only 属性来标记（已在 HTML 里加，见下方）
  comfyTab.querySelectorAll<HTMLElement>("[data-comfy-only]").forEach(el => {
    el.style.display = isOnline ? "none" : "";
  });

  // 测试连接按钮行（ComfyUI 专用）
  const testComfyBtn = document.getElementById("image_st_test_comfy") as HTMLElement | null;
  const testComfyStatus = document.getElementById("image_st_comfy_status") as HTMLElement | null;
  const testComfyResult = document.getElementById("image_st_comfy_test_result") as HTMLElement | null;
  if (testComfyBtn) testComfyBtn.style.display = isOnline ? "none" : "";
  if (testComfyStatus) testComfyStatus.style.display = isOnline ? "none" : "";
  if (testComfyResult) testComfyResult.style.display = isOnline ? "none" : "";
}

function onTestTextCleaning() {
  const resultEl = document.getElementById("image_st_test_cleaning_result") as HTMLTextAreaElement;
  if (!resultEl) return;
  const s = extension_settings[SETTINGS_KEY];
  const context = getContext();
  const messages = context.chat ?? [];
  const config = getTextCleaningConfig(s);
  const processResult = processTextPipeline(messages, config);
  resultEl.value = processResult || "(无有效文本)";
  const charEl = document.getElementById("image_st_test_cleaning_chars");
  if (charEl) charEl.textContent = `(${(processResult || "").length} 字符)`;
}

// ============================================================
// v1.9.1 性能：CHAT_CHANGED 惰性刷新（节流 + 抽屉门控 + 空闲错峰）
// 职责：面板刷新只在设置抽屉打开时执行；否则仅清缓存标记脏。
// ============================================================
let panelsDirty = false;
let drawerObserver: MutationObserver | null = null;
let chatChangedHandler: (() => void) | null = null;

function isSettingsDrawerOpen(): boolean {
    // 优先检查 image_st_settings 所在的抽屉（设置已初始化后）
    const root = document.getElementById("image_st_settings");
    if (root) {
        const content = root.closest(".drawer-content") as HTMLElement | null;
        if (!content) return true;
        if (content.classList.contains("openDrawer")) return true;
        if (content.classList.contains("closedDrawer")) return false;
        return content.offsetParent !== null;
    }
    // 回退：直接检查主扩展设置抽屉（设置未初始化时）
    const mainDrawer = document.getElementById("rm_extensions_block") as HTMLElement | null;
    if (mainDrawer) {
        if (mainDrawer.classList.contains("openDrawer")) return true;
        if (mainDrawer.classList.contains("closedDrawer")) return false;
        return mainDrawer.offsetParent !== null;
    }
    return false;
}

function cleanupDrawerObserver(): void {
    if (drawerObserver) {
        drawerObserver.disconnect();
        drawerObserver = null;
    }
}

function cleanupChatChangedListener(): void {
    if (chatChangedHandler) {
        eventSource.off(event_types.CHAT_CHANGED, chatChangedHandler);
        chatChangedHandler = null;
    }
}

function resetPanelsPlaceholder(): void {
    const mvuTree = document.getElementById("image_st_mvu_tree");
    if (mvuTree) mvuTree.innerHTML = '<div class="image-st-hint-text">MVU 状态：未检测</div>';
    const mvuStatusEl = document.getElementById("image_st_mvu_status");
    if (mvuStatusEl) mvuStatusEl.textContent = "MVU 状态：未检测";
    const mvuFoldStatus = document.getElementById("image_st_mvu_fold_status");
    if (mvuFoldStatus) { mvuFoldStatus.textContent = "未检测"; mvuFoldStatus.title = ""; }
    const invalidBar = document.getElementById("image_st_mvu_invalid");
    if (invalidBar) invalidBar.style.display = "none";
    const selectedBox = document.getElementById("image_st_mvu_selected");
    if (selectedBox) selectedBox.innerHTML = "";

    const dbTree = document.getElementById("image_st_db_tree");
    if (dbTree) dbTree.innerHTML = '<div class="image-st-hint-text">数据库状态：未检测</div>';
    const dbStatusEl = document.getElementById("image_st_db_status");
    if (dbStatusEl) dbStatusEl.textContent = "数据库状态：未检测";
    const dbFoldStatus = document.getElementById("image_st_db_fold_status");
    if (dbFoldStatus) { dbFoldStatus.textContent = "未检测"; dbFoldStatus.title = ""; }
    const dbSelectedBox = document.getElementById("image_st_db_selected");
    if (dbSelectedBox) dbSelectedBox.innerHTML = "";
    const bbsTree = document.getElementById("image_st_bbs_tree");
    if (bbsTree) bbsTree.innerHTML = '<div class="image-st-hint-text">柏宝书：未检测</div>';
    const bbsStatusEl = document.getElementById("image_st_bbs_status");
    if (bbsStatusEl) bbsStatusEl.textContent = "柏宝书：未检测";
    const bbsFoldStatus = document.getElementById("image_st_bbs_fold_status");
    if (bbsFoldStatus) { bbsFoldStatus.textContent = "未检测"; bbsFoldStatus.title = ""; }
    const bbsSelectedBox = document.getElementById("image_st_bbs_selected");
    if (bbsSelectedBox) bbsSelectedBox.innerHTML = "";

    const previewResult = document.getElementById("image_st_preview_result") as HTMLTextAreaElement;
    if (previewResult) previewResult.value = "";
    const previewChars = document.getElementById("image_st_preview_chars");
    if (previewChars) previewChars.textContent = "(0 字符)";
}

function refreshPanelsIfOpen(): void {
    if (!isSettingsDrawerOpen()) return;
    panelsDirty = false;
    resetPanelsPlaceholder();
    const s_ = extension_settings[SETTINGS_KEY];
    if (s_?.mvu_enabled) {
        refreshMvuData().then(() => refreshMvuPanelExtras());
    }
    if (s_?.db_enabled) {
        refreshDatabaseData().then(ok => {
            refreshDbPanelExtras();
            const dbStatusEl = document.getElementById("image_st_db_status");
            if (dbStatusEl) {
                if (ok) {
                    const st = getDatabaseStatus();
                    dbStatusEl.textContent = `数据库状态：已就绪 (${st.sheets} 表 / ${st.rows} 行)`;
                } else {
                    dbStatusEl.textContent = "数据库状态：不可用";
                }
            }
        });
    }
    if (s_?.bbs_enabled) {
        refreshBaibaiData().then(() => {
            rebuildBaibaiTree();
            refreshBbsPanelExtras();
        });
    }
    refreshLocalPanelOnChatChange();
}

function schedulePanelRefresh(): void {
    panelsDirty = true;
    scheduleIdle(() => {
        if (panelsDirty) refreshPanelsIfOpen();
    });
}

/**
 * v2.7 性能：用户真正打开设置面板时才**按需加载**完整词库。
 * 幂等：已加载则直接返回；未导入过词库则不做任何事。
 */
function loadFullLexiconOnDemand(): void {
    if (isFullLexiconReady()) return;
    // 以 IndexedDB 实际内容为准（getLexiconLoadState），而不是 UI 标记 ext_dict_imported
    // —— 后者可能因历史原因与实际存储不同步，导致按需加载永远不触发。
    if (getLexiconLoadState() !== "persisted") return;
    refreshDictStatus();
    void ensureFullLexicon().then(() => {
        refreshDictStatus();
    });
}

function initDrawerObserver(): void {
    cleanupDrawerObserver();
    // 直接监听主扩展设置抽屉 (#rm_extensions_block)，不依赖 image_st_settings 存在
    // 避免循环依赖：observer 触发 createSettingsUI，但 observer 初始化需要 image_st_settings 存在
    const content = document.getElementById("rm_extensions_block") as HTMLElement | null;
    if (!content) {
        console.warn("[image_st] 主扩展设置抽屉未找到，无法设置抽屉观察器");
        return;
    }
    let wasOpen = false; // 强制第一次打开时触发
    let initialRefreshDone = false;
    drawerObserver = new MutationObserver(() => {
        // 直接检查抽屉的 class，不依赖 isSettingsDrawerOpen()
        const open = content.classList.contains("openDrawer");
        if (open && !wasOpen) {
            wasOpen = true;
            schedulePanelRefresh();
            loadFullLexiconOnDemand();
            // 首次打开抽屉时延迟初始化设置面板（避免启动时阻塞）
            const win = window as unknown as { image_st?: Record<string, unknown> };
            if (win.image_st?._lazyInitSettingsUI) {
                (win.image_st._lazyInitSettingsUI as () => Promise<void>)().catch(err => {
                    console.error("[image_st] 惰性初始化设置面板失败:", err);
                });
            }
            // 首次打开时做一次初始数据刷新（原 init 中的 setTimeout 150ms 逻辑）
            if (!initialRefreshDone) {
                initialRefreshDone = true;
                const s_ = extension_settings[SETTINGS_KEY];
                const refresh: Promise<unknown>[] = [];
                if (s_?.mvu_enabled) refresh.push(refreshMvuData());
                if (s_?.db_enabled) refresh.push(refreshDatabaseData());
                if (s_?.bbs_enabled) refresh.push(refreshBaibaiData());
                Promise.all(refresh).then(() => refreshMvuPanelExtras());
                refreshLocalPanelOnChatChange();
            }
        } else if (!open) {
            wasOpen = false;
            // 抽屉关闭时 flush 关键词保存（避免用户输入后关面板丢失）
            const keywordsEl = document.getElementById("image_st_local_keywords") as HTMLTextAreaElement | null;
            const flushFn = (keywordsEl as HTMLTextAreaElement & { _flushKwSave?: () => void })._flushKwSave;
            if (flushFn) flushFn();
        }
    });
    drawerObserver.observe(content, { attributes: true, attributeFilter: ["class"] });
}

// ============================================================
// createSettingsUI — 设置面板主构建器 (移自 index.ts)
// onGenerate / getPreview / getPipelinePreview 由 index.ts 注入（避免反向导入）
// ============================================================
async function createSettingsUI(
  onGenerate: () => Promise<void>,
  getPreview: () => Promise<string>,
  getPipelinePreview?: () => string,
): Promise<void> {
  console.trace("[image_st] createSettingsUI called");
  
  // Clean up previous UI and listeners before re-rendering
  cleanupChatChangedListener();
  cleanupDrawerObserver();
  
  // Remove old settings root if exists (prevents duplicate UI on re-render)
  const oldRoot = document.getElementById("image_st_settings");
  if (oldRoot) oldRoot.remove();
  
  const container = document.getElementById("extensions_settings");
  if (!container) {
    console.error("[image_st] extensions_settings container not found");
    return;
  }
  const s = extension_settings[SETTINGS_KEY];
  // v2.1: 注入柏宝书模块的设置访问器
  configureBaibai(() => extension_settings[SETTINGS_KEY]);
  let html = "";
  try {
    html = await renderExtensionTemplateAsync(EXTENSION_FOLDER, 'settings', {
      api_key: s.apiKey ?? '',
      comfy_url: s.comfy_url || DEFAULTS.comfyUrl,
      llm_url: s.llm_url || LLM_URL_DEFAULT,
      llm_model: s.llm_model || LLM_MODEL_DEFAULT,
      llm_max_tokens: s.llm_max_tokens ?? 512,
      thinking_budget: s.thinking_budget ?? 0,
      steps: s.steps ?? DEFAULTS.steps,
      first_steps: s.first_steps ?? 0,
      first_cfg: s.first_cfg ?? DEFAULTS.first_cfg,
      second_cfg: s.second_cfg ?? DEFAULTS.second_cfg,
      width: s.width ?? DEFAULTS.width,
      height: s.height ?? DEFAULTS.height,
      seed: s.seed ?? -1,
      fixed_prefix: s.fixed_prompt_prefix ?? '',
      fixed_suffix: s.fixed_prompt_suffix ?? '',
      negative_prompt: s.negative_prompt ?? '',
      // latent.moe 设置
      generation_backend: s.generation_backend || "comfyui",
      latent_api_key: s.latent_api_key ?? "",
      latent_resolution: s.latent_resolution || "portrait",
      latent_steps: s.latent_steps ?? 12,
      latent_sampler: s.latent_sampler || "euler",
      latent_scheduler: s.latent_scheduler || "sgm_uniform",
      latent_negative_prompt: s.latent_negative_prompt ?? "low quality, blurry, malformed hands, bad anatomy, extra limbs, missing limbs, fused fingers, too many fingers, long neck, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry, bad feet",
      // RunningHub 设置
      rh_api_key: s.rh_api_key ?? "",
      rh_workflow_id: s.rh_workflow_id ?? "",
      rh_prompt_node_id: s.rh_prompt_node_id ?? "",
      rh_negative_node_id: s.rh_negative_node_id ?? "",
      rh_negative_prompt: s.rh_negative_prompt ?? "low quality, blurry, malformed hands, bad anatomy, extra limbs, missing limbs, fused fingers, too many fingers, long neck, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry, bad feet",
    });
  } catch (err) {
    console.error("[image_st] Template render failed:", err);
    container.innerHTML = `<div style="padding:16px;color:red;">面板渲染失败: ${err instanceof Error ? err.message : String(err)}</div>`;
    return;
  }
  container.insertAdjacentHTML("beforeend", html);
  console.debug("[image_st] Settings HTML inserted");

  const keyInput = document.getElementById("image_st_api_key") as HTMLInputElement;
  keyInput?.addEventListener("change", () => {
    s.apiKey = keyInput.value;
    saveSettingsDebounced();
  });

  const llmUrlInput = document.getElementById("image_st_llm_url") as HTMLInputElement;
  llmUrlInput?.addEventListener("change", () => {
    s.llm_url = llmUrlInput.value.trim() || LLM_URL_DEFAULT;
    saveSettingsDebounced();
  });

  const llmModelInput = document.getElementById("image_st_llm_model") as HTMLInputElement;
  llmModelInput?.addEventListener("change", () => {
    s.llm_model = llmModelInput.value.trim() || LLM_MODEL_DEFAULT;
    saveSettingsDebounced();
  });

  const urlInput = document.getElementById("image_st_comfy_url") as HTMLInputElement;
  urlInput?.addEventListener("change", () => {
    s.comfy_url = urlInput.value.trim() || DEFAULTS.comfyUrl;
    saveSettingsDebounced();
  });

  const bindNum = (id: string, key: string) => {
    const el = document.getElementById(id) as HTMLInputElement;
    el?.addEventListener("change", () => {
      const num = el.value === "" ? 0 : Number(el.value);
      (extension_settings[SETTINGS_KEY] as Record<string, unknown>)[key] = Number.isFinite(num) ? num : 0;
      saveSettingsDebounced();
    });
    el?.addEventListener("focus", () => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  };
  bindNum("image_st_steps", "steps");
  bindNum("image_st_first_steps", "first_steps");
  bindNum("image_st_first_cfg", "first_cfg");
  bindNum("image_st_second_cfg", "second_cfg");
  bindNum("image_st_width", "width");
  bindNum("image_st_height", "height");
  bindNum("image_st_seed", "seed");

  const bindText = (id: string, key: string) => {
    const el = document.getElementById(id) as HTMLTextAreaElement;
    el?.addEventListener("change", () => {
      (extension_settings[SETTINGS_KEY] as Record<string, unknown>)[key] = el.value;
      saveSettingsDebounced();
    });
    el?.addEventListener("focus", () => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  };
  bindText("image_st_fixed_prefix", "fixed_prompt_prefix");
  bindText("image_st_fixed_suffix", "fixed_prompt_suffix");
  bindText("image_st_negative_prompt", "negative_prompt");

  const bindSelect = (id: string, key: string) => {
    const el = document.getElementById(id) as HTMLSelectElement;
    el?.addEventListener("change", () => {
      (extension_settings[SETTINGS_KEY] as Record<string, unknown>)[key] = el.value;
      saveSettingsDebounced();
    });
    el?.addEventListener("focus", () => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  };
  bindSelect("image_st_model", "model");
  bindSelect("image_st_first_sampler", "first_sampler");
  bindSelect("image_st_first_scheduler", "first_scheduler");
  bindSelect("image_st_second_sampler", "second_sampler");
  bindSelect("image_st_second_scheduler", "second_scheduler");
  // POV 触发词 / NSFW 关键词：已移入「生成管线」tab（POV 判定模块旁），此处不再绑定
  bindNum("image_st_llm_max_tokens", "llm_max_tokens");
  bindNum("image_st_thinking_budget", "thinking_budget");
  bindNum("image_st_llm_temperature", "llm_temperature");
  bindNum("image_st_llm_top_p", "llm_top_p");
  // v1.1.3: 初始化温度/核采样 UI 显示值
  (document.getElementById("image_st_llm_temperature") as HTMLInputElement).value = String(s.llm_temperature ?? 1);
  (document.getElementById("image_st_llm_top_p") as HTMLInputElement).value = String(s.llm_top_p ?? 1);
  bindSelect("image_st_llm_reasoning_effort", "llm_reasoning_effort");
  (document.getElementById("image_st_llm_reasoning_effort") as HTMLSelectElement).value = (s.llm_reasoning_effort as string) ?? "none";

  // v1.1.3: 思考模式下提示 temperature/top_p 不生效
  // v2.1: GLM-5.3 系为强制思考模型 —— 无法关闭思考，选项映射为 reasoning_effort
  const updateThinkingHint = () => {
    const hint = document.getElementById("image_st_llm_thinking_hint");
    if (!hint) return;
    const effort = (document.getElementById("image_st_llm_reasoning_effort") as HTMLSelectElement)?.value;
    const model = (document.getElementById("image_st_llm_model") as HTMLInputElement)?.value ?? "";
    if (isGLMForcedThinking(model)) {
      hint.textContent = "GLM-5.3 为强制思考模型：无法关闭思考（thinking.type 仅接受 enabled）。思考强度经 reasoning_effort 控制——Non-think→low（最轻量）、High→high、Max→max。该模型不支持 Thinking Budget；思考模式下 Temperature/Top P 通常不生效。";
      hint.style.display = "";
    } else {
      hint.textContent = "思考模式下 Temperature 与 Top P 参数不会生效。";
      hint.style.display = effort && effort !== "none" ? "" : "none";
    }
  };
  document.getElementById("image_st_llm_reasoning_effort")?.addEventListener("change", updateThinkingHint);
  llmModelInput?.addEventListener("input", updateThinkingHint);
  updateThinkingHint();

  // v2.x: 按当前模型名实时展示家族与上下文窗口（帮助用户判断参数是否适配）
  const refreshLLMProfileHint = () => {
    const hint = document.getElementById("image_st_llm_profile");
    if (!hint) return;
    const model = (document.getElementById("image_st_llm_model") as HTMLInputElement)?.value || LLM_MODEL_DEFAULT;
    const family = detectModelFamily(model);
    const ctx = getModelContextLength(model);
    const thinking = familySupportsThinking(family);
    const familyLabel = { qwen: "Qwen", glm: "GLM", kimi: "Kimi", deepseek: "DeepSeek", nemotron: "Nemotron", generic: "未知/通用" };
    // v2.1: GLM-5.3 系强制思考（不可关闭，强度经 reasoning_effort 控制）
    const tail = family === "glm" && isGLMForcedThinking(model)
      ? "强制思考（无法关闭，强度经 reasoning_effort: low/high/max 控制）"
      : thinking ? "支持思考模式" : "不支持思考模式（思考选项将按通用网关处理）";
    hint.textContent = `识别家族：${familyLabel[family]} | 上下文：${(ctx / 1000).toFixed(0)}K tokens | ${tail}`;
  };
  llmModelInput?.addEventListener("input", refreshLLMProfileHint);
  refreshLLMProfileHint();

  // v2.2: 旧版角色串格式开关已移除（v3.x 起人数标签恒为 (solo:3)/(Ncharacter:3)、
  // 性别恒并入括号短语，该开关不再被规则引擎读取，属无效开关）。
  // 生成链路 / 解析模式 / 公共后处理 / 格式化开关已收敛到「生成管线」tab（模块化开关）。
  // 此处不再绑定旧的 gen_pipeline / ext_* / pp_* 控件（旧键仅保留用于一次性迁移）。
  // 词库状态与导入/移除按钮已移入「生成管线」tab 的「标签工具调用」模块内（事件委托绑定）。
  // v2.7 性能：完整词库**惰性加载** —— 这里只做一次**廉价探测**（IndexedDB count，不读 blob、不解密），
  // 不再在页面加载时就解密 15MB 词库包（实测 ≈180ms 主线程阻塞 + ≈94MB 常驻堆，手机端首屏直接卡住）。
  // 真正的解码建索引推迟到「打开设置抽屉」或「点击生成」时才发生。
  // 存储里已无可用数据时撤销标记，避免之后每次生成/加载都空转一次恢复。
  if ((s as Record<string, unknown>).ext_dict_imported === true) {
    scheduleIdle(() => {
      void hasPersistedLexicon().then((present) => {
        if (!present) {
          (s as Record<string, unknown>).ext_dict_imported = false;
          saveSettingsDebounced();
        }
        refreshDictStatus();
      });
    });
  }
  // LLM 调用优化
  const boolCheck = (id: string, key: string, defaultVal: boolean) => {
    const el = document.getElementById(id) as HTMLInputElement;
    if (!el) return;
    el.checked = (s as Record<string, unknown>)[key] === true || defaultVal;
    el.addEventListener("change", () => {
      (s as Record<string, unknown>)[key] = el.checked;
      saveSettingsDebounced();
    });
  };
  boolCheck("image_st_llm_json_mode", "llm_json_mode", false);
  boolCheck("image_st_retry_json_fail", "retry_json_fail", false);

  const firstStepsEl = document.getElementById("image_st_first_steps") as HTMLInputElement;
  const toggleFirstPassSection = () => {
    const section = document.getElementById("image_st_first_pass_section");
    if (section) section.style.display = Number(firstStepsEl?.value) > 0 ? "" : "none";
  };
  firstStepsEl?.addEventListener("change", toggleFirstPassSection);
  toggleFirstPassSection();

  populateModelDropdown();
  rebuildLoraUI();
  void populateLoraDropdowns(); // 非阻塞，内部只填充一次
  rebuildRegexRulesUI();

  // v1.1: 一次性事件绑定（不再在 rebuild* 中重复挂载）
  bindLoraEvents();
  bindRegexEvents();

  // v1.1.2: Prompt tags
  rebuildPromptTagsUI();
  bindPromptTagEvents();

  // v1.x: Style presets
  initStylePresetUI();
  bindStylePresetEvents();

  // API Profile Management
  rebuildApiProfilesUI();
  bindApiProfileEvents();

  const linkSlider = (sliderId: string, numId: string) => {
    const slider = document.getElementById(sliderId) as HTMLInputElement;
    const num = document.getElementById(numId) as HTMLInputElement;
    if (!slider || !num) return;
    slider.addEventListener('input', () => {
      num.value = slider.value;
      num.dispatchEvent(new Event('change', { bubbles: true }));
    });
    num.addEventListener('input', () => {
      slider.value = num.value;
    });
  };
  linkSlider('image_st_steps_slider', 'image_st_steps');
  linkSlider('image_st_first_cfg_slider', 'image_st_first_cfg');
  linkSlider('image_st_second_cfg_slider', 'image_st_second_cfg');
  linkSlider('image_st_width_slider', 'image_st_width');
  linkSlider('image_st_height_slider', 'image_st_height');
  linkSlider('image_st_floor_count_slider', 'image_st_floor_count');
  linkSlider('image_st_truncate_percent_slider', 'image_st_truncate_percent');
  linkSlider('image_st_llm_temperature_slider', 'image_st_llm_temperature');
  linkSlider('image_st_llm_top_p_slider', 'image_st_llm_top_p');

  const floorCountEl = document.getElementById("image_st_floor_count") as HTMLInputElement;
  floorCountEl?.addEventListener("change", () => {
    s.floor_count = floorCountEl.value === "" ? 1 : Number(floorCountEl.value);
    saveSettingsDebounced();
  });
  bindSelect("image_st_truncate_direction", "truncate_direction");
  const truncatePercentEl = document.getElementById("image_st_truncate_percent") as HTMLInputElement;
  truncatePercentEl?.addEventListener("change", () => {
    s.truncate_percent = truncatePercentEl.value === "" ? 100 : Number(truncatePercentEl.value);
    saveSettingsDebounced();
  });

  const floorCountSlider = document.getElementById("image_st_floor_count_slider") as HTMLInputElement;
  if (floorCountSlider) floorCountSlider.value = String(s.floor_count ?? 1);
  const floorCountNum = document.getElementById("image_st_floor_count") as HTMLInputElement;
  if (floorCountNum) floorCountNum.value = String(s.floor_count ?? 1);
  const directionEl = document.getElementById("image_st_truncate_direction") as HTMLSelectElement;
  if (directionEl) directionEl.value = s.truncate_direction ?? "top";
  const truncateSlider = document.getElementById("image_st_truncate_percent_slider") as HTMLInputElement;
  if (truncateSlider) truncateSlider.value = String(s.truncate_percent ?? 100);
  const truncateNum = document.getElementById("image_st_truncate_percent") as HTMLInputElement;
  if (truncateNum) truncateNum.value = String(s.truncate_percent ?? 100);

  // Truncate mode handling
  const truncateModeEl = document.getElementById("image_st_truncate_mode") as HTMLSelectElement;
  const truncatePercentGroup = document.getElementById("image_st_truncate_percent_group") as HTMLElement;
  const truncateCharsGroup = document.getElementById("image_st_truncate_chars_group") as HTMLElement;
  const truncateDirectionCharsEl = document.getElementById("image_st_truncate_direction_chars") as HTMLSelectElement;
  const truncateCharsEl = document.getElementById("image_st_truncate_chars") as HTMLInputElement;
  const truncateToleranceEl = document.getElementById("image_st_truncate_tolerance") as HTMLInputElement;

  function updateTruncateModeUI() {
    const mode = truncateModeEl?.value ?? "percent";
    if (truncatePercentGroup) truncatePercentGroup.style.display = mode === "percent" ? "" : "none";
    if (truncateCharsGroup) truncateCharsGroup.style.display = mode === "chars" ? "" : "none";
  }
  truncateModeEl?.addEventListener("change", () => {
    s.truncate_mode = truncateModeEl.value as "percent" | "chars";
    saveSettingsDebounced();
    updateTruncateModeUI();
  });
  updateTruncateModeUI();

  // Bind truncate chars settings
  bindSelect("image_st_truncate_direction_chars", "truncate_direction");
  truncateCharsEl?.addEventListener("change", () => {
    s.truncate_chars = truncateCharsEl.value === "" ? 2000 : Number(truncateCharsEl.value);
    saveSettingsDebounced();
  });
  truncateToleranceEl?.addEventListener("change", () => {
    s.truncate_tolerance = truncateToleranceEl.value === "" ? 100 : Number(truncateToleranceEl.value);
    saveSettingsDebounced();
  });

  // Initialize truncate chars values
  if (truncateDirectionCharsEl) truncateDirectionCharsEl.value = s.truncate_direction ?? "top";
  if (truncateCharsEl) truncateCharsEl.value = String(s.truncate_chars ?? 2000);
  if (truncateToleranceEl) truncateToleranceEl.value = String(s.truncate_tolerance ?? 100);

  // Extract tags button
  document.getElementById("image_st_extract_tags")?.addEventListener("click", async () => {
    const resultEl = document.getElementById("image_st_test_cleaning_result") as HTMLTextAreaElement;
    const extractedContainer = document.getElementById("image_st_extracted_tags_container") as HTMLElement;
    if (!resultEl || !extractedContainer) return;
    
    const text = resultEl.value;
    if (!text || text === "(无有效文本)") {
      alert("请先执行测试获取清洗后的文本");
      return;
    }
    
    const groups = extractTagsFromText(text);
    if (groups.length === 0) {
      extractedContainer.innerHTML = '<div class="image-st-hint-text">未提取到标签</div>';
      extractedContainer.style.display = "block";
      return;
    }
    
    extractedContainer.innerHTML = "";
    const title = document.createElement("b");
    title.textContent = "提取的标签 (点击复制)：";
    extractedContainer.appendChild(title);
    
    for (const group of groups) {
      const groupDiv = document.createElement("div");
      groupDiv.style.marginTop = "8px";
      groupDiv.style.padding = "8px";
      groupDiv.style.border = "1px solid var(--SmartThemeBorderColor)";
      groupDiv.style.borderRadius = "6px";
      groupDiv.style.background = "var(--black30a)";
      
      const groupTitle = document.createElement("div");
      groupTitle.style.fontWeight = "bold";
      groupTitle.style.marginBottom = "6px";
      groupTitle.textContent = `${group.category} (${group.tags.length})`;
      groupDiv.appendChild(groupTitle);
      
      const tagsWrap = document.createElement("div");
      tagsWrap.style.display = "flex";
      tagsWrap.style.flexWrap = "wrap";
      tagsWrap.style.gap = "6px";
      
      for (const tag of group.tags) {
        const tagBtn = document.createElement("button");
        tagBtn.type = "button";
        tagBtn.className = "menu_button";
        tagBtn.style.fontSize = "12px";
        tagBtn.style.padding = "4px 8px";
        tagBtn.style.whiteSpace = "nowrap";
        tagBtn.textContent = tag;
        tagBtn.title = "点击复制到剪贴板";
        tagBtn.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(tag);
            const originalText = tagBtn.textContent;
            tagBtn.textContent = "✓ 已复制";
            tagBtn.style.background = "var(--active)";
            setTimeout(() => {
              tagBtn.textContent = originalText;
              tagBtn.style.background = "";
            }, 1000);
          } catch {
            alert("复制失败，请手动复制");
          }
        });
        tagsWrap.appendChild(tagBtn);
      }
      
      groupDiv.appendChild(tagsWrap);
      extractedContainer.appendChild(groupDiv);
    }
    
    extractedContainer.style.display = "block";
  });

  document.getElementById("image_st_refresh_models")?.addEventListener("click", async () => {
    await populateModelDropdown();
    await populateLoraDropdowns();
  });
  // 注：设置面板内无「生成」按钮（生成入口为悬浮按钮 / 自动生成），此处不再绑定已移除的 image_st_generate
  document.getElementById("image_st_test_llm")?.addEventListener("click", testLLMConnection);
  document.getElementById("image_st_test_comfy")?.addEventListener("click", testComfyUIConnection);
  document.getElementById("image_st_test_latent")?.addEventListener("click", testLatentMoeConnection);
  document.getElementById("image_st_test_runninghub")?.addEventListener("click", testRunningHubConnection);

  // 生成后端选择
  const backendSelect = document.getElementById("image_st_generation_backend") as HTMLSelectElement;
  if (backendSelect) {
    backendSelect.value = s.generation_backend ?? "comfyui";
    backendSelect.addEventListener("change", () => {
      s.generation_backend = backendSelect.value;
      saveSettingsDebounced();
      toggleBackendSettings(backendSelect.value);
    });
    // 初始显示/隐藏
    toggleBackendSettings(backendSelect.value);
  }

  // latent.moe 设置绑定
  bindText("image_st_latent_api_key", "latent_api_key");
  bindSelect("image_st_latent_resolution", "latent_resolution");
  bindNum("image_st_latent_steps", "latent_steps");
  bindSelect("image_st_latent_sampler", "latent_sampler");
  bindSelect("image_st_latent_scheduler", "latent_scheduler");
  bindText("image_st_latent_negative_prompt", "latent_negative_prompt");

  // RunningHub 设置绑定
  bindText("image_st_rh_api_key", "rh_api_key");
  bindText("image_st_rh_workflow_id", "rh_workflow_id");
  bindText("image_st_rh_prompt_node_id", "rh_prompt_node_id");
  bindText("image_st_rh_negative_node_id", "rh_negative_node_id");
  bindText("image_st_rh_negative_prompt", "rh_negative_prompt");
  document.getElementById("image_st_add_regex_rule")?.addEventListener("click", () => {
    const s_ = extension_settings[SETTINGS_KEY];
    if (!Array.isArray(s_.regex_rules)) s_.regex_rules = [];
    s_.regex_rules.push({ name: "", pattern: "", replacement: "", enabled: true, type: "extract", startTag: "", endTag: "", tag: "" });
    saveSettingsDebounced();
    rebuildRegexRulesUI();
    refreshPipelineModulesStatus();
  });
  document.getElementById("image_st_test_cleaning")?.addEventListener("click", onTestTextCleaning);

  // v1.1.2: Prompt tag add button
  document.getElementById("image_st_add_prompt_tag")?.addEventListener("click", () => {
    const s_ = extension_settings[SETTINGS_KEY];
    if (!Array.isArray(s_.prompt_tags)) s_.prompt_tags = [];
    s_.prompt_tags.push({ name: "", prompt: "", enabled: true });
    saveSettingsDebounced();
    rebuildPromptTagsUI();
  });

  // v1.1.2: Prompt tags enabled toggle
  const promptTagsEnabledEl = document.getElementById("image_st_prompt_tags_enabled") as HTMLInputElement;
  if (promptTagsEnabledEl) {
    promptTagsEnabledEl.checked = s.prompt_tags_enabled ?? false;
    promptTagsEnabledEl.addEventListener("change", () => {
      s.prompt_tags_enabled = promptTagsEnabledEl.checked;
      saveSettingsDebounced();
    });
  }

  populateDropdown('image_st_first_sampler', SAMPLERS, s.first_sampler ?? DEFAULTS.first_sampler);
  populateDropdown('image_st_first_scheduler', SCHEDULERS, s.first_scheduler ?? DEFAULTS.first_scheduler);
  populateDropdown('image_st_second_sampler', SAMPLERS, s.second_sampler ?? DEFAULTS.second_sampler);
  populateDropdown('image_st_second_scheduler', SCHEDULERS, s.second_scheduler ?? DEFAULTS.second_scheduler);

  const TAB_CSS_ID = "image_st_tab_css";
  if (!document.getElementById(TAB_CSS_ID)) {
    const style = document.createElement("style");
    style.id = TAB_CSS_ID;
    style.textContent = `
      #image_st_settings .image-st-tabs { display:flex; gap:4px; background:var(--black30a); padding:4px; border-radius:8px; margin-bottom:8px; flex-shrink:0; }
      #image_st_settings .image-st-tab { padding:6px 12px; background:transparent; border:none; border-radius:6px; color:var(--SmartThemeBodyColor); opacity:0.6; cursor:pointer; font-size:calc(var(--mainFontSize) * 0.9); font-weight:500; transition:all 0.2s; user-select:none; }
      #image_st_settings .image-st-tab:hover { opacity:0.9; }
      #image_st_settings .image-st-tab.active { opacity:1; background:var(--white30a); box-shadow:0 1px 2px var(--SmartThemeShadowColor); }
      #image_st_settings .image-st-tab[data-disabled="true"] { opacity:0.3; cursor:not-allowed; }
      #image_st_settings .image-st-tab[data-disabled="true"]:hover { opacity:0.3; }
      #image_st_settings .image-st-tab-content { border:1px solid var(--SmartThemeBorderColor); padding:8px; border-radius:10px; background-color:var(--black30a); }
      #image_st_settings .image-st-llm-status { display:inline-block; width:10px; height:10px; border-radius:50%; background:var(--SmartThemeBodyColor); opacity:0.3; flex-shrink:0; transition:all 0.3s; }
      #image_st_settings .image-st-llm-status-ok { opacity:1; background:var(--SmartThemeBodyColor); }
      #image_st_settings .image-st-llm-status-error { opacity:1; background:var(--SmartThemeQuoteColor); }
      #image_st_settings .image-st-llm-status-testing { opacity:1; background:var(--SmartThemeEmColor); }
      #image_st_settings .image-st-regex-empty { font-size:12px;color:var(--SmartThemeBodyColor);opacity:0.6; }
      #image_st_settings .image-st-regex-row { gap:6px;margin:4px 0;flex-wrap:wrap; }
      #image_st_settings .image-st-regex-name { width:80px; }
      #image_st_settings .image-st-regex-pattern { min-width:120px; }
      #image_st_settings .image-st-regex-replacement { width:100px; }
      #image_st_settings .image-st-regex-delete { padding:2px 6px;font-size:12px; }
      #image_st_settings .image-st-lora-section { margin:8px 0;padding:6px;border:1px solid var(--SmartThemeBorderColor);border-radius:6px; }
      #image_st_settings .image-st-lora-header { gap:8px;margin:0 0 6px 0; }
      /* v2.3 管线模块树：只读状态徽标 + 就地挂载的编辑器 */
      #image_st_settings .image-st-pipeline-status { display:inline-flex; align-items:center; flex-shrink:0; padding:1px 8px; border:1px solid var(--SmartThemeBorderColor); border-radius:10px; font-size:calc(var(--mainFontSize)*0.8); white-space:nowrap; }
      #image_st_settings .image-st-pipeline-status.on { color:var(--active); border-color:var(--active); }
      #image_st_settings .image-st-pipeline-status.off { opacity:0.55; }
      #image_st_settings .image-st-pipeline-editor { margin:4px 0 8px 20px; padding:6px 8px; border-left:2px solid var(--SmartThemeBorderColor); background:var(--black30a); border-radius:0 6px 6px 0; }
      #image_st_settings .image-st-pipeline-editor .image-st-hint-text { margin:2px 0 0 0; }
      #image_st_settings .image-st-pipeline-editor textarea { margin:2px 0; }
      #image_st_settings .image-st-dict-actions { display:flex; align-items:center; gap:8px; flex-wrap:nowrap; margin:6px 0 2px 0; }
      #image_st_settings .image-st-dict-actions .menu_button { flex:0 0 auto; width:auto; margin:0; padding:4px 10px; white-space:nowrap; }
      /* v2.3 管线诊断报告 */
      #image_st_settings .image-st-pipeline-reports { display:flex; flex-direction:column; gap:4px; }
      #image_st_settings .image-st-pipeline-report-row { border:1px solid var(--SmartThemeBorderColor); border-radius:5px; padding:4px 6px; }
      #image_st_settings .image-st-pipeline-report-head { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
      #image_st_settings .image-st-pipeline-report-warn { color:var(--SmartThemeEmColor,#c96); font-size:calc(var(--mainFontSize)*0.85); margin-top:2px; opacity:0.9; }
      #image_st_settings .image-st-lora-name-label { min-width:55px;font-size:calc(var(--mainFontSize) * 0.9); }
      #image_st_settings .image-st-lora-mode { min-width:90px; }
      #image_st_settings .image-st-lora-strength-row { gap:12px;flex-wrap:wrap; }
      #image_st_settings .image-st-lora-strength-wrapper { gap:4px; }
      #image_st_settings .image-st-lora-strength-label { font-size:12px;white-space:nowrap; }
      #image_st_settings .image-st-lora-strength-input { width:70px; }
      #image_st_settings .image-st-result { white-space:pre-wrap; }
      #image_st_settings .image-st-db-sheet { margin:8px 0;padding:6px;border:1px solid var(--SmartThemeBorderColor);border-radius:6px; }
      #image_st_settings .image-st-db-group-label { font-size:12px;color:var(--SmartThemeBodyColor);opacity:0.7;margin:4px 0 2px 0; }
      #image_st_settings .image-st-db-items { gap:6px;flex-wrap:wrap;margin:2px 0; }
      #image_st_settings .image-st-hint-text { font-size:12px;color:var(--SmartThemeBodyColor);opacity:0.6; }
      #image_st_settings .image-st-action-row { gap:8px;margin:8px 0; }
      #image_st_settings .image-st-mvu-tree { margin:4px 0; max-height:400px; overflow-y:auto; font-size:calc(var(--mainFontSize)*0.9); user-select:none; }
      #image_st_settings .image-st-tree-branch { padding:2px 0 2px 16px; display:flex; align-items:center; gap:4px; flex-wrap:nowrap; }
      #image_st_settings .image-st-tree-leaf { padding:2px 0 2px 16px; display:flex; align-items:center; gap:4px; cursor:pointer; }
      #image_st_settings .image-st-tree-leaf:hover { background:var(--white30a); border-radius:4px; }
      #image_st_settings .image-st-tree-toggle { cursor:pointer; display:inline-block; width:12px; text-align:center; transition:transform 0.15s; flex-shrink:0; }
      #image_st_settings .image-st-tree-toggle.expanded { transform:rotate(90deg); }
      #image_st_settings .image-st-tree-children { display:none; padding-left:8px; }
      #image_st_settings .image-st-tree-children.show { display:block; }
      #image_st_settings .image-st-tree-leaf-label { opacity:0.7; white-space:nowrap; }
      #image_st_settings .image-st-tree-spacer { display:inline-block; width:12px; flex-shrink:0; }
      #image_st_settings .image-st-tree-path-copy { opacity:0; cursor:pointer; font-size:12px; transition:opacity 0.15s; flex-shrink:0; }
      #image_st_settings .image-st-tree-branch:hover .image-st-tree-path-copy,
      #image_st_settings .image-st-tree-leaf:hover .image-st-tree-path-copy { opacity:0.6; }
      #image_st_settings .image-st-tree-path-copy:hover { opacity:1 !important; }
      #image_st_settings .image-st-tree-matrix-btn { cursor:pointer; opacity:0.55; padding:0 2px; flex-shrink:0; }
      #image_st_settings .image-st-tree-matrix-btn:hover, #image_st_settings .image-st-tree-matrix-btn.active { opacity:1; }
      #image_st_settings .image-st-mvu-matrix-container { display:none; margin:2px 0 6px 28px; overflow-x:auto; max-width:100%; }
      #image_st_settings .image-st-mvu-matrix-container.show { display:block; }
      #image_st_settings table.image-st-mvu-matrix { border-collapse:collapse; font-size:calc(var(--mainFontSize)*0.85); }
      #image_st_settings .image-st-mvu-matrix th, #image_st_settings .image-st-mvu-matrix td { padding:2px 8px; text-align:left; border-bottom:1px solid var(--white30a); white-space:nowrap; }
      #image_st_settings .image-st-mvu-matrix thead th { opacity:0.9; position:sticky; top:0; }
      #image_st_settings .image-st-mvu-matrix tbody th { font-weight:normal; opacity:0.85; }
      #image_st_settings .image-st-mvu-matrix-na { opacity:0.3; text-align:center; }
      #image_st_settings .image-st-mvu-matrix-drill { opacity:0.6; font-size:0.9em; }
      #image_st_settings .image-st-mvu-matrix-covered { outline:1px dashed var(--SmartThemeBodyColor); outline-offset:1px; }
      #image_st_settings .image-st-tree-tool-btn { cursor:pointer; opacity:0.6; padding:0 6px; flex-shrink:0; }
      #image_st_settings .image-st-tree-tool-btn:hover { opacity:1; }
      #image_st_settings .image-st-mvu-selected { display:flex; flex-wrap:wrap; gap:4px; margin:4px 0; }
      #image_st_settings .image-st-mvu-chip { display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border:1px solid var(--SmartThemeBorderColor); border-radius:10px; font-size:calc(var(--mainFontSize)*0.85); user-select:none; }
      /* v2.6：三模式变体面板（结果面板里展示多份提示词） */
      #image_st_settings .image-st-variant-panel { margin-top:10px; padding-top:8px; border-top:1px solid var(--SmartThemeBorderColor); }
      #image_st_settings .image-st-variant-title { font-size:calc(var(--mainFontSize)*0.9); opacity:0.8; margin-bottom:6px; }
      #image_st_settings .image-st-variant-row { margin-bottom:10px; }
      #image_st_settings .image-st-variant-head { font-size:12px; opacity:0.75; margin-bottom:4px; }
      #image_st_settings .image-st-variant-row textarea { width:100%; min-height:60px; font-size:12px; }
      #image_st_settings .image-st-variant-btns { display:flex; gap:8px; margin-top:4px; }
      #image_st_settings .image-st-mvu-chip-wild { border-style:dashed; }
      #image_st_settings .image-st-mvu-chip-invalid { border-color:#e5534b; color:#e5534b; }
      #image_st_settings .image-st-mvu-chip i { cursor:pointer; opacity:0.7; }
      #image_st_settings .image-st-mvu-chip i:hover { opacity:1; }
      #image_st_settings .image-st-local-chip { max-width:180px; min-width:0; }
      #image_st_settings .image-st-local-chip-txt { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
      #image_st_settings .image-st-local-chip-rm { display:inline-flex; align-items:center; justify-content:center; width:16px; height:16px; flex:0 0 16px; cursor:pointer; border-radius:50%; opacity:0.7; margin:0 -4px 0 0; }
      #image_st_settings .image-st-local-chip-rm:hover { opacity:1; background:rgba(0,0,0,0.1); }
      #image_st_settings .image-st-local-chip-rm i { font-size:0.75em; cursor:pointer; }
      #image_st_settings .image-st-local-entry { border-radius:4px; }
      #image_st_settings .image-st-local-entry-active { background:rgba(0,180,255,0.12); outline:1px solid var(--SmartThemeEmColor); outline-offset:-1px; }
      #image_st_settings .image-st-mvu-chip-ns { cursor:pointer; opacity:0.6; font-size:0.9em; }
      #image_st_settings .image-st-mvu-chip-ns:hover { opacity:1; }
      #image_st_settings .image-st-mvu-chip-clear { cursor:pointer; color:#e5534b; }
      #image_st_settings .image-st-mvu-invalid { color:#e5534b; font-size:calc(var(--mainFontSize)*0.85); margin:4px 0; display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
      #image_st_settings .image-st-mvu-invalid-btn { cursor:pointer; text-decoration:underline; flex-shrink:0; }
      #image_st_settings .image-st-search-hide { display:none !important; }
      #image_st_settings .image-st-search-hit { background:rgba(255, 213, 79, 0.25); border-radius:4px; }
      #image_st_settings .image-st-prompt-tag-section { margin:8px 0;padding:6px;border:1px solid var(--SmartThemeBorderColor);border-radius:6px; }
      #image_st_settings .image-st-prompt-tag-header { gap:8px;margin:0 0 4px 0; }
      #image_st_settings .image-st-prompt-tag-name { width:120px; }
      #image_st_settings .image-st-prompt-tag-delete { padding:2px 6px;font-size:12px; }
      #image_st_settings .image-st-regex-header { display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
      #image_st_settings .image-st-regex-body { display:flex; gap:6px; flex:1 1 100%; flex-wrap:wrap; }
      #image_st_settings .image-st-regex-collapsed .image-st-regex-body { display:none; }
      #image_st_settings .image-st-regex-collapsed input[data-field="name"] { opacity:0.4; cursor:default; }
      #image_st_settings .image-st-tag-body { margin:4px 0 0 0; }
      #image_st_settings .image-st-tag-collapsed .image-st-tag-body { display:none; }
      #image_st_settings .image-st-tag-collapsed input[data-field="name"] { opacity:0.4; cursor:default; }
      #image_st_settings .image-st-tag-collapsed .image-st-fold-arrow,
      #image_st_settings .image-st-regex-collapsed .image-st-fold-arrow { transform:rotate(-90deg); }
      /* v1.6: fold sections */
      #image_st_settings .image-st-fold-section { margin:4px 0; }
      #image_st_settings .image-st-fold-header { display:flex; align-items:center; gap:4px; padding:4px 6px; border:1px solid var(--SmartThemeBorderColor); border-radius:6px; cursor:pointer; user-select:none; transition:background 0.15s; }
      #image_st_settings .image-st-fold-header:hover { background:var(--white30a); }
      #image_st_settings .image-st-fold-arrow { font-size:10px; opacity:0.6; transition:transform 0.2s; flex-shrink:0; }
      #image_st_settings .image-st-fold-arrow.open { transform:rotate(90deg); }
      #image_st_settings .image-st-fold-body { padding:0 4px 4px 20px; display:none; }
      #image_st_settings .image-st-fold-body.open { display:block; }
      #image_st_settings details { margin:4px 0; }
      #image_st_settings details summary { cursor:pointer; opacity:0.85; font-size:calc(var(--mainFontSize)*0.95); padding:2px 4px; border-radius:4px; user-select:none; }
      #image_st_settings details summary:hover { opacity:1; background:var(--white30a); }
    `;
    document.head.appendChild(style);
  }

  const FLOATING_CSS_ID = "image_st_floating_css";
  if (!document.getElementById(FLOATING_CSS_ID)) {
    const fStyle = document.createElement("style");
    fStyle.id = FLOATING_CSS_ID;
    fStyle.textContent = `
      .image-st-floating-btn { position:fixed; width:56px; height:56px; border-radius:50%; background:var(--black50a); border:2px solid var(--SmartThemeBorderColor); box-shadow:0 2px 8px var(--SmartThemeShadowColor); cursor:grab; display:flex; align-items:center; justify-content:center; z-index:9999; font-size:22px; color:var(--SmartThemeBodyColor); transition:box-shadow 0.3s, border-color 0.3s, opacity 0.3s; opacity:0.85; user-select:none; backdrop-filter:blur(4px); min-width:56px; min-height:56px; }
      .image-st-floating-btn:hover { opacity:1; background:var(--white30a); }
      .image-st-floating-btn-prompting { border-color:var(--SmartThemeEmColor); box-shadow:0 0 12px var(--SmartThemeShadowColor); }
      .image-st-floating-btn-rendering { border-color:var(--SmartThemeQuoteColor); box-shadow:0 0 12px var(--SmartThemeShadowColor); }
      .image-st-floating-btn-done { border-color:var(--active); box-shadow:0 0 12px var(--SmartThemeShadowColor); }
      .image-st-floating-btn-failed { border-color:var(--SmartThemeQuoteColor); box-shadow:0 0 12px var(--SmartThemeShadowColor); }
      .image-st-floating-btn-busy { border-color:var(--SmartThemeDangerColor, #e5484d); box-shadow:0 0 14px rgba(229,72,77,.55); color:#e5484d; }
      @keyframes image-st-pulse { 0%,100% { box-shadow:0 0 12px var(--SmartThemeShadowColor); } 50% { box-shadow:0 0 20px var(--SmartThemeEmColor); } }
      .image-st-floating-btn-prompting.image-st-animate-pulse { animation:image-st-pulse 1.5s ease-in-out infinite; }
      .image-st-floating-btn-rendering.image-st-animate-pulse { animation:image-st-pulse 0.8s ease-in-out infinite; }
      .image-st-align-left { justify-content:flex-start !important; text-align:left !important; }
      .image-st-align-center { justify-content:center !important; text-align:center !important; }
      .image-st-align-right { justify-content:flex-end !important; text-align:right !important; }
      .image-st-align-left .mes_img_container, .image-st-align-center .mes_img_container, .image-st-align-right .mes_img_container,
      .image-st-align-left .mes_video_container, .image-st-align-center .mes_video_container, .image-st-align-right .mes_video_container { display:inline-block !important; }
      .image-st-size-small img,
      .image-st-size-small video,
      .image-st-size-small .mes_img_container,
      .image-st-size-small .mes_video_container { max-width:300px !important; }
      .image-st-size-medium img,
      .image-st-size-medium video,
      .image-st-size-medium .mes_img_container,
      .image-st-size-medium .mes_video_container { max-width:500px !important; }
      .image-st-size-large img,
      .image-st-size-large video,
      .image-st-size-large .mes_img_container,
      .image-st-size-large .mes_video_container { max-width:100% !important; }
      .image-st-size-small img, .image-st-size-small video,
      .image-st-size-medium img, .image-st-size-medium video,
      .image-st-size-large img, .image-st-size-large video { max-height:none !important; }
      .image-st-inline-progress { padding:8px 12px; margin:4px 0; border-radius:8px; background:var(--black30a); border:1px solid var(--SmartThemeBorderColor); font-size:calc(var(--mainFontSize) * 0.9); color:var(--SmartThemeBodyColor); display:flex; align-items:center; gap:8px; }
      .img_enlarged_title { max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:block; }
      /* v1.2: iOS touch optimizations — scoped to touch devices only, PC unaffected */
      @media (hover: none) and (pointer: coarse) {
        .image-st-floating-btn { touch-action:none; }
        #image_st_settings .image-st-tab { padding:10px 8px !important; }
        #image_st_settings .image-st-tabs { overflow-x:auto; -webkit-overflow-scrolling:touch; flex-shrink:0; }
        #image_st_settings .image-st-regex-delete,
        #image_st_settings .image-st-prompt-tag-delete { min-width:44px; min-height:44px; }
        #image_st_settings .menu_button { min-height:44px; }
        #image_st_settings .image-st-mvu-tree { max-height:200px; }
        #image_st_settings .image-st-tree-toggle { width:32px; height:32px; font-size:18px; display:flex; align-items:center; justify-content:center; }
        #image_st_settings .image-st-tree-path-copy { min-width:44px; min-height:44px; font-size:18px; opacity:0.5; }
        #image_st_settings .flex-container.flexnowrap { flex-wrap:wrap; }
        #image_st_settings .flex-container:has(> .flexBasis48p) { flex-direction:column; }
        #image_st_settings .flex1 { min-width:0; overflow:hidden; }
        #image_st_settings .image-st-regex-row { flex-direction:column; }
        #image_st_settings .image-st-tab-content textarea { min-height:80px; }
        #image_st_settings input[type="range"]::-webkit-slider-thumb { width:24px; height:24px; }
        #image_st_settings .image-st-tab-content { max-height:60vh; overflow-y:auto; -webkit-overflow-scrolling:touch; }
      }
    `;
    document.head.appendChild(fStyle);
  }

  const tabBar = document.getElementById("image_st_tab_bar");
  const settings_ = document.getElementById("image_st_settings");

  const activateTab = (tabId: string) => {
    if (!tabBar || !settings_) return;
    const target = tabBar.querySelector(`.image-st-tab[data-tab="${tabId}"]`) as HTMLElement | null;
    if (!target) return;
    tabBar.querySelectorAll(".image-st-tab").forEach(t => t.classList.remove("active"));
    target.classList.add("active");
    settings_.querySelectorAll(".image-st-tab-content").forEach(c => {
      (c as HTMLElement).style.display = c.getAttribute("data-tab") === tabId ? "" : "none";
    });
    const drawer = settings_.closest('.drawer-content') as HTMLElement | null;
    if (drawer) drawer.scrollTop = 0;
  };

  activateTab("comfy");

  tabBar?.addEventListener("click", (e) => {
    const target = (e.target as HTMLElement).closest(".image-st-tab") as HTMLElement | null;
    if (!target) return;
    if (target.getAttribute("data-disabled") === "true") return;
    const tabName = target.getAttribute("data-tab");
    if (!tabName) return;
    activateTab(tabName);
    if (tabName === "pipeline") {
      setupPipelinePanel();
    }
  });

  try {
    await loadDefaultWorkflow();
  } catch (err) {
    const wfStatus = document.getElementById("image_st_comfy_test_result");
    if (wfStatus) wfStatus.textContent = `工作流加载失败: ${err instanceof Error ? err.message : String(err)}`;
  }

  // CHAT_CHANGED: 仅清缓存标记脏（立即），面板重刷惰性化（抽屉打开才执行 + 空闲错峰）
  chatChangedHandler = () => {
    clearMvuCache();
    lastTreeRefs = null;
    clearDatabaseCache();
    lastDbTreeRefs = null;
    clearBaibaiCache();
    schedulePanelRefresh();
  };
  eventSource.on(event_types.CHAT_CHANGED, chatChangedHandler);

  // MVU enable checkbox
  const mvuEnabledEl = document.getElementById("image_st_mvu_enabled") as HTMLInputElement;
  if (mvuEnabledEl) {
    mvuEnabledEl.checked = s.mvu_enabled ?? false;
    mvuEnabledEl.addEventListener("change", () => {
      s.mvu_enabled = mvuEnabledEl.checked;
      saveSettingsDebounced();
      const statusEl = document.getElementById("image_st_mvu_status");
      const foldBody = document.getElementById("image_st_mvu_fold_body");
      const foldArrow = document.querySelector('.image-st-fold-header[data-section="mvu"] .image-st-fold-arrow') as HTMLElement | null;
      if (mvuEnabledEl.checked) {
        if (foldBody) foldBody.classList.add("open");
        if (foldArrow) foldArrow.classList.add("open");
        refreshMvuData().then(() => refreshMvuPanelExtras());
      } else {
        clearMvuCache();
        lastTreeRefs = null;
        if (foldBody) foldBody.classList.remove("open");
        if (foldArrow) foldArrow.classList.remove("open");
        if (statusEl) statusEl.textContent = "MVU 状态：未启用";
        const treeEl = document.getElementById("image_st_mvu_tree");
        if (treeEl) treeEl.innerHTML = '<div class="image-st-hint-text">MVU 状态：未启用</div>';
        const invalidBar = document.getElementById("image_st_mvu_invalid");
        if (invalidBar) invalidBar.style.display = "none";
        const selectedBox = document.getElementById("image_st_mvu_selected");
        if (selectedBox) selectedBox.innerHTML = "";
        const foldStatusEl = document.getElementById("image_st_mvu_fold_status");
        if (foldStatusEl) { foldStatusEl.textContent = "未启用"; foldStatusEl.title = ""; }
      }
    });
  }

  // Load MVU tree button
  document.getElementById("image_st_mvu_load_tree")?.addEventListener("click", () => {
    const tree = buildMvuTree();
    renderMvuTree(tree);
  });

  // P3: 失效条按钮 / 搜索 / 展开收起
  document.getElementById("image_st_mvu_invalid_view")?.addEventListener("click", () => {
    const box = document.getElementById("image_st_mvu_selected");
    box?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
  document.getElementById("image_st_mvu_invalid_clear")?.addEventListener("click", () => {
    const invalid = computeInvalidSelections();
    if (invalid.length === 0) return;
    if (!confirm(`确定清除 ${invalid.length} 条失效已选？（在当前卡的变量结构中不存在）`)) return;
    const invalidSet = new Set(invalid.map(sel => JSON.stringify(sel.path)));
    const s_ = extension_settings[SETTINGS_KEY];
    s_.mvu_selections = migrateMvuPaths(s_).filter(sel => !invalidSet.has(JSON.stringify(sel.path)));
    saveSettingsDebounced();
    refreshMvuPanelExtras();
    if (lastTreeRefs) refreshAllCheckboxStates(lastTreeRefs);
  });
  setupMvuSearch();
  document.getElementById("image_st_mvu_expand_all")?.addEventListener("click", () => setAllTreeExpanded(true));
  document.getElementById("image_st_mvu_collapse_all")?.addEventListener("click", () => setAllTreeExpanded(false));

  // Database search/expand/collapse
  setupDbSearch();
  document.getElementById("image_st_db_expand_all")?.addEventListener("click", () => setDbTreeExpanded(true));
  document.getElementById("image_st_db_collapse_all")?.addEventListener("click", () => setDbTreeExpanded(false));

  // Database enable checkbox
  const dbEnabledEl = document.getElementById("image_st_db_enabled") as HTMLInputElement;
  if (dbEnabledEl) {
    dbEnabledEl.checked = s.db_enabled ?? false;
    dbEnabledEl.addEventListener("change", () => {
      s.db_enabled = dbEnabledEl.checked;
      saveSettingsDebounced();
      const dbStatusEl = document.getElementById("image_st_db_status");
      const foldBody = document.getElementById("image_st_db_fold_body");
      const foldArrow = document.querySelector('.image-st-fold-header[data-section="db"] .image-st-fold-arrow') as HTMLElement | null;
      if (dbEnabledEl.checked) {
        if (foldBody) foldBody.classList.add("open");
        if (foldArrow) foldArrow.classList.add("open");
        refreshDatabaseData().then(ok => {
          refreshDbPanelExtras();
          if (dbStatusEl) {
            if (ok) {
              const st = getDatabaseStatus();
              dbStatusEl.textContent = `数据库状态：已就绪 (${st.sheets} 表 / ${st.rows} 行)`;
            } else {
              dbStatusEl.textContent = "数据库状态：不可用";
            }
          }
        });
      } else {
        clearDatabaseCache();
        lastDbTreeRefs = null;
        if (foldBody) foldBody.classList.remove("open");
        if (foldArrow) foldArrow.classList.remove("open");
        if (dbStatusEl) dbStatusEl.textContent = "数据库状态：未启用";
        const dbTree = document.getElementById("image_st_db_tree");
        if (dbTree) dbTree.innerHTML = '<div class="image-st-hint-text">数据库状态：未启用</div>';
        const dbSelectedBox = document.getElementById("image_st_db_selected");
        if (dbSelectedBox) dbSelectedBox.innerHTML = "";
        const foldStatusEl = document.getElementById("image_st_db_fold_status");
        if (foldStatusEl) { foldStatusEl.textContent = "未启用"; foldStatusEl.title = ""; }
      }
    });
  }

  // Scan database button
  document.getElementById("image_st_db_scan")?.addEventListener("click", () => {
    rebuildDatabaseTableTree();
  });

  // 柏宝书（v2.1）：启用开关 / 读取名册 / 搜索 / 展开收起 / 纳入范围开关
  const bbsEnabledEl = document.getElementById("image_st_bbs_enabled") as HTMLInputElement | null;
  if (bbsEnabledEl) {
    bbsEnabledEl.checked = s.bbs_enabled ?? false;
    bbsEnabledEl.addEventListener("change", async () => {
      s.bbs_enabled = bbsEnabledEl.checked;
      saveSettingsDebounced();
      const foldBody = document.getElementById("image_st_bbs_fold_body");
      const foldArrow = document.querySelector('.image-st-fold-header[data-section="bbs"] .image-st-fold-arrow') as HTMLElement | null;
      if (bbsEnabledEl.checked) {
        if (foldBody) foldBody.classList.add("open");
        if (foldArrow) foldArrow.classList.add("open");
        await handleBbsRefresh();
      } else {
        clearBaibaiCache();
        if (foldBody) foldBody.classList.remove("open");
        if (foldArrow) foldArrow.classList.remove("open");
        const tree = document.getElementById("image_st_bbs_tree");
        if (tree) tree.innerHTML = '<div class="image-st-hint-text">柏宝书：未启用</div>';
        refreshBbsPanelExtras();
      }
    });
  }
  document.getElementById("image_st_bbs_refresh")?.addEventListener("click", () => {
    void handleBbsRefresh();
  });
  document.getElementById("image_st_bbs_defaults")?.addEventListener("click", () => {
    bbsSelectDefaults();
  });
  document.getElementById("image_st_bbs_invalid_clear")?.addEventListener("click", () => {
    const stale = getBbsStaleSelections();
    if (stale.length === 0) return;
    if (!confirm(`确定清除 ${stale.length} 条失效选择？`)) return;
    for (const entry of stale) {
      bbsStoreSelection(entry.kind, entry.key, []);
    }
    rebuildBaibaiTree();
    refreshBbsPanelExtras();
  });
  setupBbsSearch();
  document.getElementById("image_st_bbs_expand_all")?.addEventListener("click", () => setBbsTreeExpanded(true));
  document.getElementById("image_st_bbs_collapse_all")?.addEventListener("click", () => setBbsTreeExpanded(false));
  const bbsToggleDefs: Array<[string, string]> = [
    ["image_st_bbs_include_nearby", "bbs_include_nearby"],
    ["image_st_bbs_include_absent", "bbs_include_absent"],
    ["image_st_bbs_include_other_scenes", "bbs_include_other_scenes"],
    ["image_st_bbs_include_distant_items", "bbs_include_distant_items"],
    ["image_st_bbs_name_gate", "bbs_name_gate"],
  ];
  for (const [id, key] of bbsToggleDefs) {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (!el) continue;
    if (s[key] === undefined) s[key] = false;
    el.checked = Boolean(s[key]);
    el.addEventListener("change", () => {
      s[key] = el.checked;
      saveSettingsDebounced();
    });
  }

  // Preview injection button — 使用回调参数
  document.getElementById("image_st_preview_injection")?.addEventListener("click", async () => {
    if (typeof getPreview !== 'function') {
      toastr.warning('预览功能未初始化', 'ST Image Plugin');
      return;
    }
    try {
      const result = await getPreview();
      const textarea = document.getElementById("image_st_preview_result") as HTMLTextAreaElement;
      if (textarea) textarea.value = result || "(无注入内容)";
      const charEl = document.getElementById("image_st_preview_chars");
      if (charEl) charEl.textContent = `(${(result || "").length} 字符)`;
    } catch (err) {
      console.error('[ImageST] 预览注入失败:', err);
      toastr.error(err instanceof Error ? err.message : String(err), 'ST Image Plugin');
    }
  });

  // v2.3: 管线预览（阶段5-7 逐段产物；用缓存抽取结果离线重跑，不调用 LLM）
  document.getElementById("image_st_preview_pipeline")?.addEventListener("click", () => {
    if (typeof getPipelinePreview !== "function") {
      toastr.warning("管线预览功能未初始化", "ST Image Plugin");
      return;
    }
    try {
      const result = getPipelinePreview();
      const textarea = document.getElementById("image_st_preview_pipeline_result") as HTMLTextAreaElement | null;
      if (textarea) textarea.value = result || "(无内容)";
    } catch (err) {
      console.error("[ImageST] 管线预览失败:", err);
      toastr.error(err instanceof Error ? err.message : String(err), "ST Image Plugin");
    }
  });

  // v1.6: Fold header toggle — event delegation
  settings_?.addEventListener("click", (e) => {
    const header = (e.target as HTMLElement).closest(".image-st-fold-header") as HTMLElement | null;
    if (!header) return;
    const section = header.getAttribute("data-section");
    if (!section) return;
    const arrow = header.querySelector(".image-st-fold-arrow") as HTMLElement | null;
    const body = document.getElementById(`image_st_${section}_fold_body`);
    if (!body) return;
    const open = body.classList.toggle("open");
    if (arrow) arrow.classList.toggle("open", open);
  });

  // v1.6: Set initial fold state based on enable checkbox
  const initFoldState = (section: string, enabled: boolean) => {
    const body = document.getElementById(`image_st_${section}_fold_body`);
    const arrow = document.querySelector(`.image-st-fold-header[data-section="${section}"] .image-st-fold-arrow`) as HTMLElement | null;
    if (body) body.classList.toggle("open", enabled);
    if (arrow) arrow.classList.toggle("open", enabled);
  };
  initFoldState("mvu", s.mvu_enabled ?? false);
  initFoldState("db", s.db_enabled ?? false);
  initFoldState("bbs", s.bbs_enabled ?? false);

  // v2.2 生成管线 tab（模块开关 / 输出模式 / 提示词编辑 / 审核 / 标签工具）
  setupPipelinePanel();

  // v0.9.9: Basic tab controls — 自动生成模式下拉（off | default | charlib）
  const autoGenModeEl = document.getElementById("image_st_auto_generate_mode") as HTMLSelectElement;
  if (autoGenModeEl) {
    autoGenModeEl.value = (s.auto_generate_mode as string) ?? "off";
    autoGenModeEl.addEventListener("change", () => {
      s.auto_generate_mode = autoGenModeEl.value;
      saveSettingsDebounced();
    });
  }

  const floatingBtnEl = document.getElementById("image_st_floating_btn") as HTMLInputElement;
  if (floatingBtnEl) {
    floatingBtnEl.checked = s.floating_btn_enabled ?? false;
    floatingBtnEl.addEventListener("change", () => {
      s.floating_btn_enabled = floatingBtnEl.checked;
      saveSettingsDebounced();
      if (floatingBtnEl.checked) {
        initFloatingButton(onGenerate);
      } else {
        destroyFloatingButton();
      }
    });
  }

  const progressEl = document.getElementById("image_st_progress_enabled") as HTMLInputElement;
  if (progressEl) {
    progressEl.checked = s.progress_enabled ?? true;
    progressEl.addEventListener("change", () => {
      s.progress_enabled = progressEl.checked;
      saveSettingsDebounced();
      if (!progressEl.checked) {
        toastr.clear();
      }
    });
  }

  document.getElementById("image_st_copy_gallery_path")?.addEventListener("click", onCopyGalleryPath);

  // v1.0.3: Image alignment
  bindSelect("image_st_image_align", "image_align");
  (document.getElementById("image_st_image_align") as HTMLSelectElement).value = s.image_align ?? "center";
  // v1.0.3: Image size
  bindSelect("image_st_image_size", "image_size");
  (document.getElementById("image_st_image_size") as HTMLSelectElement).value = s.image_size ?? "medium";

  // v1.0.3: Progress in chat checkbox
  const progressInChatEl = document.getElementById("image_st_progress_in_chat") as HTMLInputElement;
  if (progressInChatEl) {
    progressInChatEl.checked = s.progress_in_chat ?? true;
    progressInChatEl.addEventListener("change", () => {
      s.progress_in_chat = progressInChatEl.checked;
      saveSettingsDebounced();
      if (!progressInChatEl.checked && currentStage === 'idle') {
        updateFloatingButtonStage('idle');
      }
    });
  }

  // v1.2.1: Strip inline media (text-only backend compatibility)
  const stripInlineMediaEl = document.getElementById("image_st_strip_inline_media") as HTMLInputElement;
  if (stripInlineMediaEl) {
    stripInlineMediaEl.checked = s.strip_inline_media ?? true;
    stripInlineMediaEl.addEventListener("change", () => {
      s.strip_inline_media = stripInlineMediaEl.checked;
      saveSettingsDebounced();
    });
  }

  // v1.2: iOS — delegated focus handler for keyboard-aware scrolling
  settings_?.addEventListener('focusin', (e) => {
    const target = e.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  });

  // v1.0.4: Anchor text
  const anchorTextEl = document.getElementById("image_st_anchor_text") as HTMLInputElement;
  if (anchorTextEl) {
    anchorTextEl.value = (s.anchor_text as string ?? "").trim();
    anchorTextEl.addEventListener("change", () => {
      const val = anchorTextEl.value.trim();
      if (val.length > 200) {
        toastr.warning('锚点文本最长 200 字符', 'ST Image Plugin');
        anchorTextEl.value = s.anchor_text as string ?? "";
        return;
      }
      s.anchor_text = val;
      saveSettingsDebounced();
    });
  }
  bindSelect("image_st_anchor_position", "anchor_position");
  (document.getElementById("image_st_anchor_position") as HTMLSelectElement).value = s.anchor_position ?? "above";
  bindSelect("image_st_injection_order", "injection_order");
  (document.getElementById("image_st_injection_order") as HTMLSelectElement).value = (s.injection_order as string) ?? "info_first";

  // v1.8: Local library UI
  const localEnabledEl = document.getElementById("image_st_local_enabled") as HTMLInputElement | null;
  if (localEnabledEl) {
    localEnabledEl.checked = s.local_enabled ?? false;
    localEnabledEl.addEventListener("change", () => {
      s.local_enabled = localEnabledEl.checked;
      saveSettingsDebounced();
      const foldBody = document.getElementById("image_st_local_fold_body");
      const foldArrow = document.querySelector('.image-st-fold-header[data-section="local"] .image-st-fold-arrow') as HTMLElement | null;
      if (localEnabledEl.checked) {
        if (foldBody) foldBody.classList.add("open");
        if (foldArrow) foldArrow.classList.add("open");
        populateLocalWorldbookSelect();
      } else {
        if (foldBody) foldBody.classList.remove("open");
        if (foldArrow) foldArrow.classList.remove("open");
        const statusEl = document.getElementById("image_st_local_status");
        if (statusEl) statusEl.textContent = '';
        const foldStatusEl = document.getElementById("image_st_local_fold_status");
        if (foldStatusEl) foldStatusEl.textContent = '未启用';
      }
    });
  }

  // v1.8.2: Local build API source selector
  const apiSourceRadios = document.querySelectorAll('input[name="image_st_local_api_source"]');
  const savedApiSource = s.local_build_api_source as string | undefined;
  if (savedApiSource) {
    const target = document.querySelector(`input[name="image_st_local_api_source"][value="${savedApiSource}"]`) as HTMLInputElement | null;
    if (target) target.checked = true;
  }
  apiSourceRadios.forEach(radio => {
    radio.addEventListener("change", () => {
      s.local_build_api_source = (radio as HTMLInputElement).value;
      saveSettingsDebounced();
    });
  });

  // v1.9: Local build chunk strategy selector
  const chunkStrategyRadios = document.querySelectorAll('input[name="image_st_local_chunk_strategy"]');
  const savedChunkStrategy = s.local_chunk_strategy as string | undefined;
  if (savedChunkStrategy) {
    const target = document.querySelector(`input[name="image_st_local_chunk_strategy"][value="${savedChunkStrategy}"]`) as HTMLInputElement | null;
    if (target) target.checked = true;
  }
  chunkStrategyRadios.forEach(radio => {
    radio.addEventListener("change", () => {
      s.local_chunk_strategy = (radio as HTMLInputElement).value;
      saveSettingsDebounced();
    });
  });

  // v1.9: NSFW 特征开关（本地角色库抽取）
  const nsfwEnabledEl = document.getElementById("image_st_nsfw_enabled") as HTMLInputElement | null;
  if (nsfwEnabledEl) {
    nsfwEnabledEl.checked = s.nsfw_enabled === true;
    nsfwEnabledEl.addEventListener("change", () => {
      s.nsfw_enabled = nsfwEnabledEl.checked;
      saveSettingsDebounced();
    });
  }

  // v1.8: 模型思考复选框（此前未绑定，修复为实际生效）
  const localThinkingEl = document.getElementById("image_st_local_thinking_enabled") as HTMLInputElement | null;
  if (localThinkingEl) {
    localThinkingEl.checked = s.local_thinking_enabled === true;
    localThinkingEl.addEventListener("change", () => {
      s.local_thinking_enabled = localThinkingEl.checked;
      saveSettingsDebounced();
    });
  }

  // Local library fold state
  const initLocalFoldState = () => {
    const foldBody = document.getElementById("image_st_local_fold_body");
    const foldArrow = document.querySelector('.image-st-fold-header[data-section="local"] .image-st-fold-arrow') as HTMLElement | null;
    if (foldBody) foldBody.classList.toggle("open", s.local_enabled ?? false);
    if (foldArrow) foldArrow.classList.toggle("open", s.local_enabled ?? false);
  };
  initLocalFoldState();

  // Worldbook select
  document.getElementById("image_st_local_worldbook_select")?.addEventListener("change", () => {
    const select = document.getElementById("image_st_local_worldbook_select") as HTMLSelectElement;
    renderLocalEntryTree(select.value);
  });

  // v1.8.1: Local entry search
  setupLocalSearch();

  // Keywords textarea - debounced to avoid double-trigger (change + blur)
  const keywordsEl = document.getElementById("image_st_local_keywords") as HTMLTextAreaElement | null;
  if (keywordsEl) {
    let kwSaveTimer: number | null = null;
    const scheduleKwSave = () => {
      if (kwSaveTimer !== null) window.clearTimeout(kwSaveTimer);
      kwSaveTimer = window.setTimeout(() => { kwSaveTimer = null; void saveLocalKeywords(); }, 300);
    };
    keywordsEl.addEventListener("change", scheduleKwSave);
    keywordsEl.addEventListener("blur", scheduleKwSave);
    // 关抽屉/页面卸载时 flush，避免用户输入后关面板丢失
    const flushKwSave = () => {
      if (kwSaveTimer !== null) { window.clearTimeout(kwSaveTimer); kwSaveTimer = null; void saveLocalKeywords(); }
    };
    window.addEventListener("beforeunload", flushKwSave);
    // 也在抽屉关闭时 flush（initDrawerObserver 里会监听）
    (keywordsEl as HTMLTextAreaElement & { _flushKwSave?: () => void })._flushKwSave = flushKwSave;
  }

  // Build button
  document.getElementById("image_st_local_build")?.addEventListener("click", handleLocalBuild);

  // Cancel button
  document.getElementById("image_st_local_cancel")?.addEventListener("click", handleLocalCancel);

  // Open dir button
  document.getElementById("image_st_local_open_dir")?.addEventListener("click", handleLocalOpenDir);

  // 注意：不在此处初始填充世界书列表。
  // 原因：createSettingsUI 执行时 chat context 可能尚未就绪，
  // getWorldInfoNames() / getCurrentCharName() 可能返回空值。
  // 由 index.ts 的 refreshLocalPanelOnChatChange（CHAT_CHANGED + 初始化延迟）负责填充。
}

// ============================================================
// Exports (仅在 ui.ts 中 export，不在 index.ts 中定义)
// @ts-ignore — 避免同文件声明+导出的循环引用误报（运行时无影响） // eslint-disable-line @typescript-eslint/ban-ts-comment
// ============================================================
export {
  // @ts-ignore — Types from exported.sillytavern.d.ts // eslint-disable-line @typescript-eslint/ban-ts-comment
  createSettingsUI,
  setProgress,
  resetProgress,
  currentStage,
  floatingBtn,
  initFloatingButton,
  initWandButton,
  destroyFloatingButton,
  updateFloatingButtonStage,
  setCancelHandler,
  ensureValidLoraSlots,
  rebuildLoraUI,
  rebuildRegexRulesUI,
  testLLMConnection,
  testComfyUIConnection,
  testLatentMoeConnection,
  testRunningHubConnection,
  onCopyGalleryPath,
  onTestTextCleaning,
  renderMvuTree,
  refreshMvuPanelExtras,
  rebuildDatabaseTableTree,
  refreshDbPanelExtras,
  handleLocalBuild,
  handleLocalCancel,
  handleLocalOpenDir,
  refreshLocalPanelOnChatChange,
  initDrawerObserver,
};
