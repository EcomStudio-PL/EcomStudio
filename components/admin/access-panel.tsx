"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notify";
import { Loader2, Monitor, Smartphone } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Switch } from "@/components/ui/record";
import { AccessNotice } from "@/components/auth/access-notice";
import { saveAccessConfigAction } from "@/app/actions/access-admin";
import {
  MODE_PRESETS, accessCopyFor, blockedReasonFor, modeOf, signupOpen,
  type AccessCopy, type PlatformAccess, type PlatformMode,
} from "@/lib/platform-access";
import { cn } from "@/lib/utils";

/**
 * DOSTĘP DO PLATFORMY — the pre-launch door.
 *
 * Four switches that are genuinely independent, because the states the
 * business needs are combinations of them: open to everyone, existing
 * customers only, pre-launch with a waiting list, fully closed. The four
 * presets above them are a shortcut, not a fifth setting — picking one writes
 * the same flags an operator could have set by hand, and touching any switch
 * afterwards simply reads as "Własna".
 *
 * Copy is edited here rather than in a second CMS: the same desktop/mobile
 * override pattern the welcome bonus already uses, falling back field by field
 * so nobody types eight sentences twice. The preview is the real customer
 * component, so the words can be changed and the design cannot be broken.
 */

/** ISO instant → the value a datetime-local input wants, in the admin's zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** …and back. The browser parses in ITS zone — the one the admin is thinking
 *  in — and only UTC is ever stored or compared. */
