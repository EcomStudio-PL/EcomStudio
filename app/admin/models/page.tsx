import { redirect } from "next/navigation";

/** Modele AI moved into Modele, API i koszty → Modele. */
export default function Moved() {
  redirect("/admin/ai/modele?tab=modele");
}
