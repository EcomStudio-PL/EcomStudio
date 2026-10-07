"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, ImagePlus, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { toast } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { acceptFiles, dragCarriesFiles, type IntakeLimits } from "@/lib/images/file-intake";
import { ALLOWED_MIME, MAX_FILE_BYTES } from "@/lib/services/images";
import { stashHomeUpload } from "@/lib/home-handoff";
import { SAMPLES, type HeroTaskKey } from "@/lib/seller-home-config";
import { cannotAfford, imagesAffordable, pluralForm, taskByKey, type ResolvedTask } from "@/lib/seller-home-model";
import { formatCount } from "@/components/plan/pricing-model";
import { MediaSlot } from "./media-slot";
import { HERO_ID, UPLOAD_ID, setSelectedTask, useSelectedTask } from "./task-store";
import { NoCreditsModal, type ProOfferView } from "./no-credits-modal";

/** The strictest common limit — the generator's and the storage bucket's. */
const HOME_LIMITS: IntakeLimits = { mime: ALLOWED_MIME, ext: null, maxBytes: MAX_FILE_BYTES, maxFiles: 1 };
const ACCEPT = ALLOWED_MIME.join(",");

/**
 * THE HERO — one path to a first result.
 *
 * Pick a task (four radio cards), drop a photo, press "Generuj". /home itself
 * generates nothing: the photo is handed to the task's EXISTING screen
 * (lib/home-handoff.ts), which uploads it through its own upload and shows its
 * own price and button. A task whose screen does not take a handed photo is
 * simply opened. No prompt, no notes and no settings travel with the photo.
 */
