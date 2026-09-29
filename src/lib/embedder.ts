import type { WorkerRequest, WorkerResponse } from "../workers/embed.worker";

export type EmbedderState =
  | { state: "idle" }
  | { state: "loading"; progress: number }
  | { state: "ready"; device: "webgpu" | "wasm" }
  | { state: "error"; message: string };

type Listener = (s: EmbedderState) => void;

/**
 * Main-thread handle to the embedding worker. Turns postMessage traffic into
 * plain promises: `await embedder.embed(["text"])`.
 */
class Embedder {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: Float32Array[]) => void; reject: (e: Error) => void }>();
  private listeners = new Set<Listener>();
  status: EmbedderState = { state: "idle" };

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("../workers/embed.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === "status") {
        this.setStatus(
          msg.state === "loading"
            ? { state: "loading", progress: msg.progress }
            : msg.state === "ready"
              ? { state: "ready", device: msg.device }
              : { state: "error", message: msg.message },
        );
        if (msg.state === "error") this.rejectAll(new Error(msg.message));
        return;
      }
      const p = this.pending.get(msg.requestId);
      if (!p) return;
      this.pending.delete(msg.requestId);
      if (msg.type === "result") p.resolve(msg.vectors);
      else p.reject(new Error(msg.message));
    };
    worker.onerror = (e) => {
      this.setStatus({ state: "error", message: e.message || "Embedding worker crashed" });
      this.rejectAll(new Error(e.message));
    };
    this.worker = worker;
    return worker;
  }

  private setStatus(s: EmbedderState) {
    this.status = s;
    this.listeners.forEach((l) => l(s));
  }

  private rejectAll(err: Error) {
    this.pending.forEach((p) => p.reject(err));
    this.pending.clear();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  /** Start downloading/loading the model in the background. Safe to call repeatedly. */
  warmUp() {
    if (this.status.state === "idle" || this.status.state === "error") {
      this.setStatus({ state: "loading", progress: 0 });
      this.post({ type: "init" });
    }
  }

  get ready() {
    return this.status.state === "ready";
  }

  embed(texts: string[]): Promise<Float32Array[]> {
    const requestId = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.post({ type: "embed", requestId, texts });
    });
  }

  private post(msg: WorkerRequest) {
    this.ensureWorker().postMessage(msg);
  }
}

export const embedder = new Embedder();
