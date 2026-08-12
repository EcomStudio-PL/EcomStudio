/** Route-level skeleton: paints instantly on tab switches while server
 *  components fetch, so navigation feels immediate instead of blank. */
export default function AppLoading() {
  return (
    <div aria-busy className="animate-pulse">
      <div className="mb-6 space-y-2">
        <div className="h-7 w-48 rounded-lg bg-raised" />
        <div className="h-4 w-72 max-w-full rounded-lg bg-raised/70" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-20 rounded-2xl bg-raised/70" />)}
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="h-56 rounded-2xl bg-raised/50" />
        <div className="h-56 rounded-2xl bg-raised/50" />
      </div>
    </div>
  );
}
