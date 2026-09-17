"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Monitor, RotateCcw, Smartphone, Tablet } from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { saveSlotAction, clearSlotAction } from "@/app/actions/media-slots";
import { OBJECT_POSITIONS, type SlotDef } from "@/lib/media-slots";
import type { LibraryItem, SlotRow } from "@/lib/services/media-slots";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Switch } from "@/components/ui/record";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";
import { AssetPicker, AssetChip } from "./asset-picker";

/**
 * ONE POSITION IN THE INTERFACE, EDITED.
 *
 * The brief asks for a screen a person can use, not an editor for a
 * programmer. So the top of this component is four things — a preview, a type,
 * a file and an alt text — and everything else is folded away under
 * "Zaawansowane". Somebody swapping the Moda picture never opens it.
 *
 * THE PREVIEW IS THE POINT. It shows the CARD at the three device widths, with
 * the file that device would actually be served: pick a mobile override and the
 * mobile preview changes while the desktop one does not. Choosing a crop
 * without seeing the crop is how a face ends up cut in half on a phone.
 *
 * EMPTY IS A VALID STATE, AND IT IS THE DEFAULT. "Przywróć domyślne" deletes
 * the row rather than blanking its fields, so the surface goes back to drawing
 * exactly what it drew before this feature existed. That is the undo.
 */

type Device = "desktop" | "tablet" | "mobile";

/** How wide the preview frame is allowed to be per device. Not the real
 *  viewport — the real RATIO at a believable relative size, so the three
 *  previews read as three devices rather than three copies. */
const DEVICE_WIDTH: Record<Device, string> = {
  desktop: "max-w-[24rem]",
  tablet: "max-w-[17rem]",
  mobile: "max-w-[11rem]",
};

type Draft = {
  mediaType: "image" | "video";
  mediaId: string | null;
  tabletMediaId: string | null;
  mobileMediaId: string | null;
  posterMediaId: string | null;
  altText: string;
  objectFit: "cover" | "contain";
  objectPosition: string;
  autoplay: boolean;
  muted: boolean;
  loop: boolean;
  controls: boolean;
  enabled: boolean;
};

function draftOf(row: SlotRow | null): Draft {
  return {
    mediaType: row?.mediaType ?? "image",
    mediaId: row?.mediaId ?? null,
    tabletMediaId: row?.tabletMediaId ?? null,
    mobileMediaId: row?.mobileMediaId ?? null,
    posterMediaId: row?.posterMediaId ?? null,
    altText: row?.altText ?? "",
    objectFit: row?.objectFit ?? "cover",
    objectPosition: row?.objectPosition ?? "center center",
    // A card that moves on its own: muted and looping, with no controls over
    // the top of it. The brief's defaults, and the only combination a browser
    // will actually autoplay.
    autoplay: row?.autoplay ?? true,
    muted: row?.muted ?? true,
    loop: row?.loop ?? true,
    controls: row?.controls ?? false,
    enabled: row?.enabled ?? true,
  };
}

