import { redirect } from "next/navigation";

/** The homepage switch moved into Strony WWW → Ustawienia globalne. Kept as a
 *  redirect so a bookmark or an old link still lands somewhere useful. */
export default function AdminHomepageRedirect() {
  redirect("/admin/www");
}