export function SellerHero({ tasks, defaultTask, balance, pro }: {
  tasks: ResolvedTask[];
  defaultTask: HeroTaskKey | null;
  balance: number;
  pro: ProOfferView | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const selectedKey = useSelectedTask(defaultTask);
  // A remembered pick whose tool has since gone offline falls back to the
  // page's default, then to the first live task — never to "nothing selected".
  const task = taskByKey(tasks, selectedKey) ?? taskByKey(tasks, defaultTask) ?? tasks.find((x) => x.available) ?? null;
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [noCredits, setNoCredits] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const notesId = useId();

  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const take = useCallback((list: FileList | File[] | null | undefined) => {
    const res = acceptFiles(list, HOME_LIMITS, 1);
    if (res.badType > 0 && res.accepted.length === 0) toast.error(t("products.invalidType"));
    else if (res.tooLarge > 0 && res.accepted.length === 0) toast.error(t("products.tooLarge"));
    if (res.accepted[0]) setFile(res.accepted[0]);
  }, [t]);

  /** "Generuj": the same path for an uploaded photo and for a sample. */
  const go = useCallback((photo: File | null) => {
    if (!task || !task.available || busy) return;
    if (cannotAfford(balance, task.credits)) { setNoCredits(true); return; }
    if (photo && task.handoff) stashHomeUpload(photo, task.href);
    setBusy(true);
    router.push(task.href);
  }, [task, balance, busy, router]);

  const onGenerate = () => {
    if (!task || !task.available) return;
    // Not even one image is affordable: say so before asking for a photo.
    if (cannotAfford(balance, task.credits)) { setNoCredits(true); return; }
    if (!file && task.handoff) { inputRef.current?.click(); return; }
    go(file);
  };

  const runSample = async (src: string) => {
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const ext = (src.split(".").pop() || "webp").toLowerCase();
      const type = blob.type.startsWith("image/") ? blob.type : `image/${ext === "jpg" ? "jpeg" : ext}`;
      const sample = new File([blob], `przyklad.${ext}`, { type });
      setFile(sample);
      go(sample);
    } catch {
      toast.error(t("common.error"));
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    take(e.dataTransfer.files);
  };

  const count = task ? imagesAffordable(balance, task.credits) : null;
  const unit = task && count !== null ? t(`sellerHome.unit.${task.unit}.${pluralForm(count)}`) : "";
  const anyAvailable = tasks.some((x) => x.available);

  return (
    <section id={HERO_ID} aria-labelledby="seller-hero-title" className="scroll-mt-[calc(var(--header-h)+1rem)]">
      <h1 id="seller-hero-title" className="text-balance font-display text-[1.75rem] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[2.25rem] lg:text-[2.625rem]">
        {t("sellerHome.hero.title")}
      </h1>
      <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted sm:text-base">{t("sellerHome.hero.sub")}</p>

      <TaskPicker tasks={tasks} selected={task?.key ?? null} />

      {/* THE UPLOAD — a real file input; drag & drop and a click both land in
          the same check the tools use (lib/images/file-intake.ts). */}
      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_17.5rem]">
        <div
          data-seller-upload
          data-over={over || undefined}
          onDragEnter={(e) => { if (dragCarriesFiles(e.nativeEvent)) { e.preventDefault(); setOver(true); } }}
          onDragOver={(e) => { if (dragCarriesFiles(e.nativeEvent)) e.preventDefault(); }}
          onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(false); }}
          onDrop={onDrop}
          className={cn(
            "group relative flex min-h-[10.5rem] items-center gap-4 rounded-2xl border-2 border-dashed px-5 py-5 transition-colors duration-200 sm:min-h-[11.5rem] sm:px-7",
            "border-[rgb(var(--accent)/0.32)] bg-[rgb(var(--surface)/0.7)] hover:border-[rgb(var(--accent)/0.6)] hover:bg-[rgb(var(--accent)/0.035)]",
            "data-[over]:border-[rgb(var(--accent))] data-[over]:bg-[rgb(var(--accent)/0.06)]",
          )}>
          <input ref={inputRef} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden
            onChange={(e) => { take(e.target.files); e.target.value = ""; }} />
          {/* The whole zone is ONE real button (click, Enter, Space); the
              remove button sits beside it, never inside it. */}
          <button id={UPLOAD_ID} type="button" onClick={() => inputRef.current?.click()}
            aria-label={file ? t("sellerHome.upload.change") : t("sellerHome.upload.title")}
            aria-describedby={`${UPLOAD_ID}-hint`}
            className="absolute -inset-[2px] z-0 cursor-pointer rounded-2xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgb(var(--accent)/0.35)]" />
          {file && preview ? (
            <>
              {/* A local object URL of the chosen file — not an optimisable asset. */}
              <img src={preview} alt="" className="pointer-events-none relative h-24 w-24 shrink-0 rounded-xl object-cover shadow-e1 sm:h-28 sm:w-28" />
              <div className="pointer-events-none relative min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-ink">{file.name}</p>
                <p id={`${UPLOAD_ID}-hint`} className="mt-0.5 text-[13px] text-muted">{t("sellerHome.upload.ready")}</p>
                <span aria-hidden className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-strong dark:text-accent">
                  <RefreshCw size={13} /> {t("sellerHome.upload.change")}
                </span>
              </div>
              <button type="button" aria-label={t("sellerHome.upload.remove")}
                onClick={() => setFile(null)}
                className="absolute right-2.5 top-2.5 z-10 flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-ink">
                <X size={15} aria-hidden />
              </button>
            </>
          ) : (
            <div className="pointer-events-none relative mx-auto flex flex-col items-center text-center">
              <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgb(var(--accent)/0.1)] text-accent-strong transition-transform duration-200 group-hover:-translate-y-0.5 dark:text-accent motion-reduce:transform-none">
                <ImagePlus size={22} strokeWidth={1.9} />
              </span>
              <p aria-hidden className="mt-3 text-[15px] font-semibold text-ink sm:text-base">{t("sellerHome.upload.title")}</p>
              <p id={`${UPLOAD_ID}-hint`} className="mt-1 text-[13px] text-muted">{t("sellerHome.upload.hint")}</p>
            </div>
          )}
        </div>

        {/* THE BUTTON, with the honest price of what it starts. */}
        <div className="flex flex-col justify-center gap-2.5 rounded-2xl border border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*1.1))] bg-[rgb(var(--surface)/0.7)] p-4">
          <button type="button" onClick={onGenerate} disabled={!task || !task.available || busy}
            data-seller-generate
            className="cta inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-semibold [--accent:var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60">
            {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Sparkles size={16} aria-hidden />}
            {t("sellerHome.generate")}
          </button>
          {task && task.available ? (
            <p className="text-[12.5px] leading-snug text-muted" data-seller-press>
              {pressLine(t, task)}
            </p>
          ) : !anyAvailable ? (
            <p className="text-[12.5px] leading-snug text-muted">{t("sellerHome.unavailable")}</p>
          ) : null}
          <p className="border-t border-[rgb(var(--hairline)/var(--hairline-alpha))] pt-2.5 text-[13px] text-ink/85" data-seller-credits>
            {t(`sellerHome.credits.${pluralForm(balance)}`, { n: formatCount(balance) })}
            {count !== null && count > 0 && <> = {t("sellerHome.credits.approx", { n: formatCount(count), unit })}</>}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <Samples onRun={runSample} disabled={!task?.available || busy} />
        <NotesDisclosure id={notesId} task={task} />
      </div>

      <NoCreditsModal open={noCredits} onClose={() => setNoCredits(false)} balance={balance}
        perImage={task?.credits ?? null} pro={pro} />
    </section>
  );
}

