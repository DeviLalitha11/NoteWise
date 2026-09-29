import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { needsOcr, recognize } from "./ocr";
import type { PageText } from "./types";

// PDF parsing runs in PDF.js's own worker so big files don't freeze the UI.
// Pinned to PDF.js 4.x on purpose: 5.x/6.x use very new JavaScript features
// (e.g. Map.getOrInsertComputed) that many students' phone browsers don't have yet.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface TextItemLike {
  str: string;
  transform: number[];
  hasEOL?: boolean;
}

/**
 * Rebuild readable lines from PDF.js text items.
 *
 * A PDF has no concept of "lines", just positioned runs of text. We start a
 * new line when PDF.js marks an end-of-line or when the vertical position
 * changes, which keeps headings on their own line for the chunker to spot.
 */
export function itemsToText(items: TextItemLike[]): string {
  let out = "";
  let lastY: number | null = null;
  for (const item of items) {
    const y = item.transform[5];
    if (lastY !== null && Math.abs(y - lastY) > 2 && !out.endsWith("\n")) out += "\n";
    out += item.str;
    if (item.hasEOL) out += "\n";
    else if (item.str && !item.str.endsWith(" ")) out += " ";
    lastY = y;
  }
  return out.replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
}

export interface ExtractProgress {
  stage: "reading" | "ocr";
  /** 0..1 across the whole document for this stage. */
  progress: number;
}

/** Render one page to a canvas at a resolution Tesseract reads well (~200 dpi for A4). */
async function renderPage(page: pdfjs.PDFPageProxy): Promise<HTMLCanvasElement> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(3, 1650 / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
  return canvas;
}

/**
 * Extract text page by page. Pages with no text layer (scans, photocopies)
 * are rendered and run through on-device OCR instead.
 */
export async function extractPdfPages(data: ArrayBuffer, onProgress?: (p: ExtractProgress) => void): Promise<PageText[]> {
  const task = pdfjs.getDocument({ data });
  const pages: PageText[] = [];
  try {
    const pdf = await task.promise;
    const scanned: number[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = itemsToText(content.items as TextItemLike[]);
      pages.push({ page: i, text });
      if (needsOcr(text)) scanned.push(i);
      page.cleanup();
      onProgress?.({ stage: "reading", progress: i / pdf.numPages });
    }

    for (let k = 0; k < scanned.length; k++) {
      const n = scanned[k];
      const page = await pdf.getPage(n);
      const canvas = await renderPage(page);
      page.cleanup();
      const text = await recognize(canvas, (p) => onProgress?.({ stage: "ocr", progress: (k + p) / scanned.length }));
      canvas.width = canvas.height = 0; // release the bitmap memory right away
      pages[n - 1] = { page: n, text };
      onProgress?.({ stage: "ocr", progress: (k + 1) / scanned.length });
    }
  } finally {
    await task.destroy(); // frees the worker-side copy of the file
  }
  return pages;
}
