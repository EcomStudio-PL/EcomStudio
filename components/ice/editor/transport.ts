"use client";
import {
  iceAssetsAction, iceCmsMapAction, iceCmsSaveAction, iceGalleryDiscardAction, iceGalleryPublishAction,
  iceGalleryRestoreAction, iceGallerySaveAction, iceGalleryStateAction, iceGalleryVersionsAction, iceHistoryAction,
  iceLibraryAction, icePageAction, icePageHistoryAction, iceRegisterUploadAction, iceSetEditAction, iceSlotSaveAction,
  iceSlotStateAction, iceTextSaveAction, iceTextStateAction, iceUploadTicketAction, iceUsageAction,
} from "@/app/actions/ice";
import type { IceTransport } from "@/lib/ice/types";

/** The real transport: the editor's server actions. A probe passes its own. */
export const actionsTransport: IceTransport = {
  setEdit: iceSetEditAction,
  page: icePageAction,
  textState: iceTextStateAction,
  textSave: iceTextSaveAction,
  slotState: iceSlotStateAction,
  slotSave: iceSlotSaveAction,
  history: iceHistoryAction,
  pageHistory: icePageHistoryAction,
  library: iceLibraryAction,
  usage: iceUsageAction,
  assets: iceAssetsAction,
  uploadTicket: iceUploadTicketAction,
  registerUpload: iceRegisterUploadAction,
  cmsMap: iceCmsMapAction,
  cmsSave: iceCmsSaveAction,
  galleryState: iceGalleryStateAction,
  gallerySave: iceGallerySaveAction,
  galleryPublish: iceGalleryPublishAction,
  galleryDiscard: iceGalleryDiscardAction,
  galleryVersions: iceGalleryVersionsAction,
  galleryRestore: iceGalleryRestoreAction,
};
