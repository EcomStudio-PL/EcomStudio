"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/provider";
import { saveRegistrationConfigAction } from "@/app/actions/registration";
import { Card, CardHeader } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import type {
  FieldMode, RegistrationConfig, RegistrationFields, WaitlistFieldConfig,
} from "@/lib/server/registration-config";

/**
 * WHICH FIELDS THE TWO SIGNUP FORMS ASK FOR.
 *
 * One row per field, one segmented control per row: an admin reads the whole
 * decision as a table rather than as seven separate settings. Picking a mode
 * saves immediately — the same choice-is-the-save behaviour the homepage
 * switch already has — so there is never an unsaved change to lose by leaving
 * the page. A refused save puts the previous mode back, because a control that
 * shows a choice the server did not accept is worse than no control.
 *
 * The action rewrites the whole row, so both cards are sent on every save;
 * only the group the admin touched can differ from what is stored.
 */

const MODE_OPTIONS: readonly { value: FieldMode; labelKey: string }[] = [
  { value: "hidden", labelKey: "reg.mHidden" },
  { value: "optional", labelKey: "reg.mOptional" },
  { value: "required", labelKey: "reg.mRequired" },
];

const SIGNUP_ROWS: readonly { field: keyof RegistrationConfig; labelKey: string }[] = [
  { field: "firstName", labelKey: "reg.fFirstName" },
  { field: "lastName", labelKey: "reg.fLastName" },
  { field: "phone", labelKey: "reg.fPhone" },
  { field: "acquisition", labelKey: "reg.fAcquisition" },
];

/** The landing form asks for less: no acquisition question on a page whose
 *  whole job is collecting one address. */
const WAITLIST_ROWS: readonly { field: keyof WaitlistFieldConfig; labelKey: string }[] = [
  { field: "firstName", labelKey: "reg.fFirstName" },
  { field: "lastName", labelKey: "reg.fLastName" },
  { field: "phone", labelKey: "reg.fPhone" },
];

/** Segmented speaks plain strings; the options it was handed are the three
 *  modes, so this is a lookup rather than a cast. */
function modeFrom(value: string): FieldMode | null {
  return MODE_OPTIONS.find((o) => o.value === value)?.value ?? null;
}

export function RegistrationSettings({ settings }: { settings: RegistrationFields }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [signup, setSignup] = useState<RegistrationConfig>(settings.signup);
  const [waitlist, setWaitlist] = useState<WaitlistFieldConfig>(settings.waitlist);

  function save(next: RegistrationFields, revert: () => void) {
    start(async () => {
      const res = await saveRegistrationConfigAction(next);
      if (res.ok) { toast.success(t("reg.saved")); router.refresh(); }
      else { revert(); toast.error(t("common.error")); }
    });
  }

  function chooseSignup(field: keyof RegistrationConfig, value: string) {
    const mode = modeFrom(value);
    if (!mode || pending || signup[field] === mode) return;
    const previous = signup;
    const next = { ...signup, [field]: mode };
    setSignup(next);
    save({ signup: next, waitlist }, () => setSignup(previous));
  }

  function chooseWaitlist(field: keyof WaitlistFieldConfig, value: string) {
    const mode = modeFrom(value);
    if (!mode || pending || waitlist[field] === mode) return;
    const previous = waitlist;
    const next = { ...waitlist, [field]: mode };
    setWaitlist(next);
    save({ signup, waitlist: next }, () => setWaitlist(previous));
  }

  const options = MODE_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }));

  /** The one row shape both cards use, so the two lists cannot drift apart. */
  const row = (key: string, labelKey: string, mode: FieldMode, onChange: (value: string) => void) => (
    <div key={key} data-registration-field={key}
      className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="text-[13.5px] font-semibold">{t(labelKey)}</span>
      <Segmented size="sm" className="sm:w-72" label={t(labelKey)}
        options={options} value={mode} onChange={onChange} />
    </div>
  );

  return (
    <div className="space-y-5">
      <Card data-registration-signup>
        <CardHeader title={t("reg.signupFields")} />
        <div className="space-y-4 p-5 pt-0">
          {SIGNUP_ROWS.map((r) => row(r.field, r.labelKey, signup[r.field], (v) => chooseSignup(r.field, v)))}
          {/* Not configurable and never will be: an account needs an address to
              confirm and a password to sign in with. */}
          <p className="text-[11.5px] text-faint">{t("reg.emailAlways")}</p>
        </div>
      </Card>

      <Card data-registration-waitlist>
        <CardHeader title={t("reg.waitlistFields")} />
        <div className="space-y-4 p-5 pt-0">
          {WAITLIST_ROWS.map((r) => row(`wl_${r.field}`, r.labelKey, waitlist[r.field], (v) => chooseWaitlist(r.field, v)))}
        </div>
      </Card>
    </div>
  );
}
