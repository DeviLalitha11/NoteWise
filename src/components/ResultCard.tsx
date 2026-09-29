import { useState } from "react";
import { highlight } from "../lib/highlight";
import type { SearchHit } from "../lib/types";

export function ResultCard({ hit, query, rank }: { hit: SearchHit; query: string; rank: number }) {
  const { chunk, docTitle, via } = hit;
  const [open, setOpen] = useState(rank === 1);
  const [copied, setCopied] = useState(false);
  const long = chunk.text.length > 320;
  const text = open || !long ? chunk.text : `${chunk.text.slice(0, 320).replace(/\s+\S*$/, "")}…`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${chunk.text}\n— ${docTitle}, ${hit.docKind === "photos" ? "photo" : "page"} ${chunk.page}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: nothing useful to do */
    }
  };

  return (
    <article id={`passage-${rank}`} className={`card${rank === 1 ? " best" : ""}`}>
      <header>
        <span className="cite">
          <b>{hit.docKind === "photos" ? "Photo" : "Page"} {chunk.page}</b> · {docTitle}
        </span>
        {rank === 1 && <span className="tag best">Best match</span>}
      </header>
      {chunk.heading && <h3>{chunk.heading}</h3>}
      <p>
        {highlight(text, query).map((s, i) => (s.match ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>))}
      </p>
      <footer>
        <span className="via">
          {via.keyword && <span className="tag">words</span>}
          {via.semantic && <span className="tag meaning">meaning</span>}
        </span>
        <span className="actions">
          {long && (
            <button className="link" onClick={() => setOpen(!open)}>
              {open ? "Less" : "More"}
            </button>
          )}
          <button className="link" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </button>
        </span>
      </footer>
    </article>
  );
}
