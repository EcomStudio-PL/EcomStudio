"use client";
import { Check, Circle } from "lucide-react";
import { PASSWORD_RULES } from "@/lib/auth-validation";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/** Live password-requirement checklist. Each rule flips independently while
 *  typing, so the user always knows exactly what is still missing. */
export function PasswordRules({ password }: { password: string }) {
  const { t } = useI18n();
  return (
    <ul className="mt-2 space-y-1" aria-live="polite">
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
