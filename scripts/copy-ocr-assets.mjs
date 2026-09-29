// Copies the OCR engine (Tesseract.js worker + WebAssembly core) and the English
// language data into public/tesseract, so the app serves them itself instead of
// relying on a CDN. That keeps OCR working offline once cached, and on networks
// that block CDNs. Runs automatically before `npm run dev` and `npm run build`.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`));
const out = join(process.cwd(), "public", "tesseract");
mkdirSync(join(out, "lang"), { recursive: true });

const files = [
  [join(pkgDir("tesseract.js"), "dist", "worker.min.js"), join(out, "worker.min.js")],
  // Tesseract picks one of these at runtime depending on the browser's WebAssembly features.
  ...["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"].map((f) => [
    join(pkgDir("tesseract.js-core"), f),
    join(out, f),
  ]),
  [join(pkgDir("@tesseract.js-data/eng"), "4.0.0_best_int", "eng.traineddata.gz"), join(out, "lang", "eng.traineddata.gz")],
];

for (const [from, to] of files) {
  if (!existsSync(from)) throw new Error(`Missing OCR asset: ${from}. Run npm install.`);
  copyFileSync(from, to);
}
console.log(`OCR assets ready in public/tesseract (${files.length} files)`);
