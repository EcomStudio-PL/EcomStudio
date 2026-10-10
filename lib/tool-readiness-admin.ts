/**
 * WHY A PUBLISHED TOOL CANNOT RUN — the operator's half of lib/tool-readiness.
 *
 * Kept out of that module on purpose: the customer catalogue imports it, and
 * the i18n scope manifest follows imports, so admin copy named here would ship
 * the whole `aicc` namespace to every signed-in page. Only the admin panel
 * (Narzędzia i silniki, a tool's own page) imports this one. Pure — no
 * server-only code — so both a server page and a client component can use it.
 */

/**
 * WHY A PUBLISHED TOOL CANNOT RUN, for the operator — never shown to a
 * customer. "ready" is the only state in which an Aktywny tool also works.
 */
export type ToolReadinessState =
  | "ready"
  | "no_key"
  | "provider_inactive"
  | "key_pending"
  | "sandbox"
  | "service_disabled"
  | "service_maintenance";

export type ToolReadiness = {
  state: ToolReadinessState;
  /** The vendor the tool is pinned to, when it is (Photoroom for the photo tools). */
  provider: string | null;
  /** That vendor's switch on the Dostawcy tab; null when the tool is not pinned. */
  providerActive: boolean | null;
};

/** A tool that cannot run right now, whatever its status says. */
export function notReady(readiness: ToolReadiness | null | undefined): readiness is ToolReadiness {
  return Boolean(readiness && readiness.state !== "ready");
}

/** The real cause, in the operator's words: no key, provider off, test key, service switch. */
export function readinessCause(
  readiness: ToolReadiness, t: (key: string, values?: Record<string, string | number>) => string,
): string {
  const provider = readiness.provider ?? "";
  if (readiness.state === "no_key") {
    const base = provider ? t("aicc.panel.readiness.cause.no_key", { provider }) : t("aicc.panel.readiness.cause.no_key_any");
    return readiness.providerActive === false ? `${base}${t("aicc.panel.readiness.alsoInactive")}` : base;
  }
  return t(`aicc.panel.readiness.cause.${readiness.state}`, { provider });
}
