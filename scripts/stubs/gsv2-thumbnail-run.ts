/** The one helper the V2 start borrows from Miniaturka's run — the same rule
 *  (lib/server/thumbnail/run.ts validPhotoPath), without the whole engine. */
export function validPhotoPath(path: unknown, workspaceId: string): path is string {
  return typeof path === "string" && path.length > 0 && path.length <= 300
    && path.startsWith(`${workspaceId}/`) && !path.includes("..") && /^[\w\-./]+$/.test(path);
}
