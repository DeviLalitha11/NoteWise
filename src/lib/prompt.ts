import type { SearchHit } from "./types";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * Build a grounded prompt: the model may only use the numbered passages, and
 * must cite them as [1], [2]... so every sentence in the answer can be traced
 * back to a page in the student's notes. This is Retrieval-Augmented Generation (RAG).
 *
 * Small on-device models have small context windows and slow prompt
 * processing on phones, so the passages are capped at `maxChars` in rank order.
 */
export function buildAnswerPrompt(question: string, hits: SearchHit[], maxChars = 3200): { messages: ChatMessage[]; used: SearchHit[] } {
  const used: SearchHit[] = [];
  const blocks: string[] = [];
  let size = 0;
  for (const hit of hits) {
    const label = `[${used.length + 1}] (${hit.docTitle}, ${hit.docKind === "photos" ? "photo" : "page"} ${hit.chunk.page}${hit.chunk.heading ? `, ${hit.chunk.heading}` : ""})`;
    const room = maxChars - size - label.length - 2;
    if (room < 200) break;
    const body = hit.chunk.text.length > room ? `${hit.chunk.text.slice(0, room).replace(/\s+\S*$/, "")}…` : hit.chunk.text;
    blocks.push(`${label}\n${body}`);
    size += label.length + body.length + 2;
    used.push(hit);
  }

  // Gemma has no separate system role, so the instructions go in the user turn.
  const content = [
    "You are NoteWise, a study assistant for a college student preparing for exams.",
    "Answer the question using ONLY the numbered passages from the student's own notes below.",
    "Rules:",
    "- After each fact, cite the passage it came from, like [1] or [2].",
    "- If the passages do not contain the answer, reply exactly: I couldn't find this in your notes.",
    "- Do not add facts that are not in the passages.",
    "- Write a clear exam-style answer: a one-line definition first, then key points. Under 180 words.",
    "",
    "Passages:",
    blocks.join("\n\n"),
    "",
    `Question: ${question.trim()}`,
  ].join("\n");

  return { messages: [{ role: "user", content }], used };
}

export type AnswerSegment = { type: "text"; text: string } | { type: "cite"; n: number };

/**
 * Split generated text into plain text and citation markers.
 * Accepts [1], [1, 3] and [1][2]. Numbers that don't match a passage are dropped
 * rather than shown, so a hallucinated citation can't point at the wrong page.
 */
export function parseCitations(answer: string, passageCount: number): AnswerSegment[] {
  const out: AnswerSegment[] = [];
  const re = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
  let last = 0;
  for (const m of answer.matchAll(re)) {
    if (m.index > last) out.push({ type: "text", text: answer.slice(last, m.index) });
    for (const n of m[1].split(",").map((s) => Number(s.trim()))) {
      if (n >= 1 && n <= passageCount) out.push({ type: "cite", n });
    }
    last = m.index + m[0].length;
  }
  if (last < answer.length) out.push({ type: "text", text: answer.slice(last) });
  return out;
}

export const NOT_FOUND = "I couldn't find this in your notes.";
