import { redirect } from "next/navigation";

/** The old Pulpit. The UX spec replaces it with the homepage — the route
 *  stays for old links, bookmarks and the PWA start_url, and just forwards. */
export default function DashboardRedirect() {
  redirect("/home");
}
