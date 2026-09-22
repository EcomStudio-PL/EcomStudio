import type { AvailabilityMap } from "@/lib/features";
import type { SlotMap } from "@/lib/server/media-slots";
import {
  railCards, categoryChips, effectCards, homeSections,
} from "@/lib/home-sections";
import { RailTile, CardRow, SectionHead } from "./product-cards";
import { StartBox } from "./start-box";
import { GrovshotBanner } from "./grovshot-banner";

type T = (key: string, vars?: Record<string, string | number>) => string;

/** The generator's own route. One constant, used by the start box, the banner
 *  and the effect section, so all three lead to the same door. */
const GENERATOR_HREF = "/prompts";

/**
 * "/" — THE PRODUCT, FOR EVERYBODY.
 *
 * One screen, two states. A visitor who has never signed up sees the whole
 * catalogue: every category, every tool, every example, the same names and the
 * same "Wkrótce" badges a paying customer sees. A signed-in customer sees the
 * identical layout with the actions live. There is no separate marketing page
 * and no separate dashboard — the difference between the two states is whether
 * a press starts work or opens the sign-in dialog, and nothing else moves.
 *
 * WHY THAT IS WORTH THE TROUBLE. The alternative — a landing page that
 * describes the product and a dashboard that is the product — means the thing
 * a stranger evaluates is never the thing they would buy. It also means two
 * surfaces to keep in step, and they never are: the landing page still
 * advertises a tool the registry switched off six weeks ago.
 *
 * EVERYTHING HERE COMES FROM THE REGISTRIES. lib/home-sections.ts assembles
 * the cards from lib/features.ts, lib/categories.ts and lib/tool-cards.ts,
 * filtered by the live availability map. This component arranges them and owns
 * no list of its own — which is the only reason it cannot advertise something
 * that does not exist.
 */
export function ProductHome({ signedIn, availability, slots, t, isAdmin = false }: {
  signedIn: boolean;
  /** Read from feature_availability on the server. A logged-out visitor gets
   *  the same map a customer does — see migration 0116 for why that needed a
   *  policy change, and what it was showing before. */
  availability: AvailabilityMap;
  /** Whatever an admin has dressed the cards with. Empty is normal. */
  slots: SlotMap;
  t: T;
  /** An admin sees modules customers cannot, badged. Same rule as the menus. */
  isAdmin?: boolean;
}) {
  const rail = railCards(availability, isAdmin);
  const chips = categoryChips(availability, isAdmin);
  const effects = effectCards(availability, isAdmin, 14);
  const sections = homeSections(availability, isAdmin);

  return (
    <div className="space-y-8 sm:space-y-10">
      {/* 1 — DISCOVERY RAIL. The first thing under the header, before any
          heading: a seller should see what this place makes before they are
          told anything about it. */}
      {rail.length > 0 && (
        <section>
          <div className="rail-x sm:hidden">
            {rail.map((c, i) => (
              <RailTile key={c.key} card={c} signedIn={signedIn} slots={slots} t={t} priority={i < 3} />
            ))}
          </div>
          <div className="hidden gap-2.5 sm:grid sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7">
            {rail.map((c, i) => (
              <RailTile key={c.key} card={c} signedIn={signedIn} slots={slots} t={t} priority={i < 4} />
            ))}
          </div>
        </section>
      )}

      {/* 2 — THE START BOX and the six categories. */}
      <StartBox signedIn={signedIn} chips={chips} href={GENERATOR_HREF} t={t} />

      {/* 3 — WYBIERZ EFEKT. What a photograph can be turned into, live
          workflows first. */}
      {effects.length > 0 && (
        <section>
          <SectionHead
            title={t("home2.sec.effects")} sub={t("home2.sec.effectsSub")}
            seeAll={GENERATOR_HREF} signedIn={signedIn} t={t} soon={false}
          />
          <CardRow cards={effects} signedIn={signedIn} slots={slots} t={t} />
        </section>
      )}

      {/* 4 — THE BANNER. */}
      <GrovshotBanner signedIn={signedIn} href={GENERATOR_HREF} t={t} />

      {/* 5 — ONE SECTION PER REAL PART OF THE PRODUCT. A section whose every
          card is inert renders quieter and without a "see all" link; a section
          with no visible cards at all was already dropped upstream. */}
      {sections.map((s) => (
        <section key={s.key}>
          <SectionHead
            title={t(s.titleKey)} sub={t(s.subKey)} seeAll={s.seeAll}
            signedIn={signedIn} t={t} soon={s.soon}
          />
          <CardRow cards={s.cards} signedIn={signedIn} slots={slots} t={t} video={s.key === "video"} />
          {/* A ROW OF BADGES IS NOT AN EXPLANATION, so a section where nothing
              can be opened says why in one line.
              TWO DIFFERENT SENTENCES, because these are two different facts.
              Video has no engine at all and the product already has careful
              words for that (video.notReadyBody, which promises no credits are
              spent on something that cannot be made). A category whose tools
              are merely unpublished is not in that situation, and borrowing the
              video copy would tell a seller that Moda has no engine — which is
              false, and would be the page lying in the other direction. */}
          {s.soon && (
            <p className="mt-3 max-w-2xl text-[12px] leading-relaxed text-faint">
              {s.key === "video" ? t("video.notReadyBody") : t("home2.sec.soon")}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
