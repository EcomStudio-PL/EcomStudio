"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLink, Image as ImageIcon, Trash2, Upload } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { createClient } from "@/lib/supabase/client";
import { saveLaunchDraftAction, publishLaunchAction } from "@/app/actions/launch";
import { saveMediaAssetAction } from "@/app/actions/admin-b2b";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Textarea, Label, Select } from "@/components/ui/input";
import type { LaunchField } from "@/lib/server/launch-page";

/**
 * STRONA PREMIERY — the copy desk for the pre-launch page.
 *
 * Every field is optional. The placeholder shows the shipped translation for
 * the chosen language, so an empty box is not a hole in the page — it is "use
 * the translated line", and clearing a field is a real reset. What the admin
 * types is a draft; the live page changes only on "Opublikuj".
 */

type Section = { key: string; titleKey: string; fields: LaunchField[]; long?: LaunchField[] };

const SECTIONS: Section[] = [
  {
    key: "hero", titleKey: "launchAdmin.secHero",
    fields: ["hero.badge", "hero.h1", "hero.sub", "hero.placeholder", "hero.cta", "hero.note",
      "hero.trust", "hero.consent"],
    long: ["hero.sub", "hero.consent"],
  },
  {
    key: "value", titleKey: "launchAdmin.secValue",
    fields: ["value.heading", "value.t1", "value.b1", "value.t2", "value.b2", "value.t3", "value.b3"],
    long: ["value.b1", "value.b2", "value.b3"],
  },
  {
    key: "how", titleKey: "launchAdmin.secHow",
    fields: ["how.heading", "how.s1", "how.s2", "how.s3"],
  },
  {
    key: "final", titleKey: "launchAdmin.secFinal",
    fields: ["final.heading", "final.body", "final.cta"],
    long: ["final.body"],
  },
  {
    key: "seo", titleKey: "launchAdmin.secSeo",
    fields: ["seo.title", "seo.description", "seo.ogTitle", "seo.ogDescription"],
    long: ["seo.description", "seo.ogDescription"],
  },
];

export type LaunchEditorData = {
  locales: string[];
  /** Saved draft overrides per locale. */
  draft: Record<string, Partial<Record<LaunchField, string>>>;
  /** The shipped translation per locale, used as placeholder and fallback. */
  defaults: Record<string, Record<string, string>>;
};

