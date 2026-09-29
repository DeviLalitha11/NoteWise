/// <reference lib="webworker" />
/**
 * Answer-writing worker: a small language model running on the device's GPU.
 *
 * Model: Gemma 3 1B instruction-tuned (Google, open weights), 4-bit quantised
 * ONNX build, run by Transformers.js on WebGPU. It downloads once from the
 * Hugging Face CDN and is cached by the browser, so it works offline afterwards.
 *
 * WebGPU only, on purpose: on the CPU a 1B model writes a few words per second
 * on a phone, which is worse than just showing the passages.
 */
import {
  env,
  InterruptableStoppingCriteria,
  pipeline,
  TextStreamer,
  type TextGenerationPipeline,
} from "@huggingface/transformers";
import { createProgressTracker, hasWebGPU, withStallTimeout } from "./loadModel";

const MODEL_ID = "onnx-community/gemma-3-1b-it-ONNX";
// Shader compilation for a 1B model can take a while on phones; only give up after a real stall.
const STALL_MS = 60_000;

env.allowLocalModels = false;
env.useBrowserCache = true;

export type LlmRequest =
  | { type: "init" }
  | { type: "generate"; requestId: number; messages: { role: string; content: string }[]; maxNewTokens: number }
  | { type: "stop" };

export type LlmResponse =
  | { type: "status"; state: "loading"; progress: number; totalBytes: number }
  | { type: "status"; state: "ready" }
  | { type: "status"; state: "error"; message: string }
  | { type: "token"; requestId: number; text: string }
  | { type: "done"; requestId: number; stopped: boolean }
  | { type: "failed"; requestId: number; message: string };

const post = (msg: LlmResponse) => self.postMessage(msg);

let generator: Promise<TextGenerationPipeline> | null = null;
const stopping = new InterruptableStoppingCriteria();
let running: Promise<void> = Promise.resolve();

async function load(): Promise<TextGenerationPipeline> {
  if (!(await hasWebGPU())) throw new Error("This device doesn't support WebGPU, which answer writing needs.");
  const tracker = createProgressTracker((progress, _loaded, totalBytes) => post({ type: "status", state: "loading", progress, totalBytes }));
  const pipe = (await withStallTimeout(
    pipeline("text-generation", MODEL_ID, { device: "webgpu", dtype: "q4", progress_callback: tracker.callback }),
    tracker,
    STALL_MS,
  )) as TextGenerationPipeline;
  // Warm-up: the first run compiles GPU shaders. Doing it now makes the first real answer fast.
  await pipe([{ role: "user", content: "Hi" }], { max_new_tokens: 1 });
  post({ type: "status", state: "ready" });
  return pipe;
}

function getGenerator() {
  if (!generator) {
    generator = load().catch((err) => {
      generator = null;
      post({ type: "status", state: "error", message: String(err?.message ?? err) });
      throw err;
    });
  }
  return generator;
}

self.onmessage = async (event: MessageEvent<LlmRequest>) => {
  const msg = event.data;
  if (msg.type === "init") {
    getGenerator().catch(() => {});
    return;
  }
  if (msg.type === "stop") {
    stopping.interrupt();
    return;
  }
  const { requestId } = msg;
  // One generation at a time: stop the previous answer and wait for it to wind down,
  // otherwise resetting the stop flag could let the old answer keep running.
  stopping.interrupt();
  const previous = running;
  let release!: () => void;
  running = new Promise<void>((r) => (release = r));
  await previous;
  try {
    const pipe = await getGenerator();
    stopping.reset();
    const streamer = new TextStreamer(pipe.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (text: string) => post({ type: "token", requestId, text }),
    });
    await pipe(msg.messages, {
      max_new_tokens: msg.maxNewTokens,
      do_sample: false, // deterministic: the same notes and question give the same answer
      repetition_penalty: 1.1,
      streamer,
      stopping_criteria: [stopping],
    });
    post({ type: "done", requestId, stopped: stopping.interrupted });
  } catch (err) {
    post({ type: "failed", requestId, message: String((err as Error)?.message ?? err) });
  } finally {
    release();
  }
};
