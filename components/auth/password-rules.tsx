"use client";
import { Check, Circle } from "lucide-react";
import { PASSWORD_RULES } from "@/lib/auth-validation";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * Live password-requirement checklist. Each rule flips independently while
 * typing, so the user always knows exactly what is still missing.
 *
 * `inline` lays the same three rules out as one wrapping row instead of a
 * column. Identical information, about 36px less of it — which is the
 * difference between the registration dialog fitting a 360px phone and
 * growing a scrollbar.
 */
export function PasswordRules({ password, inline = false }: {
  password: string;
  inline?: boolean;
}) {
  const { t } = useI18n();
  return (
    <ul className={cn("mt-2", inline ? "flex flex-wrap gap-x-3 gap-y-1" : "space-y-1")}
      aria-live="polite">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(password);
        return (
          <li key={rule.key} className={cn(
            "flex items-center gap-1.5 text-[11.5px] transition-colors duration-150",
            met ? "text-success" : "text-faint",
          )}>
            {met
              ? <Check size={12} strokeWidth={3} aria-hidden />
              : <Circle size={7} className="mx-[2.5px]" aria-hidden />}
            {t(`auth.rule_${rule.key}`)}
          </li>
        );
      })}
    </ul>
  );
}
