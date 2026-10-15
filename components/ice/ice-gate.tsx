import { getScopedDictionary } from "@/lib/i18n/server";
import { I18nScope } from "@/lib/i18n/provider";
import { iceGateData } from "@/lib/server/ice/gate";
import { IceLauncherLazy } from "./launcher-lazy";

/**
 * THE VISUAL EDITOR'S DOOR, mounted by the root layout only when the browser
 * sent one of its cookies. For anybody but a verified admin it renders
 * nothing; for an admin, the small launcher, with the editor's own strings in
 * their own scope (`ice`) — no customer page carries them.
 */
export async function IceGate() {
  const data = await iceGateData();
  if (!data) return null;
  const { dict } = await getScopedDictionary("ice");
  return (
    <I18nScope dict={dict}>
      <IceLauncherLazy sessions={data.sessions} supported={data.supported} />
    </I18nScope>
  );
}
