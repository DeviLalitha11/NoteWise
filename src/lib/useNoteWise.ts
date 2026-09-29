import { useCallback, useEffect, useMemo, useState } from "react";
import { answerer, checkAnswerSupport, type AnswererState } from "./answerer";
import { embedder, type EmbedderState } from "./embedder";
import { Engine } from "./engine";
import { isImageFile, isPdfFile } from "./images";
import { currentConnection, downloadPolicy } from "./network";
import type { NoteDoc } from "./types";

const SMART_KEY = "notewise:smart-search";

export interface ImportJob {
  id: string;
  name: string;
  stage: "reading" | "ocr" | "indexing" | "done" | "error";
  progress: number;
  message?: string;
}

const readPref = () => {
  try {
    return localStorage.getItem(SMART_KEY) === "on";
  } catch {
    return false;
  }
};
const savePref = () => {
  try {
    localStorage.setItem(SMART_KEY, "on");
  } catch {
    /* private mode: fine, we just won't remember */
  }
};

/** React glue around the engine, the embedding worker and the answer worker. */
export function useNoteWise() {
  const [docs, setDocs] = useState<NoteDoc[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [model, setModel] = useState<EmbedderState>(embedder.status);
  const [writer, setWriter] = useState<AnswererState>(answerer.status);
  const [embedProgress, setEmbedProgress] = useState<Record<string, number>>({});
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  /** True when smart search is waiting for the student's OK because they're on mobile data. */
  const [needsDataOk, setNeedsDataOk] = useState(false);

  const engine = useMemo(
    () =>
      new Engine(
        { embed: (t) => embedder.embed(t), canEmbed: () => embedder.ready },
        {
          onChange: () => setDocs(engine.listDocs()),
          onEmbedProgress: (id, done, total) => setEmbedProgress((p) => ({ ...p, [id]: total ? done / total : 1 })),
        },
      ),
    [],
  );

  useEffect(() => {
    engine.init().then(() => setLoaded(true));
    const unsubs = [embedder.subscribe(setModel), answerer.subscribe(setWriter)];
    // Already downloaded before? It's in the browser cache, so loading it again costs no data.
    if (readPref()) embedder.warmUp();
    checkAnswerSupport().then((s) => {
      if (!s.ok) answerer.markUnsupported(s.reason);
      else if (answerer.wasEnabled) answerer.enable();
    });
    // If a download failed because the network dropped, try again when it's back.
    const onOnline = () => {
      if (embedder.status.state === "error") embedder.warmUp();
      if (answerer.status.state === "error") answerer.enable();
    };
    window.addEventListener("online", onOnline);
    return () => {
      unsubs.forEach((u) => u());
      window.removeEventListener("online", onOnline);
    };
  }, [engine]);

  // Smart search switches itself on once there are notes to search: automatically on
  // Wi-Fi, but on mobile data we ask first (it's a ~50 MB one-time download).
  useEffect(() => {
    if (!loaded || docs.length === 0 || embedder.status.state !== "idle") return;
    if (readPref() || downloadPolicy(currentConnection()) === "auto") {
      savePref();
      embedder.warmUp();
    } else {
      setNeedsDataOk(true);
    }
  }, [loaded, docs.length]);

  // Whenever the model becomes ready, catch up on any documents that were added without it.
  useEffect(() => {
    if (model.state === "ready") engine.embedPending().catch((e) => console.error(e));
  }, [model.state, engine, docs.length]);

  const enableSmartSearch = useCallback(() => {
    savePref();
    setNeedsDataOk(false);
    embedder.warmUp();
  }, []);

  const importFiles = useCallback(
    async (files: File[]) => {
      const pdfs = files.filter(isPdfFile);
      const photos = files.filter(isImageFile);
      // Each PDF is its own document; photos picked together become one document.
      const batches: { name: string; title: string; kind: "pdf" | "photos"; files: File[] }[] = [
        ...pdfs.map((f) => ({ name: f.name, title: f.name.replace(/\.pdf$/i, ""), kind: "pdf" as const, files: [f] })),
      ];
      if (photos.length) {
        const when = new Date().toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
        batches.push({
          name: photos.length === 1 ? photos[0].name : `${photos.length} photos`,
          title: `Photo notes · ${when}`,
          kind: "photos",
          files: photos,
        });
      }

      const added = batches.map((b) => ({ ...b, id: `${b.name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` }));
      setJobs((js) => [...js, ...added.map((b) => ({ id: b.id, name: b.name, stage: "reading" as const, progress: 0 }))]);

      for (const b of added) {
        const update = (patch: Partial<ImportJob>) => setJobs((js) => js.map((j) => (j.id === b.id ? { ...j, ...patch } : j)));
        try {
          let pages;
          if (b.kind === "pdf") {
            // PDF.js (~1 MB) is only downloaded the first time someone adds a file.
            const { extractPdfPages } = await import("./pdf");
            pages = await extractPdfPages(await b.files[0].arrayBuffer(), ({ stage, progress }) => update({ stage, progress }));
          } else {
            const { extractImagePages } = await import("./images");
            update({ stage: "ocr", progress: 0 });
            pages = await extractImagePages(b.files, (progress) => update({ progress }));
          }
          update({ stage: "indexing", progress: 1 });
          await engine.addDocument(b.title, pages, b.kind);
          update({ stage: "done" });
          setTimeout(() => setJobs((js) => js.filter((j) => j.id !== b.id)), 2500);
        } catch (err) {
          update({ stage: "error", message: (err as Error).message || "Could not read this file" });
        }
      }
      const { releaseOcr } = await import("./ocr");
      await releaseOcr();
    },
    [engine],
  );

  const dismissJob = useCallback((id: string) => setJobs((js) => js.filter((j) => j.id !== id)), []);

  return {
    loaded,
    docs,
    model,
    writer,
    embedProgress,
    jobs,
    needsDataOk,
    importFiles,
    dismissJob,
    enableSmartSearch,
    enableAnswers: () => answerer.enable(),
    search: (q: string) => engine.search(q),
    removeDoc: (id: string) => engine.removeDocument(id),
  };
}
