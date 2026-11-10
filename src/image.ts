// ============================================================
// image.ts — 图片处理（缩略图降采样）
// 职责：把 ComfyUI 返回的全分辨率 base64 降采样为 JPEG 缩略图，
//       用于聊天内联显示（原图另存，放大时才解码）。
// ============================================================

/** 缩略图长边上限（px）。内联 CSS 最大宽 500px，512px 平衡清晰度与内存。 */
export const THUMBNAIL_MAX_DIM = 512;
const THUMBNAIL_JPEG_QUALITY = 0.75;
/** 原图 base64 长度上限（约 10MB base64 ≈ 7.5MB 二进制），防 OOM */
const MAX_BASE64_LENGTH = 10 * 1024 * 1024;

/** 检测是否为移动端/iOS，用于调整内存策略 */
function isMobileDevice(): boolean {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent;
    return /iPhone|iPad|iPod|Android/i.test(ua);
}

/** 检测是否为 iOS PWA 独立模式（添加到主屏幕） */
function isIOSStandalone(): boolean {
    if (typeof window === "undefined" || typeof navigator === "undefined") return false;
    const ua = navigator.userAgent;
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
    return isIOS && isStandalone;
}

/** 根据设备类型获取缩略图最大尺寸，移动端降低以节省内存 */
function getThumbnailMaxDim(): number {
    if (isMobileDevice()) {
        return isIOSStandalone() ? 384 : 448;
    }
    return THUMBNAIL_MAX_DIM;
}

/**
 * 将 base64 图片降采样为 JPEG 缩略图（双次 createImageBitmap 避免全尺寸位图 OOM）。
 * @param data 原始 base64（不含 data: 前缀）
 * @param format 原图格式（png | jpeg）
 * @param maxDim 缩略图长边上限（默认根据设备自动调整）
 * @returns JPEG 缩略图的 base64（不含前缀）与格式
 */
export async function downscaleImageToThumbnail(
    data: string,
    format: string,
    maxDim: number = getThumbnailMaxDim(),
): Promise<{ data: string; format: "jpg" }> {
    // 0. 输入长度上限，防止用户设 4096×4096 导致 base64 过大 OOM
    if (data.length > MAX_BASE64_LENGTH) {
        throw new Error(`原图 base64 过长（>${MAX_BASE64_LENGTH / 1024 / 1024}MB），跳过缩略图`);
    }

    // 1. base64 → Uint8Array（避免创建中间 data: URL 字符串）
    const binary = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    const blob = new Blob([binary], { type: format === "png" ? "image/png" : "image/jpeg" });

    // 2. 第一次解码：仅获取原图尺寸（不读像素数据，内存极小）
    let img: ImageBitmap;
    try {
        img = await createImageBitmap(blob, { colorSpaceConversion: "none" });
    } catch {
        img = await createImageBitmap(blob);
    }
    const w = img.width;
    const h = img.height;
    if (!w || !h) {
        img.close();
        throw new Error("thumbnail: invalid image dimensions");
    }

    // 3. 计算保持宽高比的目标尺寸（长边不超过 maxDim）
    const scale = Math.min(1, maxDim / Math.max(w, h));
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));

    // 4. 立即释放第一次解码的 ImageBitmap
    img.close();

    // 5. 第二次解码：直接用 resizeWidth/resizeHeight 产出小图（无全尺寸位图）
    // iOS 15.0-15.3 不支持 resizeWidth，需 try/catch 回退到 OffscreenCanvas 绘制
    let thumbBlob: Blob;
    try {
        const smallImg = await createImageBitmap(blob, {
            resizeWidth: tw,
            resizeHeight: th,
            resizeQuality: "high",
        });
        const smallCanvas = new OffscreenCanvas(tw, th);
        const smallCtx = smallCanvas.getContext("2d", { willReadFrequently: false });
        if (!smallCtx) throw new Error("thumbnail: 2d context unavailable");
        smallCtx.drawImage(smallImg, 0, 0);
        smallImg.close();
        thumbBlob = await smallCanvas.convertToBlob({ type: "image/jpeg", quality: THUMBNAIL_JPEG_QUALITY });
    } catch {
        // 回退：OffscreenCanvas 绘制（原逻辑）
        const canvas = new OffscreenCanvas(tw, th);
        const ctx = canvas.getContext("2d", { willReadFrequently: false });
        if (!ctx) throw new Error("thumbnail: 2d context unavailable");
        // 重新解码原图用于绘制（已释放第一次 img，需重新解码）
        let fallbackImg: ImageBitmap;
        try {
            fallbackImg = await createImageBitmap(blob, { colorSpaceConversion: "none" });
        } catch {
            fallbackImg = await createImageBitmap(blob);
        }
        ctx.drawImage(fallbackImg, 0, 0, tw, th);
        fallbackImg.close();
        thumbBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: THUMBNAIL_JPEG_QUALITY });
    }

    // 6. 转 base64
    return new Promise<{ data: string; format: "jpg" }>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const base64 = (reader.result as string).split(",")[1] ?? "";
            if (!base64) {
                reject(new Error("thumbnail: encode failed"));
                return;
            }
            resolve({ data: base64, format: "jpg" });
        };
        reader.onerror = reject;
        reader.readAsDataURL(thumbBlob);
    });
}
