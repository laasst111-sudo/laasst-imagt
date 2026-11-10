// ============================================================
// mediaManager.ts — 生成图内存治理（D1=B 缩略图放大 + D2=A 会话配额/淘汰）
// 职责：
//   1. 放大拦截：点击生成图时临时把 url 换成 original_url，让 ST 的
//      expandMessageMedia 同步读到原图（不改 ST 核心，捕获阶段拦截）。
//   2. 会话配额：内联生成图数量超 N 时，把最早生成图的 DOM 容器替换为占位条，
//      点击占位条恢复（数据层 media 不变）。
// ============================================================
// @ts-expect-error — ST provides this module at runtime
import { getContext } from "../../../../../scripts/st-context.js";
// @ts-expect-error — ST provides this module at runtime
import { MEDIA_SOURCE, MEDIA_TYPE } from "../../../../../scripts/constants.js";
// @ts-expect-error — ST provides this module at runtime
import { extension_settings } from "../../../../../scripts/extensions.js";
import { SETTINGS_KEY } from "./comfy.js";
import { logger } from "./logger.js";
const DEFAULT_QUOTA = 6;
const EVICTED_CSS_ID = "image_st_evicted_css";
/** 已淘汰的生成图：`${mesId}:${mediaIndex}` */
const evictedSet = new Set();
function isIOS() {
    if (typeof navigator === "undefined")
        return false;
    return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}
