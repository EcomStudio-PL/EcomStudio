"use client";
import { Suspense } from "react";
import { AuthModal } from "@/components/auth/auth-modal";

/**
 * The dialog is mounted once, in the root layout, so `?auth=` opens it over
 * ANY public page — the landing page, a legal document, a CMS page — instead
 * of navigating to a screen of its own.
 *
 * The Suspense boundary is not decoration: useSearchParams opts a subtree into
 * client rendering, and without it every page in the app would be forced out
 * of static generation.
 */
export function AuthModalMount() {
  return (
    <Suspense fallback={null}>
      <AuthModal />
    </Suspense>
  );
}
