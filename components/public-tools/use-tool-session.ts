"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOptionalAuthDialog } from "@/components/auth/auth-dialog-context";
import { trackEvent } from "@/components/analytics/google-analytics";
import {
  GUEST_OWNER, draftNeedsConsent, draftOwner, type DraftMeta,
} from "@/lib/public-tools";
import { useToolViewer } from "./tool-viewer";
import {
  deleteDraft, loadDraft, reownDraft, saveDraft, type DraftSource, type SaveResult,
} from "./draft-store";

/**
 * ONE PANEL ↔ PUBLIC TOOLS WIRE.
 *
 * A panel hands this hook three things — its current settings (plain data),
 * its photos in order, and how to put both back — and gets back:
 *
 *   guest       a visitor (or an admin's guest preview) is looking: keep photos
 *               local (`localRef`), never call a run endpoint;
 *   gate(run)   what Generate does: a visitor's work is saved in this browser
 *               and the sign-in dialog opens over the panel; a member runs;
 *   prepare()   save the work before a member leaves for the checkout;
 *   ran()       a run started: the saved copy is no longer needed;
 *   offer       a saved preparation waiting for a "Przywróć / Odrzuć".
 *
 * Restoring is the panel's own add-photos path: once signed in, the photos go
 * through the same upload, limits and checks as photos picked by hand. Nothing
 * here talks to a server.
 */

export type ToolSessionOptions<S> = {
  settings: S;
  sources: readonly DraftSource[];
  /** Put a saved preparation back. `files` are in their saved order; `ids`
   *  are the source ids they were saved under (a panel with two kinds of
   *  photo tells them apart by these). */
  apply: (settings: S, files: File[], ids: string[]) => void;
};

export type RestoreOffer = {
  meta: DraftMeta;
  accept: () => void;
  discard: () => void;
};

export type ToolSession = {
  guest: boolean;
  preview: boolean;
  /** A local stand-in for an uploaded photo: no request is made. */
  localRef: (file: File) => { key: string; path: string; url: string };
  gate: (run: () => void | Promise<void>) => Promise<void>;
  prepare: () => Promise<SaveResult>;
  ran: () => void;
  offer: RestoreOffer | null;
  /** The last save could not keep the photos (storage missing or full). */
  storage: "ok" | "unavailable" | "full";
  /** Restored, with fewer photos than were saved (a browser dropped some). */
  partial: boolean;
  /** Report a settings change (analytics: first one per visit, visitors only). */
  touched: () => void;
  /** Report photos added locally (analytics, visitors only). */
  added: (count: number) => void;
};

const LOCAL_PREFIX = "local:";

const SILENT: typeof trackEvent = () => undefined;

/**
 * A visitor's photos, by their local ref key, for the life of the page: the
 * panel keeps refs ({key, path, url}), the draft needs the File (its name and
 * type) — this is the bridge. Never sent anywhere.
 */
const LOCAL_FILES = new Map<string, File>();

/**
 * A panel photo as a draft source: the File itself for a visitor's local
 * photo, otherwise its object URL (an uploaded photo's preview is a URL of
 * the original File, readable until the page is left).
 */
export function refSource(ref: { key: string; path: string; url: string }): DraftSource {
  const file = LOCAL_FILES.get(ref.key);
  const name = file?.name ?? (ref.path.split("/").pop() || "photo.jpg");
  return { id: ref.key, name, type: file?.type ?? "", file, url: file ? undefined : ref.url };
}

