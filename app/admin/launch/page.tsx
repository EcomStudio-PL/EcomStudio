import { redirect } from "next/navigation";

/** The launch page is now an ordinary page in the CMS; its editor is the same
 *  editor every other page uses. Old links land on it directly. */
export default function AdminLaunchRedirect() {
  redirect("/admin/www/premiera");
}
