import { redirect } from "next/navigation";
import { authModalUrl } from "@/lib/auth-routes";

export const dynamic = "force-dynamic";

/**
 * /login is now an ENTRY POINT, not a screen: signing in happens in the
 * dialog over whatever page the visitor is on. The route stays — old links,
 * bookmarks, installed-PWA shortcuts and the sign-in route's own error
 * bounce all point at it, and none of them may 404 — and forwards to the
 * landing page with the dialog open, carrying `next`, `error` and `email`
 * through untouched.
 */
export default async function LoginPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(authModalUrl("login", await searchParams));
}
