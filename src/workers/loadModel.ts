/**
 * Shared model loading for the workers: progress reporting across all files,
 * WebGPU first, CPU (WebAssembly) fallback.
 *
 * Why a "stall" watchdog instead of a fixed timeout?
 * Some GPUs report WebGPU support but never finish initialising, so we can't
 * wait forever. But a fixed 15 s timer also counts the download, and on a slow
 * connection the download alone takes longer than that, which wrongly pushed
 * capable devices onto the slower CPU path. Now the timer only fires when
 * *nothing* has happened for `stallMs`: every progress event resets it.
 */

export interface ProgressEvent {
  status: string;
  file?: string;
  loaded?: number;
  total?: number;
}

export function createProgressTracker(onProgress: (fraction: number, loadedBytes: number, totalBytes: number) => void) {
  const files = new Map<string, { loaded: number; total: number }>();
  let lastActivity = Date.now();
  return {
    get lastActivity() {
      return lastActivity;
    },
    callback: (p: ProgressEvent) => {
      lastActivity = Date.now();
      if (p.status !== "progress" || !p.file || !p.total) return;
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
      let loaded = 0;
      let total = 0;
      for (const f of files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      onProgress(total ? loaded / total : 0, loaded, total);
    },
  };
}

/** Resolve with `work`, or reject if the tracker sees no activity for `stallMs`. */
export function withStallTimeout<T>(work: Promise<T>, tracker: { lastActivity: number }, stallMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setInterval(() => {
      if (Date.now() - tracker.lastActivity > stallMs) {
        clearInterval(timer);
        reject(new Error(`no progress for ${Math.round(stallMs / 1000)} s`));
      }
    }, 1000);
    work.then(
      (v) => {
        clearInterval(timer);
        resolve(v);
      },
      (e) => {
        clearInterval(timer);
        reject(e);
      },
    );
  });
}

export async function hasWebGPU(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}
