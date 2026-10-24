"use server";
import * as ice from "@/lib/server/ice/actions";
import type { IceCmsMoveInput, IceCmsVisibilityInput, IceGallerySaveInput, IceLocale, IceSlotWrite } from "@/lib/ice/types";
import type { GalleryKey } from "@/lib/launch/gallery";

/**
 * THE VISUAL EDITOR'S SERVER ACTIONS — thin wrappers, per the house rule.
 * Who may call them, what they may change, the write, the audit row and the
 * cache tag are all decided in lib/server/ice/actions.ts; nothing here is
 * trusted from the browser.
 */

export async function iceSetEditAction(on: boolean, path: string) { return ice.setEdit(on, path); }
export async function iceRememberAdminAction() { return ice.rememberAdmin(); }
export async function icePageAction(path: string) { return ice.pageInfo(path); }
export async function iceTextStateAction(key: string) { return ice.textState(key); }
export async function iceTextSaveAction(input: { key: string; locale: IceLocale; value: string | null; base: string | null; action?: "save" | "reset" | "restore" }) {
  return ice.textSave(input);
}
export async function iceSlotStateAction(keys: string[]) { return ice.slotState(keys); }
export async function iceSlotSaveAction(input: { writes: IceSlotWrite[]; action: "save" | "restore" | "clear" | "bulk" }) {
  return ice.slotSave(input);
}
export async function iceHistoryAction(input: { target: "text" | "slot" | "cms"; key: string; locale?: IceLocale | null; limit?: number }) {
  return ice.history(input);
}
export async function icePageHistoryAction(path: string) { return ice.pageHistory(path); }
export async function iceLibraryAction(input: { kind?: "image" | "video"; q?: string; offset?: number }) { return ice.library(input); }
export async function iceUsageAction(mediaId: string) { return ice.usage(mediaId); }
export async function iceAssetsAction(ids: string[]) { return ice.assets(ids); }
export async function iceUploadTicketAction(input: { name: string; size: number; type: string }) { return ice.uploadTicket(input); }
export async function iceRegisterUploadAction(input: { path: string; name: string }) { return ice.registerUpload(input); }
export async function iceCmsMapAction(path: string) { return ice.cmsMap(path); }
export async function iceCmsSaveAction(input: {
  blockId: string; path: string[]; locale: IceLocale | null; value: string; expected: string | null; base: string | null; action?: "save" | "restore";
}) {
  return ice.cmsSave(input);
}
export async function iceCmsVisibilityAction(input: IceCmsVisibilityInput) { return ice.cmsVisibility(input); }
export async function iceCmsMoveAction(input: IceCmsMoveInput) { return ice.cmsMove(input); }
export async function iceGalleryStateAction(path: string) { return ice.galleryState(path); }
export async function iceGallerySaveAction(input: IceGallerySaveInput) { return ice.gallerySave(input); }
export async function iceGalleryPublishAction(input: { confirmLaunchDraft?: boolean }) { return ice.galleryPublish(input); }
export async function iceGalleryDiscardAction(input: { key: GalleryKey; base: string | null }) { return ice.galleryDiscard(input); }
export async function iceGalleryVersionsAction(input: { key: GalleryKey }) { return ice.galleryVersions(input); }
export async function iceGalleryRestoreAction(input: { key: GalleryKey; version: string; base: string | null }) {
  return ice.galleryRestore(input);
}
