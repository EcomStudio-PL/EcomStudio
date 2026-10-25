"use client";
import {
  DRAFT_TTL_MS, DRAFT_VERSION, draftExpired, type DraftMeta,
} from "@/lib/public-tools";

/**
 * THE LOCAL DRAFT — a prepared tool, kept in THIS browser only.
 *
 * A visitor prepares a tool (photos in order, settings, a prompt), presses
 * Generate and is asked to sign in. Signing in is a full navigation — a form
 * POST, a Google round trip, an e-mail link — so nothing in memory survives
 * it. This keeps the preparation in IndexedDB until they are back:
 *
 *   · NEVER on a server. No Storage upload, no API, no URL. The photos are
 *     Blobs in IndexedDB (never localStorage, which holds strings and would
 *     not hold a photo anyway).
 *   · 24 HOURS, then gone — purged the next time any page asks.
 *   · Two stores: the draft (settings, the order of the photos, who it
 *     belongs to) and the files, one record per photo. Changing a setting
 *     rewrites the small record only; a photo is written once.
 *   · A storage that is missing (some private modes), refused or full says
 *     so — the caller tells the visitor honestly instead of pretending.
 */

const DB_NAME = "grovbase-tool-drafts";
const DB_VERSION = 1;
const DRAFTS = "drafts";
const FILES = "files";

export type DraftSource = {
  /** Stable for as long as this photo is in the panel (its ref key, its item id). */
  id: string;
  name: string;
  type: string;
  /** Either the File itself… */
  file?: File;
  /** …or an object URL of it (what an uploaded ref keeps). */
  url?: string;
};

export type StoredDraft<S = unknown> = DraftMeta & {
  settings: S;
  /** Photo ids in panel order. */
  order: string[];
};

type FileRecord = { id: string; tool: string; name: string; type: string; lastModified: number; blob: Blob };

export type SaveResult = "ok" | "unavailable" | "full";

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DRAFTS)) db.createObjectStore(DRAFTS, { keyPath: "tool" });
        if (!db.objectStoreNames.contains(FILES)) {
          const files = db.createObjectStore(FILES, { keyPath: "id" });
          files.createIndex("tool", "tool", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  // A failed open is not remembered: the next call may succeed (a storage
  // permission granted meanwhile, a blocked upgrade that finished).
  void dbPromise.then((db) => { if (!db) dbPromise = null; });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("aborted"));
    tx.onerror = () => reject(tx.error ?? new Error("failed"));
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("failed"));
  });
}

const fileId = (tool: string, id: string) => `${tool}|${id}`;

function isQuota(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name ?? "";
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED";
}

async function blobOf(source: DraftSource): Promise<Blob | null> {
  if (source.file) return source.file;
  if (!source.url) return null;
  try {
    const res = await fetch(source.url);
    return res.ok ? await res.blob() : null;
  } catch {
    return null;
  }
}

/**
 * Save (or update) a tool's draft. Photos already stored under the same id
 * are not written again; photos no longer in the panel are deleted. A photo
 * whose bytes cannot be read any more (a revoked object URL) is left out —
 * the draft then says so through its fileCount.
 */
