// ============================================================
// polling.ts —— 可见性感知轮询工具
// iOS PWA 后台时暂停轮询，切回前台立即恢复
// ============================================================
let hidden = false;
let visibilityInitialized = false;
/** 初始化可见性监听（幂等） */
function initVisibility() {
    if (visibilityInitialized)
        return;
    visibilityInitialized = true;
    if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", () => {
            hidden = document.hidden;
        });
        hidden = document.hidden;
    }
}
/**
 * 可见性感知轮询
 * @param fn 轮询函数，返回 true 表示完成并停止
 * @param interval 轮询间隔（ms），默认 1000
 * @param options 可选配置
 *   - immediate: 是否立即执行第一次（默认 true）
 *   - maxPolls: 最大轮询次数（默认无限）
 *   - onHidden: 进入后台时的回调
 *   - onVisible: 切回前台时的回调
 */
export async function pollWithVisibility(fn, interval = 1000, options = {}) {
    initVisibility();
    const { immediate = true, maxPolls, onHidden, onVisible } = options;
    let polls = 0;
    let wasHidden = hidden;
    // 立即执行第一次
    if (immediate) {
        if (await fn())
            return;
        polls++;
    }
    while (maxPolls === undefined || polls < maxPolls) {
        // 检测可见性变化
        if (hidden !== wasHidden) {
            wasHidden = hidden;
            if (hidden && onHidden)
                onHidden();
            if (!hidden && onVisible)
                onVisible();
        }
        if (hidden) {
            // 后台：长轮询 5s，不执行 fn
            await new Promise(r => setTimeout(r, 5000));
            continue;
        }
        // 前台：正常间隔
        await new Promise(r => setTimeout(r, interval));
        if (await fn())
            return;
        polls++;
    }
}
/**
 * 简单的可见性感知 sleep
 * 后台时延长 sleep 时间
 */
export async function sleepWithVisibility(ms) {
    initVisibility();
    const start = Date.now();
    while (Date.now() - start < ms) {
        if (hidden) {
            await new Promise(r => setTimeout(r, 5000));
        }
        else {
            await new Promise(r => setTimeout(r, Math.min(1000, ms - (Date.now() - start))));
        }
    }
}
