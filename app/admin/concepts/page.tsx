import { redirect } from "next/navigation";

/** Silnik ujęć is now GrovShot's own history: /admin/ai/prompts?tab=history. */
export default function Moved() {
  redirect("/admin/ai/prompts?tab=history");
}
