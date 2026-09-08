import { redirect } from "next/navigation";

/** Szablony promptów moved into the control centre: /admin/ai/szablony. */
export default function Moved() {
  redirect("/admin/ai/szablony");
}
