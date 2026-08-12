"use client";
import { useActionState, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/provider";
import { createClient } from "@/lib/supabase/client";
import { saveBillingProfileAction, saveWorkspaceBrandingAction } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/form-status";

type Billing = {
  company_name: string | null; vat_id: string | null; regon: string | null; address_line: string | null;
  postal_code: string | null; city: string | null; country: string | null; billing_email: string | null;
  contact_person: string | null; phone: string | null;
} | null;

const FIELDS: { key: string; labelKey: string; type?: string }[] = [
  { key: "company_name", labelKey: "company.name" },
  { key: "vat_id", labelKey: "company.vat" },
  { key: "regon", labelKey: "company.regon" },
  { key: "address_line", labelKey: "company.address" },
  { key: "postal_code", labelKey: "company.postal" },
  { key: "city", labelKey: "company.city" },
  { key: "country", labelKey: "company.country" },
  { key: "billing_email", labelKey: "company.billingEmail", type: "email" },
  { key: "contact_person", labelKey: "company.contact" },
  { key: "phone", labelKey: "company.phone", type: "tel" },
];

export function BillingProfileForm({ workspaceId, billing }: { workspaceId: string; billing: Billing }) {
  const { t } = useI18n();
  const [state, action] = useActionState(saveBillingProfileAction, null);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      {FIELDS.map((f) => (
        <div key={f.key} className={f.key === "address_line" ? "sm:col-span-2" : ""}>
          <Label htmlFor={`b-${f.key}`}>{t(f.labelKey)}</Label>
          <Input id={`b-${f.key}`} name={f.key} type={f.type ?? "text"}
            defaultValue={(billing?.[f.key as keyof NonNullable<Billing>] as string | null) ?? ""} />
        </div>
      ))}
      <div className="sm:col-span-2">
        <SubmitButton pendingLabel={t("common.saving")}>{t("common.save")}</SubmitButton>
        {state?.ok && <span className="ml-3 text-sm text-accent">✓ {t("settings.saved")}</span>}
      </div>
    </form>
  );
}

export function BrandingForm({ workspaceId, logoUrl, brandColor, companyName }: {
  workspaceId: string; logoUrl: string | null; brandColor: string | null; companyName: string | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [logo, setLogo] = useState(logoUrl);
  const [color, setColor] = useState(brandColor ?? "#8B5CF6");
  const [name, setName] = useState(companyName ?? "");
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { toast.error(t("branding.badType")); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error(t("branding.tooLarge")); return; }
    setUploading(true);
    const supabase = createClient();
    const path = `${workspaceId}/logo-${Date.now()}.${file.name.split(".").pop()}`;
    const { error } = await supabase.storage.from("workspace-branding").upload(path, file, { upsert: true });
    if (error) { toast.error(t("common.error")); setUploading(false); return; }
    const { data } = supabase.storage.from("workspace-branding").getPublicUrl(path);
    setLogo(data.publicUrl);
    setUploading(false);
  }

  function save() {
    start(async () => {
      const res = await saveWorkspaceBrandingAction({
        workspaceId, logoUrl: logo, brandColor: color, companyName: name || null,
      });
      if (res.ok) { toast.success(t("settings.saved")); router.refresh(); }
      else toast.error(t("common.error"));
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-line bg-raised">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" className="h-full w-full object-contain" />
          ) : (
            <span className="text-xs text-faint">{t("branding.noLogo")}</span>
          )}
        </div>
        <div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <Button size="sm" variant="secondary" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? t("common.loading") : t("branding.upload")}
          </Button>
          {logo && (
            <Button size="sm" variant="ghost" className="ml-2" onClick={() => setLogo(null)}>{t("common.delete")}</Button>
          )}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label>{t("company.name")}</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label>{t("branding.color")}</Label>
          <div className="flex items-center gap-2">
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
              className="h-10 w-14 cursor-pointer rounded-lg border border-line bg-surface" />
            <Input value={color} onChange={(e) => setColor(e.target.value)} className="font-mono text-xs" />
          </div>
        </div>
      </div>
      <Button disabled={pending} onClick={save}>{t("common.save")}</Button>
    </div>
  );
}
