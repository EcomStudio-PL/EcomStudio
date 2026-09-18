"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "@/lib/notify";
import { useI18n } from "@/lib/i18n/provider";
import { createCampaignAction } from "@/app/actions/newsletter";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

/**
 * "+ NOWA KAMPANIA" — the only interactive control on the campaign register.
 *
 * It is its own module because the list around it renders on the server (see
 * the note at the top of campaign-list.tsx); this is the single piece of that
 * screen that genuinely needs the browser, so it is the single piece that
 * ships to it.
 *
 * IT ASKS FOR A NAME BEFORE IT CREATES ANYTHING. A button that mints
 * "Kampania 4" and drops the operator into an editor looks faster and is not:
 * the name is how a campaign is found again three weeks later, and a list of
 * four numbered drafts is a list nobody can read. `createCampaignAction`
 * refuses an empty name anyway — this form is what turns that refusal into a
 * field the operator can see rather than a toast they have to decode.
 *
 * ONLY TWO KINDS ARE OFFERED, not the three the schema allows. An 'automation'
 * campaign is the body of a rule, and it does nothing at all until an
 * automation points a trigger at it — creating one from here would produce a
 * campaign that can never send and no screen that explains why. Automations
 * are made on the automations screen, where the trigger is made with them.
 *
 * AND IT OPENS WHAT IT CREATED. The draft already carries its first empty
 * message (`createCampaignAction` inserts step 0), so there is a coherent
 * campaign to navigate to and nothing for the operator to do to make it real.
 */
export function NewCampaignButton() {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"one_off" | "sequence">("one_off");

  function create() {
    const trimmed = name.trim();
    if (!trimmed) { toast.error(t("newsletter.err.name")); return; }
    start(async () => {
      const res = await createCampaignAction({ name: trimmed, kind });
      if (!res.ok) { toast.error(t(`newsletter.err.${res.error}`)); return; }
      setOpen(false);
      setName("");
      if (res.data) router.push(`/admin/newsletter/kampanie/${res.data.id}`);
      else router.refresh();
    });
  }

  return (
    <>
      <Button size="sm" data-campaign-new onClick={() => setOpen(true)}>
        <Plus size={14} aria-hidden />{t("newsletter.campaigns.new")}
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title={t("newsletter.campaigns.new")}>
        <div className="space-y-4">
          <div>
            <Label htmlFor="campaign-name">{t("newsletter.campaigns.name")}</Label>
            <Input id="campaign-name" value={name} autoFocus maxLength={160}
              data-campaign-name
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") create(); }} />
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">
              {t("newsletter.campaigns.createHint")}
            </p>
          </div>

          <div>
            <Label htmlFor="campaign-kind">{t("common.type")}</Label>
            <Select id="campaign-kind" value={kind} data-campaign-kind
              onChange={(e) => setKind(e.target.value === "sequence" ? "sequence" : "one_off")}>
              <option value="one_off">{t("newsletter.kind.one_off")}</option>
              <option value="sequence">{t("newsletter.kind.sequence")}</option>
            </Select>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
            <Button disabled={pending || !name.trim()} onClick={create} data-campaign-create>
              {pending && <Loader2 size={14} aria-hidden className="animate-spin" />}
              {t("common.create")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
