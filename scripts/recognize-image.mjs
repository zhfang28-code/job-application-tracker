import { createWorker, OEM, PSM } from "tesseract.js";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractRecruitmentFields } from "../src/image-import.js";

const image = process.argv[2];
if (!image) throw new Error("用法：node scripts/recognize-image.mjs 图片路径");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const worker = await createWorker("chi_sim", OEM.LSTM_ONLY, {
  langPath: join(root, "vendor", "ocr", "lang"),
  cacheMethod: "none",
});
try {
  await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: "1", user_defined_dpi: "300" });
  const { data } = await worker.recognize(resolve(image));
  console.log(JSON.stringify({ ...extractRecruitmentFields(data.text), confidence: data.confidence }, null, 2));
} finally {
  await worker.terminate();
}