export function useToolSession<S>({ settings, sources, apply }: ToolSessionOptions<S>): ToolSession {
  const viewer = useToolViewer();
  const auth = useOptionalAuthDialog();
  const facts = viewer?.facts ?? null;
  const guest = facts?.kind === "guest";
  const preview = facts?.kind === "guest" ? facts.preview : false;
  const tool = viewer?.tool ?? "";
  const path = viewer?.path ?? "";
  // An admin's "Podgląd jako gość" is not a visitor: it reports nothing.
  // (`preview` is fixed for the life of the page.)
  const track = preview ? SILENT : trackEvent;
  const [offer, setOffer] = useState<RestoreOffer | null>(null);
  const [storage, setStorage] = useState<ToolSession["storage"]>("ok");
  const [partial, setPartial] = useState(false);
  // The latest values, for callbacks that must not re-subscribe on every keystroke.
  const latest = useRef({ settings, sources, apply });
  latest.current = { settings, sources, apply };
  const restoring = useRef(false);
  const ready = useRef(false);
  const expiresAt = useRef<number | undefined>(undefined);
  const touchedOnce = useRef(false);

  const save = useCallback(async (): Promise<SaveResult> => {
    if (!facts || !tool) return "unavailable";
    const r = await saveDraft({
      tool, path, owner: draftOwner(facts),
      settings: latest.current.settings, sources: latest.current.sources,
      expiresAt: expiresAt.current,
    });
    setStorage(r);
    return r;
  }, [facts, tool, path]);

  /* ── coming back ─────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!facts || !tool) return;
    let cancelled = false;
    void loadDraft<S>(tool).then((found) => {
      if (cancelled) return;
      ready.current = true;
      if (!found) return;
      const { draft, files, ids } = found;
      const put = () => {
        restoring.current = true;
        expiresAt.current = draft.expiresAt;
        latest.current.apply(draft.settings, files, ids);
        setPartial(files.length < draft.fileCount);
        setOffer(null);
        track("tool_state_restored", { tool_id: tool, source: facts.kind === "guest" ? "guest" : "member" });
        // A visitor's preparation claimed by a brand-new account: a signup
        // that started on this tool has finished here.
        if (facts.kind === "member" && draft.owner === GUEST_OWNER && facts.fresh) {
          track("tool_signup_completed", { tool_id: tool, source: "restore" });
        }
        if (facts.kind === "member" && draft.owner !== facts.viewerKey) void reownDraft(tool, facts.viewerKey);
        window.setTimeout(() => { restoring.current = false; }, 0);
      };
      if (!draftNeedsConsent(draft, facts)) { put(); return; }
      setOffer({
        meta: draft,
        accept: put,
        discard: () => { setOffer(null); void deleteDraft(tool); },
      });
    });
    return () => { cancelled = true; };
    // Once per panel mount: a draft is offered when the page opens, not on
    // every render. `facts` is stable for the life of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  /* ── the first change of a setting, for the funnel (visitors only) ────── */
  const settingsJson = useMemo(() => JSON.stringify(settings), [settings]);
  const initialSettings = useRef(settingsJson);
  useEffect(() => {
    if (!guest || touchedOnce.current || restoring.current) return;
    if (settingsJson === initialSettings.current) return;
    touchedOnce.current = true;
    track("guest_tool_settings_interaction", { tool_id: tool });
  }, [guest, settingsJson, tool, track]);

  /* ── a visitor's work survives a refresh ──────────────────────────────── */
  const fingerprint = useMemo(
    () => JSON.stringify([settingsJson, sources.map((s) => s.id)]),
    [settingsJson, sources],
  );
  useEffect(() => {
    if (!guest || !ready.current || restoring.current || offer) return;
    // Nothing prepared yet is nothing to keep — and must not erase a draft
    // still waiting for "Przywróć".
    if (sources.length === 0 && !touchedOnce.current) return;
    const id = window.setTimeout(() => { void save(); }, 700);
    return () => window.clearTimeout(id);
  }, [guest, fingerprint, save, offer, sources.length]);

  /* ── Generate ─────────────────────────────────────────────────────────── */
  const gate = useCallback(async (run: () => void | Promise<void>) => {
    if (!guest) { await run(); return; }
    await save();
    track("tool_auth_modal_open", { tool_id: tool, source: "generate" });
    track("tool_signup_started", { tool_id: tool, source: "generate" });
    auth?.open("register", path, { intent: "tool" });
  }, [guest, save, tool, track, auth, path]);

  const ran = useCallback(() => {
    if (!tool) return;
    expiresAt.current = undefined;
    void deleteDraft(tool);
  }, [tool]);

  const localRef = useCallback((file: File) => {
    const key = `${LOCAL_PREFIX}${crypto.randomUUID()}`;
    LOCAL_FILES.set(key, file);
    return { key, path: key, url: URL.createObjectURL(file) };
  }, []);

  const touched = useCallback(() => {
    if (!guest || touchedOnce.current) return;
    touchedOnce.current = true;
    track("guest_tool_settings_interaction", { tool_id: tool });
  }, [guest, tool, track]);

  const added = useCallback((count: number) => {
    if (!guest || count <= 0) return;
    track("guest_tool_local_upload", { tool_id: tool, source: String(Math.min(count, 50)) });
  }, [guest, tool, track]);

  // One view event per panel mount, for a real visitor.
  useEffect(() => {
    if (guest && tool) track("public_tool_view", { tool_id: tool });
  }, [guest, tool, track]);

  return { guest, preview, localRef, gate, prepare: save, ran, offer, storage, partial, touched, added };
}

/** Is this ref one of a visitor's local stand-ins (never uploaded)? */
export function isLocalRef(path: string): boolean {
  return path.startsWith(LOCAL_PREFIX);
}