function toIso(local: string): string | null {
  if (!local.trim()) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const MODES: PlatformMode[] = ["open", "existing_only", "prelaunch", "closed"];

export function AccessPanel({ initial }: { initial: PlatformAccess }) {
  const { t } = useI18n();
  const router = useRouter();
  const [cfg, setCfg] = useState<PlatformAccess>(initial);
  const [opensLocal, setOpensLocal] = useState(() => toLocalInput(initial.signupOpensAt));
  const [surface, setSurface] = useState<"desktop" | "mobile">("desktop");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  const patch = (update: Partial<PlatformAccess>) => {
    setCfg((prev) => ({ ...prev, ...update }));
    setDirty(true);
  };
  const patchCopy = (field: keyof AccessCopy, value: string) => {
    const key = surface === "mobile" && cfg.mobileOverride ? "mobileCopy" : "copy";
    setCfg((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
    setDirty(true);
  };

  /** A preset is only a name for the current combination of switches. */
  const mode = modeOf(cfg);
  const applyPreset = (m: PlatformMode) => {
    if (m === "custom") return;
    patch(MODE_PRESETS[m]);
  };

  /** What the customer would actually read on the surface being edited. */
  const editing: AccessCopy = surface === "mobile" && cfg.mobileOverride ? cfg.mobileCopy : cfg.copy;
  const effective = useMemo(
    () => accessCopyFor(cfg, surface === "mobile"),
    [cfg, surface],
  );

  // The live answer, computed exactly the way the dialog computes it — same
  // functions, so the status dots cannot drift from what visitors see.
  const now = new Date(Date.now());
  const scheduled = Boolean(cfg.signupOpensAt) && !signupOpen(cfg, now);
  const loginBlocked = blockedReasonFor(cfg, "login", now);
  const signupBlocked = blockedReasonFor(cfg, "register", now);

  const save = async () => {
    setBusy(true);
    const res = await saveAccessConfigAction({
      allowSignup: cfg.allowSignup,
      allowLogin: cfg.allowLogin,
      showAuthEntry: cfg.showAuthEntry,
      waitlistEnabled: cfg.waitlistEnabled,
      signupOpensAt: toIso(opensLocal),
      copy: cfg.copy,
      mobileOverride: cfg.mobileOverride,
      mobileCopy: cfg.mobileCopy,
    });
    setBusy(false);
    if (res.ok) {
      setDirty(false);
      toast.success(t("acc.saved"));
      router.refresh();
      return;
    }
    toast.error(t(res.error === "date" ? "acc.errDate" : "common.error"));
  };

  return (
    <div className="space-y-4">
      {/* ── STATUS ───────────────────────────────────────────────────────── */}
      <Card className="p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-ink">{t("acc.statusTitle")}</h2>
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <Status label={t("acc.stLogin")} ok={cfg.allowLogin}
            note={cfg.allowLogin ? t("acc.stOpen") : t("acc.stAdminOnly")} />
          <Status label={t("acc.stSignup")} ok={cfg.allowSignup && !scheduled}
            warn={cfg.allowSignup && scheduled}
            note={!cfg.allowSignup ? t("acc.stClosed")
              : scheduled ? t("acc.stScheduled") : t("acc.stOpen")} />
          <Status label={t("acc.stButtons")} ok={cfg.showAuthEntry}
            note={cfg.showAuthEntry ? t("acc.stVisible") : t("acc.stHidden")} />
          <Status label={t("acc.stWaitlist")} ok={cfg.waitlistEnabled}
            note={cfg.waitlistEnabled ? t("acc.stOn") : t("acc.stOff")} />
        </div>
        {scheduled && cfg.signupOpensAt && (
          <p className="mt-3 text-[12px] text-muted">
            {t("acc.opensAtNote", {
              date: new Date(cfg.signupOpensAt).toLocaleString("pl-PL", {
                dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Warsaw",
              }),
            })}
          </p>
        )}
        {/* Said plainly, because an operator closing login needs to know it
            before they close it — not after they cannot get back in. */}
        <p className="mt-3 rounded-xl bg-raised px-3 py-2.5 text-[12px] leading-relaxed text-muted">
          {t("acc.adminNote")}
        </p>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-4">
          {/* ── MODE ─────────────────────────────────────────────────────── */}
          <Card className="p-4 sm:p-5">
            <h2 className="text-sm font-semibold text-ink">{t("acc.modeTitle")}</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-faint">{t("acc.modeHint")}</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {MODES.map((m) => (
                <button key={m} type="button" onClick={() => applyPreset(m)}
                  aria-pressed={mode === m}
                  className={cn(
                    "rounded-xl border px-3.5 py-3 text-left transition-colors",
                    mode === m
                      ? "border-[rgb(var(--accent)/0.55)] bg-[rgb(var(--accent)/0.10)]"
                      : "border-line hover:bg-raised",
                  )}>
                  <span className="block text-[13.5px] font-semibold text-ink">{t(`acc.mode.${m}`)}</span>
                  <span className="mt-0.5 block text-[11.5px] leading-relaxed text-faint">
                    {t(`acc.modeDesc.${m}`)}
                  </span>
                </button>
              ))}
            </div>
            {mode === "custom" && (
              <p className="mt-2.5 text-[12px] text-muted">{t("acc.modeCustom")}</p>
            )}
          </Card>

          {/* ── SWITCHES ─────────────────────────────────────────────────── */}
          <Card className="p-4 sm:p-5">
            <h2 className="text-sm font-semibold text-ink">{t("acc.switchesTitle")}</h2>
            <div className="mt-3 divide-y divide-line">
              <Row label={t("acc.swSignup")} hint={t("acc.swSignupHint")}
                checked={cfg.allowSignup} onChange={(v) => patch({ allowSignup: v })} />
              <Row label={t("acc.swLogin")} hint={t("acc.swLoginHint")}
                checked={cfg.allowLogin} onChange={(v) => patch({ allowLogin: v })} />
              <Row label={t("acc.swButtons")} hint={t("acc.swButtonsHint")}
                checked={cfg.showAuthEntry} onChange={(v) => patch({ showAuthEntry: v })} />
              <Row label={t("acc.swWaitlist")} hint={t("acc.swWaitlistHint")}
                checked={cfg.waitlistEnabled} onChange={(v) => patch({ waitlistEnabled: v })} />
            </div>

            <div className="mt-4 border-t border-line pt-3.5">
              <Label htmlFor="acc-opens">{t("acc.opensAt")}</Label>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <input id="acc-opens" type="datetime-local" value={opensLocal}
                  onChange={(e) => { setOpensLocal(e.target.value); setDirty(true); }}
                  className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-[rgb(var(--accent)/0.6)]" />
                {opensLocal !== "" && (
                  <Button variant="ghost" size="sm"
                    onClick={() => { setOpensLocal(""); setDirty(true); }}>
                    {t("acc.clearDate")}
                  </Button>
                )}
              </div>
              {/* No cron: the effective answer is computed from the server
                  clock on every request, so the moment simply arrives. */}
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">{t("acc.opensAtHint")}</p>
            </div>
          </Card>

          {/* ── COPY ─────────────────────────────────────────────────────── */}
          <Card className="p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-ink">{t("acc.copyTitle")}</h2>
              <div className="flex rounded-xl border border-line p-0.5">
                {([["desktop", Monitor], ["mobile", Smartphone]] as const).map(([key, Icon]) => (
                  <button key={key} type="button" onClick={() => setSurface(key)}
                    aria-pressed={surface === key}
                    className={cn(
                      "flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold transition-colors",
                      surface === key ? "bg-[rgb(var(--accent)/0.14)] text-ink" : "text-muted hover:text-ink",
                    )}>
                    <Icon size={14} aria-hidden />
                    {t(`onb.${key}`)}
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-faint">{t("acc.copyHint")}</p>

            {surface === "mobile" && (
              <label className="mt-3 flex items-center justify-between gap-4 rounded-xl bg-raised px-3 py-2.5">
                <span className="text-[13px] font-medium text-ink">{t("onb.sameOnMobile")}</span>
                <Switch checked={!cfg.mobileOverride}
                  onChange={(v) => patch({ mobileOverride: !v })} label={t("onb.sameOnMobile")} />
              </label>
            )}

            <div className={cn(
              "mt-4 space-y-4",
              surface === "mobile" && !cfg.mobileOverride && "pointer-events-none opacity-50",
            )}>
              <Group title={t("acc.grpLogin")}>
                <Field label={t("acc.fTitle")} value={editing.loginTitle}
                  onChange={(v) => patchCopy("loginTitle", v)} placeholder={t("access.loginTitle")} />
                <Field label={t("acc.fBody")} value={editing.loginBody}
                  onChange={(v) => patchCopy("loginBody", v)} placeholder={t("access.loginBody")} />
                <Field label={t("acc.fCta")} value={editing.loginCta}
                  onChange={(v) => patchCopy("loginCta", v)} placeholder={t("access.joinWaitlist")} />
              </Group>
              <Group title={t("acc.grpSignup")}>
                <Field label={t("acc.fTitle")} value={editing.signupTitle}
                  onChange={(v) => patchCopy("signupTitle", v)} placeholder={t("access.signupTitle")} />
                <Field label={t("acc.fBody")} value={editing.signupBody}
                  onChange={(v) => patchCopy("signupBody", v)} placeholder={t("access.signupBody")} />
                <Field label={t("acc.fCta")} value={editing.signupCta}
                  onChange={(v) => patchCopy("signupCta", v)} placeholder={t("access.joinWaitlist")} />
              </Group>
              <Group title={t("acc.grpClosed")} hint={t("acc.grpClosedHint")}>
                <Field label={t("acc.fTitle")} value={editing.closedTitle}
                  onChange={(v) => patchCopy("closedTitle", v)} placeholder={t("access.closedTitle")} />
                <Field label={t("acc.fBody")} value={editing.closedBody}
                  onChange={(v) => patchCopy("closedBody", v)} placeholder={t("access.closedBody")} />
              </Group>
            </div>
          </Card>
        </div>

        {/* ── PREVIEW ──────────────────────────────────────────────────────
            The real component the customer sees, so what is previewed is what
            is shipped. Both messages are shown regardless of the switches:
            an operator writing the sign-up copy should not have to close
            sign-ups to read it back. */}
        <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <Card className="overflow-hidden p-0">
            <p className="overline px-4 pb-1 pt-4">{t("acc.previewLogin")}</p>
            <div className={cn("mx-auto w-full px-4 pb-2", surface === "mobile" && "max-w-[340px]")}>
              <div className="rounded-2xl border border-line bg-surface px-3 py-2">
                <AccessNotice reason={loginBlocked ?? "login_closed"} copy={effective}
                  waitlistEnabled={cfg.waitlistEnabled} onWaitlist={() => {}} />
              </div>
            </div>
            <p className="overline px-4 pb-1 pt-3">{t("acc.previewSignup")}</p>
            <div className={cn("mx-auto w-full px-4 pb-4", surface === "mobile" && "max-w-[340px]")}>
              <div className="rounded-2xl border border-line bg-surface px-3 py-2">
                <AccessNotice reason={signupBlocked ?? "signup_closed"} copy={effective}
                  waitlistEnabled={cfg.waitlistEnabled} onWaitlist={() => {}}
                  onSwitchToLogin={cfg.allowLogin ? () => {} : undefined} />
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Sticky on a phone too: the switches are long enough that the save
          button would otherwise sit below three screens of copy fields. */}
      <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-3 border-t border-line bg-bg/90 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border sm:px-4">
        {dirty && <span className="text-[12px] text-muted">{t("acc.unsaved")}</span>}
        <Button onClick={save} disabled={busy || !dirty}>
          {busy && <Loader2 size={15} aria-hidden className="mr-1.5 animate-spin" />}
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}

/** A coloured dot and one word — the state at a glance, per §24. */
function Status({ label, ok, warn, note }: {
  label: string; ok: boolean; warn?: boolean; note: string;
}) {
  return (
    <div className="rounded-xl border border-line px-3 py-2.5">
      <p className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-faint">
        <span aria-hidden className={cn(
          "h-2 w-2 shrink-0 rounded-full",
          warn ? "bg-warning" : ok ? "bg-success" : "bg-danger",
        )} />
        {label}
      </p>
      <p className="mt-1 text-[13.5px] font-semibold text-ink">{note}</p>
    </div>
  );
}

function Row({ label, hint, checked, onChange }: {
  label: string; hint: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <span className="min-w-0">
        <span className="block text-[13.5px] font-medium text-ink">{label}</span>
        <span className="mt-0.5 block text-[11.5px] leading-relaxed text-faint">{hint}</span>
      </span>
      <Switch checked={checked} onChange={onChange} label={label} />
    </label>
  );
}

function Group({ title, hint, children }: {
  title: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line p-3">
      <p className="text-[12px] font-semibold text-muted">{title}</p>
      {hint && <p className="mt-0.5 text-[11.5px] leading-relaxed text-faint">{hint}</p>}
      <div className="mt-2.5 space-y-2.5">{children}</div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} maxLength={400} className="mt-1.5" />
    </div>
  );
}
