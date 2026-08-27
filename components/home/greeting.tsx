"use client";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { greetingKey } from "@/lib/plan-tone";

/**
 * GREETING — "Dzień dobry, Marcel 👋" rather than "Cześć, instaboy6341!".
 *
 * The hour comes from the VIEWER's clock, which only exists in the browser,
 * so the server renders the neutral welcome and this swaps in the
 * time-aware one after mount. The name is resolved upstream from the
 * profile, never from the email handle when a real name exists.
 */
export function Greeting({ name, fallback }: { name: string; fallback: string }) {
  const { t } = useI18n();
  const [hour, setHour] = useState<number | null>(null);
  useEffect(() => { setHour(new Date().getHours()); }, []);

  if (hour === null) return <>{fallback}</>;
  const key = greetingKey(hour);
  return (
    <>
      {t(`greet.${key}`, { name })}{" "}
      <span aria-hidden>{key === "evening" ? "🌙" : "👋"}</span>
    </>
  );
}
