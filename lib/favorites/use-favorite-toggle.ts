"use client";
import { useCallback, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * ULUBIONE V2 — saving a like, safely.
 *
 * The heart changes at once (`apply`); the save follows. Clicks on the same
 * generation never race: while one save is in flight the next click only
 * moves the TARGET, and when the save returns the loop sends again if the
 * target moved — so five fast clicks end in exactly the state of the last
 * one, with at most one request in the air per generation. A failed save
 * puts back the last state the server confirmed and says so (`onError`).
 *
 * The favourite stays what it has always been: per GENERATION, through the
 * existing `set_generation_favorite` RPC. Nothing about the data changes.
 */

export type FavoriteSave = (generationId: string, value: boolean) => Promise<{ error: unknown }>;

export type FavoriteHandlers = {
  apply: (generationId: string, value: boolean) => void;
  onError: () => void;
  /** The value the server has confirmed, once the clicks have settled. */
  onSaved?: (generationId: string, value: boolean) => void;
};

/** The saver itself, free of React — scripts/favorites-tests.ts drives it. */
export function createFavoriteSaver(save: FavoriteSave, handlers: () => FavoriteHandlers) {
  const confirmed = new Map<string, boolean>();
  const target = new Map<string, boolean>();
  const running = new Set<string>();

  return async function toggle(generationId: string, current: boolean): Promise<void> {
    const h = handlers();
    const next = !current;
    // With nothing in flight, what the tile shows IS the server's state (it
    // may have changed elsewhere — a bulk like, another tab's refresh).
    if (!running.has(generationId)) confirmed.set(generationId, current);
    target.set(generationId, next);
    h.apply(generationId, next);
    if (running.has(generationId)) return;
    running.add(generationId);
    try {
      while (target.get(generationId) !== confirmed.get(generationId)) {
        const value = target.get(generationId) as boolean;
        let failed = false;
        try { failed = Boolean((await save(generationId, value)).error); } catch { failed = true; }
        const now = handlers();
        if (failed) {
          const back = confirmed.get(generationId) as boolean;
          target.set(generationId, back);
          now.apply(generationId, back);
          now.onError();
          break;
        }
        confirmed.set(generationId, value);
        if (target.get(generationId) === value) now.onSaved?.(generationId, value);
      }
    } finally {
      running.delete(generationId);
    }
  };
}

export function useFavoriteToggle(
  apply: FavoriteHandlers["apply"],
  onError: FavoriteHandlers["onError"],
  onSaved?: FavoriteHandlers["onSaved"],
) {
  const handlers = useRef<FavoriteHandlers>({ apply, onError, onSaved });
  useEffect(() => { handlers.current = { apply, onError, onSaved }; }, [apply, onError, onSaved]);
  const saver = useRef<ReturnType<typeof createFavoriteSaver> | null>(null);
  if (!saver.current) {
    saver.current = createFavoriteSaver(
      async (id, value) => {
        const { error } = await createClient().rpc("set_generation_favorite", { gen_id: id, value });
        return { error };
      },
      () => handlers.current,
    );
  }
  return useCallback((generationId: string, current: boolean) => saver.current!(generationId, current), []);
}
