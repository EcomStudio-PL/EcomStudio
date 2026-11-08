import "server-only";

/** Parameter helpers of the GrovBase Shot admin routes (each route checks the admin role itself). */

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const intParam = (v: string | null, min: number, max: number): number | null => {
  if (v === null || !/^-?\d+$/.test(v)) return null;
  const n = Number(v);
  return n >= min && n <= max ? n : null;
};
export const noStore = { "Cache-Control": "private, no-store" } as const;
