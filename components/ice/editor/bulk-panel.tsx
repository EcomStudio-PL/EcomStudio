"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { IceElement, IcePageInfo, IceSlotSpec, IceSlotState, IceSlotWrite } from "@/lib/ice/types";
import { ICE_MAX_IMAGE_BYTES, ICE_MAX_SAMPLE_BYTES } from "@/lib/ice/sniff";
import { notify } from "@/lib/notify";
import { useFileDrop } from "@/components/ui/file-drop";
import {
  groupPairs, naturalCompare, pairSuffix, type BulkFile, type BulkProblem, type BulkProblemReason, type BulkUnit, type PairSide,
} from "@/lib/ice/pairs";
import {
  Btn, Sheet, bytes, call, cls, errorText, fitWarnings, localSize, previewUrl, roleLabel, type EditorCtx, type T,
} from "./shared";
import { precheck, uploadOne } from "./upload";
import s from "./editor.module.css";

// The name pairing moved to lib/ice/pairs.ts so the launch page's gallery
// upload (gallery-panel.tsx) and the unit tests share it without this panel;
// it is re-exported under the names it always had.
export { groupPairs, pairSuffix };
export type { BulkFile, BulkProblem, BulkProblemReason, BulkUnit, PairSide };

/**
 * "WGRAJ WIELE" — many pictures into one of the page's bulk groups at once.
 *
 *   1. the admin drops (or picks) files; each is prechecked the way a single
 *      upload is, and a refused one is listed with its reason;
 *   2. the files are put in natural alphabetical order ("2.jpg" before
 *      "10.jpg") and the admin may reorder them — the order IS the assignment;
 *   3. the plan is shown slot by slot before anything is sent: which file goes
 *      where, which slots stay as they are, which files only reach the
 *      library, and every size/shape warning (a picture is cropped by its
 *      frame, never stretched);
 *   4. Start uploads the files one by one into the library, then assigns them
 *      in ONE slotSave (action "bulk") — a single all-or-nothing transaction
 *      with a compare-and-set per slot. History rows are written per slot by
 *      the database's own triggers, so nothing here writes history.
 *
 * Only the group's own slots are ever written: the targets come from
 * `ctx.info.page.bulk`, never from the files.
 */

/** The server's ceiling for one slotState / slotSave call. */
const MAX_SLOTS = 60;
/** Files per run. Files beyond the slots go to the library only, so a cap
 *  keeps a stray folder drop from flooding it. */
const MAX_FILES = 60;
const ACCEPT = "image/jpeg,image/png,image/webp,image/avif";

/* ── the plan: pure, so the tests can hold it without a DOM ───────────────── */

export type BulkMode = "empty" | "replace";
/** A row of the group: one slot, or a pair slot's [before, after] keys. */
export type BulkRow<F extends BulkFile> = { keys: string[]; occupied: boolean; unit: BulkUnit<F> | null };
export type BulkPlan<F extends BulkFile> = {
  /** Every file (or complete pair) that will be uploaded, in final order. */
  units: BulkUnit<F>[];
  /** Pairs mode: files that are neither uploaded nor assigned. */
  problems: BulkProblem<F>[];
  /** Every row of the group, in group order, with what it receives. */
  rows: BulkRow<F>[];
  /** How many rows accept a file in this mode. */
  targets: number;
  /** Units past the last target: uploaded to the library, not assigned. */
  libraryOnly: BulkUnit<F>[];
  /** Occupied slots this plan overwrites (what "replace all" must confirm). */
  replaced: number;
};

/**
 * Files + the group's slots + the mode → who goes where.
 *
 * Order: natural by name (pairs: by base name), unless the admin reordered —
 * then `order` (unit ids) wins, and units it does not know yet (files added
 * after the reorder) follow in natural order.
 *
 * "Fill empty" takes only rows with no picture (a pair row: both halves
 * empty) and skips the rest; "replace all" takes every row. Units are dealt to
 * those rows in order; whatever is left over goes to the library only.
 */
