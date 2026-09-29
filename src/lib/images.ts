import { recognize } from "./ocr";
import type { PageText } from "./types";

/** Longest side we feed to OCR. Phone photos are often 4000px+, which is slow and uses a lot of memory for no accuracy gain. */
const MAX_SIDE = 2000;

export function isImageFile(f: File): boolean {
  return /^image\/(jpeg|png|webp)$/.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name);
}

export function isPdfFile(f: File): boolean {
  return f.type === "application/pdf" || /\.pdf$/i.test(f.name);
}

async function toCanvas(file: File): Promise<HTMLCanvasElement> {
  // imageOrientation: "from-image" applies the EXIF rotation, so sideways phone photos come out upright.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

/**
 * Photos of notes become one document, one page per photo, in the order picked.
 * So "page 3" in a citation means "the third photo".
 */
export async function extractImagePages(files: File[], onProgress?: (p: number) => void): Promise<PageText[]> {
  const pages: PageText[] = [];
  for (let i = 0; i < files.length; i++) {
    const canvas = await toCanvas(files[i]);
    const text = await recognize(canvas, (p) => onProgress?.((i + p) / files.length));
    canvas.width = canvas.height = 0;
    pages.push({ page: i + 1, text });
    onProgress?.((i + 1) / files.length);
  }
  return pages;
}