function pressLine(t: (k: string, v?: Record<string, string | number>) => string, task: ResolvedTask): string {
  // A screen that does not take the photo is just opened — say that first.
  if (!task.handoff) return t("sellerHome.press.open");
  const per = task.credits;
  if (per === null) return t("sellerHome.press.next");
  if (per === 0) return t("sellerHome.press.free");
  if (task.shots && task.shots > 1) {
    return t("sellerHome.press.shots", { shots: task.shots, total: formatCount(task.shots * per), per: formatCount(per) });
  }
  return t("sellerHome.press.single", { per: formatCount(per) });
}

/* ── the four task cards (a radio group) ───────────────────────────────────*/

function TaskPicker({ tasks, selected }: { tasks: ResolvedTask[]; selected: HeroTaskKey | null }) {
  const { t } = useI18n();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const live = useMemo(() => tasks.map((x, i) => (x.available ? i : -1)).filter((i) => i >= 0), [tasks]);

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step || live.length === 0) return;
    e.preventDefault();
    const at = live.indexOf(index);
    const next = live[(at + step + live.length) % live.length];
    setSelectedTask(tasks[next].key);
    refs.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={t("sellerHome.tasksLabel")}
      className="rail-x-sm mt-5 sm:mt-6 sm:grid sm:grid-cols-2 sm:gap-3 lg:grid-cols-4">
      {tasks.map((task, i) => {
        const on = task.available && task.key === selected;
        return (
          <button key={task.slot} ref={(el) => { refs.current[i] = el; }}
            type="button" role="radio" aria-checked={on} disabled={!task.available}
            tabIndex={on || (!selected && i === live[0]) ? 0 : -1}
            onClick={() => setSelectedTask(task.key)}
            onKeyDown={(e) => onKey(e, i)}
            data-seller-task={task.key}
            data-selected={on || undefined}
            className={cn(
              "group relative flex w-[72vw] max-w-[18rem] shrink-0 snap-start flex-col overflow-hidden rounded-2xl border bg-[rgb(var(--surface))] text-left transition-[border-color,box-shadow,transform] duration-200 sm:w-auto sm:max-w-none",
              on
                ? "border-[rgb(var(--accent))] shadow-[0_0_0_3px_rgb(var(--accent)/0.16),0_14px_30px_-18px_rgb(var(--accent)/0.7)]"
                : "border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*1.4))] hover:border-[rgb(var(--accent)/0.45)] motion-safe:hover:-translate-y-0.5",
              !task.available && "cursor-not-allowed opacity-55",
            )}>
            {/* Pictures illustrate; the card's name says what it is. */}
            <span aria-hidden className="contents">
            <MediaSlot ratio="4/3" pair={task.media}
              label={t("sellerHome.slot.taskPair", { name: t(task.nameKey) })}
              hint={t("sellerHome.slot.size", { w: task.media.after.width, h: task.media.after.height })}
              pairLabels={{ before: t("sellerHome.before"), after: t("sellerHome.after") }}
              sizes="(max-width: 639px) 72vw, (max-width: 1023px) 45vw, 18rem"
              priority />
            </span>
            {task.badgeKey && (
              <span className="absolute left-2.5 top-2.5 rounded-full bg-[rgb(var(--accent-strong))] px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.08em] text-white shadow-[0_6px_14px_-6px_rgb(var(--accent)/0.9)]">
                {t(task.badgeKey)}
              </span>
            )}
            <span aria-hidden className={cn(
              "absolute right-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors",
              on ? "border-[rgb(var(--accent))] bg-[rgb(var(--accent))] text-white" : "border-white/90 bg-black/15",
            )}>
              {on && <Check size={13} strokeWidth={3.2} />}
            </span>
            <span className="flex flex-1 flex-col gap-1 px-3.5 pb-3.5 pt-3">
              <span className="font-display text-[15.5px] font-semibold leading-tight tracking-tight text-ink">{t(task.nameKey)}</span>
              <span className="text-[13px] leading-snug text-muted">{t(task.effectKey)}</span>
              <span className="mt-auto pt-1.5 text-[12.5px] font-semibold tabular-nums text-accent-strong dark:text-accent">
                {costLabel(t, task.credits)}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function costLabel(t: (k: string, v?: Record<string, string | number>) => string, credits: number | null): string {
  if (credits === null) return "";
  if (credits === 0) return t("sellerHome.cost.free");
  return t("sellerHome.cost.perImage", { n: formatCount(credits) });
}

/* ── samples ──────────────────────────────────────────────────────────────*/

function Samples({ onRun, disabled }: { onRun: (src: string) => void; disabled: boolean }) {
  const { t } = useI18n();
  const anyEmpty = SAMPLES.some((s) => !s.media.src);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2" data-seller-samples>
      <span className="text-[13px] text-muted">{t("sellerHome.samples")}</span>
      <div className="flex gap-2">
        {SAMPLES.map((s) => {
          const src = s.media.src;
          const label = t(s.labelKey);
          return src ? (
            <button key={s.key} type="button" disabled={disabled} onClick={() => onRun(src)}
              aria-label={t("sellerHome.sampleTry", { name: label })}
              className="h-12 w-12 overflow-hidden rounded-xl border border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*1.4))] transition-transform hover:-translate-y-0.5 disabled:opacity-50 motion-reduce:transform-none">
              <MediaSlot ratio="1/1" media={s.media} label={label} hint="" sizes="48px" compact className="h-full w-full" />
            </button>
          ) : (
            <span key={s.key} aria-hidden title={t("sellerHome.sampleEmpty", { w: s.media.width, h: s.media.height })}
              className="relative h-12 w-12 overflow-hidden rounded-xl border border-dashed border-[rgb(var(--hairline)/calc(var(--hairline-alpha)*2))]"
              data-sample-empty={s.media.configKey}>
              <MediaSlot ratio="1/1" label={label} hint="" compact className="h-full w-full" />
            </span>
          );
        })}
      </div>
      {/* Not a dead control: an example without its photo says so. */}
      {anyEmpty && <span className="text-[12px] font-medium text-muted" data-samples-soon>{t("sellerHome.samplesSoon")}</span>}
    </div>
  );
}

/* ── "Dodatkowe uwagi (opcjonalnie)" ──────────────────────────────────────*/

/**
 * Collapsed by default, so nobody reads it as "you must write a prompt".
 * A text box appears only for a task whose screen already sends such a field
 * (none of today's tasks: see HeroTaskDef.notesField). Otherwise it says where
 * the details can be given — the next screen's own per-shot descriptions —
 * and adds nothing to any request.
 */
function NotesDisclosure({ id, task }: { id: string; task: ResolvedTask | null }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className="sm:max-w-[22rem] sm:text-right" data-seller-notes>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted transition-colors hover:text-ink">
        {t("sellerHome.notes.toggle")}
        <ChevronDown size={14} aria-hidden className={cn("transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open && (
        <p id={id} className="animate-fade mt-1.5 text-left text-[12.5px] leading-relaxed text-muted">
          {task?.handoff ? t("sellerHome.notes.nextStep") : t("sellerHome.notes.inTool")}
        </p>
      )}
    </div>
  );
}

