"use client";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * Password input with show/hide and a Caps Lock hint.
 *
 * The toggle is a real button with an accessible label; the Caps Lock state
 * comes from the keyboard event's own modifier flag, so it costs nothing and
 * needs no permissions. Both password fields on a form share this component,
 * so the behavior can never diverge between them.
 */
export function PasswordField({ id, name, autoComplete, value, onChange, invalid, minLength }: {
  id: string;
  name: string;
  autoComplete: "current-password" | "new-password";
  value?: string;
  onChange?: (v: string) => void;
  invalid?: boolean;
  minLength?: number;
}) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const [caps, setCaps] = useState(false);
  return (
    <div>
      <div className="relative">
        <Input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          required
          minLength={minLength}
          autoComplete={autoComplete}
          value={value}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          onKeyDown={(e) => setCaps(e.getModifierState?.("CapsLock") ?? false)}
          onKeyUp={(e) => setCaps(e.getModifierState?.("CapsLock") ?? false)}
          onBlur={() => setCaps(false)}
          aria-invalid={invalid || undefined}
          className={cn("pr-12", invalid && "border-[rgb(var(--danger)/0.6)]")}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t("auth.hidePassword") : t("auth.showPassword")}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-faint transition-colors duration-150 hover:text-ink"
        >
          {visible ? <EyeOff size={17} aria-hidden /> : <Eye size={17} aria-hidden />}
        </button>
      </div>
      {caps && (
        <p className="mt-1.5 text-[11.5px] font-medium text-warning" role="status">
          {t("auth.capsLock")}
        </p>
      )}
    </div>
  );
}
