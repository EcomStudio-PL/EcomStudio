// The REAL screens behind „UPDATE NARZĘDZI V4”, mounted by
// scripts/v4-tools-tests.ts (window.__fx.mode):
//   studio  the generator panel in „Stwórz zdjęcie” as a member, with
//           custom.inspirationEnabled from the page (and, optionally, a draft
//           saved before the switch: one product photo + one inspiration);
//   thumb   the Miniaturka form (photos, Packshot AI, summary, Generate);
//   frame   the tool header with and without a way back.
import { createRoot } from "react-dom/client";
import { I18nProvider } from "@/lib/i18n/provider";
import { ToolViewerProvider } from "@/components/public-tools/tool-viewer";
import { GeneratorWorkspace } from "@/components/genv3/workspace";
import { ThumbnailWorkspace } from "@/components/thumbnail/workspace";
import { ToolFrame, useToolFrameController } from "@/components/tool-frame/frame";
import { saveDraft } from "@/components/public-tools/draft-store";
import { offerRetouched } from "@/lib/thumbnail/reuse";
import type { GenModel } from "@/components/genv3/types";

type Fx = {
  mode: "studio" | "thumb" | "frame"; dict: Record<string, unknown>; ws: string; path: string;
  flag?: boolean; draft?: boolean; legacyBack?: boolean; offerBeforeMount?: { ref: string; original: string | null; url: string }[];
};
const w = window as unknown as { __fx: Fx; __ready?: boolean; __offer?: typeof offerRetouched };
const fx = w.__fx;
w.__offer = offerRetouched;

const MEMBER = {
  tool: "generator", path: fx.path, trialWatermark: false,
  facts: { kind: "member" as const, viewerKey: "viewer-1", emailVerified: true, planActive: true, bonus: null, bonusOffered: null, fresh: false },
};
const MODEL: GenModel = {
  id: "m1", name: "Nano Banana Pro", badge: null, badgeTone: null, description: null, pricing: { "1K": 1, "2K": 1 },
  resolutions: ["1K", "2K"], ratios: ["1:1", "4:5"], exactRatios: ["1:1", "4:5"], maxOutputs: 1, supportsRefs: true, maxRefs: 6,
  qualities: [], qualityPricing: {},
};
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function Frames() {
  const a = useToolFrameController();
  const b = useToolFrameController();
  return (
    <>
      <div data-frame="without">
        <ToolFrame frame={a} tools={["ecommerce_thumbnail"]} title={<h1>Miniaturka</h1>}><div /></ToolFrame>
      </div>
      <div data-frame="with">
        <ToolFrame frame={b} tools={["ecommerce_packshot"]} back={{ href: "/k/ecommerce", label: "E-commerce" }} title={<h1>Packshot</h1>}><div /></ToolFrame>
      </div>
    </>
  );
}

async function boot() {
  if (fx.mode === "studio" && fx.draft) {
    const png = await (await fetch(PNG)).blob();
    const file = (name: string) => new File([png], name, { type: "image/png" });
    await saveDraft({
      tool: "studio-test", path: fx.path, owner: "member:viewer-1",
      settings: { v: 3, grovshot: {}, stworz: { modelId: "m1", ratio: "1:1", resolution: "1K", quality: "medium", count: 1, prompt: "Produkt na drewnianym stole w kuchni" } },
      // Six product photos (the model's whole budget) and one inspiration.
      sources: [
        ...[1, 2, 3, 4, 5, 6].map((k) => ({ id: `${fx.ws}/adhoc-x/p${k}.png`, name: `p${k}.png`, type: "image/png", file: file(`p${k}.png`) })),
        { id: `insp:${fx.ws}/insp-x/i1.png`, name: "i1.png", type: "image/png", file: file("i1.png") },
      ],
    });
  }
  if (fx.offerBeforeMount) offerRetouched(fx.offerBeforeMount);
  // Before/after screenshots only: what the runtime handed Miniaturka before
  // 17.11.2026 (the current screen takes no `back` and ignores it).
  const legacy: Record<string, unknown> = fx.legacyBack ? { back: { href: "/k/ecommerce", label: "E-commerce" } } : {};
  const body = fx.mode === "studio" ? (
    <ToolViewerProvider value={MEMBER}>
      <GeneratorWorkspace
        managed={{ models: [], engineAvailable: false }}
        custom={{ models: [MODEL], initialPrompt: "", inspirationEnabled: fx.flag }}
        initialTab="stworz" credits={100} workspaceId={fx.ws}
        initialItems={[]} initialCursor={null} back={{ href: "/tools", label: "Wszystkie narzędzia" }} draftKey="studio-test"
      />
    </ToolViewerProvider>
  ) : fx.mode === "thumb" ? (
    <ToolViewerProvider value={{ ...MEMBER, tool: "ecommerce_thumbnail" }}>
      <ThumbnailWorkspace workspaceId={fx.ws} credits={1000} title="Miniaturka" {...legacy}
        data={{
          ready: true, blockers: [], maxPhotos: 10, thumbnailCredits: 20, retouch: { available: true, unit: 7 },
          target: 2560, openRunId: null, initialItems: [], initialCursor: null,
        }} />
    </ToolViewerProvider>
  ) : <Frames />;
  createRoot(document.getElementById("root")!).render(<I18nProvider locale="pl" dict={fx.dict}>{body}</I18nProvider>);
  w.__ready = true;
}
void boot();
