"use client";
import { useEffect } from "react";
import { useAuthDialog, type AuthDialogSeed } from "@/components/auth/auth-dialog-context";

/**
 * Hands the sign-in dialog what the page read for it (see AuthDialogSeed), for
 * as long as the page is on screen. Rendered by GuestShell in the admin's
 * guest preview only; a visitor's dialog asks the server itself, as before.
 */
export function AuthDialogSeeder({ seed }: { seed: AuthDialogSeed }) {
  const { setSeed } = useAuthDialog();
  useEffect(() => {
    setSeed(seed);
    return () => setSeed(null);
  }, [seed, setSeed]);
  return null;
}
