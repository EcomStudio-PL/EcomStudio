"use client";
import { useCallback, useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Loader2, Upload, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { toast } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { acceptFiles, dragCarriesFiles, type IntakeLimits } from "@/lib/images/file-intake";
import { ALLOWED_MIME, MAX_FILE_BYTES } from "@/lib/services/images";
import { stashHomeUpload } from "@/lib/home-handoff";
import { SAMPLE_PHOTO, UPLOAD_LEAD_DEFAULT, type MediaSrc, type UploadToolKey } from "@/lib/seller-home-config";
import { cannotAfford, selectedUploadTool, type UploadToolView } from "@/lib/seller-home-model";
import { EmptyArt } from "./media-slot";
import { StatusBadge } from "./parts";
import { HERO_ID, UPLOAD_ID, setSelectedTool, useSelectedTool } from "./task-store";
import { NoCreditsModal, type ProOfferView } from "./no-credits-modal";

/** The strictest common limit — the generator's and the storage bucket's. */
const HOME_LIMITS: IntakeLimits = { mime: ALLOWED_MIME, ext: null, maxBytes: MAX_FILE_BYTES, maxFiles: 1 };
const ACCEPT = ALLOWED_MIME.join(",");
/** A sample dragged onto the tile carries its index, not a file. */
const SAMPLE_DRAG = "application/x-grovbase-sample";

/**
 * The brand light pooled behind the tile. Every layer is a `closest-side`
 * ellipse, so each one reaches full transparency INSIDE its own box — there
 * is no edge for anything to cut. The box reaches well below the section
 * (into the gap before the next one) so the light fades out over the page
 * instead of stopping at a line; the sections after it are positioned, so
 * their cards paint over it and only the gaps between them glow.
 */
const GLOW =
  "radial-gradient(closest-side at 50% 40%, rgb(var(--accent) / 0.26), rgb(var(--accent) / 0.10) 58%, transparent),"
  + "radial-gradient(closest-side at 30% 34%, rgb(var(--violet) / 0.17), transparent),"
  + "radial-gradient(closest-side at 72% 44%, rgb(var(--accent-glow) / 0.15), transparent)";

/**
 * 2 — THE UPLOAD TILE, the old Start's box: one centred surface with a
 * magenta rim and halo, the upload glyph, one sentence and "Utwórz"; under it
 * three tool pills and five example photos for the selected tool.
 *
 * /home generates NOTHING. A photo (picked, dropped, or a sample) is held
 * here until "Utwórz"; then it is handed — once, in memory, bound to that
 * one route (lib/home-handoff.ts) — to the tool's EXISTING screen, which
 * uploads it through its own upload, shows its own price and runs only when
 * the seller presses its button there. Choosing a sample never fetches more
 * than the sample file and never spends a credit.
 *
 * Retusz takes no handed photo (it is frozen, and nothing is prefilled into
 * it): with Retusz selected the tile is a door — "Utwórz" opens /retusz and
 * the tile says the photo is added there. Nothing pretends to carry it.
 */
export function UploadTile({ tools, defaultTool, balance, pro }: {
  tools: UploadToolView[];
  defaultTool: UploadToolKey | null;
  balance: number;
  pro: ProOfferView | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const picked = useSelectedTool();
  const tool = selectedUploadTool(tools, picked, defaultTool);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [noCredits, setNoCredits] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  // Every choice of a photo (picked, dropped, sample, removed) bumps this; a
  // sample that finishes downloading after a newer choice is thrown away.
  const choice = useRef(0);

  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const take = useCallback((list: FileList | File[] | null | undefined) => {
    choice.current += 1;
    const res = acceptFiles(list, HOME_LIMITS, 1);
    if (res.badType > 0 && res.accepted.length === 0) toast.error(t("products.invalidType"));
    else if (res.tooLarge > 0 && res.accepted.length === 0) toast.error(t("products.tooLarge"));
    if (res.accepted[0]) setFile(res.accepted[0]);
  }, [t]);

  /** A sample becomes the chosen photo — fetched, validated like any file. */
  const pickSample = useCallback(async (media: MediaSrc) => {
    if (!media.src) return;
    const mine = ++choice.current;
    try {
      const res = await fetch(media.src);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      if (mine !== choice.current) return; // the seller chose something else meanwhile
      // The sample's own file name, so nothing language-bound reaches the UI.
      const base = media.src.split(/[?#]/)[0].split("/").pop() || "sample.webp";
      const ext = (base.split(".").pop() || "webp").toLowerCase();
      const type = blob.type.startsWith("image/") ? blob.type : `image/${ext === "jpg" ? "jpeg" : ext}`;
      take([new File([blob], base, { type })]);
    } catch {
      if (mine === choice.current) toast.error(t("common.error"));
    }
  }, [take, t]);

  /** Drop the chosen photo; the keyboard focus goes back to the tile. */
  const removeFile = () => {
    choice.current += 1;
    setFile(null);
    document.getElementById(UPLOAD_ID)?.focus();
  };

  const handoff = Boolean(tool?.handoff);

  /** The tile itself: pick a photo (a tool that takes one) or open the tool. */
  const onZone = () => {
    if (!tool) return;
    if (handoff) inputRef.current?.click();
    else router.push(tool.href);
  };

  /** "Utwórz". */
  const create = () => {
    if (!tool || busy) return;
    if (!handoff) { setBusy(true); router.push(tool.href); return; }
    // Not even one image is affordable: say so before asking for a photo.
    if (cannotAfford(balance, tool.credits)) { setNoCredits(true); return; }
    if (!file) { inputRef.current?.click(); return; }
    stashHomeUpload(file, tool.href);
    setBusy(true);
    router.push(tool.href);
  };

  const carries = (e: DragEvent) => dragCarriesFiles(e.nativeEvent) || Array.from(e.dataTransfer.types).includes(SAMPLE_DRAG);
  const onDragEnter = (e: DragEvent) => {
    if (!carries(e)) return;
    e.preventDefault();
    depth.current += 1;
    if (handoff) setOver(true);
  };
  const onDragOver = (e: DragEvent) => {
    if (!carries(e)) return;
    // Cancelled either way, so the browser never opens a dropped file in the
    // tab; a tool that takes no photo says so with the cursor.
    e.preventDefault();
    e.dataTransfer.dropEffect = handoff ? "copy" : "none";
  };
  const onDragLeave = (e: DragEvent) => {
    if (!carries(e)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setOver(false);
  };
  const onDrop = (e: DragEvent) => {
    if (!carries(e)) return;
    e.preventDefault();
    depth.current = 0;
    setOver(false);
    if (!handoff || !tool) return;
    const sample = e.dataTransfer.getData(SAMPLE_DRAG);
    if (sample !== "") {
      const media = tool.samples[Number(sample)];
      if (media) void pickSample(media);
      return;
    }
    take(e.dataTransfer.files);
  };

  const lead = t(tool?.leadKey ?? UPLOAD_LEAD_DEFAULT);
  const shown = handoff && file && preview;

  return (
    <section id={HERO_ID} aria-labelledby="seller-upload-lead" className="relative isolate scroll-mt-[calc(var(--header-h)+1rem)]" data-seller-upload-section>
      <span aria-hidden data-upload-glow
        className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[calc(100%+7rem)] w-full max-w-[76rem] -translate-x-1/2"
        style={{ background: GLOW }} />

      <div className="relative mx-auto w-full max-w-[56rem]">
        <div data-seller-upload data-over={over || undefined}
          onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
          className={cn(
            "relative overflow-hidden rounded-2xl border border-[rgb(var(--accent)/0.5)] bg-[rgb(var(--surface)/0.55)] px-5 py-6 text-center backdrop-blur-sm sm:py-8",
            "shadow-[0_0_46px_-10px_rgb(var(--accent)/0.55),inset_0_0_42px_-20px_rgb(var(--accent)/0.55)]",
            "transition-[border-color,box-shadow] duration-200 hover:border-[rgb(var(--accent)/0.8)] motion-reduce:transition-none",
            "data-[over]:border-[rgb(var(--accent))] data-[over]:shadow-[0_0_64px_-6px_rgb(var(--accent)/0.7),inset_0_0_52px_-16px_rgb(var(--accent)/0.7)]",
          )}>
          <input ref={inputRef} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden
            onChange={(e) => { take(e.target.files); e.target.value = ""; }} />
          {/* The whole tile is ONE real button; "Utwórz" and "remove" sit
              above it, never inside it. */}
          <button id={UPLOAD_ID} type="button" onClick={onZone} disabled={!tool}
            aria-label={handoff ? (file ? t("sellerHome.upload.change") : t("sellerHome.upload.pick")) : t("sellerHome.upload.open")}
            aria-describedby="seller-upload-lead"
            className="absolute inset-0 z-0 cursor-pointer rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--accent))] disabled:cursor-default" />

          <div className="pointer-events-none relative flex flex-col items-center">
            {shown ? (
              <span className="relative block h-16 w-16 overflow-hidden rounded-xl shadow-e1 ring-1 ring-[rgb(var(--accent)/0.35)]">
                {/* A local object URL of the chosen file — not an optimisable asset. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="" className="h-full w-full object-cover" />
              </span>
            ) : (
              <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-xl bg-[rgb(var(--accent)/0.12)] text-accent ring-1 ring-[rgb(var(--accent)/0.25)]">
                <Upload size={18} />
              </span>
            )}
            <p id="seller-upload-lead" className="mx-auto mt-3 max-w-md text-balance text-[14px] font-medium leading-relaxed text-muted sm:text-[15px]">
              {lead}
            </p>
            {shown && (
              <p className="mt-1 max-w-xs truncate text-[12px] font-medium text-ink/80" data-upload-file>{file.name}</p>
            )}
          </div>

          <div className="relative z-10 mt-4 flex items-center justify-center gap-2">
            <button type="button" onClick={create} disabled={!tool || busy} data-seller-create
              className="cta inline-flex h-10 items-center justify-center gap-2 rounded-full px-7 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60">
              {busy && <Loader2 size={15} className="animate-spin" aria-hidden />}
              {t("sellerHome.upload.create")}
              {!busy && <ArrowRight size={15} aria-hidden />}
            </button>
            {shown && (
              <button type="button" onClick={removeFile} aria-label={t("sellerHome.upload.remove")}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-[rgb(var(--surface)/0.7)] text-muted transition-colors hover:text-ink">
                <X size={15} aria-hidden />
              </button>
            )}
          </div>
          {tool && !handoff && (
            <p className="pointer-events-none relative mt-2.5 text-[11.5px] text-faint" data-upload-opens>{t("sellerHome.upload.opensTool")}</p>
          )}
          {!tool && (
            <p className="pointer-events-none relative mt-2.5 text-[11.5px] text-faint">{t("sellerHome.upload.unavailable")}</p>
          )}
        </div>
      </div>

      <ToolPills tools={tools} selected={tool?.key ?? null} />
      <Samples tool={tool} onPick={pickSample} />

      <NoCreditsModal open={noCredits} onClose={() => setNoCredits(false)} balance={balance}
        perImage={tool?.credits ?? null} pro={pro} />
    </section>
  );
}

/* ── the three pills (a radio group) ──────────────────────────────────────*/

function ToolPills({ tools, selected }: { tools: UploadToolView[]; selected: UploadToolKey | null }) {
  const { t } = useI18n();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  if (tools.length === 0) return null;
  const live = tools.map((x, i) => (x.status === "live" ? i : -1)).filter((i) => i >= 0);

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!dir || live.length === 0) return;
    e.preventDefault();
    const at = live.indexOf(index);
    const next = live[((at < 0 ? 0 : at) + dir + live.length) % live.length];
    setSelectedTool(tools[next].key);
    refs.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={t("sellerHome.upload.toolsLabel")}
      className="relative mt-4 flex flex-wrap items-center justify-center gap-1.5 sm:gap-2" data-upload-tools>
      {tools.map((tool, i) => {
        const on = tool.key === selected;
        const isLive = tool.status === "live";
        return (
          <button key={tool.key} ref={(el) => { refs.current[i] = el; }} type="button" role="radio"
            aria-checked={on} aria-disabled={!isLive || undefined}
            tabIndex={on || (!selected && i === live[0]) ? 0 : -1}
            onClick={() => { if (isLive) setSelectedTool(tool.key); }}
            onKeyDown={(e) => onKey(e, i)}
            data-upload-tool={tool.key} data-selected={on || undefined}
            className={cn(
              "inline-flex h-9 items-center gap-1 rounded-xl border px-2.5 text-[12px] font-semibold transition-colors duration-200 sm:gap-1.5 sm:px-3.5 sm:text-[12.5px]",
              on
                ? "border-[rgb(var(--accent)/0.7)] bg-[rgb(var(--accent)/0.1)] text-accent-strong dark:text-accent"
                : "border-line bg-[rgb(var(--surface)/0.6)] text-ink hover:border-[rgb(var(--accent)/0.45)] hover:bg-[rgb(var(--accent)/0.06)]",
              !isLive && "cursor-default text-faint hover:border-line hover:bg-[rgb(var(--surface)/0.6)]",
            )}>
            {on && <Check size={13} strokeWidth={3} aria-hidden />}
            {t(tool.pillKey)}
            {!isLive && <StatusBadge status={tool.status} t={t} />}
          </button>
        );
      })}
    </div>
  );
}

/* ── five example photos for the selected tool ────────────────────────────*/

function Samples({ tool, onPick }: { tool: UploadToolView | null; onPick: (m: MediaSrc) => void }) {
  const { t } = useI18n();
  if (!tool) return null;
  const usable = tool.handoff;
  const anyEmpty = tool.samples.some((s) => !s.src);
  const ring = "relative block h-10 w-10 shrink-0 overflow-hidden rounded-full ring-1 ring-[rgb(var(--glass-border)/0.3)] sm:h-11 sm:w-11";
  return (
    <div className="relative mt-3.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-2.5" data-seller-samples={tool.key}>
      <span className="basis-full text-center text-[12px] text-faint sm:basis-auto">{t("sellerHome.samples")}</span>
      <span className="flex items-center gap-2.5">
        {tool.samples.map((media, i) => {
          if (!media.src) {
            return (
              <span key={media.configKey} aria-hidden className={ring} data-sample-empty={media.configKey}
                title={t("sellerHome.sampleEmpty", { w: SAMPLE_PHOTO.width, h: SAMPLE_PHOTO.height })}>
                <EmptyArt tone={i} bare label="" hint="" />
              </span>
            );
          }
          const picture = media.src.startsWith("/")
            ? <Image src={media.src} alt="" fill sizes="44px" className="object-cover" />
            // eslint-disable-next-line @next/next/no-img-element
            : <img src={media.src} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />;
          // A tool that takes no photo from here shows its examples as
          // pictures only — nothing to pick, nothing that pretends to be sent.
          if (!usable) {
            return <span key={media.configKey} aria-hidden className={ring} title={t("sellerHome.upload.opensTool")}>{picture}</span>;
          }
          return (
            <button key={media.configKey} type="button" draggable
              onDragStart={(e) => { e.dataTransfer.setData(SAMPLE_DRAG, String(i)); e.dataTransfer.effectAllowed = "copy"; }}
              onClick={() => onPick(media)} data-sample={media.configKey}
              aria-label={t("sellerHome.sampleTry", { n: i + 1 })}
              className={cn(ring, "transition-transform duration-200 hover:scale-105 hover:ring-[rgb(var(--accent)/0.6)] motion-reduce:transition-none motion-reduce:hover:scale-100")}>
              {picture}
            </button>
          );
        })}
      </span>
      {anyEmpty && <span className="text-[11.5px] text-faint" data-samples-soon>{t("sellerHome.samplesSoon")}</span>}
    </div>
  );
}
