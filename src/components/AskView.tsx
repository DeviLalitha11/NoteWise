import { useEffect, useRef, useState } from "react";
import { answerer, type AnswererState } from "../lib/answerer";
import { buildAnswerPrompt } from "../lib/prompt";
import type { SearchHit } from "../lib/types";
import { AnswerCard } from "./AnswerCard";
import { ResultCard } from "./ResultCard";
import { formatBytes } from "./format";

interface Props {
  ready: boolean;
  hasDocs: boolean;
  smart: boolean;
  writer: AnswererState;
  search: (q: string) => Promise<SearchHit[]>;
  onAddNotes: () => void;
  onEnableAnswers: () => void;
}

const EXAMPLES = ["What is a deadlock?", "Difference between paging and segmentation", "Explain round robin scheduling"];

interface Answer {
  text: string;
  used: SearchHit[];
  streaming: boolean;
  error?: string;
}

export function AskView({ ready, hasDocs, smart, writer, search, onAddNotes, onEnableAnswers }: Props) {
  const [query, setQuery] = useState("");
  const [asked, setAsked] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const [ms, setMs] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const runId = useRef(0);

  const writeAnswer = async (question: string, found: SearchHit[], id: number) => {
    const { messages, used } = buildAnswerPrompt(question, found);
    if (!used.length) return;
    setAnswer({ text: "", used, streaming: true });
    try {
      await answerer.generate(messages, (t) => {
        if (runId.current === id) setAnswer((a) => (a ? { ...a, text: a.text + t } : a));
      });
      if (runId.current === id) setAnswer((a) => (a ? { ...a, streaming: false } : a));
    } catch (err) {
      if (runId.current === id) setAnswer((a) => (a ? { ...a, streaming: false, error: (err as Error).message } : a));
    }
  };

  const run = async (q: string) => {
    const text = q.trim();
    if (!text) return;
    const id = ++runId.current;
    setBusy(true);
    setAnswer(null);
    const t0 = performance.now();
    try {
      const found = await search(text);
      if (runId.current !== id) return;
      setHits(found);
      setAsked(text);
      setMs(performance.now() - t0);
      if (found.length && answerer.status.state === "ready") void writeAnswer(text, found, id);
    } finally {
      setBusy(false);
    }
  };

  // Re-run the last question when smart search or answer writing becomes available,
  // so results improve in place instead of the student having to ask again.
  useEffect(() => {
    if (asked) run(asked);
  }, [smart, writer.state === "ready"]);

  // Stop any answer in progress when leaving this screen.
  useEffect(() => () => answerer.stop(), []);

  if (ready && !hasDocs) {
    return (
      <section className="empty">
        <img src="/icon.svg" alt="" width={72} height={72} />
        <h2>Add your notes to start</h2>
        <p>
          Upload lecture notes, a textbook PDF or photos of your notes. NoteWise reads them <b>on this device</b>, so nothing is
          uploaded. Then it answers your questions with the exact page to look at.
        </p>
        <button className="primary" onClick={onAddNotes}>
          Add notes
        </button>
      </section>
    );
  }

  return (
    <section className="ask">
      <form
        className="askbar"
        onSubmit={(e) => {
          e.preventDefault();
          inputRef.current?.blur(); // closes the phone keyboard so results are visible
          run(query);
        }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask anything from your notes…"
          enterKeyHint="search"
          aria-label="Your question"
        />
        <button type="submit" className="primary" disabled={busy || !query.trim()}>
          {busy ? "…" : "Ask"}
        </button>
      </form>

      {hits === null && (
        <div className="examples">
          <p>Try asking</p>
          {EXAMPLES.map((e) => (
            <button
              key={e}
              className="chip"
              onClick={() => {
                setQuery(e);
                run(e);
              }}
            >
              {e}
            </button>
          ))}
        </div>
      )}

      {hits !== null && (
        <div className="results">
          {answer && <AnswerCard {...answer} onStop={() => answerer.stop()} />}

          {hits.length > 0 && writer.state === "idle" && (
            <div className="promo">
              <div>
                <b>Want a written answer?</b>
                <span>NoteWise can write exam-style answers from these passages, on this phone. One-time download, best on Wi-Fi.</span>
              </div>
              <button className="secondary" onClick={onEnableAnswers}>
                Get answers
              </button>
            </div>
          )}
          {writer.state === "loading" && (
            <div className="promo">
              <div>
                <b>Downloading the answer writer…</b>
                <span>
                  {Math.round(writer.progress * 100)}%{writer.totalBytes ? ` of ${formatBytes(writer.totalBytes)}` : ""}. You can keep
                  searching meanwhile.
                </span>
                <progress value={writer.progress} />
              </div>
            </div>
          )}

          <p className="meta">
            {hits.length ? `${hits.length} passages from your notes` : "Nothing in your notes matches that yet."}
            {hits.length > 0 && ` · ${ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`} · on this device`}
          </p>
          {hits.length === 0 && (
            <p className="hint">
              Try different words{smart ? ", or check the right notes are added." : ". Smart search (by meaning) switches on automatically soon."}
            </p>
          )}
          {hits.map((h, i) => (
            <ResultCard key={h.chunk.id} hit={h} query={asked} rank={i + 1} />
          ))}
        </div>
      )}
    </section>
  );
}
