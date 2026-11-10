// ============================================================
// logger.ts — 日志开关（DEBUG 默认关，iOS 上彻底关闭）
// 职责：所有 verbose 日志（原 console.log/debug）收敛到 debugEnabled()，
//       warn/error 保留（真实错误/告警，不随 DEBUG 关闭）。
// ============================================================
// @ts-expect-error — ST provides this module at runtime
import { extension_settings } from "../../../../../scripts/extensions.js";
import { isIOS } from "./utils.js";
// 与 comfy.ts 中 SETTINGS_KEY 相同；此处刻意避免 import comfy.ts 造成循环依赖
const SETTINGS_KEY = "image_st";
let debugCache = null;
function debugEnabled() {
    if (debugCache !== null)
        return debugCache;
    debugCache = isIOS() ? false : extension_settings?.[SETTINGS_KEY]?.debug_enabled === true;
    return debugCache;
}
export const logger = {
    debug(...args) {
        if (debugEnabled())
            console.log(...args);
    },
    log(...args) {
        if (debugEnabled())
            console.log(...args);
    },
    info(...args) {
        if (debugEnabled())
            console.info(...args);
    },
    warn(...args) {
        console.warn(...args);
    },
    error(...args) {
        console.error(...args);
    },
};
