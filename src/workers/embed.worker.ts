/// <reference lib="webworker" />
/**
 * Embedding worker. Runs the sentence-embedding model off the main thread so
 * typing and scrolling stay smooth while hundreds of passages are processed.
 *
 * Model: all-MiniLM-L6-v2 (384 dimensions, ~23 MB quantised). Downloaded once
 * from the Hugging Face CDN, then served from the browser cache, so it works offline after that.
 */
import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { createProgressTracker, hasWebGPU, withStallTimeout } from "./loadModel";

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const GPU_STALL_MS = 20_000;

env.allowLocalModels = false; // always fetch from the Hub, then cache
env.useBrowserCache = true;

export type WorkerRequest = { type: "init" } | { type: "embed"; requestId: number; texts: string[] };

export type WorkerResponse =
  | { type: "status"; state: "loading"; progress: number }
  | { type: "status"; state: "ready"; device: "webgpu" | "wasm" }
  | { type: "status"; state: "error"; message: string }
  | { type: "result"; requestId: number; vectors: Float32Array[] }
  | { type: "failed"; requestId: number; message: string };

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

let extractor: Promise<FeatureExtractionPipeline> | null = null;

async function load(): Promise<FeatureExtractionPipeline> {
  const tracker = createProgressTracker((progress) => post({ type: "status", state: "loading", progress }));
  const progress_callback = tracker.callback;

  if (await hasWebGPU()) {
    try {
      const pipe = await withStallTimeout(
        pipeline("feature-extraction", MODEL_ID, { device: "webgpu", dtype: "fp32", progress_callback }),
        tracker,
        GPU_STALL_MS,
      );
      post({ type: "status", state: "ready", device: "webgpu" });
      return pipe as FeatureExtractionPipeline;
    } catch (err) {
      console.warn("[notewise] WebGPU unavailable, using WASM:", err);
    }
  }
  const pipe = await pipeline("feature-extraction", MODEL_ID, { device: "wasm", dtype: "q8", progress_callback });
  post({ type: "status", state: "ready", device: "wasm" });
  return pipe as FeatureExtractionPipeline;
}

function getExtractor() {
  if (!extractor) {
    extractor = load().catch((err) => {
      extractor = null; // allow a retry, e.g. once the network is back
      post({ type: "status", state: "error", message: String(err?.message ?? err) });
      throw err;
    });
  }
  return extractor;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.type === "init") {
    getExtractor().catch(() => {});
    return;
  }
  try {
    const embed = await getExtractor();
    const output = await embed(msg.texts, { pooling: "mean", normalize: true });
    const [n, dim] = output.dims as [number, number];
    const flat = output.data as Float32Array;
    const vectors = Array.from({ length: n }, (_, i) => flat.slice(i * dim, (i + 1) * dim));
    post({ type: "result", requestId: msg.requestId, vectors }, vectors.map((v) => v.buffer));
  } catch (err) {
    post({ type: "failed", requestId: msg.requestId, message: String((err as Error)?.message ?? err) });
  }
};
