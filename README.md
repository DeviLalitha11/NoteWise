# NoteWise — your notes, understood

An offline-first AI study assistant. Students add their lecture notes, textbook PDFs, scanned
pages or phone photos of notes, and ask questions in plain language. NoteWise finds the answer in
**their own notes**, writes an exam-style answer, and cites the exact page for every point.

Everything runs **on the student's phone or laptop**: PDF reading, OCR, indexing, search and the
language model. Nothing is uploaded, there are no API keys, and it costs nothing to run.

---

## Status

| Phase | What | State |
| --- | --- | --- |
| 1 | PDF import, hybrid search (keyword + AI meaning), page citations, installable offline PWA | ✅ done |
| 1.5 | OCR for scanned PDFs and photos, automatic smart search, stall-based GPU fallback | ✅ done |
| 2 | On-device LLM (Gemma 3 1B via WebGPU) writes cited answers from the retrieved passages | ✅ done, needs real-device testing |
| 3 | Note Packs: share a processed notes library with classmates in real time | planned |
| 4 | Fine-tune our own small model on exam-style Q&A (Kaggle/Colab free GPU) | planned |

---

## How it works

```
 PDF ────> PDF.js (text per page) ─┐
   └ scanned pages ─> Tesseract OCR ┤
 Photos ─────────────> Tesseract OCR ┴─> chunker ──> IndexedDB (on device)
                                            │
                                            ├──> BM25 keyword index               (instant, any phone)
                                            └──> MiniLM embeddings, Web Worker    (auto-downloads on Wi-Fi)

 Question ──> BM25 top 30 ──────────────┐
          └─> embed ─> cosine top 30 ───┴─> Reciprocal Rank Fusion ──> top passages + page numbers
                                                                           │
                                          (WebGPU devices, opt-in) ────────┴─> Gemma 3 1B writes an
                                                                                answer citing [1], [2] → p.4, p.9
```

**Chunking** (`src/lib/chunker.ts`). Pages are split into ~120-word passages. A passage never spans
two pages, so every citation points to exactly one page. Headings like `UNIT - III` or
`3.2 Deadlock Avoidance` are detected and attached to the passages under them, which gives both
search and the reader context.

**Keyword search** (`src/lib/bm25.ts`). BM25, the ranking function behind Elasticsearch, written from
scratch. It works the moment a PDF is added, with no download, on any phone. Exam filler words
("explain", "define", "short note") are ignored. The tokenizer keeps Telugu words intact, because
Telugu vowel signs are Unicode combining marks.

**Semantic search** (`src/workers/embed.worker.ts`, `src/lib/vector.ts`). `all-MiniLM-L6-v2` turns each
passage into a 384-number vector, so "processes stuck waiting" can find a passage about deadlock. It
runs in a Web Worker so the UI never freezes. It uses WebGPU when the device has it and falls back
to WebAssembly on the CPU, with a timeout for GPUs that claim support but hang. Vectors are
normalised once, so similarity is a plain dot product. A brute-force scan of a semester's notes
(a few thousand passages) takes milliseconds on a phone, so an approximate index would add
complexity with no visible gain.

**Fusion** (`src/lib/fusion.ts`). BM25 scores and cosine similarities are on different scales and
can't be added. Reciprocal Rank Fusion combines the two ranked lists using only rank, so passages
that both methods like rise to the top.

**OCR** (`src/lib/ocr.ts`, `src/lib/images.ts`). Many college notes are photocopies or phone photos
with no text layer. Pages where PDF.js finds almost no text are rendered to a canvas and read with
Tesseract.js (WebAssembly) on the device. Photos are downscaled to 2000 px and rotated upright from
their EXIF data first. The OCR engine and English data are served by the app itself
(`scripts/copy-ocr-assets.mjs`), not a CDN, so OCR works on networks that block CDNs and offline
once cached. It reads printed text well; handwriting is much less reliable.