export function planBulk<F extends BulkFile>(input: {
  slots: readonly string[];
  pairs: boolean;
  mode: BulkMode;
  files: readonly F[];
  order: readonly string[] | null;
  filled: (key: string) => boolean;
}): BulkPlan<F> {
  let units: BulkUnit<F>[];
  let problems: BulkProblem<F>[] = [];
  if (input.pairs) {
    ({ pairs: units, problems } = groupPairs(input.files));
  } else {
    units = [...input.files]
      .sort((a, b) => naturalCompare(a.name, b.name) || naturalCompare(a.id, b.id))
      .map((f) => ({ id: f.id, name: f.name, files: [f] }));
  }
  if (input.order) {
    const pos = new Map(input.order.map((id, i) => [id, i]));
    const known = units.filter((u) => pos.has(u.id)).sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0));
    units = [...known, ...units.filter((u) => !pos.has(u.id))];
  }

  const keys = input.slots.slice(0, MAX_SLOTS);
  const groups: string[][] = [];
  // A pairs group lists its slots as before, after, before, after… — the
  // registry builds it that way from the pair elements.
  if (input.pairs) for (let i = 0; i + 1 < keys.length; i += 2) groups.push([keys[i], keys[i + 1]]);
  else for (const k of keys) groups.push([k]);

  const rows: BulkRow<F>[] = groups.map((g) => ({ keys: g, occupied: g.some((k) => input.filled(k)), unit: null }));
  const targets = rows.filter((r) => input.mode === "replace" || !r.occupied);
  targets.forEach((r, i) => {
    r.unit = units[i] ?? null;
  });
  const replaced = targets.reduce((n, r) => n + (r.unit ? r.keys.filter((k) => input.filled(k)).length : 0), 0);
  return { units, problems, rows, targets: targets.length, libraryOnly: units.slice(targets.length), replaced };
}

/* ── the group, as the registry describes it ──────────────────────────────── */

type SlotInfo = { spec: IceSlotSpec; element: IceElement; pos: number };
type Group = { key: string; pairs: boolean; keys: string[]; slots: Map<string, SlotInfo> };

function resolveGroup(info: IcePageInfo, groupKey: string): Group | null {
  if (info.kind !== "registry") return null;
  const def = info.page.bulk?.find((g) => g.key === groupKey);
  if (!def) return null;
  const slots = new Map<string, SlotInfo>();
  for (const sec of info.page.sections) for (const element of sec.elements) {
    (element.slots ?? []).forEach((spec, pos) => {
      // A tool-card slot is listed twice on /home (carousel and featured):
      // the first element, in page order, names it.
      if (!slots.has(spec.key)) slots.set(spec.key, { spec, element, pos });
    });
  }
  let keys: string[] = [];
  if (def.pairs) {
    // Chunk the declared list, not a filtered one, so a half the registry
    // does not know can never shift every later pair by one.
    for (let i = 0; i + 1 < def.slots.length; i += 2) {
      const [b, a] = [def.slots[i], def.slots[i + 1]];
      if (b !== a && slots.has(b) && slots.has(a) && !keys.includes(b) && !keys.includes(a)) keys.push(b, a);
    }
  } else {
    keys = [...new Set(def.slots)].filter((k) => slots.has(k));
  }
  // MAX_SLOTS is even, so a pairs group is never cut between its halves.
  keys = keys.slice(0, MAX_SLOTS);
  return keys.length ? { key: def.key, pairs: Boolean(def.pairs), keys, slots } : null;
}

/** "Miniatura 3", "Para 2 · przed", "Przykłady 4" — role + the element's own
 *  number; an element without one (a tool's five samples) uses the slot's
 *  place in it, and a slot no element names falls back to its place in the
 *  group. */
function slotLabel(t: T, info: SlotInfo | undefined, groupIndex: number): string {
  if (!info) return t("ice.bulk.slotN", { n: groupIndex + 1 });
  const el = info.element;
  const base = roleLabel(t, el);
  if (el.kind === "pair") return `${base} · ${t(info.pos === 0 ? "ice.bulk.before" : "ice.bulk.after")}`;
  if (el.index !== undefined) return base;
  return `${base} ${(el.slots?.length ?? 0) > 1 ? info.pos + 1 : groupIndex + 1}`;
}

function conflictKey(current: unknown): string | null {
  if (!current || typeof current !== "object" || !("key" in current)) return null;
  const key = (current as { key: unknown }).key;
  return typeof key === "string" ? key : null;
}

