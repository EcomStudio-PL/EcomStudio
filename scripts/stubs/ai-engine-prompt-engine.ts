/** Test double for the two helpers the engine runtime borrows from the
 *  GrovShot planner module. */
export async function downloadReferences(_s: unknown, paths: string[]) {
  return paths.map(() => ({ base64: "AAAA", mime: "image/jpeg" }));
}
export async function textCapableBackends() {
  return [{ provider: "openai" as const, cred: { apiKey: "k" } }];
}
