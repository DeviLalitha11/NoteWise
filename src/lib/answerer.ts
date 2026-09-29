import type { LlmRequest, LlmResponse } from "../workers/llm.worker";
import type { ChatMessage } from "./prompt";

export type AnswererState =
  | { state: "unsupported"; reason: string }
  | { state: "idle" }
  | { state: "loading"; progress: number; totalBytes: number }
  | { state: "ready" }
  | { state: "error"; message: string };

const PREF_KEY = "notewise:answers";

/**
 * Can this device write answers? Needs WebGPU and enough memory.
 * `navigator.deviceMemory` is Chrome-only and rounded (max 8); when it's
 * missing (Safari, Firefox) we let WebGPU availability decide.
 */
export async function checkAnswerSupport(): Promise<{ ok: true } | { ok: false; reason: string }> {
  const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> }; deviceMemory?: number };
  if (!nav.gpu) return { ok: false, reason: "This browser doesn't support WebGPU yet." };
  const adapter = await nav.gpu.requestAdapter().catch(() => null);
  if (!adapter) return { ok: false, reason: "This device's GPU isn't available to the browser." };
  if (nav.deviceMemory !== undefined && nav.deviceMemory < 4) return { ok: false, reason: "This phone has less than 4 GB of memory." };
  return { ok: true };
}

/** Main-thread handle to the answer-writing worker. */
class Answerer {
  private worker: Worker | null = null;
  private nextId = 1;
  private active: { id: number; onToken: (t: string) => void; resolve: (r: { stopped: boolean }) => void; reject: (e: Error) => void } | null = null;
  private listeners = new Set<(s: AnswererState) => void>();
  status: AnswererState = { state: "idle" };

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("../workers/llm.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<LlmResponse>) => {
      const msg = e.data;
      if (msg.type === "status") {
        if (msg.state === "loading") this.setStatus({ state: "loading", progress: msg.progress, totalBytes: msg.totalBytes });
        else if (msg.state === "ready") this.setStatus({ state: "ready" });
        else {
          this.setStatus({ state: "error", message: msg.message });
          this.finish(new Error(msg.message));
        }
        return;
      }
      if (!this.active || this.active.id !== msg.requestId) return;
      if (msg.type === "token") this.active.onToken(msg.text);
      else if (msg.type === "done") this.finish(null, { stopped: msg.stopped });
      else this.finish(new Error(msg.message));
    };
    worker.onerror = (e) => {
      this.setStatus({ state: "error", message: e.message || "Answer worker crashed" });
      this.finish(new Error(e.message));
    };
    this.worker = worker;
    return worker;
  }

  private finish(err: Error | null, result = { stopped: false }) {
    const a = this.active;
    this.active = null;
    if (!a) return;
    if (err) a.reject(err);
    else a.resolve(result);
  }

  private setStatus(s: AnswererState) {
    this.status = s;
    this.listeners.forEach((l) => l(s));
  }

  private post(msg: LlmRequest) {
    this.ensureWorker().postMessage(msg);
  }

  subscribe(listener: (s: AnswererState) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  markUnsupported(reason: string) {
    this.setStatus({ state: "unsupported", reason });
  }

  /** Start the one-time download. Remembered, so later visits load from cache automatically. */
  enable() {
    if (this.status.state === "idle" || this.status.state === "error") {
      try {
        localStorage.setItem(PREF_KEY, "on");
      } catch {
        /* private mode */
      }
      this.setStatus({ state: "loading", progress: 0, totalBytes: 0 });
      this.post({ type: "init" });
    }
  }

  get wasEnabled(): boolean {
    try {
      return localStorage.getItem(PREF_KEY) === "on";
    } catch {
      return false;
    }
  }

  /** Stream an answer. Only one answer at a time: a new question stops the previous one. */
  generate(messages: ChatMessage[], onToken: (t: string) => void, maxNewTokens = 320): Promise<{ stopped: boolean }> {
    if (this.active) this.stop();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.active = { id, onToken, resolve, reject };
      this.post({ type: "generate", requestId: id, messages, maxNewTokens });
    });
  }

  stop() {
    if (this.worker) this.post({ type: "stop" });
    this.finish(null, { stopped: true });
  }
}

export const answerer = new Answerer();
