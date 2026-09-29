import { NOT_FOUND, parseCitations } from "../lib/prompt";
import type { SearchHit } from "../lib/types";

interface Props {
  text: string;
  used: SearchHit[];
  streaming: boolean;
  error?: string;
  onStop: () => void;
}

/** A citation chip scrolls to the passage it came from, so the student can check it. */
function jumpTo(n: number) {
  const el = document.getElementById(`passage-${n}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 1200);
}

export function AnswerCard({ text, used, streaming, error, onStop }: Props) {
  const notFound = !streaming && text.trim().startsWith(NOT_FOUND.slice(0, 20));
  return (
    <article className={`answer${streaming ? " streaming" : ""}`} aria-live="polite" aria-busy={streaming}>
      <header>
        <span className="answer-label">✦ Answer · written on this device</span>
        {streaming && (
          <button className="link" onClick={onStop}>
            Stop
          </button>
        )}
      </header>
      {error ? (
        <p className="err">Couldn't write an answer: {error}. The passages below are still from your notes.</p>
      ) : !text && streaming ? (
        <p className="thinking">Reading your notes…</p>
      ) : notFound ? (
        <p className="hint">Your notes don't seem to cover this. Check the passages below, or add the chapter that does.</p>
      ) : (
        <div className="answer-body">
          {text.split(/\n{2,}/).map((para, pi) => (
            <p key={pi}>
              {parseCitations(para, used.length).map((seg, i) =>
                seg.type === "text" ? (
                  <span key={i}>{seg.text}</span>
                ) : (
                  <button key={i} className="cite-chip" onClick={() => jumpTo(seg.n)} title={`${used[seg.n - 1].docTitle}, ${used[seg.n - 1].docKind === "photos" ? "photo" : "page"} ${used[seg.n - 1].chunk.page}`}>
                    {used[seg.n - 1].docKind === "photos" ? "photo " : "p."}
                    {used[seg.n - 1].chunk.page}
                  </button>
                ),
              )}
              {streaming && pi === text.split(/\n{2,}/).length - 1 && <span className="caret" />}
            </p>
          ))}
        </div>
      )}
      {!streaming && !error && !notFound && text && (
        <p className="disclaimer">Written by a small AI from your notes. Tap a page chip to check the source.</p>
      )}
    </article>
  );
}
