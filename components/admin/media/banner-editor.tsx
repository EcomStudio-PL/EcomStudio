"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { LOCALES } from "@/lib/i18n/config";
import { saveBannerAction } from "@/app/actions/media-slots";
import { bannerSlotDef } from "@/lib/media-slots";
import type { BannerRow, LibraryItem, SlotRow } from "@/lib/services/media-slots";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Switch } from "@/components/ui/record";
import { cn } from "@/lib/utils";
import { SlotEditor } from "./slot-editor";

/**
 * BANNERS — the one thing on this screen that is more than a picture.
 *
 * A slot has a file and a crop. A banner also has a headline, a destination, a
 * schedule and an order, which is why it is a row of its own. Its PICTURE is
 * still an ordinary media slot (`banner.<key>.media`), so there is one uploader
 * and one library here as everywhere else — the banner editor adds the fields a
 * slot does not have and borrows the rest.
 *
 * THE SCHEDULE IS THE FEATURE. "Active" plus a window means a campaign can be
 * prepared on Tuesday and appear on Friday without anybody being at a keyboard
 * on Friday, and disappear on its own afterwards. The database enforces the
 * window on read, so an expired banner is not something the application has to
 * remember to filter out.
 */

const PLACEMENTS = ["dashboard", "tools", "library", "generator"] as const;

type Draft = {
  bannerKey: string;
  placement: string;
  label: Record<string, string>;
  body: Record<string, string>;
  ctaLabel: Record<string, string>;
  ctaUrl: string;
  active: boolean;
  startsAt: string;
  endsAt: string;
  sortOrder: number;
};

const toDraft = (b: BannerRow): Draft => ({
  bannerKey: b.bannerKey,
  placement: b.placement,
  label: { ...b.label },
  body: { ...b.body },
  ctaLabel: { ...b.ctaLabel },
  ctaUrl: b.ctaUrl ?? "",
  active: b.active,
  // `datetime-local` wants "YYYY-MM-DDTHH:mm" and nothing else.
  startsAt: localInput(b.startsAt),
  endsAt: localInput(b.endsAt),
  sortOrder: b.sortOrder,
});

function localInput(iso: string | null): string {
  return iso ? iso.slice(0, 16) : "";
}

