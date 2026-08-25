import { redirect } from "next/navigation";

/** History is a tab inside the Library now (UX spec §6) — same data set,
 *  one destination. Old links keep working. */
export default function HistoryRedirect() {
  redirect("/library?tab=history");
}
