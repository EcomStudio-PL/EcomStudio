import type { Client } from "./workspace";

export const BUCKET = "product-images";
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/avif"];

export function buildStoragePath(workspaceId: string, productId: string, ext: string) {
  const id = crypto.randomUUID();
  return `${workspaceId}/${productId}/${id}.${ext}`;
}

export async function signImageUrls(supabase: Client, paths: string[], expiresIn = 3600) {
  if (paths.length === 0) return new Map<string, string>();
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(paths, expiresIn);
  const map = new Map<string, string>();
  data?.forEach((d) => {
    if (d.signedUrl && d.path) map.set(d.path, d.signedUrl);
  });
  return map;
}

export async function setPrimaryImage(supabase: Client, productId: string, imageId: string) {
  await supabase.from("product_images").update({ is_primary: false }).eq("product_id", productId);
  const { error } = await supabase.from("product_images").update({ is_primary: true }).eq("id", imageId);
  if (error) throw error;
}

export async function deleteImage(supabase: Client, imageId: string) {
  const { data: img, error: e1 } = await supabase
    .from("product_images")
    .select("storage_path")
    .eq("id", imageId)
    .single();
  if (e1) throw e1;
  const { error: e2 } = await supabase.from("product_images").delete().eq("id", imageId);
  if (e2) throw e2;
  await supabase.storage.from(BUCKET).remove([img.storage_path]);
}

export async function moveImage(supabase: Client, productId: string, imageId: string, dir: -1 | 1) {
  const { data: images, error } = await supabase
    .from("product_images")
    .select("id, sort_order")
    .eq("product_id", productId)
    .order("sort_order", { ascending: true });
  if (error || !images) throw error ?? new Error("not_found");
  const idx = images.findIndex((i) => i.id === imageId);
  const swapIdx = idx + dir;
  if (idx < 0 || swapIdx < 0 || swapIdx >= images.length) return;
  const a = images[idx];
  const b = images[swapIdx];
  await supabase.from("product_images").update({ sort_order: b.sort_order }).eq("id", a.id);
  await supabase.from("product_images").update({ sort_order: a.sort_order }).eq("id", b.id);
}
