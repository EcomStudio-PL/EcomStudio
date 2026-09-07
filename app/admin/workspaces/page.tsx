import { redirect } from "next/navigation";

/**
 * Workspaces moved into /admin/users.
 *
 * The screen is gone, the route is not: a bookmark, a Telegram deep link or a
 * link in an old e-mail must land somewhere useful rather than on a 404. This
 * file exists purely so those keep working.
 */
export default function Moved() {
  redirect("/admin/users");
}
