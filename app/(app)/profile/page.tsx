import { redirect } from "next/navigation";

/**
 * /profile is not a second screen: the profile is the first tab of the
 * account settings. It lives in the (app) group beside /settings, and the
 * middleware (PROTECTED_PREFIXES) turns a visitor away before it runs.
 */
export default function ProfilePage() {
  redirect("/settings?tab=profile");
}
