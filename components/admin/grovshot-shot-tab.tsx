import type { createClient } from "@/lib/supabase/server";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { readShotAdmin } from "@/lib/server/grovshot-shot/admin";
import { getCurrentWorkspace } from "@/lib/services/workspace";
import { ShotKbPanel, ShotTestsPanel } from "@/components/admin/grovshot-shot-client";
import { ShotQualityPanel } from "@/components/admin/grovshot-shot-quality";
import { readQuality } from "@/lib/server/grovshot-shot/quality";

/**
 * GROVBASE SHOT — the lifestyle engine's admin tabs on the GrovShot tool page:
 *   Baza wiedzy  the knowledge file: import (check → parse → preview →
 *                comparison → a DRAFT), versions (activate for new orders,
 *                roll back), the publication history;
 *   Testy        the engine settings (Claude model per step, the global
 *                limits), the queue, the test set, an admin test (prompts
 *                only, or paid images after confirmation) and every order
 *                step by step.
 * Customers keep their engine (the flag and the margin gate decide).
 */

type T = (key: string, values?: Record<string, string | number>) => string;

export async function GrovshotShotTab({ supabase, t, view }: {
  supabase: Awaited<ReturnType<typeof createClient>>; t: T; view: "kb" | "tests" | "quality";
}) {
  if (view === "quality") {
    const data = await readQuality(supabase, 90);
    return (
      <div className="space-y-4" data-grovshot-shot-admin="quality">
        <Card className="p-4 sm:p-5">
          <CardHeader title={t("gss.q.title")} sub={t("gss.q.sub")} />
          <div className="pt-4"><ShotQualityPanel data={data} /></div>
        </Card>
      </div>
    );
  }
  const { data: { user } } = await supabase.auth.getUser();
  const [admin, workspace] = await Promise.all([readShotAdmin(supabase), user ? getCurrentWorkspace(supabase, user.id) : Promise.resolve(null)]);
  const activeVersion = admin.active?.version ?? null;
  return (
    <div className="space-y-4" data-grovshot-shot-admin={view}>
      <Card className="p-4 sm:p-5">
        <CardHeader title={view === "kb" ? t("gss.kb.title") : t("gss.test.panelTitle")} sub={view === "kb" ? t("gss.kb.sub") : t("gss.test.panelSub")} />
        <div className="flex flex-wrap gap-2 pt-3">
          <Badge tone={activeVersion ? "success" : "warning"} dot>
            {activeVersion ? t("gss.kb.activeBadge", { v: activeVersion }) : t("gss.kb.noActive")}
          </Badge>
          <Badge tone="neutral">{t("gss.kb.versionsBadge", { n: admin.versions.length })}</Badge>
        </div>
        <div className="pt-4">
          {view === "kb"
            ? <ShotKbPanel versions={admin.versions} events={admin.events} active={admin.active} />
            : <ShotTestsPanel settings={admin.settings} settingsErrors={admin.settingsErrors} model={admin.model} versions={admin.versions}
                testProducts={admin.testProducts} workspaceId={workspace?.id ?? null} queue={admin.queue} />}
        </div>
      </Card>
    </div>
  );
}
