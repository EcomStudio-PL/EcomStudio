"use client";
import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/provider";
import { createProductAction, updateProductAction, deleteProductAction } from "@/app/actions/products";
import { Input, Textarea, Select, Label } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/form-status";
import { Button } from "@/components/ui/button";
import type { Tables } from "@/lib/database.types";

const MARKETPLACES = ["allegro", "amazon", "woocommerce", "social", "meta_ads", "other"];
const STATUSES = ["draft", "ready", "processing", "completed", "archived"];

export function ProductForm({ product }: { product?: Tables<"products"> }) {
  const { t } = useI18n();
  const isEdit = !!product;
  const [state, action] = useActionState(isEdit ? updateProductAction : createProductAction, null);

  useEffect(() => {
    if (state?.ok) toast.success(t("products.saved"));
    else if (state?.error) toast.error(t("common.error"));
  }, [state, t]);

  return (
    <form action={action} className="space-y-5">
      {isEdit && <input type="hidden" name="id" value={product.id} />}
      <div>
        <Label htmlFor="name">{t("common.name")} *</Label>
        <Input id="name" name="name" required defaultValue={product?.name} placeholder={t("products.namePh")} />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="category">{t("common.category")}</Label>
          <Input id="category" name="category" defaultValue={product?.category ?? ""} placeholder={t("products.categoryPh")} />
        </div>
        <div>
          <Label htmlFor="marketplace">{t("common.marketplace")}</Label>
          <Select id="marketplace" name="marketplace" defaultValue={product?.marketplace ?? "allegro"}>
            {MARKETPLACES.map((m) => (
              <option key={m} value={m}>{t(`products.mp.${m}`)}</option>
            ))}
          </Select>
        </div>
      </div>
      <div>
        <Label htmlFor="description">{t("common.description")}</Label>
        <Textarea id="description" name="description" defaultValue={product?.description ?? ""} placeholder={t("products.descriptionPh")} />
      </div>
      <div>
        <Label htmlFor="instructions">{t("products.instructions")}</Label>
        <Textarea id="instructions" name="instructions" defaultValue={product?.instructions ?? ""} />
        <p className="mt-1 text-xs text-muted">{t("products.instructionsHint")}</p>
      </div>
      {isEdit && (
        <div>
          <Label htmlFor="status">{t("common.status")}</Label>
          <Select id="status" name="status" defaultValue={product.status}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{t(`products.status.${s}`)}</option>
            ))}
          </Select>
        </div>
      )}
      <div className="flex items-center justify-between pt-2">
        <SubmitButton pendingLabel={t("common.saving")}>{isEdit ? t("common.save") : t("common.create")}</SubmitButton>
        {isEdit && (
          <Button
            type="button" variant="danger" size="sm"
            onClick={() => {
              if (confirm(t("common.confirmDelete"))) void deleteProductAction(product.id);
            }}
          >
            {t("common.delete")}
          </Button>
        )}
      </div>
    </form>
  );
}