function evictedKey(mesId, mediaIndex) {
    return `${mesId}:${mediaIndex}`;
}
function getQuota() {
    const s = extension_settings?.[SETTINGS_KEY] ?? {};
    const n = Number(s.generated_media_quota);
    if (Number.isFinite(n) && n >= 0)
        return Math.floor(n);
    // iOS 默认更低配额，避免内联图片过多导致 OOM
    return isIOS() ? 4 : DEFAULT_QUOTA;
}
/** 扫描数据层，返回按 (消息顺序, 媒体顺序) 排列的生成图位置列表 */
function getGeneratedMediaLocations() {
    const chat = getContext().chat ?? [];
    const locs = [];
    for (let mesId = 0; mesId < chat.length; mesId++) {
        const media = chat[mesId]?.extra?.media;
        if (!Array.isArray(media))
            continue;
        for (let mediaIndex = 0; mediaIndex < media.length; mediaIndex++) {
            const m = media[mediaIndex];
            if (m && m.source === MEDIA_SOURCE.GENERATED && m.type === MEDIA_TYPE.IMAGE) {
                locs.push({ mesId, mediaIndex });
            }
        }
    }
    return locs;
}
function findMediaContainer(mesId, mediaIndex) {
    const mesBlock = document.querySelector(`.mes[mesid="${mesId}"]`);
    if (!mesBlock)
        return null;
    const wrapper = mesBlock.querySelector(".mes_media_wrapper");
    if (!wrapper)
        return null;
    return wrapper.querySelector(`.mes_media_container[data-index="${mediaIndex}"]`);
}
function makeEvictedPlaceholder(mesId, mediaIndex) {
    const div = document.createElement("div");
    div.className = "image-st-evicted";
    div.setAttribute("data-mesid", String(mesId));
    div.setAttribute("data-media-index", String(mediaIndex));
    div.setAttribute("role", "button");
    div.innerHTML = '<i class="fa-solid fa-image"></i> <span>已卸载图片 · 点击恢复</span>';
    return div;
}
/** 把指定生成图容器替换为占位条（释放其解码位图），返回是否成功 */
function evictMedia(mesId, mediaIndex) {
    const container = findMediaContainer(mesId, mediaIndex);
    if (!container)
        return false;
    container.replaceWith(makeEvictedPlaceholder(mesId, mediaIndex));
    evictedSet.add(evictedKey(mesId, mediaIndex));
    return true;
}
/** 从占位条恢复单个生成图容器（手工重建，避免整条消息媒体重渲染导致兄弟图被一起恢复） */
function restoreMedia(mesId, mediaIndex) {
    const chat = getContext().chat ?? [];
    const media = chat[mesId]?.extra?.media?.[mediaIndex];
    if (!media)
        return;
    const placeholder = document.querySelector(`.image-st-evicted[data-mesid="${mesId}"][data-media-index="${mediaIndex}"]`);
    if (!placeholder)
        return;
    const template = document.querySelector("#message_image_template .mes_img_container");
    if (!template)
        return;
    const container = template.cloneNode(true);
    container.setAttribute("data-index", String(mediaIndex));
    const img = container.querySelector(".mes_img");
    if (img) {
        img.src = media.url || "";
        img.title = media.title || "";
        img.removeAttribute("alt");
        img.classList.remove("error");
    }
    const wrapper = placeholder.parentElement;
    placeholder.remove();
    if (wrapper) {
        let inserted = false;
        const siblings = Array.from(wrapper.querySelectorAll(".mes_media_container[data-index]"));
        for (const sib of siblings) {
            const idx = Number(sib.getAttribute("data-index"));
            if (!Number.isNaN(idx) && idx > mediaIndex) {
                wrapper.insertBefore(container, sib);
                inserted = true;
                break;
            }
        }
        if (!inserted)
            wrapper.appendChild(container);
    }
    evictedSet.delete(evictedKey(mesId, mediaIndex));
}
/** 会话配额：内联生成图超过 N 时，淘汰最早的生成图 */
export function enforceGeneratedMediaQuota() {
    const quota = getQuota();
    if (quota <= 0)
        return;
    const locs = getGeneratedMediaLocations();
    let inlineCount = locs.filter(l => !evictedSet.has(evictedKey(l.mesId, l.mediaIndex))).length;
    for (const loc of locs) {
        if (inlineCount <= quota)
            break;
        if (evictedSet.has(evictedKey(loc.mesId, loc.mediaIndex)))
            continue;
        if (evictMedia(loc.mesId, loc.mediaIndex)) {
            inlineCount--;
            logger.debug(`[image_st] 已卸载生成图 mes:${loc.mesId} media:${loc.mediaIndex}`);
        }
    }
}
/** 放大拦截：捕获阶段把 url 临时换成 original_url，让 ST 的 expandMessageMedia 读到原图 */
function onCaptureClick(e) {
    const target = e.target;
    if (!target || typeof target.closest !== "function")
        return;
    const mediaEl = target.closest(".mes_img, .mes_media_enlarge");
    if (!mediaEl)
        return;
    const container = mediaEl.closest(".mes_media_container");
    const mesBlock = mediaEl.closest(".mes");
    if (!container || !mesBlock)
        return;
    const mesId = Number(mesBlock.getAttribute("mesid"));
    const mediaIndex = Number(container.getAttribute("data-index"));
    if (Number.isNaN(mesId) || Number.isNaN(mediaIndex))
        return;
    const media = getContext().chat?.[mesId]?.extra?.media?.[mediaIndex];
    if (!media || !media.original_url)
        return;
    // 临时换原图 → ST 的 expandMessageMedia 同步读取原图 → 下一 tick 还原
    const savedUrl = media.url;
    media.url = media.original_url;
    setTimeout(() => { media.url = savedUrl; }, 0);
}
// 捕获阶段回调引用（用于移除）
const onCaptureClickRef = onCaptureClick;
// 冒泡阶段回调引用
let onPlaceholderClickRef;
function injectEvictedCss() {
    if (document.getElementById(EVICTED_CSS_ID))
        return;
    const style = document.createElement("style");
    style.id = EVICTED_CSS_ID;
    style.textContent = `
        .image-st-evicted { display:flex; align-items:center; gap:8px; padding:8px 12px; margin:4px 0; border:1px dashed var(--SmartThemeBorderColor); border-radius:8px; color:var(--SmartThemeBodyColor); opacity:0.7; cursor:pointer; font-size:calc(var(--mainFontSize) * 0.9); user-select:none; }
        .image-st-evicted:hover { opacity:1; background:var(--white30a); }
    `;
    document.head.appendChild(style);
}
let managerInitialized = false;
/** 清理媒体管理器注册的全局事件监听器（扩展卸载/重载时调用） */
export function cleanupGeneratedMediaManager() {
    if (!managerInitialized)
        return;
    document.removeEventListener("click", onCaptureClickRef, true);
    if (onPlaceholderClickRef) {
        document.removeEventListener("click", onPlaceholderClickRef);
    }
    // 清理 CSS
    const styleEl = document.getElementById(EVICTED_CSS_ID);
    if (styleEl)
        styleEl.remove();
    managerInitialized = false;
    evictedSet.clear();
}
export function initGeneratedMediaManager() {
    if (managerInitialized)
        return;
    managerInitialized = true;
    injectEvictedCss();
    // capture：先于 ST 在 chatElement 上的委托处理器执行
    document.addEventListener("click", onCaptureClickRef, true);
    // bubble：占位条点击恢复
    onPlaceholderClickRef = (e) => {
        const target = e.target;
        if (!target || typeof target.closest !== "function")
            return;
        const placeholder = target.closest(".image-st-evicted");
        if (!placeholder)
            return;
        const mesId = Number(placeholder.getAttribute("data-mesid"));
        const mediaIndex = Number(placeholder.getAttribute("data-media-index"));
        if (Number.isNaN(mesId) || Number.isNaN(mediaIndex))
            return;
        restoreMedia(mesId, mediaIndex);
    };
    document.addEventListener("click", onPlaceholderClickRef);
}
