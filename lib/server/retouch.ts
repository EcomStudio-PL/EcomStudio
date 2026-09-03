import "server-only";
import sharp from "sharp";
import type { Client } from "@/lib/services/workspace";
import { runGeneration } from "@/lib/server/generation";
import { RATIO_SHAPE, type AspectRatio, type Resolution } from "@/lib/ai/types";

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
 * ledger, calls the provider with the source photo as the reference image,
 * stores the output in the generation bucket and refunds on failure.
 */

/** The model this tool runs on. Resolved by its API identifier, never by the
 *  marketing name — the row is admin-managed and its display name may change
 *  without the endpoint changing. */
const RETOUCH_MODEL_IDENTIFIER = "gemini-3-pro-image-preview";

/** Marks the job in `generation_jobs.settings` so the tool's own gallery,
 *  the library and the cost log can tell a retouch from a generation. */
export const RETOUCH_OPERATION = "image_retouch";

/**
 * THE HIDDEN RETOUCH PROMPT. Server-only by construction (see above).
 * Product fidelity outranks every aesthetic instruction in it, and
 * `runGeneration` additionally appends the platform's Product Lock contract.
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
  const [{ data: model }, { data: setting }] = await Promise.all([
    supabase
      .from("ai_models")
      .select("id, supported_resolutions, supported_aspect_ratios, pricing, credit_cost, active, ai_providers!inner(active)")
      .eq("model_identifier", RETOUCH_MODEL_IDENTIFIER)
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
  };
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : undefined;
}

/** Credits for one image at one size — the single source of truth for both
 *  the quote the panel shows and the amount the server reserves. */
export function retouchPrice(model: RetouchModelInfo, resolution: string): number {
  return model.pricing[resolution] ?? Object.values(model.pricing)[0] ?? 0;
}

/**
 * "Oryginalny" means the shape of the file the customer uploaded, snapped to
 * the nearest framing the engine can actually draw. Measuring beats guessing:
 * a 3000×2000 photo asked for as 1:1 comes back cropped, and the whole point
 * of a retouch is that the crop does not move.
 */
async function ratioOfSource(bytes: Buffer, allowed: string[]): Promise<AspectRatio> {
  const fallback = (allowed.includes("1:1") ? "1:1" : allowed[0] ?? "1:1") as AspectRatio;
  try {
    const meta = await sharp(bytes).metadata();
    // EXIF orientation 5–8 stores the image rotated a quarter turn.
    const swap = (meta.orientation ?? 1) >= 5;
    const w = (swap ? meta.height : meta.width) ?? 0;
    const h = (swap ? meta.width : meta.height) ?? 0;
    if (!w || !h) return fallback;
    const target = w / h;
    let best = fallback;
    let bestDelta = Infinity;
    for (const r of allowed) {
      const shape = RATIO_SHAPE[r as keyof typeof RATIO_SHAPE];
      if (!shape) continue;
      const delta = Math.abs(Math.log(shape.w / shape.h) - Math.log(target));
      if (delta < bestDelta) { bestDelta = delta; best = r as AspectRatio; }
    }
    return best;
  } catch {
    return fallback;
  }
}

export type RetouchInput = {
  /** Storage path in `product-images`, already uploaded by the browser and
   *  verified by the route to sit inside the caller's own workspace. */
  sourcePath: string;
  resolution?: string;
  /** "original" (default) keeps the source shape; anything else must be a
   *  framing the model declares. */
  format?: string;
};

export type RetouchResult =
  | { ok: true; generationId: string | null; jobId: string; url: string; path: string; credits: number }
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

  let aspectRatio: AspectRatio;
  if (input.format && input.format !== "original" && model.ratios.includes(input.format)) {
    aspectRatio = input.format as AspectRatio;
  } else {
    const { data: blob } = await supabase.storage.from("product-images").download(input.sourcePath);
    if (!blob) return { ok: false, error: "source_unavailable" };
    aspectRatio = await ratioOfSource(Buffer.from(await blob.arrayBuffer()), model.ratios);
  }

  const result = await runGeneration(supabase, userId, workspaceId, {
    modelId: model.id,
    prompt: RETOUCH_PROMPT,
    aspectRatio,
    resolution,
    quantity: 1,
    // The source photo IS the subject: image-to-image, never text-to-image.
    referencePaths: [input.sourcePath],
    referenceImageIds: [],
    // GrovBase wrote the prompt, so it is GrovBase's: the job row stores no
    // prompt text and the customer-facing projection has nothing to show.
    hidePromptText: true,
    promptOrigin: "ecomstudio",
    costOverride: retouchPrice(model, resolution),
    operation: RETOUCH_OPERATION,
  });

  if (!result.ok) return result;
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
