# 本地图片识别资源

这些文件供浏览器设备端识别使用，不会上传图片。使用 `npm ci --ignore-scripts` 后运行 `npm run prepare:ocr` 可重新生成资源；运行网站不需要安装 npm 依赖。

- Tesseract.js 7.0.0：https://github.com/naptha/tesseract.js（Apache-2.0，见 LICENSE-tesseract.js.md）
- Tesseract.js-core：Tesseract.js 7.0.0 的配套依赖，见 LICENSE-tesseract.js-core
- `chi_sim` 4.0.0_best_int：来自 @tesseract.js-data/chi_sim 1.0.0，https://github.com/naptha/tessdata（包许可证 MIT，训练数据源 https://github.com/tesseract-ocr/tessdata_best，Apache-2.0）

核心固定使用 LSTM 模式，提供普通、SIMD、Relaxed SIMD 三个对应引擎，由浏览器选择可用版本。
