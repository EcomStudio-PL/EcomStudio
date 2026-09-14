"use client";
import { useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { MessageSquarePlus } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { toast } from "@/lib/notify";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Label, Select, Textarea } from "@/components/ui/input";
import { submitFeedbackAction } from "@/app/actions/support";

/**
 * "Something not working, or got an idea?" — the end of every customer screen.
 *
 * WHY IT IS NOT A FLOATING BUTTON. A bubble pinned to the corner is in the way
 * for the whole session to be useful for the few seconds somebody actually
 * wants it, and on a phone it lands exactly where the thumb reaches for the
 * navigation. This sits at the BOTTOM OF THE CONTENT instead: invisible while
 * there is still work on the screen, and the first thing under the work once
 * there is not. It asks for attention by being where you end up, not by being
 * loud.
 *
 * So: a hairline, muted text, a ghost button. Nothing here may out-weigh the
 * screen's real action — if this ever reads as the primary call to action on a
 * page, it is wrong.
 *
 * ONE COMPONENT, ONE MOUNT. It is rendered once at the end of the customer
 * layout's <main>, which is why it needs no per-page wiring and cannot drift
 * between screens. That also means it inherits the layout's own bottom padding
 * (`--page-bottom`, derived from the dock height plus the safe area), so the
 * fixed navigation can never cover it.
 */
export function FeedbackCTA() {
  const { t, locale } = useI18n();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("bug");
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();

  const MAX = 1000;

  function close() {
    if (pending) return;
    setOpen(false);
  }

  function submit() {
    const text = message.trim();
    if (!text) return;
    start(async () => {
      const res = await submitFeedbackAction({
        kind,
        message: text,
        // Gathered at SEND time, not on mount: the route is whatever screen the
        // person is reporting about, and on a phone the viewport changes when
        // the keyboard opens. Nothing here identifies the person — who they are
        // is the row's own user_id, which the server fills in from the session.
        context: {
          route: pathname ?? undefined,
          viewport: typeof window !== "undefined"
            ? `${window.innerWidth}×${window.innerHeight}` : undefined,
          agent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
          locale,
        },
      });
      if (!res.ok) {
        toast.error(t("feedback.failed"));
        return;
      }
      toast.success(t("feedback.sent"));
      setMessage("");
      setKind("bug");
      setOpen(false);
    });
  }

  return (
    <>
      {/* The rule is the whole separation: content above, aside below.
          `data-feedback-cta` is the handle globals.css uses to switch this off
          inside the desktop generator frame, which has no bottom of page to
          sit under — see the note on the `.gen-shell` block there. */}
      <div data-feedback-cta className="mt-10 border-t border-line pt-5 sm:mt-12">
        <div className="flex flex-col items-start gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12.5px] leading-snug text-faint">{t("feedback.prompt")}</p>
          <Button size="sm" variant="ghost" onClick={() => setOpen(true)}
            className="shrink-0 border border-line text-muted hover:text-ink">
            <MessageSquarePlus size={14} aria-hidden />
            {t("feedback.cta")}
          </Button>
        </div>
      </div>

      <Modal open={open} onClose={close} title={t("feedback.title")}>
        <div className="space-y-4">
          <div>
            <Label htmlFor="feedback-kind">{t("feedback.type")}</Label>
            <Select id="feedback-kind" value={kind} disabled={pending}
              onChange={(e) => setKind(e.target.value)}>
              <option value="bug">{t("feedback.bug")}</option>
              <option value="change">{t("feedback.change")}</option>
              <option value="feature">{t("feedback.feature")}</option>
              <option value="other">{t("feedback.other")}</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="feedback-message" hint={`${message.length}/${MAX}`}>
              {t("feedback.message")}
            </Label>
            <Textarea id="feedback-message" rows={5} maxLength={MAX} value={message}
              disabled={pending} placeholder={t("feedback.placeholder")}
              onChange={(e) => setMessage(e.target.value)} />
          </div>
          {/* Said plainly rather than buried in a privacy note: the report
              carries the screen it was sent from, and the customer can see that
              before they press send. */}
          <p className="text-[11.5px] leading-snug text-faint">
            {t("feedback.context", { route: pathname ?? "—" })}
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={close} disabled={pending}>
              {t("common.cancel")}
            </Button>
            <Button onClick={submit} disabled={pending || message.trim().length === 0}>
              {pending ? t("feedback.sending") : t("feedback.send")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
