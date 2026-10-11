const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const ASSET_BASE = new URL("../vendor/ocr/", import.meta.url);
let enginePromise = null;

function aborted() {
  return new DOMException("识别已取消", "AbortError");
}

function loadEngine() {
  if (globalThis.Tesseract?.createWorker) return Promise.resolve(globalThis.Tesseract);
  if (!enginePromise) {
    enginePromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const timer = setTimeout(() => {
        script.remove();
        reject(new Error("识别引擎加载超时，请联网后重试"));
      }, 30_000);
      script.src = new URL("tesseract.min.js", ASSET_BASE).href;
      script.onload = () => {
        clearTimeout(timer);
        if (globalThis.Tesseract?.createWorker) resolve(globalThis.Tesseract);
        else reject(new Error("识别引擎未能启动，请刷新后重试"));
      };
      script.onerror = () => {
        clearTimeout(timer);
        script.remove();
        reject(new Error("识别资源未能加载，请联网后重试"));
      };
      document.head.append(script);
    }).catch((error) => {
      enginePromise = null;
      throw error;
    });
  }
  return enginePromise;
}

async function prepareImage(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("无法读取图片，请使用 PNG、JPG 或 WebP 截图");
  }
  try {
    if (bitmap.width * bitmap.height > 40_000_000) throw new Error("图片尺寸过大，请先裁剪招聘信息区域");
    // Upscale small screenshots to retain strokes in Chinese characters.
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(2, 2600 / longest);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器无法处理图片，请使用新版 Chrome 或 Edge");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.filter = "grayscale(1) contrast(1.08)";
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally {
    bitmap.close();
  }
}

export async function recognizeRecruitmentImage(file, { onProgress = () => {}, signal } = {}) {
  if (!file?.type.startsWith("image/") || file.type === "image/svg+xml") throw new Error("请选择 PNG、JPG 或 WebP 图片");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("图片超过 20 MB，请先裁剪或压缩后再试");
  if (signal?.aborted) throw aborted();
  let worker = null;
  let workerPromise = null;
  let rejectCancellation;
  let timedOut = false;
  const cancellation = new Promise((_, reject) => { rejectCancellation = reject; });
  const cancel = () => {
    worker?.terminate();
    rejectCancellation(timedOut ? new Error("识别超时，请裁剪图片中的招聘信息后重试") : aborted());
  };
  const timer = setTimeout(() => { timedOut = true; cancel(); }, 120_000);
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    return await Promise.race([cancellation, (async () => {
      onProgress({ value: 0.03, label: "正在读取图片…" });
      const prepared = await prepareImage(file);
      const engine = await loadEngine();
      if (signal?.aborted || timedOut) throw aborted();
      onProgress({ value: 0.1, label: "正在加载中文识别资源，首次使用请稍候…" });
      workerPromise = engine.createWorker("chi_sim", engine.OEM.LSTM_ONLY, {
        workerPath: new URL("worker.min.js", ASSET_BASE).href,
        corePath: new URL("core", ASSET_BASE).href,
        langPath: new URL("lang", ASSET_BASE).href,
        workerBlobURL: false,
        cachePath: "jobtrail-ocr-7-best",
        logger(message) {
          if (signal?.aborted || timedOut) return;
          if (message.status === "recognizing text") {
            onProgress({ value: 0.3 + message.progress * 0.69, label: `正在识别图片文字 ${Math.round(message.progress * 100)}%` });
          }
        },
        errorHandler() {},
      });
      worker = await workerPromise;
      if (signal?.aborted || timedOut) throw aborted();
      await worker.setParameters({ tessedit_pageseg_mode: engine.PSM.AUTO, preserve_interword_spaces: "1", user_defined_dpi: "300" });
      const { data } = await worker.recognize(prepared);
      onProgress({ value: 1, label: "识别完成，请核对后填入" });
      return { text: data.text.trim(), confidence: data.confidence };
    })()]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
    if (worker) await worker.terminate();
    else workerPromise?.then((lateWorker) => lateWorker.terminate()).catch(() => {});
  }
}
