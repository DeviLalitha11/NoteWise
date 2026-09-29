import type { Worker as TesseractWorker } from "tesseract.js";

/**
 * On-device OCR for scanned notes and photos, using Tesseract.js (WebAssembly).
 *
 * Many college notes are photocopies or phone photos, which have no text
 * layer for PDF.js to read. Tesseract turns the image into text right in the
 * browser. The engine (~4 MB) and English language data (~3 MB) are served by
 * the app itself from /tesseract (see scripts/copy-ocr-assets.mjs), fetched
 * the first time OCR is needed and cached afterwards.
 *
 * Works well on printed or typed pages. Handwriting is much less reliable.
 */

let workerPromise: Promise<TesseractWorker> | null = null;
let progressListener: ((p: number) => void) | null = null;

function getWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = import("tesseract.js")
      .then(({ createWorker }) =>
        createWorker("eng", 1, {
          workerPath: "/tesseract/worker.min.js",
          corePath: "/tesseract",
          langPath: "/tesseract/lang",
          logger: (m: { status: string; progress: number }) => {
            if (m.status === "recognizing text") progressListener?.(m.progress);
          },
        }),
      )
      .catch((err) => {
        workerPromise = null;
        throw new Error(`Couldn't start text recognition (OCR). Check your internet connection for the first use. ${err?.message ?? ""}`.trim());
      });
  }
  return workerPromise;
}

/** Recognise text in an image, canvas or image file. `onProgress` gets 0..1 for this image. */
export async function recognize(image: HTMLCanvasElement | Blob, onProgress?: (p: number) => void): Promise<string> {
  const worker = await getWorker();
  progressListener = onProgress ?? null;
  try {
    const { data } = await worker.recognize(image);
    return cleanOcrText(data.text);
  } finally {
    progressListener = null;
  }
}

/** Free the OCR engine's memory once an import batch is finished. Phones need it back. */
export async function releaseOcr(): Promise<void> {
  const p = workerPromise;
  workerPromise = null;
  if (p) await (await p).terminate().catch(() => {});
}

/**
 * Tidy common OCR noise: hyphenated line breaks, stray single symbols, runs of spaces.
 * Keeps line breaks, because the chunker uses them to spot headings.
 */
export function cleanOcrText(text: string): string {
  return text
    .replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2") // "algo-\nrithm" -> "algorithm"
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l) => l.replace(/[^\p{L}\p{N}]/gu, "").length >= 2) // drop lines that are only noise
    .join("\n");
}

/** A page "needs OCR" when PDF.js found almost no real text on it. */
export function needsOcr(pageText: string): boolean {
  return pageText.replace(/[^\p{L}\p{N}]/gu, "").length < 25;
}
