import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { PageHeader } from "@/components/ui/page-header";
import { SectionHeader } from "@/components/ui/section-header";
import { RelativeTime } from "@/components/ui/relative-time";
import { CmsNav } from "@/components/admin/cms/cms-nav";
import { IceEditButton, IceFind, type IceFindItem, type IceFindPage } from "@/components/admin/cms/visual-editor";
import { iceAdminOverview, type IceAdminElement, type IceAdminPage } from "@/lib/server/ice/admin";

/**
 * CMS → EDYTOR WIZUALNY — the way into the inline editor from the admin panel.
 *
 * Every page the editor can open, what can be changed on it and when it last
 * was; a search over every element by name, page or the copy it shows now;
 * and, said plainly, the pages it does not cover and why. "Edytuj wizualnie"
 * starts an edit session for that one page and opens it.
 *
 * Server-rendered from plain data (lib/server/ice/admin.ts). The two client
 * pieces get translated strings, never the registry.
 */
export default async function VisualEditorRoute() {
  const supabase = await createClient();
  const [{ dict, locale }, overview] = await Promise.all([getDictionary(), iceAdminOverview(supabase)]);
  const t = makeT(dict);

  const pageName = (p: IceAdminPage): string => {
    if (p.source === "cms") return p.title?.trim() || p.path;
    if (p.type === "tool") return t("iceAdmin.page.tool", { name: p.titleKey ? t(p.titleKey) : p.path, path: p.path });
    return t(`iceAdmin.page.${p.registryKey}`);
  };
  const elementLabel = (e: IceAdminElement): string => {
    const role = t(`iceAdmin.role.${e.role}`);
    return [
      t(`iceAdmin.sec.${e.section}`),
      e.index !== null ? `${role} ${e.index}` : role,
      ...(e.detailKey ? [t(e.detailKey)] : []),
    ].join(" · ");
  };

  const findPages: IceFindPage[] = overview.pages.map((p) => ({ path: p.path, name: pageName(p) }));
  const pageAt = new Map(overview.pages.map((p, i) => [p.path, i]));
  const findItems: IceFindItem[] = overview.elements.flatMap((e) => {
    const p = pageAt.get(e.path);
    if (p === undefined) return [];
    return [{
      p,
      id: e.id,
      label: elementLabel(e),
      value: e.value,
      slots: e.kind === "text" || e.slots.length === 0 ? null : e.slots.join(", "),
    }];
  });

  const counts = (p: IceAdminPage) => t("iceAdmin.counts", { texts: p.texts, media: p.media });
  const lastChange = (p: IceAdminPage) => (p.lastChange
    ? <RelativeTime at={p.lastChange} locale={locale} t={t} />
    : <span className="text-faint">{t("iceAdmin.never")}</span>);

  return (
    <div>
      <PageHeader overline={t("cms.pagesTitle")} title={t("iceAdmin.title")} sub={t("iceAdmin.sub")} />
      <CmsNav />

      <div className="space-y-8" data-ice-admin>
        <IceFind pages={findPages} items={findItems} />

        <section data-ice-supported>
          <SectionHeader size="sm" title={t("iceAdmin.supported.title")} sub={t("iceAdmin.supported.sub")} className="mb-3" />

          {/* ── DESKTOP: one row per page ─────────────────────────────── */}
          {/* Scrolls inside its own rounded panel if a narrow desktop cannot
              fit every column — never the page. */}
          <div className="panel thin-scroll hidden overflow-x-auto rounded-2xl lg:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[11.5px] uppercase tracking-[0.08em] text-faint">
                  <th scope="col" className="px-4 py-3 font-semibold">{t("iceAdmin.col.page")}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{t("iceAdmin.col.url")}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{t("iceAdmin.col.type")}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{t("iceAdmin.col.elements")}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{t("iceAdmin.col.lastChange")}</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">
                    <span className="sr-only">{t("iceAdmin.col.actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {overview.pages.map((p) => (
                  <tr key={p.id} className="border-b border-line/60 last:border-0" data-ice-page={p.path}>
                    <td className="px-4 py-3 font-semibold">{pageName(p)}</td>
                    <td className="px-4 py-3"><code className="text-[12px] text-faint">{p.path}</code></td>
                    <td className="px-4 py-3 text-[12.5px] text-muted">{t(`iceAdmin.type.${p.type}`)}</td>
                    <td className="px-4 py-3 text-[12.5px] text-muted">{counts(p)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-[12.5px] text-muted">{lastChange(p)}</td>
                    <td className="px-4 py-3 text-right"><IceEditButton path={p.path} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── MOBILE AND TABLET: a card per page ────────────────────── */}
          <ul className="space-y-2 lg:hidden">
            {overview.pages.map((p) => (
              <li key={p.id} className="panel rounded-2xl" data-ice-page={p.path}>
                <div className="px-4 py-3.5">
                  <p className="truncate text-sm font-semibold">{pageName(p)}</p>
                  <code className="text-[11.5px] text-faint">{p.path}</code>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-4 py-2 text-[11.5px] text-muted">
                  <span>{t(`iceAdmin.type.${p.type}`)}</span>
                  <span>· {counts(p)}</span>
                  <span>· {lastChange(p)}</span>
                </div>
                <div className="flex justify-end border-t border-line px-3 py-2">
                  <IceEditButton path={p.path} />
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section data-ice-unsupported>
          <SectionHeader size="sm" title={t("iceAdmin.unsupported.title")} sub={t("iceAdmin.unsupported.sub")} className="mb-3" />
          <ul className="panel rounded-2xl">
            {overview.unsupported.map((u) => (
              <li key={u.path} data-ice-unsupported-path={u.path}
                className="flex flex-col gap-1 border-b border-line/60 px-4 py-3 last:border-0 sm:flex-row sm:items-baseline sm:gap-4">
                <code className="break-words text-[12.5px] text-ink sm:w-80 sm:shrink-0">{u.path}</code>
                <span className="text-[12.5px] leading-relaxed text-muted">{t(`iceAdmin.reason.${u.reason}`)}</span>
              </li>
            ))}
          </ul>
        </section>

        <p className="text-[12px] leading-relaxed text-muted">{t("iceAdmin.note")}</p>
      </div>
    </div>
  );
}
