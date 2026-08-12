"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/provider";
import { saveInspirationAction, deleteInspirationAction } from "@/app/actions/admin-b2b";
import { Modal, ConfirmModal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Select, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export type InspirationRow = {
  id?: string; title: string; description: string | null; category: string; use_case: string | null;
  prompt: string; negative_prompt: string | null; model_slug: string | null; format: string | null;
  tags: string[]; premium: boolean; featured: boolean; sort_order: number;
  status: "draft" | "published"; locale: string | null;
  before_url: string | null; after_urls: string[]; video_url: string | null;
};

export const INSPIRATION_CATEGORIES = [
  "lifestyle", "packshot", "ad", "marketplace", "allegro", "amazon", "social",
  "detail", "studio", "fashion", "beauty", "electronics", "home", "kids", "automotive",
];

export function InspirationManager({ items }: { items: InspirationRow[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<InspirationRow | null>(null);
  const [deleting, setDeleting] = useState<InspirationRow | null>(null);
  const [tagsText, setTagsText] = useState("");
  const [aftersText, setAftersText] = useState("");

  const blank: InspirationRow = {
    title: "", description: null, category: "lifestyle", use_case: null, prompt: "",
    negative_prompt: null, model_slug: null, format: "1:1", tags: [], premium: false,
    featured: false, sort_order: items.length, status: "draft", locale: null,
    before_url: null, after_urls: [], video_url: null,
  };
  const open = (r: InspirationRow) => {
    setEditing(r); setTagsText(r.tags.join(", ")); setAftersText(r.after_urls.join("\n"));
  };

  function save(status?: "draft" | "published") {
    if (!editing) return;
    start(async () => {
      const res = await saveInspirationAction({
        ...editing,
        status: status ?? editing.status,
        tags: tagsText.split(",").map((s) => s.trim()).filter(Boolean),
        after_urls: aftersText.split("\n").map((s) => s.trim()).filter(Boolean),
      });
      if (res.ok) { toast.success(t("common.save")); setEditing(null); router.refresh(); }
      else toast.error(res.error === "invalid_url" ? t("media.badUrl") : t("common.error"));
    });
  }

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button size="sm" onClick={() => open(blank)}>+ {t("insp.new")}</Button>
      </div>
      {items.length === 0 ? (
        <div className="panel rounded-2xl p-10 text-center">
          <p className="text-sm font-semibold">{t("insp.emptyAdminTitle")}</p>
          <p className="mt-1 text-sm text-muted">{t("insp.emptyAdminBody")}</p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => open(r)}
                className="panel panel-interactive w-full rounded-2xl p-4 text-left">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold">{r.title}</p>
                  <Badge tone={r.status === "published" ? "green" : "amber"}>
                    {r.status === "published" ? t("cms.published") : t("cms.draft")}
                  </Badge>
                </div>
                <p className="mt-1 truncate text-xs text-muted">{r.prompt}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge tone="indigo">{r.category}</Badge>
                  {r.featured && <Badge tone="blue">★</Badge>}
                  {r.premium && <Badge tone="amber">PREMIUM</Badge>}
                  {r.locale && <Badge tone="neutral">{r.locale.toUpperCase()}</Badge>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? t("common.edit") : t("insp.new")} wide>
        {editing && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>{t("cms.f.title")}</Label>
                <Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
              </div>
              <div>
                <Label>{t("common.category")}</Label>
                <Select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
                  {INSPIRATION_CATEGORIES.map((c) => <option key={c} value={c}>{t(`insp.cat.${c}`)}</option>)}
                </Select>
              </div>
            </div>
            <div>
              <Label>{t("common.description")}</Label>
              <Textarea rows={2} value={editing.description ?? ""}
                onChange={(e) => setEditing({ ...editing, description: e.target.value || null })} />
            </div>
            <div>
              <Label>Prompt</Label>
              <Textarea rows={4} value={editing.prompt} onChange={(e) => setEditing({ ...editing, prompt: e.target.value })} />
            </div>
            <div>
              <Label>Negative prompt</Label>
              <Textarea rows={2} value={editing.negative_prompt ?? ""}
                onChange={(e) => setEditing({ ...editing, negative_prompt: e.target.value || null })} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label>{t("insp.model")}</Label>
                <Input value={editing.model_slug ?? ""} onChange={(e) => setEditing({ ...editing, model_slug: e.target.value || null })} />
              </div>
              <div>
                <Label>Format</Label>
                <Select value={editing.format ?? "1:1"} onChange={(e) => setEditing({ ...editing, format: e.target.value })}>
                  {["1:1", "4:5", "16:9", "9:16"].map((f) => <option key={f}>{f}</option>)}
                </Select>
              </div>
              <div>
                <Label>{t("insp.locale")}</Label>
                <Select value={editing.locale ?? ""} onChange={(e) => setEditing({ ...editing, locale: e.target.value || null })}>
                  <option value="">{t("insp.allLocales")}</option>
                  {["pl", "en", "de"].map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
                </Select>
              </div>
              <div>
                <Label>{t("insp.useCase")}</Label>
                <Input value={editing.use_case ?? ""} onChange={(e) => setEditing({ ...editing, use_case: e.target.value || null })} />
              </div>
              <div>
                <Label>{t("insp.tags")}</Label>
                <Input value={tagsText} onChange={(e) => setTagsText(e.target.value)} />
              </div>
              <div>
                <Label>{t("admin.order")}</Label>
                <Input type="number" value={editing.sort_order}
                  onChange={(e) => setEditing({ ...editing, sort_order: parseInt(e.target.value || "0", 10) })} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>BEFORE URL</Label>
                <Input placeholder="https://…" value={editing.before_url ?? ""}
                  onChange={(e) => setEditing({ ...editing, before_url: e.target.value || null })} />
              </div>
              <div>
                <Label>Video URL</Label>
                <Input placeholder="https://…" value={editing.video_url ?? ""}
                  onChange={(e) => setEditing({ ...editing, video_url: e.target.value || null })} />
              </div>
            </div>
            <div>
              <Label>AFTER URLs ({t("insp.perLine")})</Label>
              <Textarea rows={2} placeholder={"https://…\nhttps://…"} value={aftersText} onChange={(e) => setAftersText(e.target.value)} />
            </div>
            <div className="flex flex-wrap items-center gap-5">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={editing.featured} className="h-4 w-4 accent-[rgb(var(--accent))]"
                  onChange={(e) => setEditing({ ...editing, featured: e.target.checked })} />
                Featured
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={editing.premium} className="h-4 w-4 accent-[rgb(var(--accent2))]"
                  onChange={(e) => setEditing({ ...editing, premium: e.target.checked })} />
                Premium
              </label>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              {editing.id ? (
                <Button variant="danger" size="sm" onClick={() => setDeleting(editing)}>{t("common.delete")}</Button>
              ) : <span />}
              <span className="flex gap-2">
                <Button variant="ghost" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
                <Button variant="secondary" disabled={pending || !editing.title.trim() || !editing.prompt.trim()}
                  onClick={() => save("draft")}>{t("cms.draft")}</Button>
                <Button disabled={pending || !editing.title.trim() || !editing.prompt.trim()}
                  onClick={() => save("published")}>{t("cms.publish")}</Button>
              </span>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmModal open={!!deleting} onClose={() => setDeleting(null)}
        onConfirm={() => { if (deleting?.id) start(async () => {
          const res = await deleteInspirationAction(deleting.id!);
          if (res.ok) { setDeleting(null); setEditing(null); router.refresh(); } else toast.error(t("common.error"));
        }); }}
        title={t("common.delete")} body={t("common.confirmDelete")} confirmLabel={t("common.delete")} danger pending={pending} />
    </div>
  );
}
