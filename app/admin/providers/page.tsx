import { redirect } from "next/navigation";

/** Dostawcy AI moved into Modele, API i koszty → Dostawcy. */
export default function Moved() {
  redirect("/admin/ai/modele?tab=dostawcy");
}