export function LaunchEditor({ data }: { data: LaunchEditorData }) {
  const { t, locale: uiLocale } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [locale, setLocale] = useState(data.locales.includes(uiLocale) ? uiLocale : data.locales[0]);
  const [drafts, setDrafts] = useState(data.draft);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const values = useMemo(() => drafts[locale] ?? {}, [drafts, locale]);
  const defaults = data.defaults[locale] ?? {};

  const set = (field: LaunchField, value: string) =>
    setDrafts((prev) => ({ ...prev, [locale]: { ...(prev[locale] ?? {}), [field]: value } }));

  function save(then?: () => void) {
    start(async () => {
      const res = await saveLaunchDraftAction(locale, (values ?? {}) as Record<string, string>);
      if (!res.ok) { toast.error(t("common.error")); return; }
      toast.success(t("launchAdmin.draftSaved"));
      router.refresh();
      then?.();
    });
  }

  function publish() {
    start(async () => {
      // Publish always ships what is on screen, so the admin never has to
      // remember to press save first.
      const saved = await saveLaunchDraftAction(locale, (values ?? {}) as Record<string, string>);
      if (!saved.ok) { toast.error(t("common.error")); return; }
      const res = await publishLaunchAction();
      if (res.ok) { toast.success(t("launchAdmin.publishedOk")); router.refresh(); }
      else toast.error(t("common.error"));
    });
  }

  /** The hero visual goes to Supabase Storage and the page stores its URL —
   *  never the bytes, so the settings row stays small and the image is served
   *  by the CDN like every other asset. */
  async function upload(file: File) {
    if (file.size > 10 * 1024 * 1024) { toast.error(t("media.tooLarge")); return; }
    setUploading(true);
    const supabase = createClient();
    const path = `launch/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { error } = await supabase.storage.from("media").upload(path, file, { upsert: false });
    if (error) { setUploading(false); toast.error(t("common.error")); return; }
    const { data: pub } = supabase.storage.from("media").getPublicUrl(path);
    await saveMediaAssetAction({
      kind: "image", storagePath: path, title: file.name, mime: file.type, sizeBytes: file.size,
    });
    set("hero.image", pub.publicUrl);
    setUploading(false);
    toast.success(t("common.save"));
  }

  const heroImage = values["hero.image"] ?? "";

  return (
    <div data-launch-editor className="space-y-5">
      <Card>
        <CardHeader title={t("launchAdmin.localeLabel")} sub={t("launchAdmin.draftHint")} />
        <div className="flex flex-wrap items-end gap-3 p-5 pt-0">
          <div className="w-40">
            <Select value={locale} onChange={(e) => setLocale(e.target.value)} aria-label={t("launchAdmin.localeLabel")}>
              {data.locales.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
            </Select>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => save()}>
              {t("launchAdmin.saveDraft")}
            </Button>
            <Button size="sm" variant="ghost" disabled={pending}
              onClick={() => save(() => window.open("/?preview=waitlist&draft=1", "_blank", "noreferrer"))}>
              {t("launchAdmin.previewDraft")}
              <ExternalLink size={13} aria-hidden />
            </Button>
            <Button size="sm" disabled={pending} onClick={publish} data-launch-publish>
              {t("launchAdmin.publish")}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title={t("launchAdmin.heroImage")} sub={t("launchAdmin.heroImageHint")} />
        <div className="flex flex-col gap-4 p-5 pt-0 sm:flex-row sm:items-start">
          <div className="flex h-32 w-full shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-sunken sm:w-56">
            {heroImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={heroImage} alt="" className="h-full w-full object-cover" />
            ) : (
              <ImageIcon size={22} className="text-faint" aria-hidden />
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-2.5">
            <input ref={fileRef} type="file" className="hidden" accept="image/png,image/jpeg,image/webp,image/avif"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" disabled={uploading} onClick={() => fileRef.current?.click()}>
                <Upload size={14} aria-hidden />
                {uploading ? t("launchAdmin.uploading") : t("launchAdmin.uploadImage")}
              </Button>
              {heroImage && (
                <Button size="sm" variant="ghost" onClick={() => set("hero.image", "")}>
                  <Trash2 size={14} aria-hidden />
                  {t("launchAdmin.removeImage")}
                </Button>
              )}
            </div>
            <Input value={heroImage} onChange={(e) => set("hero.image", e.target.value)}
              placeholder="https://…" aria-label={t("launchAdmin.heroImage")} className="font-mono text-xs" />
          </div>
        </div>
      </Card>

      {SECTIONS.map((section) => (
        <Card key={section.key}>
          <CardHeader title={t(section.titleKey)} />
          <div className="grid gap-4 p-5 pt-0 sm:grid-cols-2">
            {section.fields.map((field) => {
              const long = section.long?.includes(field);
              const id = `launch-${field}`;
              return (
                <div key={field} className={long ? "sm:col-span-2" : undefined}>
                  <Label htmlFor={id} hint={values[field] ? undefined : t("launchAdmin.fromDictionary")}>
                    {t(`launchAdmin.f.${field}`)}
                  </Label>
                  {long ? (
                    <Textarea id={id} rows={2} value={values[field] ?? ""}
                      placeholder={defaults[field] ?? ""}
                      onChange={(e) => set(field, e.target.value)} />
                  ) : (
                    <Input id={id} value={values[field] ?? ""}
                      placeholder={defaults[field] ?? ""}
                      onChange={(e) => set(field, e.target.value)} />
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      ))}

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" disabled={pending} onClick={() => save()}>{t("launchAdmin.saveDraft")}</Button>
        <Button disabled={pending} onClick={publish}>{t("launchAdmin.publish")}</Button>
      </div>
    </div>
  );
}
