import { redirect } from "next/navigation";
import { authModalUrl } from "@/lib/auth-routes";

export const dynamic = "force-dynamic";

/** Password recovery moved into the auth dialog; the old route forwards. */
export default async function ForgotPasswordPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(authModalUrl("forgot", await searchParams));
}
