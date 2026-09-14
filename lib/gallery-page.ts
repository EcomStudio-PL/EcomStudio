/**
 * HOW MANY RESULTS A WORKSPACE GALLERY ASKS FOR AT A TIME.
 *
 * The gallery at the bottom of a generator is "your last twenty", not the
 * Library. Twenty is what the first page fetches — server-side, as part of the
 * page's own batch, so opening the generator costs no extra round trip — and
 * what each later page fetches as the customer scrolls. Everything beyond that
 * lives in the Library, which is a page in its own right.
 *
 * One constant rather than a literal repeated across five routes, the API
 * handler and the client: the number decides how much work a page does before
 * it can paint, and a surface that quietly asked for more than its neighbours
 * is exactly the kind of drift nobody notices until the generator is slow to
 * open on a phone.
 */
export const GALLERY_PAGE_SIZE = 20;

/** Hard ceiling for anything a client may ask the API for. */
export const GALLERY_PAGE_MAX = 48;
