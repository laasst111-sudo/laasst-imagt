// ============================================================
// utils.ts — 插件内部通用工具（纯函数，零依赖）
// 职责：深拷贝、iOS 判定、空闲调度（requestIdleCallback 守卫）
// ============================================================
/**
 * 深拷贝。优先 structuredClone（iOS 15.4+ / 现代浏览器），
 * 低版本回退到 JSON 往返。本插件数据均为纯 JSON（磁盘/LLM 解析产物），
 * 两者语义等价。
 */
export function deepClone(value) {
    if (typeof structuredClone === "function") {
        return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
}
let iosCache = null;
/** iOS / iPadOS 判定（UA + iPad 桌面模式兜底，带缓存） */
export function isIOS() {
    if (iosCache !== null)
        return iosCache;
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const isMacLike = /Mac/i.test(ua) && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1;
    iosCache = /iPhone|iPad|iPod/i.test(ua) || isMacLike;
    return iosCache;
}
/**
 * 空闲调度：requestIdleCallback 仅适合极轻量任务（< 50ms）。
 * 本插件的面板刷新/词库探测属于较重操作，改用 setTimeout 避免违规。
 */
export function scheduleIdle(fn) {
    setTimeout(fn, 0);
}
/** 字符串简单散列（FNV-1a），用于缓存键指纹 */
export function hashString(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h = ((h ^ text.charCodeAt(i)) * 0x01000193) >>> 0;
    }
    return h;
}