/* ── the panel ────────────────────────────────────────────────────────────── */

type Status = "idle" | "waiting" | "uploading" | "done" | "error";

type Item = {
  id: string;
  name: string;
  file: File;
  /** Object URL for the thumbnail; revoked on removal and on unmount. */
  url: string;
  /** undefined while being read, null when the browser cannot decode it. */
  dims: { width: number; height: number } | null | undefined;
  status: Status;
  error: string | null;
  /** The library asset once uploaded: a second Start (after a conflict or a
   *  failed save) reuses it instead of uploading the file again. */
  assetId: string | null;
};

type Rejected = { id: string; name: string; reason: string };

let seq = 0;
const nextId = () => `f${(seq += 1)}`;
const fingerprint = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;

const STATUS_KEY: Record<Exclude<Status, "idle">, string> = {
  waiting: "ice.bulk.status.waiting",
  uploading: "ice.bulk.status.uploading",
  done: "ice.bulk.status.done",
  error: "ice.bulk.status.error",
};

const PROBLEM_KEY: Record<BulkProblemReason, string> = {
  noSuffix: "ice.bulk.problem.noSuffix",
  missingBefore: "ice.bulk.problem.missingBefore",
  missingAfter: "ice.bulk.problem.missingAfter",
  duplicate: "ice.bulk.problem.duplicate",
};

/** A unit's status is its worst file's: one failed half fails the pair. */
function unitStatus(u: BulkUnit<Item>): Status {
  const all = u.files.map((f) => f.status);
  for (const st of ["error", "uploading", "waiting"] as const) if (all.includes(st)) return st;
  return all.every((st) => st === "done") ? "done" : "idle";
}

