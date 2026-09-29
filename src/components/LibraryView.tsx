import { useRef, useState } from "react";
import type { AnswererState } from "../lib/answerer";
import type { EmbedderState } from "../lib/embedder";
import { isImageFile, isPdfFile } from "../lib/images";
import type { NoteDoc } from "../lib/types";
import type { ImportJob } from "../lib/useNoteWise";
import { formatBytes } from "./format";

interface Props {
  docs: NoteDoc[];
  jobs: ImportJob[];
  embedProgress: Record<string, number>;
  model: EmbedderState;
  writer: AnswererState;
  needsDataOk: boolean;
  onImport: (files: File[]) => void;
  onRemove: (id: string) => void;
  onDismissJob: (id: string) => void;
  onEnableSmart: () => void;
  onEnableAnswers: () => void;
}

const STAGE_LABEL: Record<ImportJob["stage"], string> = {
  reading: "Reading",
  ocr: "Reading scanned pages",
  indexing: "Indexing…",
  done: "Added ✓",
  error: "",
};

export function LibraryView(props: Props) {
  const { docs, jobs, embedProgress, model, writer, needsDataOk } = props;
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  const take = (list: FileList | null) => {
    const files = [...(list ?? [])].filter((f) => isPdfFile(f) || isImageFile(f));
    if (files.length) props.onImport(files);
  };

  return (
    <section className="library">
      <div
        className={`drop${dragging ? " over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          take(e.dataTransfer.files);
        }}
      >
        <input ref={fileRef} type="file" accept="application/pdf,.pdf,image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => (take(e.target.files), (e.target.value = ""))} />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (take(e.target.files), (e.target.value = ""))} />
        <div className="drop-buttons">
          <button className="primary" onClick={() => fileRef.current?.click()}>
            + Add PDF or photos
          </button>
          <button className="secondary" onClick={() => cameraRef.current?.click()}>
            Scan a page
          </button>
        </div>
        <p>Scanned pages and photos are read with on-device OCR. Nothing leaves your phone.</p>
      </div>

      {jobs.map((j) => (
        <div key={j.id} className={`job ${j.stage}`}>
          <div className="row">
            <span className="name">{j.name}</span>
            <span className="state">
              {j.stage === "error" ? (
                <button className="link" onClick={() => props.onDismissJob(j.id)}>
                  Dismiss
                </button>
              ) : (
                `${STAGE_LABEL[j.stage]}${j.stage === "reading" || j.stage === "ocr" ? ` ${Math.round(j.progress * 100)}%` : ""}`
              )}
            </span>
          </div>
          {j.stage === "error" ? <p className="err">{j.message}</p> : <progress value={j.stage === "reading" || j.stage === "ocr" ? j.progress : 1} />}
        </div>
      ))}

      {needsDataOk && model.state === "idle" && (
        <div className="smart-card">
          <h3>Turn on search by meaning?</h3>
          <p>
            You seem to be on mobile data. Smart search needs a one-time download of about 50 MB, then works offline forever. It
            switches on by itself next time you're on Wi-Fi.
          </p>
          <button className="secondary" onClick={props.onEnableSmart}>
            Download now
          </button>
        </div>
      )}

      {docs.length > 0 && writer.state !== "unsupported" && writer.state !== "ready" && (
        <div className="smart-card">
          <h3>Written answers</h3>
          {writer.state === "loading" ? (
            <>
              <p>
                Downloading the answer writer: {Math.round(writer.progress * 100)}%
                {writer.totalBytes ? ` of ${formatBytes(writer.totalBytes)}` : ""}.
              </p>
              <progress value={writer.progress} />
            </>
          ) : (
            <>
              <p>
                A small AI model (Google's Gemma, runs on this phone's GPU) writes exam-style answers from your notes, with page
                numbers. It's a large one-time download, so use Wi-Fi.
              </p>
              <button className="secondary" onClick={props.onEnableAnswers}>
                {writer.state === "error" ? "Retry download" : "Download answer writer"}
              </button>
              {writer.state === "error" && <p className="err">{writer.message}</p>}
            </>
          )}
        </div>
      )}

      <ul className="docs">
        {docs.map((d) => {
          const p = embedProgress[d.id];
          const learning = !d.embedded && model.state === "ready";
          return (
            <li key={d.id}>
              <div className="doc-icon" aria-hidden="true">
                {d.kind === "photos" ? "IMG" : "PDF"}
              </div>
              <div className="doc-body">
                <b>{d.title}</b>
                <span>
                  {d.pageCount} {d.kind === "photos" ? (d.pageCount === 1 ? "photo" : "photos") : d.pageCount === 1 ? "page" : "pages"} · {d.chunkCount} passages
                  {d.embedded ? " · smart ✓" : learning ? ` · learning ${Math.round((p ?? 0) * 100)}%` : ""}
                </span>
              </div>
              {confirming === d.id ? (
                <span className="confirm">
                  <button className="link danger" onClick={() => (props.onRemove(d.id), setConfirming(null))}>
                    Remove
                  </button>
                  <button className="link" onClick={() => setConfirming(null)}>
                    Keep
                  </button>
                </span>
              ) : (
                <button className="icon" aria-label={`Remove ${d.title}`} onClick={() => setConfirming(d.id)}>
                  ×
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