export function SlotEditor({ def, row, library, entityName }: {
  def: SlotDef;
  row: SlotRow | null;
  library: LibraryItem[];
  /** The thing this slot belongs to — "Moda", "Retusz" — for the card preview. */
  entityName: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<Draft>(() => draftOf(row));
  const [device, setDevice] = useState<Device>("desktop");
  const [advanced, setAdvanced] = useState(false);
  const [picking, setPicking] = useState<null | "main" | "tablet" | "mobile" | "poster">(null);

  const byId = useMemo(() => new Map(library.map((a) => [a.id, a])), [library]);
  const item = (id: string | null) => (id ? byId.get(id) ?? null : null);

  const main = item(draft.mediaId);
  const tablet = item(draft.tabletMediaId);
  const mobile = item(draft.mobileMediaId);
  const poster = item(draft.posterMediaId);

  // What THIS device is served, following the same narrowest-wins order the
  // renderer uses. A device with no override falls through to desktop.
  const shown = device === "mobile" ? (mobile ?? tablet ?? main)
    : device === "tablet" ? (tablet ?? main)
      : main;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(row));

  function save() {
    start(async () => {
      const res = await saveSlotAction({ slotKey: def.key, ...draft });
      if (res.ok) { toast.success(t("common.saved")); router.refresh(); }
      else toast.error(t(`media.err.${res.error}`));
    });
  }

  function restore() {
    start(async () => {
      const res = await clearSlotAction(def.key);
      if (res.ok) {
        setDraft(draftOf(null));
        toast.success(t("media.restored"));
        router.refresh();
      } else toast.error(t("common.error"));
    });
  }

  const kindFilter = draft.mediaType === "video" ? "video" : "image";

  return (
    <div className="panel rounded-2xl p-4 sm:p-5" data-slot-editor={def.key}>
      {/* ── WHAT THIS IS ────────────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-[13.5px] font-semibold">{t(def.labelKey)}</h4>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">
            {main
              ? t("media.slotFilledHint")
              : t("media.fallbackLabel", { what: t(def.fallbackKey) })}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-sunken px-2 py-0.5 font-mono text-[10px] text-faint">
          {def.ratio}
        </span>
      </div>

      {/* ── PREVIEW ─────────────────────────────────────────────────────── */}
      <div className="mb-4">
        <div className="mb-2 flex rounded-lg bg-sunken/80 p-1" role="group"
          aria-label={t("media.previewDevice")}>
          {([
            ["desktop", Monitor],
            ["tablet", Tablet],
            ["mobile", Smartphone],
          ] as const).map(([key, Icon]) => (
            <button key={key} type="button" onClick={() => setDevice(key)}
              aria-pressed={device === key} data-preview-device={key}
              className={cn(
                // 32px, not the 25 that `Segmented size="sm"` gives: this row
                // is the control an operator taps most on a phone, and a
                // quarter-inch target next to two others is a mis-tap.
                "flex min-h-[32px] flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-[11.5px] font-semibold transition-colors",
                device === key ? "bg-surface text-accent shadow-e1" : "text-muted hover:text-ink",
              )}>
              <Icon size={13} aria-hidden />
              <span className="hidden sm:inline">{t(`media.${key}`)}</span>
            </button>
          ))}
        </div>

        <div className={cn("mx-auto w-full transition-[max-width] duration-200", DEVICE_WIDTH[device])}>
          {/* The CARD, not just the file: picture, title, one muted line —
              the anatomy every tile in the product shares, so an operator
              sees what the customer will see. */}
          <div className="panel overflow-hidden rounded-xl p-2">
            <div className="relative w-full overflow-hidden rounded-lg bg-raised/60"
              style={{ aspectRatio: def.ratio }} data-slot-preview>
              {!shown?.url ? (
                <span className="absolute inset-0 flex items-center justify-center px-3 text-center text-[10.5px] leading-snug text-faint">
                  {t(def.fallbackKey)}
                </span>
              ) : draft.mediaType === "video" ? (
                <video
                  key={`${shown.id}-${draft.muted}-${draft.loop}-${draft.autoplay}`}
                  src={shown.url}
                  poster={poster?.url ?? undefined}
                  autoPlay={draft.autoplay}
                  muted={draft.muted || draft.autoplay}
                  loop={draft.loop}
                  controls={draft.controls}
                  playsInline
                  preload="metadata"
                  aria-hidden
                  className="absolute inset-0 h-full w-full"
                  style={{ objectFit: draft.objectFit, objectPosition: draft.objectPosition }}
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={shown.url} alt="" loading="lazy"
                  className="absolute inset-0 h-full w-full"
                  style={{ objectFit: draft.objectFit, objectPosition: draft.objectPosition }} />
              )}
            </div>
            <p className="mt-1.5 truncate text-[11.5px] font-semibold">{entityName}</p>
            <p className="truncate text-[10.5px] text-muted">{t(def.labelKey)}</p>
          </div>

          {/* Which file the previewed device is actually being served. Without
              this, "why does mobile look the same" has no answer on screen. */}
          <p className="mt-1.5 text-center text-[10.5px] text-faint">
            {device === "desktop" || shown === main
              ? t("media.usesDesktopFile")
              : t("media.usesOwnFile")}
          </p>
        </div>
      </div>

      {/* ── TYPE ────────────────────────────────────────────────────────── */}
      {def.video && (
        <div className="mb-3">
          <Label>{t("common.type")}</Label>
          <Segmented
            size="sm"
            label={t("common.type")}
            value={draft.mediaType}
            onChange={(v) => setDraft((d) => ({
              ...d,
              mediaType: v === "video" ? "video" : "image",
              // The files belong to the old type: a video id in an image slot
              // would render a broken picture. Cleared deliberately rather
              // than silently kept.
              mediaId: null, tabletMediaId: null, mobileMediaId: null,
            }))}
            options={[
              { value: "image", label: t("media.typeImage") },
              { value: "video", label: t("media.typeVideo") },
            ]}
          />
        </div>
      )}

      {/* ── THE FILE ────────────────────────────────────────────────────── */}
      <div className="mb-3">
        <AssetChip item={main} label={t("media.mainFile")}
          onPick={() => setPicking("main")}
          onClear={() => set("mediaId", null)} />
      </div>

      {/* A video with no poster is a black rectangle until it decides to
          start. Said here, where it can be fixed, rather than discovered on
          the dashboard. */}
      {draft.mediaType === "video" && main && !poster && (
        <p className="mb-3 rounded-lg border border-[rgb(var(--caution)/0.4)] bg-[rgb(var(--caution)/0.08)] px-3 py-2 text-[11.5px] text-muted">
          {t("media.posterMissing")}
        </p>
      )}

      <div className="mb-3">
        <Label htmlFor={`alt-${def.key}`}>{t("cms.label.alt")}</Label>
        <Input id={`alt-${def.key}`} value={draft.altText} maxLength={300}
          placeholder={t("media.altPlaceholder")}
          onChange={(e) => set("altText", e.target.value)} />
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">{t("media.altHint")}</p>
      </div>

      {/* ── ADVANCED ────────────────────────────────────────────────────── */}
      <button type="button" onClick={() => setAdvanced(!advanced)}
        aria-expanded={advanced}
        className="flex w-full items-center gap-1.5 rounded-lg py-2 text-[12px] font-semibold text-muted transition-colors hover:text-ink">
        <ChevronDown size={14} aria-hidden
          className={cn("transition-transform", advanced && "rotate-180")} />
        {t("media.advanced")}
      </button>

      {advanced && (
        <div className="space-y-4 border-t border-line pt-4">
          {/* FIT + POSITION */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>{t("media.fit")}</Label>
              <Segmented size="sm" label={t("media.fit")} value={draft.objectFit}
                onChange={(v) => set("objectFit", v === "contain" ? "contain" : "cover")}
                options={[
                  { value: "cover", label: t("media.fitCover") },
                  { value: "contain", label: t("media.fitContain") },
                ]} />
            </div>
            <div>
              <Label hint={t("media.positionHint")}>{t("media.position")}</Label>
              <div className="grid w-[7.5rem] grid-cols-3 gap-1" role="group"
                aria-label={t("media.position")}>
                {OBJECT_POSITIONS.map((p) => (
                  <button key={p} type="button" onClick={() => set("objectPosition", p)}
                    aria-pressed={draft.objectPosition === p}
                    aria-label={t(`media.pos.${p.replace(" ", "-")}`)}
                    data-position={p}
                    className={cn(
                      "h-8 rounded-md border transition-colors",
                      draft.objectPosition === p
                        ? "border-accent bg-accent-soft"
                        : "border-line bg-sunken/60 hover:border-[rgb(var(--accent)/0.45)]",
                    )}>
                    <span aria-hidden className={cn("mx-auto block h-1.5 w-1.5 rounded-full",
                      draft.objectPosition === p ? "bg-accent" : "bg-[rgb(var(--faint)/0.5)]")} />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* RESPONSIVE OVERRIDES — optional, and named as optional. */}
          <div>
            <Label hint={t("media.overrideHint")}>{t("media.overrides")}</Label>
            <div className="space-y-2">
              <AssetChip item={tablet} label={t("media.tablet")}
                onPick={() => setPicking("tablet")}
                onClear={() => set("tabletMediaId", null)} />
              <AssetChip item={mobile} label={t("media.mobile")}
                onPick={() => setPicking("mobile")}
                onClear={() => set("mobileMediaId", null)} />
            </div>
          </div>

          {/* VIDEO BEHAVIOUR */}
          {draft.mediaType === "video" && (
            <div>
              <Label>{t("media.videoOptions")}</Label>
              <div className="mb-2">
                <AssetChip item={poster} label={t("media.posterLabel")}
                  onPick={() => setPicking("poster")}
                  onClear={() => set("posterMediaId", null)} />
              </div>
              <div className="space-y-2.5 rounded-xl border border-line bg-sunken/40 p-3">
                {([
                  ["autoplay", draft.autoplay],
                  ["muted", draft.muted],
                  ["loop", draft.loop],
                  ["controls", draft.controls],
                ] as const).map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between gap-3">
                    <span className="text-[12.5px]">{t(`media.${key}`)}</span>
                    <Switch checked={value} label={t(`media.${key}`)}
                      onChange={(next) => set(key, next)} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* OFF WITHOUT LOSING THE SETUP */}
          <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-sunken/40 p-3">
            <div className="min-w-0">
              <p className="text-[12.5px] font-medium">{t("media.enabled")}</p>
              <p className="text-[11px] leading-relaxed text-muted">{t("media.enabledHint")}</p>
            </div>
            <Switch checked={draft.enabled} label={t("media.enabled")}
              onChange={(v) => set("enabled", v)} />
          </div>
        </div>
      )}

      {/* ── SAVE ────────────────────────────────────────────────────────── */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <Button size="sm" disabled={pending || !dirty} onClick={save} data-slot-save>
          {t("common.save")}
        </Button>
        {row && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={restore}
            data-slot-restore>
            <RotateCcw size={13} aria-hidden />
            {t("media.restore")}
          </Button>
        )}
        {dirty && <span className="text-[11.5px] text-faint">{t("media.unsaved")}</span>}
      </div>

      <AssetPicker
        open={picking !== null}
        onClose={() => setPicking(null)}
        title={t("media.pickTitle")}
        library={library}
        // A poster is a still frame of a clip, so it is an image even when the
        // slot holds a video.
        kind={picking === "poster" ? "image" : kindFilter}
        onPick={(a) => {
          if (picking === "main") set("mediaId", a.id);
          else if (picking === "tablet") set("tabletMediaId", a.id);
          else if (picking === "mobile") set("mobileMediaId", a.id);
          else if (picking === "poster") set("posterMediaId", a.id);
        }}
      />
    </div>
  );
}
