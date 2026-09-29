import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Chunk, NoteDoc } from "./types";

/**
 * Everything lives in IndexedDB on the student's device: documents, chunks and
 * their embeddings. Nothing is uploaded. Float32Array embeddings are stored
 * as-is (IndexedDB can structured-clone typed arrays), so there is no JSON
 * encoding cost and no precision loss.
 */
interface NoteWiseDB extends DBSchema {
  docs: { key: string; value: NoteDoc };
  chunks: { key: string; value: Chunk; indexes: { byDoc: string } };
}

const DB_NAME = "notewise";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<NoteWiseDB>> | null = null;

export function getDB(name = DB_NAME): Promise<IDBPDatabase<NoteWiseDB>> {
  if (!dbPromise) {
    dbPromise = openDB<NoteWiseDB>(name, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore("docs", { keyPath: "id" });
        db.createObjectStore("chunks", { keyPath: "id" }).createIndex("byDoc", "docId");
      },
    });
  }
  return dbPromise;
}

/** Tests use this to start from an empty database. */
export async function resetDBForTests(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}

/** Save a document and all its chunks in one transaction: either all of it lands or none does. */
export async function saveDocument(doc: NoteDoc, chunks: Chunk[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(["docs", "chunks"], "readwrite");
  await Promise.all([tx.objectStore("docs").put(doc), ...chunks.map((c) => tx.objectStore("chunks").put(c)), tx.done]);
}

export async function listDocuments(): Promise<NoteDoc[]> {
  const docs = await (await getDB()).getAll("docs");
  return docs.sort((a, b) => b.addedAt - a.addedAt);
}

export async function getAllChunks(): Promise<Chunk[]> {
  return (await getDB()).getAll("chunks");
}

export async function getChunksForDoc(docId: string): Promise<Chunk[]> {
  return (await getDB()).getAllFromIndex("chunks", "byDoc", docId);
}

/** Write embeddings back onto chunks that were saved without them. */
export async function saveEmbeddings(docId: string, embeddings: Map<string, Float32Array>, complete: boolean) {
  const db = await getDB();
  const tx = db.transaction(["docs", "chunks"], "readwrite");
  const chunkStore = tx.objectStore("chunks");
  for (const [id, embedding] of embeddings) {
    const chunk = await chunkStore.get(id);
    if (chunk) await chunkStore.put({ ...chunk, embedding });
  }
  if (complete) {
    const doc = await tx.objectStore("docs").get(docId);
    if (doc) await tx.objectStore("docs").put({ ...doc, embedded: true });
  }
  await tx.done;
}

export async function deleteDocument(docId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(["docs", "chunks"], "readwrite");
  const ids = await tx.objectStore("chunks").index("byDoc").getAllKeys(docId);
  await Promise.all([tx.objectStore("docs").delete(docId), ...ids.map((id) => tx.objectStore("chunks").delete(id)), tx.done]);
}
