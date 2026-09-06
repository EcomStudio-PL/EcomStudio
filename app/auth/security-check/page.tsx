import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { enforceLoginSecurity } from "@/lib/server/login-security";
import { SecurityCheck } from "@/components/auth/security-check";

export const dynamic = "force-dynamic";

/**
 * THE STEP-UP SCREEN.
 *
 * The gate in the two protected layouts sends an unrecognised device here. The
 * page render only checks the two boundary conditions — no session, or already
 * cleared — and hands everything else to a client component, because sending
 * the code and setting the device cookie are writes that only a server ACTION
 * may perform (a server component cannot set cookies).
 *
 * `next` is where to go once verified. It is validated to a same-origin path so
 * the step-up cannot be turned into an open redirect.
 */
export default async function SecurityCheckPage({ searchParams }: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next: nextRaw } = await searchParams;
  const next = nextRaw && nextRaw.startsWith("/") && !nextRaw.startsWith("//") && !nextRaw.includes("\\")
    ? nextRaw
    : "/home";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Already trusted (feature off, or the device is known): nothing to verify.
  const gate = await enforceLoginSecurity(supabase);
  if (gate === null) redirect(next);

  return <SecurityCheck next={next} />;
}