const Chevron = ({ up }: { up: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d={up ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} />
  </svg>
);

export function BulkPanel({ ctx, groupKey, onClose }: { ctx: EditorCtx; groupKey: string; onClose: () => void }) {
  const { t, transport, info } = ctx;
  const group = useMemo(() => resolveGroup(info, groupKey), [info, groupKey]);
  const sample = useMemo(() => Boolean(group?.keys.some((k) => group.slots.get(k)?.spec.sample)), [group]);

  const [states, setStates] = useState<Map<string, IceSlotState> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [rejected, setRejected] = useState<Rejected[]>([]);
  const [order, setOrder] = useState<string[] | null>(null);
  const [mode, setMode] = useState<BulkMode>("empty");
  // The confirmation is for a NUMBER of replaced pictures: when the plan
  // changes that number (files added, states reloaded), it must be given again.
  const [confirmedFor, setConfirmedFor] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<"upload" | "save">("upload");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [problem, setProblem] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [live, setLive] = useState("");

  const alive = useRef(true);
  const urls = useRef(new Set<string>());
  const fileRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const refocus = useRef<string | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const radioName = useId();

  // Stable, so the Sheet does not re-run its focus effect on every render.
  // Closing mid-run is a cancel: the loop sees `alive` drop and saves nothing
  // (files already uploaded simply stay in the library).
  const close = useCallback(() => closeRef.current(), []);

  useEffect(() => {
    alive.current = true;
    const created = urls.current;
    return () => {
      alive.current = false;
      for (const u of created) URL.revokeObjectURL(u);
      created.clear();
    };
  }, []);

  const load = useCallback(async (): Promise<boolean> => {
    if (!group) return false;
    const res = await call(transport.slotState(group.keys));
    if (!alive.current) return false;
    if (!res.ok) {
      setLoadError(res.error);
      return false;
    }
    setLoadError(null);
    setStates(new Map(res.data.map((st) => [st.key, st])));
    return true;
  }, [group, transport]);

  useEffect(() => {
    void load();
  }, [load]);

  const intake = (list: FileList | null) => {
    if (!list?.length || running || !group) return;
    const fresh: Item[] = [];
    const bad: Rejected[] = [];
    const seen = new Set(items.map((i) => fingerprint(i.file)));
    let room = MAX_FILES - items.length;
    for (const file of Array.from(list)) {
      const why = precheck(file, { sample, kind: "image" });
      const fp = fingerprint(file);
      if (why) bad.push({ id: nextId(), name: file.name, reason: why });
      else if (seen.has(fp)) bad.push({ id: nextId(), name: file.name, reason: "duplicate" });
      else if (room <= 0) bad.push({ id: nextId(), name: file.name, reason: "too_many" });
      else {
        seen.add(fp);
        room -= 1;
        const url = URL.createObjectURL(file);
        urls.current.add(url);
        fresh.push({ id: nextId(), name: file.name, file, url, dims: undefined, status: "idle", error: null, assetId: null });
      }
    }
    setRejected(bad);
    if (!fresh.length) return;
    setItems((prev) => [...prev, ...fresh]);
    setLive(t("ice.bulk.added", { n: fresh.length }));
    for (const item of fresh) {
      void localSize(item.file).then((dims) => {
        if (alive.current) setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, dims } : i)));
      });
    }
  };

  // Window-wide, the project's shared drop: a file released anywhere while
  // this panel is open lands here, and never makes the browser navigate away
  // from the page being edited.
  const dragging = useFileDrop({ onFiles: (list) => intake(list), enabled: !running && Boolean(group) });

  const plan = useMemo(() => planBulk<Item>({
    slots: group?.keys ?? [],
    pairs: Boolean(group?.pairs),
    mode,
    files: items,
    order,
    // Before the states arrive the targets are not shown and Start stays
    // disabled; the plan is still used for the list's order.
    filled: (k) => Boolean(states?.get(k)?.media),
  }), [group, mode, items, order, states]);

  // Keep keyboard focus on the arrow that was pressed after its row moved.
  useEffect(() => {
    const want = refocus.current;
    const root = rootRef.current;
    if (!want || !root) return;
    refocus.current = null;
    const [id, dir] = [want.slice(0, want.lastIndexOf(":")), want.slice(want.lastIndexOf(":") + 1)];
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>("button[data-move]"));
    const find = (d: string) => buttons.find((b) => b.dataset.move === `${id}:${d}` && !b.disabled);
    (find(dir) ?? find(dir === "up" ? "down" : "up"))?.focus();
  });

  const move = (unit: BulkUnit<Item>, delta: -1 | 1) => {
    const ids = plan.units.map((u) => u.id);
    const i = ids.indexOf(unit.id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setOrder(ids);
    refocus.current = `${unit.id}:${delta < 0 ? "up" : "down"}`;
    setLive(t("ice.bulk.moved", { name: unit.name, n: j + 1 }));
  };

  const removeFiles = (ids: string[]) => {
    const gone = new Set(ids);
    for (const i of items) {
      if (gone.has(i.id)) {
        URL.revokeObjectURL(i.url);
        urls.current.delete(i.url);
      }
    }
    setItems((prev) => prev.filter((i) => !gone.has(i.id)));
  };

  const patch = (id: string, p: Partial<Item>) => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...p } : i)));

  if (!group) {
    return (
      <Sheet title={t("ice.bulk.title")} onClose={close} t={t}>
        <p className={s.error} role="alert">{t("ice.bulk.unknownGroup")}</p>
      </Sheet>
    );
  }

  const ready = states !== null;
  const labelOf = (key: string) => slotLabel(t, group.slots.get(key), group.keys.indexOf(key));
  const rowLabel = (row: BulkRow<Item>, index: number) => {
    if (!group.pairs) return labelOf(row.keys[0]);
    const el = group.slots.get(row.keys[0])?.element;
    return el?.kind === "pair" ? roleLabel(t, el) : t("ice.bulk.pairN", { n: index + 1 });
  };
  const half = (i: number) => t(i === 0 ? "ice.bulk.before" : "ice.bulk.after");
  const rowOf = new Map<string, { row: BulkRow<Item>; index: number }>();
  plan.rows.forEach((row, index) => {
    if (row.unit) rowOf.set(row.unit.id, { row, index });
  });

  const fileCount = plan.units.reduce((n, u) => n + u.files.length, 0);
  const assignedFiles = plan.rows.reduce((n, r) => n + (r.unit ? r.unit.files.length : 0), 0);
  const libraryFiles = fileCount - assignedFiles;
  const emptyRows = plan.rows.filter((r) => !r.occupied).length;
  const needsConfirm = mode === "replace" && plan.replaced > 0;
  const confirmed = confirmedFor === plan.replaced;
  const allUploaded = fileCount > 0 && plan.units.every((u) => u.files.every((f) => f.assetId));
  const canStart = ready && !running && fileCount > 0 && (!needsConfirm || confirmed);

  const specs = group.keys.map((k) => group.slots.get(k)?.spec).filter((x): x is IceSlotSpec => Boolean(x));
  const uniform = specs.every((sp) => sp.width === specs[0].width && sp.height === specs[0].height && sp.ratio === specs[0].ratio);
  const shared = specs.find((sp) => sp.sharedWith || sp.positionOnly);

  // "samples.retouch" → "Przykładowe zdjęcia · Retusz": the group's own label
  // (shared with the group picker), then the tool it belongs to.
  const [groupHead, groupTool] = group.key.split(".");
  const groupName = t(`ice.bulk.group.${groupHead}`) + (groupTool ? ` · ${t(`ice.bulk.tool.${groupTool}`)}` : "");

  const dimsText = (f: Item) => (f.dims === undefined ? "…" : f.dims ? `${f.dims.width}×${f.dims.height} px` : t("ice.bulk.noSize"));
  const rejectText = (code: string) => (code === "duplicate" ? t("ice.bulk.duplicate")
    : code === "too_many" ? t("ice.bulk.tooMany", { n: MAX_FILES }) : errorText(t, code));

  const start = async () => {
    if (!canStart || !states) return;
    // Everything the run decides is fixed here, from what the admin saw:
    // the plan, and each slot's updatedAt as the compare-and-set base.
    const snapshot = plan;
    const seen = states;
    const queue = snapshot.units.flatMap((u) => u.files);
    const assetOf = new Map<string, string>();
    for (const f of queue) if (f.assetId) assetOf.set(f.id, f.assetId);
    const todo = queue.filter((f) => !assetOf.has(f.id));
    const todoIds = new Set(todo.map((f) => f.id));

    setRunning(true);
    setPhase("upload");
    setProblem(null);
    setConflict(null);
    setItems((prev) => prev.map((i) => (todoIds.has(i.id) ? { ...i, status: "waiting", error: null } : i)));
    let done = queue.length - todo.length;
    setProgress({ done, total: queue.length });

    const failed: { name: string; error: string }[] = [];
    for (const f of todo) {
      patch(f.id, { status: "uploading" });
      const res = await uploadOne(transport, f.file, { sample, kind: "image" });
      if (!alive.current) return;
      if (res.ok) {
        assetOf.set(f.id, res.asset.id);
        patch(f.id, { status: "done", assetId: res.asset.id, error: null });
      } else {
        failed.push({ name: f.name, error: res.error });
        patch(f.id, { status: "error", error: res.error });
      }
      done += 1;
      setProgress({ done, total: queue.length });
    }

    if (assetOf.size === 0) {
      setRunning(false);
      setProblem(t("ice.bulk.allFailed"));
      return;
    }

    // A row is assigned only when every file it needs is in the library: a
    // failed upload skips its slot, and a pair with a failed half is skipped
    // whole (the uploaded half stays in the library).
    const writes: IceSlotWrite[] = [];
    const inGroup = new Set(group.keys);
    for (const row of snapshot.rows) {
      const unit = row.unit;
      if (!unit || unit.files.some((f) => !assetOf.has(f.id))) continue;
      row.keys.forEach((key, i) => {
        const st = seen.get(key);
        const mediaId = assetOf.get(unit.files[i]?.id ?? "");
        if (!inGroup.has(key) || !mediaId) return;
        writes.push({
          key,
          mediaType: "image",
          mediaId,
          mobileMediaId: null,
          posterMediaId: null,
          // A new picture must not inherit the old one's description.
          alt: null,
          altI18n: {},
          fit: st?.fit ?? "cover",
          position: st?.position ?? "center center",
          // A fresh file starts uncropped (and a position-only tool card
          // takes no crop at all).
          crop: null,
          base: st?.updatedAt ?? null,
        });
      });
    }
    const libraryOnly = assetOf.size - writes.length;

    if (writes.length > 0) {
      if (writes.length > MAX_SLOTS) {
        setRunning(false);
        setProblem(t("ice.error.generic"));
        return;
      }
      setPhase("save");
      const res = await call(transport.slotSave({ action: "bulk", writes }));
      if (!alive.current) return;
      if (!res.ok) {
        setRunning(false);
        if (res.error === "conflict") {
          // Nothing was assigned (one transaction). Show the slots as they
          // are now; the uploaded files keep their assets for the next Start.
          setConfirmedFor(null);
          const key = conflictKey(res.current);
          await load();
          if (!alive.current) return;
          setConflict(key && inGroup.has(key) ? t("ice.bulk.conflict", { slot: labelOf(key) }) : t("ice.bulk.conflictAny"));
        } else {
          setProblem(errorText(t, res.error));
        }
        return;
      }
    }

    setRunning(false);
    if (failed.length) {
      notify.warning(t("ice.bulk.doneFailed", { x: writes.length, y: libraryOnly, z: failed.length }), {
        description: failed.map((f) => `${f.name}: ${errorText(t, f.error)}`).join("\n"),
      });
    } else {
      notify.success(t("ice.bulk.done", { x: writes.length, y: libraryOnly }));
    }
    void ctx.reload();
    close();
  };

  const statusChip = (st: Status, error: string | null) => {
    if (st === "idle") return null;
    return (
      <span className={cls(s.chip, st === "uploading" && s.chipAccent, st === "done" && s.bulkChipOk, st === "error" && s.bulkChipError)}
        title={error ? errorText(t, error) : undefined}>
        {t(STATUS_KEY[st])}
      </span>
    );
  };

  const mini = (key: string) => {
    const media = states?.get(key)?.media;
    if (!media) return <span key={key} />;
    const src = media.kind === "image" ? previewUrl(media, 160) : media.posterUrl;
    // eslint-disable-next-line @next/next/no-img-element
    return src ? <img key={key} src={src} alt="" loading="lazy" /> : <span key={key} />;
  };

  const footer = (
    <>
      <span className={cls(s.meta, s.grow)}>
        {running ? t("ice.bulk.runningNote")
          : ready && fileCount > 0 ? t("ice.bulk.footer", { x: assignedFiles, y: libraryFiles }) : ""}
      </span>
      <Btn onClick={close}>{t("ice.cancel")}</Btn>
      <Btn kind="primary" disabled={!canStart} onClick={() => void start()}>
        {running ? t("ice.media.uploading")
          : allUploaded ? t("ice.save")
          : assignedFiles > 0 ? t("ice.bulk.start", { n: fileCount }) : t("ice.bulk.startLibrary", { n: fileCount })}
      </Btn>
    </>
  );

  return (
    <Sheet wide title={t("ice.bulk.title")} crumbs={`${ctx.pageLabel} · ${groupName}`} onClose={close} t={t} footer={footer}>
      <div ref={rootRef} className={s.bulkRoot}>
        <p className={s.srOnly} aria-live="polite">{live}</p>

        <div className={s.field}>
          {ready && (
            <p className={s.meta}>
              {t(group.pairs ? "ice.bulk.summaryPairs" : "ice.bulk.summary", { n: plan.rows.length, e: emptyRows, f: plan.rows.length - emptyRows })}
              {" · "}
              {uniform && specs[0] ? t("ice.bulk.size", { w: specs[0].width, h: specs[0].height }) : t("ice.bulk.sizeMixed")}
            </p>
          )}
          {group.pairs && <p className={s.note}>{t("ice.bulk.pairsHint")}</p>}
          {sample && <p className={s.note}>{t("ice.bulk.sampleNote")}</p>}
          {shared && <p className={s.warn}>{t("ice.bulk.sharedNote", { page: shared.sharedWith ?? "/tools" })}</p>}
        </div>

        {loadError && (
          <div className={s.error} role="alert">
            <p className={s.bulkLine}>{t("ice.bulk.loadFailed")} {errorText(t, loadError)}</p>
            <Btn small onClick={() => void load()}>{t("ice.bulk.retry")}</Btn>
          </div>
        )}
        {!ready && !loadError && <p className={s.meta} aria-busy="true">{t("ice.bulk.loading")}</p>}

        <div className={cls(s.drop, dragging && s.dropOn)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M12 16V4m0 0L7 9m5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
          </svg>
          <span>{t("ice.bulk.drop")}</span>
          <Btn onClick={() => fileRef.current?.click()} disabled={running}>{t("ice.bulk.pick")}</Btn>
          <input ref={fileRef} type="file" hidden multiple accept={ACCEPT}
            onChange={(e) => { intake(e.target.files); e.target.value = ""; }} />
          <span className={s.meta}>{t("ice.bulk.formats", { mb: Math.round((sample ? ICE_MAX_SAMPLE_BYTES : ICE_MAX_IMAGE_BYTES) / 1024 / 1024) })}</span>
        </div>

        {rejected.length > 0 && (
          <div className={s.error} role="alert">
            <p className={s.bulkLine}><strong>{t("ice.bulk.rejectedTitle")}</strong></p>
            <ul className={s.bulkBullets}>
              {rejected.map((r) => <li key={r.id}><span className={s.bulkName}>{r.name}</span> — {rejectText(r.reason)}</li>)}
            </ul>
          </div>
        )}

        {plan.problems.length > 0 && (
          <div className={s.warn}>
            <p className={s.bulkLine}><strong>{t("ice.bulk.problemsTitle")}</strong></p>
            <ul className={s.bulkBullets}>
              {plan.problems.map((p) => (
                <li key={p.file.id} className={s.bulkProblem}>
                  <span><span className={s.bulkName}>{p.file.name}</span> — {t(PROBLEM_KEY[p.reason], { base: p.base })}</span>
                  <button type="button" className={cls(s.btn, s.ghost, s.bulkIconBtn)} disabled={running}
                    onClick={() => removeFiles([p.file.id])} aria-label={t("ice.bulk.remove", { name: p.file.name })}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {plan.units.length > 0 && (
          <section className={s.field} aria-label={t("ice.bulk.orderLabel")}>
            <div className={s.between}>
              <span className={s.label}>{t(group.pairs ? "ice.bulk.pairsTitle" : "ice.bulk.filesTitle", { n: plan.units.length })}</span>
              {order && <Btn small kind="ghost" disabled={running} onClick={() => setOrder(null)}>{t("ice.bulk.sortAz")}</Btn>}
            </div>
            <p className={s.meta}>{t("ice.bulk.orderHint")}</p>
            <ol className={s.list}>
              {plan.units.map((u, i) => {
                const target = rowOf.get(u.id);
                const st = unitStatus(u);
                const err = u.files.find((f) => f.error)?.error ?? null;
                return (
                  <li key={u.id} className={s.bulkRow}>
                    <div className={s.bulkThumb}>
                      {u.files.length > 1 ? (
                        <div className={s.bulkPairThumb}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {u.files.map((f) => <img key={f.id} src={f.url} alt="" />)}
                        </div>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={u.files[0].url} alt="" />
                      )}
                    </div>
                    <div className={s.bulkInfo}>
                      <p className={s.tileName} title={u.name}>{i + 1}. {u.name}</p>
                      {u.files.map((f, h) => (
                        <p key={f.id} className={s.tileMeta} title={f.name}>
                          {u.files.length > 1 ? `${half(h)}: ${f.name} · ` : ""}{dimsText(f)} · {bytes(f.file.size)}
                        </p>
                      ))}
                      <div className={s.row}>
                        {ready && (target
                          ? <span className={cls(s.chip, s.chipAccent)}>{t("ice.bulk.target", { slot: rowLabel(target.row, target.index) })}</span>
                          : <span className={s.chip}>{t("ice.bulk.libraryOnly")}</span>)}
                        {statusChip(st, err)}
                      </div>
                      {st === "error" && err && <p className={cls(s.meta, s.bulkErrText)}>{errorText(t, err)}</p>}
                    </div>
                    <div className={s.bulkTools}>
                      <button type="button" className={cls(s.btn, s.ghost, s.bulkIconBtn)} data-move={`${u.id}:up`}
                        disabled={running || i === 0} onClick={() => move(u, -1)} aria-label={t("ice.bulk.up", { name: u.name })}>
                        <Chevron up />
                      </button>
                      <button type="button" className={cls(s.btn, s.ghost, s.bulkIconBtn)} data-move={`${u.id}:down`}
                        disabled={running || i === plan.units.length - 1} onClick={() => move(u, 1)} aria-label={t("ice.bulk.down", { name: u.name })}>
                        <Chevron up={false} />
                      </button>
                      <button type="button" className={cls(s.btn, s.ghost, s.bulkIconBtn)} disabled={running}
                        onClick={() => removeFiles(u.files.map((f) => f.id))} aria-label={t("ice.bulk.remove", { name: u.name })}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        <fieldset className={s.bulkFieldset} disabled={running}>
          <legend className={s.label}>{t("ice.bulk.mode.label")}</legend>
          <label className={s.bulkChoice}>
            <input type="radio" name={radioName} value="empty" checked={mode === "empty"}
              onChange={() => { setMode("empty"); setConfirmedFor(null); }} />
            <span><strong>{t("ice.bulk.mode.empty")}</strong><span className={s.meta}>{t("ice.bulk.mode.emptyHint")}</span></span>
          </label>
          <label className={s.bulkChoice}>
            <input type="radio" name={radioName} value="replace" checked={mode === "replace"} onChange={() => setMode("replace")} />
            <span><strong>{t("ice.bulk.mode.replace")}</strong><span className={s.meta}>{t("ice.bulk.mode.replaceHint")}</span></span>
          </label>
          {mode === "replace" && ready && (needsConfirm ? (
            <label className={cls(s.bulkChoice, s.bulkConfirm)}>
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmedFor(e.target.checked ? plan.replaced : null)} />
              <span>{t("ice.bulk.confirm", { n: plan.replaced })}</span>
            </label>
          ) : (
            <p className={s.meta}>{t("ice.bulk.nothingReplaced")}</p>
          ))}
        </fieldset>

        {ready && (
          <section className={s.field} aria-label={t("ice.bulk.previewTitle")}>
            <span className={s.label}>{t("ice.bulk.previewTitle")}</span>
            {plan.units.length > 0 && plan.targets === 0 && <p className={s.note}>{t("ice.bulk.noTargets")}</p>}
            <ul className={s.list}>
              {plan.rows.map((row, index) => {
                const unit = row.unit;
                return (
                  <li key={row.keys.join("|")} className={s.bulkSlot}>
                    <div className={cls(s.bulkMini, row.keys.length > 1 && s.bulkMiniPair)}>{row.keys.map(mini)}</div>
                    <div className={s.bulkInfo}>
                      <p className={s.bulkLine}>
                        <strong>{rowLabel(row, index)}</strong>
                        {unit ? <> ← <span className={s.bulkName}>{unit.name}</span></> : null}
                      </p>
                      <div className={s.row}>
                        {unit && row.occupied && <span className={cls(s.chip, s.bulkChipWarn)}>{t("ice.bulk.slotReplaced")}</span>}
                        {unit && !row.occupied && <span className={cls(s.chip, s.chipAccent)}>{t("ice.bulk.slotFilled")}</span>}
                        {!unit && <span className={s.chip}>{row.occupied ? t("ice.bulk.slotKept") : t("ice.bulk.slotFree")}</span>}
                      </div>
                      {unit && row.keys.map((key, h) => {
                        const f = unit.files[h];
                        const spec = group.slots.get(key)?.spec;
                        const warnings = f?.dims && spec ? fitWarnings(t, { width: f.dims.width, height: f.dims.height, kind: "image" }, spec) : [];
                        if (!f || (row.keys.length === 1 && warnings.length === 0)) return null;
                        return (
                          <div key={key}>
                            {row.keys.length > 1 && <p className={s.tileMeta}>{half(h)} ← {f.name}</p>}
                            {warnings.length > 0 && (
                              <ul className={s.bulkWarnList}>
                                {warnings.map((w) => <li key={w}>{w}</li>)}
                              </ul>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {running && (
          <div className={s.field}>
            <p className={s.meta} aria-live="polite">
              {phase === "save" ? t("ice.bulk.saving") : t("ice.bulk.progress", { done: progress.done, total: progress.total })}
            </p>
            <div className={s.progress} role="progressbar" aria-label={t("ice.bulk.progressLabel")}
              aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
              <span style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
            </div>
          </div>
        )}
        {conflict && <p className={s.warn} role="alert">{conflict}</p>}
        {problem && <p className={s.error} role="alert">{problem}</p>}
      </div>
    </Sheet>
  );
}
