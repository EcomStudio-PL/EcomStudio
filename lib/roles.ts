/** Shared role presentation. The DB enum currently holds user/admin;
 *  "caretaker" is reserved for the upcoming operator role so UI code is
 *  ready when the backend ships it. Never hardcode role labels in
 *  components — read them from here. */

export type AppRole = "user" | "caretaker" | "admin";

export const ROLE_PRESENTATION: Record<AppRole, { labelKey: string; badgeClass: string }> = {
  user: { labelKey: "roles.user", badgeClass: "bg-accent-soft text-accent" },
  caretaker: { labelKey: "roles.caretaker", badgeClass: "bg-accent2-soft text-accent2" },
  admin: { labelKey: "roles.admin", badgeClass: "bg-accent2-soft text-accent2" },
};

export function rolePresentation(role: string | null | undefined) {
  return ROLE_PRESENTATION[(role as AppRole) ?? "user"] ?? ROLE_PRESENTATION.user;
}
