import "server-only";
import type { Client } from "@/lib/services/workspace";
import { isPending, runEngineImageTool } from "@/lib/server/engine/tool-run";
import { resolveEngine } from "@/lib/server/ai-engine";
import type { AspectRatio, Resolution } from "@/lib/ai/types";

/**
 * RETUSZ ZDJĘĆ — GrovBase's own retouch pass.
 *
 * `import "server-only"` at the top of this file is the load-bearing line:
 * the prompt below is GrovBase IP and the module cannot be imported from a
 * client component at all, so it can never reach a bundle, a network payload
 * or a devtools panel. The job row is written with `hidePromptText`, so it
 * is not stored in clear either — the customer's own history shows what the
 * image was made from, never the words that made it.
 *
 * Everything else is the existing pipeline: `runGeneration` resolves the
 * model and its decrypted credential, reserves credits through the usage
 * ledger, calls the provider with the source photo as the image to EDIT,
 * stores the output in the generation bucket and refunds on failure.
 *
 * WHAT THE MODEL RECEIVES, with a prompt published in Admin → Narzędzia i
 * silniki: the original uploaded photo (untouched bytes) + that prompt, byte
 * for byte + the size the customer chose + the framing the customer chose —
 * or, for "Oryginalny", no ratio at all, so the edit keeps the photo's own
 * shape. Nothing else: no Product Lock, no built-in text, no knowledge the
 * prompt did not ask for.
 */

/** The model this tool runs on when the panel assigns none. Resolved by its
 *  API identifier, never by the marketing name — the row is admin-managed and
 *  its display name may change without the endpoint changing. Nano Banana Pro
 *  = Gemini 3 Pro Image, the generally available code (migration 0131). */
export const RETOUCH_MODEL_IDENTIFIER = "gemini-3-pro-image";

/** Marks the job in `generation_jobs.settings` so the tool's own gallery,
 *  the library and the cost log can tell a retouch from a generation. */
export const RETOUCH_OPERATION = "image_retouch";
/** The tool's row in Admin → Narzędzia i silniki (`ai_tools.tool_key`). */
const RETOUCH_TOOL_KEY = "retouch";

/**
 * THE BUILT-IN RETOUCH PROMPT — used ONLY while nothing is published in the
 * panel (never alongside a published prompt). Server-only by construction
 * (see above). On that built-in path `runGeneration` still appends the
 * platform's Product Lock contract it was written to be paired with.
 */
