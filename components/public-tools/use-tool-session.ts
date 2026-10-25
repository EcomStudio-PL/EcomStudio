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
  /**
   * Generator UX V3: keep this panel's work for a MEMBER too — saved as they
   * go, put back on their next visit (24 h), kept after a run — under its own
   * key. It is this account's alone: its owner is `member:<account>`, so
   * another account in the same browser never sees it (not even offered),
   * and the "come back to your tool" banner and the checkout's report, which
   * look at a visitor's preparation, never count it.
   */
  memberDraft?: { key: string };
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
  /** The panel was put back from this viewer's own draft, silently. */
  restored: boolean;
  /** Drop the draft(s) of this panel ("Wyczyść"). */
  clear: () => Promise<void>;
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

export function useToolSession<S>({ settings, sources, apply, memberDraft }: ToolSessionOptions<S>): ToolSession {
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
  const [restored, setRestored] = useState(false);
  // The member's own working draft (Generator UX V3), when the panel keeps one.
  const memberSlot = memberDraft && facts?.kind === "member" ? memberDraft.key : null;
  const memberOwner = facts?.kind === "member" ? `member:${facts.viewerKey}` : "";
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

  /** The member's working draft: a fresh 24 hours from every save. */
  const saveMine = useCallback(async (): Promise<SaveResult> => {
    if (!memberSlot) return "unavailable";
    const r = await saveDraft({
      tool: memberSlot, path, owner: memberOwner,
      settings: latest.current.settings, sources: latest.current.sources,
    });
    setStorage(r);
    return r;
  }, [memberSlot, memberOwner, path]);

  /* ── coming back ─────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!facts || !tool) return;
    let cancelled = false;
    // The member's own working draft, and only theirs.
    const putMine = (mine: Awaited<ReturnType<typeof loadDraft<S>>>) => {
      if (!mine || mine.draft.owner !== memberOwner) return;
      restoring.current = true;
      latest.current.apply(mine.draft.settings, mine.files, mine.ids);
      setPartial(mine.files.length < mine.draft.fileCount);
      setRestored(true);
      window.setTimeout(() => { restoring.current = false; }, 0);
    };
    void loadDraft<S>(tool).then(async (found) => {
      if (cancelled) return;
      const mine = memberSlot ? await loadDraft<S>(memberSlot) : null;
      if (cancelled) return;
      ready.current = true;
      // Another account's working draft in this browser (a shared device):
      // never shown — and not kept on the device for its remaining hours.
      if (memberSlot && mine && mine.draft.owner !== memberOwner) void deleteDraft(memberSlot);
      // A visit's or a checkout's preparation (the tool's own key) is put back
      // only while it is NEWER than the member's working draft: once restored,
      // the work is saved to the member's slot, so an older copy left under
      // the tool's key must never come back over it on a later visit.
      const mineFresh = !!mine && mine.draft.owner === memberOwner;
      if (found && mineFresh && mine.draft.savedAt >= found.draft.savedAt) {
        void deleteDraft(tool);
        putMine(mine);
        return;
      }
      if (!found) { putMine(mine); return; }
      const { draft, files, ids } = found;
      const put = () => {
        restoring.current = true;
        expiresAt.current = draft.expiresAt;
        latest.current.apply(draft.settings, files, ids);
        setPartial(files.length < draft.fileCount);
        setOffer(null);
        if (!draftNeedsConsent(draft, facts)) setRestored(true);
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
        // Turned down: the member's own draft (if any) is still theirs — it
        // is put back rather than left to be overwritten by the next save.
        discard: () => { setOffer(null); void deleteDraft(tool); putMine(mine); },
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
  // "Wyczyść": the panel's reset (rendered together with the tick) is the
  // new starting point — not a change worth keeping as a fresh draft.
  const [clearTick, setClearTick] = useState(0);
  useEffect(() => {
    if (clearTick) initialSettings.current = settingsJson;
    // Only on a clear: the reset settings of that very render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearTick]);
  useEffect(() => {
    if (!guest || touchedOnce.current || restoring.current) return;
    if (settingsJson === initialSettings.current) return;
    touchedOnce.current = true;
    track("guest_tool_settings_interaction", { tool_id: tool });
  }, [guest, settingsJson, tool, track]);

  /* ── a visitor's work survives a refresh (and a member's, where kept) ──── */
  const fingerprint = useMemo(
    () => JSON.stringify([settingsJson, sources.map((s) => s.id)]),
    [settingsJson, sources],
  );
  const changedOnce = useRef(false);
  useEffect(() => {
    if (settingsJson !== initialSettings.current && !restoring.current) changedOnce.current = true;
  }, [settingsJson]);
  useEffect(() => {
    if (!(guest || memberSlot) || !ready.current || restoring.current || offer) return;
    // Nothing prepared yet is nothing to keep — and must not erase a draft
    // still waiting for "Przywróć".
    if (sources.length === 0 && !touchedOnce.current && !changedOnce.current) return;
    const id = window.setTimeout(() => { void (guest ? save() : saveMine()); }, 700);
    return () => window.clearTimeout(id);
  }, [guest, memberSlot, fingerprint, save, saveMine, offer, sources.length]);

  /* ── Generate ─────────────────────────────────────────────────────────── */
  const gate = useCallback(async (run: () => void | Promise<void>) => {
    if (!guest) { await run(); return; }
    await save();
    track("tool_auth_modal_open", { tool_id: tool, source: "generate" });
    track("tool_signup_started", { tool_id: tool, source: "generate" });
    // Back to the very address the visitor is on — with its ?tryb= — so a
    // screen with two modes reopens on the one they were working in.
    const here = window.location.pathname === path ? `${path}${window.location.search}` : path;
    auth?.open("register", here, { intent: "tool" });
  }, [guest, save, tool, track, auth, path]);

  // A run never drops the member's working draft (Generator UX V3): only the
  // preparation a visit or a checkout left under the tool's own key.
  const ran = useCallback(() => {
    if (!tool) return;
    expiresAt.current = undefined;
    void deleteDraft(tool);
  }, [tool]);

  const clear = useCallback(async () => {
    setRestored(false);
    setOffer(null);
    setPartial(false);
    changedOnce.current = false;
    touchedOnce.current = false;
    setClearTick((n) => n + 1);
    if (!tool) return;
    await Promise.all([deleteDraft(tool), memberSlot ? deleteDraft(memberSlot) : Promise.resolve()]);
  }, [tool, memberSlot]);

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

  return { guest, preview, localRef, gate, prepare: save, ran, offer, storage, partial, touched, added, restored, clear };
}

/** Is this ref one of a visitor's local stand-ins (never uploaded)? */
export function isLocalRef(path: string): boolean {
  return path.startsWith(LOCAL_PREFIX);
}