**Written answers** (`src/workers/llm.worker.ts`, `src/lib/prompt.ts`). This is Retrieval-Augmented
Generation (RAG) with the whole pipeline on the device. The top passages are numbered and given to
Gemma 3 1B (Google's open model, 4-bit ONNX, run by Transformers.js on WebGPU) with strict rules:
use only these passages, cite them as [1], [2], and say "I couldn't find this in your notes"
otherwise. Citations become tappable page chips that scroll to the source passage; citation
numbers that don't match a passage are dropped, so a made-up citation can't point to the wrong
page. Answers stream token by token and can be stopped. Generation is greedy (no sampling), so the
same notes and question give the same answer. It's WebGPU-only on purpose: on a phone CPU a 1B
model is too slow to be useful, so those devices keep the passage view.

**Model loading** (`src/workers/loadModel.ts`). Each worker tries WebGPU first and falls back to the
CPU. Some GPUs claim WebGPU support but hang during setup, so there's a watchdog, but it measures
*stalls*, not total time: every download progress event resets it. A fixed timeout would also count
the download and wrongly push capable devices onto the CPU on slow connections.

**Data-friendly downloads** (`src/lib/network.ts`). Smart search downloads by itself on Wi-Fi. On mobile
data or with Data Saver on, it asks first. The large answer model is always opt-in. Failed downloads
retry automatically when the connection comes back.

**Storage** (`src/lib/db.ts`). IndexedDB holds documents, passages and embeddings (stored as
`Float32Array`, not JSON). Embeddings are saved batch by batch, so closing the app midway loses at
most one batch.

**Offline** (`vite.config.ts`). A service worker precaches the ~2.5 MB app shell. The 27 MB AI runtime
is cached only when a student turns on smart search, so students who never use it don't pay for it.

### Graceful degradation

| Device | Experience |
| --- | --- |
| Any phone, no model yet | Keyword search with highlighted matches and page numbers |
| Model downloaded, no WebGPU | Hybrid search, embeddings on the CPU (WebAssembly) |
| WebGPU available | Hybrid search on the GPU, plus the option of written answers |
| WebGPU + answer model downloaded | Cited, exam-style answers written on the device |

---

## Run it

Needs Node 20+.

```bash
npm install
npm run dev        # http://localhost:5173
```

Try it with `samples/OS_Unit3_Notes.pdf` and ask "how does the system avoid deadlock?".

Smart search downloads its model (~23 MB, plus the AI runtime) from the Hugging Face CDN by itself
once you've added notes (on Wi-Fi). The answer model is a larger, opt-in download from **My notes →
Download answer writer**. Both are cached and work offline afterwards.

`npm run dev` and `npm run build` first copy the OCR engine into `public/tesseract` (ignored by git).

**Test on your phone:** run `npm run dev -- --host`, then open the "Network" address it prints on a
phone on the same Wi-Fi. For the installable PWA and the AI features, use the deployed HTTPS site,
because browsers only enable service workers and some AI features on HTTPS or localhost.

```bash
npm test           # 37 unit tests: chunker, BM25, vectors, fusion, engine + IndexedDB, prompt/citations, OCR cleanup, download policy, stall watchdog
npm run typecheck
npm run build      # production build in dist/
npm run preview    # serve the production build locally
```

---

## Deploy (free)

It's a static site, so any static host works.

- **Netlify (used for the live site):** import the GitHub repo. `netlify.toml` already sets the build
  command, publish folder, Node version and cache headers, so just click Deploy.
- **Vercel:** import the GitHub repo. Framework: Vite, output: `dist`.

Both give HTTPS automatically, which the PWA install needs.

---

## Project layout

```
src/
  lib/
    types.ts        Shared types: NoteDoc, Chunk, SearchHit
    pdf.ts          PDF.js text extraction, rebuilding lines from positioned text
    chunker.ts      Page-bounded passages, heading detection, sentence splitting
    bm25.ts         Tokenizer, light stemmer, BM25 index
    vector.ts       Normalise, dot product, top-k
    fusion.ts       Reciprocal Rank Fusion
    db.ts           IndexedDB storage (idb)
    engine.ts       Ties it together: add/remove docs, background embedding, hybrid search
    embedder.ts     Promise-based client for the embedding worker
    highlight.ts    Highlights query terms in results (same stemming as search)
    ocr.ts          Tesseract.js OCR, text clean-up, "does this page need OCR?"
    images.ts       Photos of notes -> upright, downscaled canvases -> OCR
    prompt.ts       RAG prompt builder and citation parser
    answerer.ts     Client for the answer worker; WebGPU/memory capability check
    network.ts      Wi-Fi vs mobile-data download policy
    useNoteWise.ts    React hook: engine + workers + import jobs
  workers/
    embed.worker.ts Sentence embeddings (MiniLM), WebGPU with WASM fallback
    llm.worker.ts   Gemma 3 1B text generation on WebGPU, streaming, stoppable
    loadModel.ts    Shared progress tracking and stall watchdog
  components/       AskView, AnswerCard, ResultCard, LibraryView, StatusPill
scripts/
  copy-ocr-assets.mjs  Self-hosts the OCR engine and language data
tests/              Vitest unit tests (fake-indexeddb for storage)
samples/            A small OS notes PDF to try it with
```

## Known limitations

- **Handwriting:** OCR reads printed and typed notes well; handwritten notes are hit-and-miss.
- **Written answers need WebGPU:** recent Chrome on Android 12+ with a supported GPU, Safari on iOS 26,
  or a recent desktop browser. Other devices get search and passages without the written answer.
  The answer model is a large one-time download.
- **Small model:** a 1B model can still misread a passage. Every point is cited so students can check
  it against their notes, and the UI says so.
- **Telugu:** keyword search works in Telugu; semantic search and OCR are English-first for now.
- **PDF.js is pinned to 4.x:** newer versions use JavaScript features many phone browsers don't have yet.