const RETOUCH_PROMPT = `[ZADANIE]
Przekształć dostarczone zdjęcie produktu w wysokiej klasy wizualizację sprzedażową premium do e-commerce. Zachowaj rzeczywisty kształt, proporcje, konstrukcję i funkcję produktu, ale popraw jego prezentację tak, aby wyglądał jak perfekcyjny fotorealistyczny render produktowy klasy premium. Efekt końcowy ma wyglądać jak profesjonalny packshot reklamowy / CGI hero shot: maksymalnie czysty, dopracowany, elegancki, nowoczesny i bardzo sprzedażowy. Produkt ma być głównym bohaterem kadru, ma wyglądać drożej, czytelniej i bardziej premium niż na surowym zdjęciu, ale nadal wiarygodnie produktowo. Czysto białe tło. Doświetl wszystkie obecnie zacienione miejsca i elementy. Zachowaj identyczny kadr i ujęcie ze zdjęcia referencyjnego. Nie ingeruj w ustawienie produktu na zdjęciu.

[STYL WIZUALNY]
- estetyka premium e-commerce / hyper-clean commercial CGI
- wygląd jak fotorealistyczny render 3D lub perfekcyjnie wyretuszowana fotografia studyjna
- sterylna czystość, brak chaosu, brak przypadkowości
- bardzo wysoka czytelność bryły już w miniaturze
- wyraźna objętość produktu, atrakcyjna forma i elegancka geometria
- materiały mają wyglądać luksusowo, czysto i technicznie perfekcyjnie
- nowoczesny, minimalistyczny, komercyjny wygląd
- tło neutralne, jasne, czyste, bez rozpraszaczy
- produkt ma wyglądać jak nowy, nienaruszony, idealnie przygotowany do reklamy
- zachowaj realizm użytkowy, ale usuń wrażenie taniej amatorskiej fotografii
- całość ma sprawiać wrażenie dopracowanego premium renderu katalogowego
- ostrość, kontrast lokalny i separacja planów mają być bardzo dobre, ale bez przesadnego HDR i bez sztucznego przerysowania

[OŚWIETLENIE]
- miękkie, duże, studyjne oświetlenie produktowe
- jasny, czysty key light od przodu i lekko z góry
- dodatkowe miękkie światło wypełniające dla pełnej czytelności detali
- subtelny rim light / kontrowanie dla oddzielenia produktu od tła
- delikatne, eleganckie refleksy podkreślające materiał i krawędzie
- miękkie, krótkie, kontrolowane cienie
- brak brudnych, przypadkowych odbić otoczenia
- brak żółtych dominant, brak mieszanych temperatur barwowych
- neutralna lub lekko chłodna biel światła
- oświetlenie ma podkreślać objętość, fakturę i premium charakter produktu
- powierzchnie metalowe, plastikowe, silikonowe lub lakierowane mają mieć piękne, czyste highlighty jak w reklamowej fotografii studyjnej
- ekran, szkło lub elementy połyskliwe mają być czytelne, eleganckie i bez przepaleń

[TECHNIKA RENDEROWANIA]
- potraktuj produkt jak hero object w fotorealistycznym CGI
- zachowaj dokładny design produktu, bez zmieniania jego konstrukcji
- popraw geometrię wizualną: wyrównaj krawędzie, symetrię i powierzchnie, ale bez zmiany modelu
- materiały mają być fizycznie wiarygodne, ale lekko upiększone reklamowo
- wygładź przypadkowe deformacje, tanie załamania, nierówności i wady wynikające z kiepskiego zdjęcia
- zwiększ czytelność faz, przetłoczeń, łączeń i istotnych elementów konstrukcyjnych
- nadaj powierzchniom wysokiej jakości shader look: czysty mat, kontrolowany satynowy połysk, elegancki metal, dopracowany silikon, realistyczna guma, precyzyjne szkło
- popraw separację produktu od tła
- zachowaj naturalną perspektywę produktu, ale podaj go w bardziej atrakcyjny, sprzedażowy sposób
- efekt końcowy ma przypominać połączenie packshotu premium, reklamy produktowej i fotorealistycznego renderu 3D
- produkt ma wyglądać na idealnie nowy, fabrycznie czysty, premium i starannie zaprezentowany

[RETUSZ]
- usuń szumy, kompresję, artefakty, zabrudzenia, kurz, pyłki, rysy i przypadkowe skazy
- usuń tanie wrażenie słabego zdjęcia wejściowego
- oczyść krawędzie produktu i popraw wycięcie
- popraw balans bieli, ekspozycję i kontrast
- zwiększ mikrokontrast lokalny tylko w sposób elegancki i kontrolowany
- dopracuj tekstury tak, by były czytelne, ale nie przesadnie ostre
- wyrównaj kolor materiałów i usuń nieestetyczne przebarwienia
- popraw nadruki, etykiety, skale, logo i elementy interfejsu tylko jeśli są obecne, zachowując ich zgodność z oryginałem
- zachowaj naturalny wygląd produktu, bez plastikowej przesady i bez cartoonowego efektu
- brak halo, brak przerysowanego sharpeningu, brak przesadnego glow
- finalny obraz ma wyglądać drogo, czysto, profesjonalnie i bardzo wiarygodnie sprzedażowo

[WAŻNE OGRANICZENIA]
- nie zmieniaj projektu produktu
- nie dodawaj nowych elementów konstrukcyjnych
- nie zmieniaj koloru produktu, chyba że wynika to z korekty balansu bieli i lepszego odwzorowania materiału
- nie deformuj proporcji
- nie stylizuj w kierunku ilustracji, kreskówki ani sztucznego AI look
- unikaj przesadnego beauty retuszu, który zniekształca realny wygląd przedmiotu
- zachowaj zgodność z prawdziwym produktem, ale pokaż go w estetyce premium CGI`;

