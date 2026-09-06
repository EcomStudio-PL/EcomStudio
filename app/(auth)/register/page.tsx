import { redirect } from "next/navigation";
import { authModalUrl } from "@/lib/auth-routes";

export const dynamic = "force-dynamic";

/** Registration moved into the auth dialog; the route forwards rather than
 *  404s, because campaigns, e-mails and the admin's own links point here. */
export default async function RegisterPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(authModalUrl("register", await searchParams));
}
