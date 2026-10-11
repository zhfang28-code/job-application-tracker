import { cp, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const modules = join(root, "node_modules");
const output = join(root, "vendor", "ocr");
const packageInfo = JSON.parse(await readFile(join(modules, "tesseract.js", "package.json"), "utf8"));
if (packageInfo.version !== "7.0.0") throw new Error("OCR 资源需要 Tesseract.js 7.0.0");
await mkdir(join(output, "core"), { recursive: true });
await mkdir(join(output, "lang"), { recursive: true });

for (const name of ["tesseract.min.js", "worker.min.js"]) {
  await cp(join(modules, "tesseract.js", "dist", name), join(output, name));
}
for (const variant of ["", "-simd", "-relaxedsimd"]) {
  const name = `tesseract-core${variant}-lstm.wasm.js`;
  await cp(join(modules, "tesseract.js-core", name), join(output, "core", name));
}
for (const language of ["chi_sim"]) {
  await cp(
    join(modules, "@tesseract.js-data", language, "4.0.0_best_int", `${language}.traineddata.gz`),
    join(output, "lang", `${language}.traineddata.gz`),
  );
}
await cp(join(modules, "tesseract.js", "LICENSE.md"), join(output, "LICENSE-tesseract.js.md"));
await cp(join(modules, "tesseract.js-core", "LICENSE"), join(output, "LICENSE-tesseract.js-core"));
console.log("本地 OCR 引擎及中文模型已复制到 vendor/ocr");