export type RetouchModelInfo = {
  id: string;
  /** Sizes the admin configured for this model — the picker shows no other. */
  resolutions: string[];
  /** Framings the model renders, used when the customer overrides "original". */
  ratios: string[];
  /** Credits per image at each size, already including any admin override. */
  pricing: Record<string, number>;
  /** The fallback assigned in Admin → Narzędzia i silniki, when enabled there. */
  fallbackId: string | null;
};

type SettingsRow = { price_per_image?: unknown; price_1k?: unknown; price_2k?: unknown; price_4k?: unknown };

/**
 * What the tool costs, per output size. The base is the model's own admin
 * price table; `app_settings.retouch` may override it per size (or with one
 * flat `price_per_image`) so the price of the SERVICE can move without the
 * price of the model, and without touching any code. Never read from the
 * client: the browser is shown this number, the server recomputes it.
 */
export async function retouchModel(supabase: Client): Promise<RetouchModelInfo | null> {
  // THE MODEL ASSIGNED IN THE PANEL (ai_tool_models primary, read through the
  // token-gated ai_tool_runtime). Without an assignment the tool keeps the
  // model it has always used, so an install that never touched the picker
  // behaves exactly as before.
  const engine = await resolveEngine(supabase, RETOUCH_TOOL_KEY);
  const primaryId = engine?.primaryModelId ?? null;
  const fallbackId = engine?.fallbackEnabled && engine.fallbackModelId && engine.fallbackModelId !== primaryId
    ? engine.fallbackModelId : null;
  const [{ data: model }, { data: setting }] = await Promise.all([
    supabase
      .from("ai_models")
      .select("id, supported_resolutions, supported_aspect_ratios, pricing, credit_cost, active, ai_providers!inner(active)")
      .eq(primaryId ? "id" : "model_identifier", primaryId ?? RETOUCH_MODEL_IDENTIFIER)
      .eq("active", true)
      .eq("ai_providers.active", true)
      .maybeSingle(),
    supabase.from("app_settings").select("value").eq("key", "retouch").maybeSingle(),
  ]);
  if (!model) return null;

  const overrides = (setting?.value ?? {}) as SettingsRow;
  const flat = num(overrides.price_per_image);
  const perSize: Record<string, number | undefined> = {
    "1K": num(overrides.price_1k), "2K": num(overrides.price_2k), "4K": num(overrides.price_4k),
  };
  const resolutions = model.supported_resolutions?.length ? model.supported_resolutions : ["1K"];
  const base = (model.pricing ?? {}) as Record<string, number>;
  const pricing: Record<string, number> = {};
  for (const res of resolutions) {
    const fromModel = typeof base[res] === "number" && base[res] >= 0 ? base[res] : model.credit_cost;
    pricing[res] = perSize[res] ?? flat ?? fromModel;
  }
  return {
    id: model.id,
    resolutions,
    ratios: model.supported_aspect_ratios ?? ["1:1"],
    pricing,
    fallbackId,
  };
}

/**
 * Retusz AS A WORKFLOW STEP: the instruction and model the tool itself would
 * use for ONE image — the published GrovBase prompt when there is one, else
 * the built-in prompt — never the retouch tool's own workflow (a workflow
 * step can therefore not recurse). Server memory only.
 */
export async function retouchStepConfig(supabase: Client): Promise<{ prompt: string; modelId: string; fallbackId: string | null } | null> {
  const [model, engine] = await Promise.all([retouchModel(supabase), resolveEngine(supabase, RETOUCH_TOOL_KEY)]);
  if (!model) return null;
  const published = engine && (engine.mode === "grovbase" || engine.mode === "hybrid") && engine.systemPrompt?.trim()
    ? engine.systemPrompt : null;
  return { prompt: published ?? RETOUCH_PROMPT, modelId: model.id, fallbackId: model.fallbackId };
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : undefined;
}

