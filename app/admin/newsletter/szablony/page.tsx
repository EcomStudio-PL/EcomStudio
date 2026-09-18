import { createClient } from "@/lib/supabase/server";
import { listTemplates } from "@/lib/services/newsletter";
import { TemplateList } from "@/components/admin/newsletter/template-list";

/**
 * SZABLONY.
 *
 * One read, and no second one to make the screen look fuller. If the table is
 * empty the list says so and explains how a template comes into existence
 * ("Zapisz jako szablon" from a finished campaign) instead of seeding examples
 * — a card that names a template nobody can open is a bug an operator finds
 * ten minutes later, at which point every other number on this module is
 * suspect too.
 *
 * THESE ARE NOT THE SYSTEM MESSAGE TEMPLATES. `lib/server/message-templates.ts`
 * owns verification, password resets and security codes; this table owns
 * marketing bodies. Same word, two subsystems, and they are kept apart on
 * purpose: nothing an operator does here can change the wording of a password
 * reset.
 *
 * No PageHeader and no nav: app/admin/newsletter/layout.tsx renders both.
 */
export default async function NewsletterTemplatesPage() {
  const supabase = await createClient();
  const templates = await listTemplates(supabase);

  return <TemplateList templates={templates} />;
}
