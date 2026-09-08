import { redirect } from "next/navigation";

/**
 * AI Engine moved into the control centre: /admin/ai/wiedza.
 *
 * The screen is gone from the menu, the route is not: a bookmark or a link in
 * an old note must land on the page that now does the job rather than a 404.
 */
export default function Moved() {
  redirect("/admin/ai/wiedza");
}
