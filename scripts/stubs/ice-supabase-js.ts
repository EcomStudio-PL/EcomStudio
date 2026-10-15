import { iceState } from "./ice-state";

/** Test-only stand-in for @supabase/supabase-js (ice suite). Only the
 *  ANONYMOUS client the cached readers build (createAnonClient) is used at
 *  runtime; its rpc answers from iceState.anonRpc and never touches the
 *  network. Types are imported with `import type` everywhere, so nothing else
 *  is needed here. */

export function createClient(_url: string, _key: string) {
  return {
    rpc(name: string, args?: unknown) {
      iceState.anonCalls.push(name);
      return iceState.anonRpc(name, args);
    },
    from(table: string) {
      throw new Error(`anon client: table ${table} not available in the ice suite`);
    },
  };
}
