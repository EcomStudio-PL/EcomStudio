/**
 * THE START'S OWN SKELETON — the shape of the seller home's first screen
 * (components/seller-home): the tool carousel (three and a half tiles in the
 * catalogue's 2336×1744 frame on a desktop, two and a half on a tablet, one
 * and a bit on a phone), then the upload tile and its pills, at the sizes they
 * will have — so the page settles into the space it was promised instead of
 * reflowing.
 */
export default function HomeLoading() {
  return (
    <div aria-busy className="flex w-full min-w-0 animate-pulse flex-col gap-[14px] [overflow-x:clip] sm:gap-[18px] lg:gap-[22px] xl:-mx-2 xl:w-[calc(100%+1rem)]">
      <div className="flex gap-[10px] overflow-hidden py-1 sm:gap-3 lg:gap-3.5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="w-[calc((100%_-_1.8px)_/_1.18)] shrink-0 sm:w-[calc((100%_-_18px)_/_2.5)] lg:w-[calc((100%_-_35px)_/_3.5)]">
            <div className="aspect-[2336/1744] rounded-xl bg-raised/60" />
            <div className="mt-2 h-4 w-1/2 rounded bg-raised/70" />
            <div className="mt-0.5 h-4 w-2/3 rounded bg-raised/50" />
          </div>
        ))}
      </div>
      <div className="mx-auto w-full max-w-[56rem]">
        <div className="h-[12.625rem] rounded-2xl border border-[rgb(var(--accent)/0.25)] bg-raised/40 sm:h-[13.8rem]" />
        <div className="mt-4 flex flex-wrap justify-center gap-1.5 sm:gap-2">
          {[0, 1, 2].map((i) => <div key={i} className="h-9 w-[6.5rem] rounded-xl bg-raised/50 sm:w-28" />)}
        </div>
      </div>
    </div>
  );
}