export function BannerEditor({ banners, slotRows, library }: {
  banners: BannerRow[];
  /** The `banner.<key>.media` rows, keyed by slot key. */
  slotRows: Record<string, SlotRow | null>;
  library: LibraryItem[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [pending, start] = useTransition();

  function create() {
    const key = newKey.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
    if (key.length < 3) { toast.error(t("media.err.bannerKey")); return; }
    if (banners.some((b) => b.bannerKey === key)) { toast.error(t("media.err.bannerExists")); return; }
    start(async () => {
      const res = await saveBannerAction({
        bannerKey: key, placement: "dashboard",
        label: {}, body: {}, ctaLabel: {}, ctaUrl: "",
        // A new banner is off. Nobody wants an empty promo appearing on the
        // dashboard the instant it is created.
        active: false, startsAt: null, endsAt: null,
        sortOrder: (banners.at(-1)?.sortOrder ?? 90) + 10,
      });
      if (res.ok) { setCreating(false); setNewKey(""); router.refresh(); }
      else toast.error(t(`media.err.${res.error}`));
    });
  }

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus size={14} aria-hidden />
          {t("media.banners.new")}
        </Button>
      </div>

      {banners.length === 0 ? (
        <p className="panel rounded-2xl px-4 py-10 text-center text-[13px] text-muted">
          {t("media.banners.empty")}
        </p>
      ) : (
        <ul className="space-y-3">
          {banners.map((b) => (
            <li key={b.bannerKey}>
              <BannerCard banner={b} library={library}
                slotRow={slotRows[b.slotKey] ?? null} />
            </li>
          ))}
        </ul>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title={t("media.banners.new")}>
        <div className="space-y-4">
          <div>
            <Label htmlFor="banner-key" hint={t("media.banners.keyHint")}>
              {t("media.banners.key")}
            </Label>
            <Input id="banner-key" value={newKey} placeholder="dashboard.blackfriday"
              onChange={(e) => setNewKey(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreating(false)}>{t("common.cancel")}</Button>
            <Button disabled={pending} onClick={create}>{t("common.create")}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function BannerCard({ banner, slotRow, library }: {
  banner: BannerRow;
  slotRow: SlotRow | null;
  library: LibraryItem[];
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => toDraft(banner));
  const [lang, setLang] = useState<string>(locale);
  const [pending, start] = useTransition();

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const setText = (field: "label" | "body" | "ctaLabel", value: string) =>
    setDraft((d) => ({ ...d, [field]: { ...d[field], [lang]: value } }));

  function save() {
    start(async () => {
      const res = await saveBannerAction({
        ...draft,
        startsAt: draft.startsAt ? new Date(draft.startsAt).toISOString() : null,
        endsAt: draft.endsAt ? new Date(draft.endsAt).toISOString() : null,
      });
      if (res.ok) { toast.success(t("common.saved")); router.refresh(); }
      else toast.error(t(`media.err.${res.error}`));
    });
  }

  return (
    <div className="panel rounded-2xl p-4 sm:p-5" data-banner={banner.bannerKey}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-semibold">
            {draft.label[locale] || draft.label.pl || banner.bannerKey}
          </p>
          <p className="truncate font-mono text-[10.5px] text-faint">{banner.bannerKey}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn("text-[11.5px] font-semibold",
            draft.active ? "text-accent" : "text-faint")}>
            {t(draft.active ? "media.banners.on" : "media.banners.off")}
          </span>
          <Switch checked={draft.active} label={t("media.banners.active")}
            onChange={(v) => set("active", v)} />
        </div>
      </div>

      {/* ── TEXT, PER LANGUAGE ──────────────────────────────────────────── */}
      <div className="mb-3 flex gap-1">
        {LOCALES.map((l) => (
          <button key={l} type="button" onClick={() => setLang(l)}
            aria-pressed={lang === l} data-banner-lang={l}
            className={cn("rounded-md px-2.5 py-1 text-[11px] font-semibold uppercase transition-colors",
              lang === l ? "bg-raised text-ink" : "text-faint hover:text-ink")}>
            {l}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`bl-${banner.bannerKey}`}>{t("media.banners.label")}</Label>
          <Input id={`bl-${banner.bannerKey}`} value={draft.label[lang] ?? ""}
            onChange={(e) => setText("label", e.target.value)} />
        </div>
        <div>
          <Label htmlFor={`bb-${banner.bannerKey}`}>{t("media.banners.body")}</Label>
          <Input id={`bb-${banner.bannerKey}`} value={draft.body[lang] ?? ""}
            onChange={(e) => setText("body", e.target.value)} />
        </div>
        <div>
          <Label htmlFor={`bc-${banner.bannerKey}`}>{t("media.banners.ctaLabel")}</Label>
          <Input id={`bc-${banner.bannerKey}`} value={draft.ctaLabel[lang] ?? ""}
            onChange={(e) => setText("ctaLabel", e.target.value)} />
        </div>
        <div>
          <Label htmlFor={`bu-${banner.bannerKey}`} hint={t("media.banners.ctaUrlHint")}>
            {t("media.banners.ctaUrl")}
          </Label>
          <Input id={`bu-${banner.bannerKey}`} value={draft.ctaUrl} placeholder="/tools"
            onChange={(e) => set("ctaUrl", e.target.value)} />
        </div>
      </div>

      {/* ── WHERE AND WHEN ──────────────────────────────────────────────── */}
      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        <div>
          <Label htmlFor={`bp-${banner.bannerKey}`}>{t("media.banners.placement")}</Label>
          <Select id={`bp-${banner.bannerKey}`} value={draft.placement}
            onChange={(e) => set("placement", e.target.value)}>
            {PLACEMENTS.map((p) => (
              <option key={p} value={p}>{t(`media.banners.place.${p}`)}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor={`bs-${banner.bannerKey}`}>{t("media.banners.from")}</Label>
          <Input id={`bs-${banner.bannerKey}`} type="datetime-local" value={draft.startsAt}
            onChange={(e) => set("startsAt", e.target.value)} />
        </div>
        <div>
          <Label htmlFor={`be-${banner.bannerKey}`}>{t("media.banners.to")}</Label>
          <Input id={`be-${banner.bannerKey}`} type="datetime-local" value={draft.endsAt}
            onChange={(e) => set("endsAt", e.target.value)} />
        </div>
        <div>
          <Label htmlFor={`bo-${banner.bannerKey}`}>{t("media.banners.order")}</Label>
          <Input id={`bo-${banner.bannerKey}`} type="number" value={draft.sortOrder}
            onChange={(e) => set("sortOrder", Number(e.target.value))} />
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <Button size="sm" disabled={pending} onClick={save}>{t("common.save")}</Button>
      </div>

      {/* ── THE PICTURE, THROUGH THE SAME SLOT EDITOR AS EVERYTHING ELSE ── */}
      <div className="mt-4 border-t border-line pt-4">
        <SlotEditor
          def={bannerSlotDef(banner.bannerKey)}
          row={slotRow}
          library={library}
          entityName={draft.label[locale] || draft.label.pl || banner.bannerKey}
        />
      </div>
    </div>
  );
}