export async function saveDraft<S>(a: {
  tool: string; path: string; owner: string; settings: S; sources: readonly DraftSource[];
  /** Keep the original deadline when an existing draft is re-saved. */
  expiresAt?: number;
}): Promise<SaveResult> {
  const db = await openDb();
  if (!db) return "unavailable";
  try {
    // Which photos are already there.
    const existing = new Set<string>(await request(
      db.transaction(FILES, "readonly").objectStore(FILES).index("tool").getAllKeys(IDBKeyRange.only(a.tool)),
    ).then((keys) => (keys as IDBValidKey[]).map(String)));
    const wanted = a.sources.map((s) => fileId(a.tool, s.id));
    const fresh: FileRecord[] = [];
    const order: string[] = [];
    for (const s of a.sources) {
      const id = fileId(a.tool, s.id);
      if (existing.has(id)) { order.push(s.id); continue; }
      const blob = await blobOf(s);
      if (!blob) continue;
      fresh.push({ id, tool: a.tool, name: s.name.slice(0, 200), type: s.type || blob.type, lastModified: s.file?.lastModified ?? Date.now(), blob });
      order.push(s.id);
    }
    const now = Date.now();
    const draft: StoredDraft<S> = {
      v: DRAFT_VERSION, tool: a.tool, path: a.path, owner: a.owner,
      savedAt: now, expiresAt: a.expiresAt && a.expiresAt > now ? a.expiresAt : now + DRAFT_TTL_MS,
      fileCount: order.length, settings: a.settings, order,
    };
    const tx = db.transaction([DRAFTS, FILES], "readwrite");
    const files = tx.objectStore(FILES);
    for (const r of fresh) files.put(r);
    for (const id of existing) if (!wanted.includes(id)) files.delete(id);
    tx.objectStore(DRAFTS).put(draft);
    await done(tx);
    return "ok";
  } catch (e) {
    return isQuota(e) ? "full" : "unavailable";
  }
}

/** The draft and its photos as Files, in order (with the ids they were saved
 *  under) — or null (none, expired, unreadable). */
export async function loadDraft<S>(tool: string): Promise<{ draft: StoredDraft<S>; files: File[]; ids: string[] } | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    const draft = await request(db.transaction(DRAFTS, "readonly").objectStore(DRAFTS).get(tool)) as StoredDraft<S> | undefined;
    if (!draft) return null;
    if (draftExpired(draft, Date.now())) { await deleteDraft(tool); return null; }
    const store = db.transaction(FILES, "readonly").objectStore(FILES);
    const records = await Promise.all(draft.order.map((id) =>
      request(store.get(fileId(tool, id))) as Promise<FileRecord | undefined>));
    const files: File[] = [];
    const ids: string[] = [];
    records.forEach((r, i) => {
      if (!r) return;
      files.push(new File([r.blob], r.name, { type: r.type, lastModified: r.lastModified }));
      ids.push(draft.order[i]);
    });
    return { draft, files, ids };
  } catch {
    return null;
  }
}

/** Re-own a draft (a visitor's draft claimed by the account that signed in). */
export async function reownDraft(tool: string, owner: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(DRAFTS, "readwrite");
    const store = tx.objectStore(DRAFTS);
    const draft = await request(store.get(tool)) as StoredDraft | undefined;
    if (draft) store.put({ ...draft, owner });
    await done(tx);
  } catch {
    // Nothing to do: the draft simply stays as it was.
  }
}

export async function deleteDraft(tool: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const keys = await request(db.transaction(FILES, "readonly").objectStore(FILES).index("tool").getAllKeys(IDBKeyRange.only(tool)));
    const tx = db.transaction([DRAFTS, FILES], "readwrite");
    for (const k of keys as IDBValidKey[]) tx.objectStore(FILES).delete(k);
    tx.objectStore(DRAFTS).delete(tool);
    await done(tx);
  } catch {
    // A draft that cannot be deleted expires on its own.
  }
}

/** Every live draft (expired ones are purged on the way), newest first. */
export async function listDrafts(): Promise<DraftMeta[]> {
  const db = await openDb();
  if (!db) return [];
  try {
    const all = await request(db.transaction(DRAFTS, "readonly").objectStore(DRAFTS).getAll()) as StoredDraft[];
    const now = Date.now();
    const live: DraftMeta[] = [];
    for (const d of all) {
      if (draftExpired(d, now)) await deleteDraft(d.tool);
      else live.push({ v: d.v, tool: d.tool, path: d.path, owner: d.owner, savedAt: d.savedAt, expiresAt: d.expiresAt, fileCount: d.fileCount });
    }
    return live.sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}
