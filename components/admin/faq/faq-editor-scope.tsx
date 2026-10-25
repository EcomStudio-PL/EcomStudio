import { getScopedDictionary } from "@/lib/i18n/server";
import { I18nScope } from "@/lib/i18n/provider";
import type { FaqEditorData } from "@/app/actions/faq";
import { FaqManager } from "./faq-manager";

/**
 * The FAQ editor in the admin panel (Strony WWW → FAQ). Its words live in the
 * visual editor's namespace — the same component is the "FAQ" panel of
 * "Edytuj stronę" — so, like components/ice/ice-gate.tsx, it asks for the
 * `ice` scope itself instead of shipping it with every admin page.
 */
export async function FaqEditorScope({ initial }: { initial: FaqEditorData }) {
  const { dict } = await getScopedDictionary("ice");
  return (
    <I18nScope dict={dict}>
      <FaqManager initial={initial} />
    </I18nScope>
  );
}
