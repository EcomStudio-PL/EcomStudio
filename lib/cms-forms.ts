/**
 * THE FORMS A CMS SECTION MAY POST TO.
 *
 * There is no PHP here and no "backend code" field, because a CMS that lets an
 * admin type server code is a CMS that lets anyone who reaches the admin panel
 * run anything. What replaces it is this list: a small set of handlers that
 * already exist, are already rate-limited, already captcha-checked and already
 * reviewed — and a form section chooses one of them by NAME.
 *
 * A handler that is not on this list is not a handler. `resolveHandler`
 * returns null for anything unrecognised, and the form renders as disabled
 * rather than posting somewhere unexpected.
 */

export type FormKind = "contact" | "newsletter";

export type FormHandler = {
  key: string;
  kind: FormKind;
  endpoint: string;
  /** Which inputs the form draws. */
  fields: readonly ("name" | "email" | "topic" | "message")[];
};

export const FORM_HANDLERS: readonly FormHandler[] = [
  {
    key: "contact",
    kind: "contact",
    endpoint: "/api/public/contact",
    fields: ["name", "email", "topic", "message"],
  },
  {
    key: "newsletter",
    kind: "newsletter",
    endpoint: "/api/public/newsletter",
    fields: ["email"],
  },
] as const;

export function resolveHandler(key: string | undefined, kind: FormKind): FormHandler | null {
  // An empty value means "the obvious one for this section type", which is
  // what an admin who never opened the dropdown expects.
  const wanted = (key ?? "").trim() || kind;
  const found = FORM_HANDLERS.find((h) => h.key === wanted);
  // A contact section may not quietly become a newsletter signup.
  return found && found.kind === kind ? found : null;
}

/** The contact topics the panel offers. Values are stored, labels come from
 *  the dictionary, so a topic never arrives as free text an operator has to
 *  interpret — and never as something unbounded going into an email subject. */
export const CONTACT_TOPICS = ["sales", "support", "partnership", "press", "other"] as const;
export type ContactTopic = (typeof CONTACT_TOPICS)[number];

export function isContactTopic(value: string): value is ContactTopic {
  return (CONTACT_TOPICS as readonly string[]).includes(value);
}
