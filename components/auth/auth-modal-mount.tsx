"use client";
import { AuthDialogProvider } from "@/components/auth/auth-dialog-context";
import { AuthModal } from "@/components/auth/auth-modal";

/**
 * The dialog is mounted once, in the root layout, so `?auth=` opens it over
 * ANY public page — the landing page, a legal document, a CMS page — instead
 * of navigating to a screen of its own.
 *
 * The provider wraps the whole tree because the links that OPEN the dialog
 * live inside the page, not next to the dialog. There is no Suspense boundary
 * any more: nothing on this path reads useSearchParams(), which is exactly why
 * a click no longer waits for a server render.
 */
export function AuthModalMount({ children }: { children: React.ReactNode }) {
  return (
    <AuthDialogProvider>
      {children}
      <AuthModal />
    </AuthDialogProvider>
  );
}