/** Credits for one image at one size — the single source of truth for both
 *  the quote the panel shows and the amount the server reserves. */
export function retouchPrice(model: RetouchModelInfo, resolution: string): number {
  return model.pricing[resolution] ?? Object.values(model.pricing)[0] ?? 0;
}

export type RetouchInput = {
  /** Storage path in `product-images`, already uploaded by the browser and
   *  verified by the route to sit inside the caller's own workspace. */
  sourcePath: string;
  resolution?: string;
  /** "original" (default) keeps the source photo's own shape — no ratio is
   *  imposed on the edit; anything else must be a framing the model declares
   *  and is sent exactly. */
  format?: string;
  /** Results per run the panel showed the price for. */
  quotedOutputs?: number;
};

export type RetouchResult =
  | { ok: true; generationId: string | null; jobId: string; url: string; path: string; credits: number }
  /** Workflow ON: the run was started and charged; poll /api/engine/runs/{runId}. */
  | { ok: true; pending: true; runId: string; jobId: string | null; credits: number; expected: number }
  | { ok: false; error: string; missingCredits?: number };

/**
 * Retouch ONE image. One call, one job, one credit reservation — a batch is
 * the caller looping, so a single failure refunds and reports only itself
 * and never takes the other photos' results with it.
 */
export async function runRetouch(
  supabase: Client, userId: string, workspaceId: string, input: RetouchInput,
): Promise<RetouchResult> {
  const model = await retouchModel(supabase);
  if (!model) return { ok: false, error: "model_unavailable" };

  const resolution = (model.resolutions.includes(input.resolution ?? "") ? input.resolution : model.resolutions[0]) as Resolution;

  // "Oryginalny" is NOT a ratio GrovBase picks: snapping a 4:3 or 3:2 photo
  // to the nearest of a handful of ratios (1:1, 16:9…) forced the model to
  // re-frame the scene. "auto" sends no ratio, and the edit keeps the shape
  // of the photo it was given. A framing the customer chose is sent exactly.
  const aspectRatio: AspectRatio = input.format && input.format !== "original" && model.ratios.includes(input.format)
    ? input.format as AspectRatio
    : "auto";

  // THE INSTRUCTION: a published workflow or prompt from Admin → Narzędzia i
  // silniki when there is one, otherwise the built-in RETOUCH_PROMPT exactly
  // as before. Nothing is published by default, so nothing changes by default.
  const result = await runEngineImageTool(supabase, userId, workspaceId, {
    toolKey: RETOUCH_TOOL_KEY,
    builtInPrompt: RETOUCH_PROMPT,
    hint: "",
    // The source photo IS the subject: image-to-image, never text-to-image.
    referencePaths: [input.sourcePath],
    expectedCost: retouchPrice(model, resolution),
    quotedOutputs: input.quotedOutputs,
    generation: {
      modelId: model.id,
      // runGeneration tries it only when the primary cannot serve, under the
      // same reservation, and skips it when it cannot take the references
      // (Product Lock) or render the paid size.
      ...(model.fallbackId ? { fallbackModelIds: [model.fallbackId] } : {}),
      aspectRatio,
      resolution,
      quantity: 1,
      referenceImageIds: [],
      // GrovBase wrote the prompt, so it is GrovBase's: the job row stores no
      // prompt text and the customer-facing projection has nothing to show.
      hidePromptText: true,
      promptOrigin: "ecomstudio",
      costOverride: retouchPrice(model, resolution),
      operation: RETOUCH_OPERATION,
    },
  });

  if (!result.ok) return result;
  if (isPending(result)) {
    return { ok: true, pending: true, runId: result.runId, jobId: result.jobId, credits: result.credits, expected: result.expected };
  }
  const first = result.images[0];
  return {
    ok: true,
    generationId: result.productId, // unused by the tool; kept for parity
    jobId: result.jobId,
    url: first?.url ?? "",
    path: first?.path ?? "",
    credits: result.credits,
  };
}
