import { GrovNewsAdminNav } from "@/components/admin/grovnews/nav";

/** GrovNews inside the newsletter module. The newsletter layout above has
 *  already refused anyone whose profile role is not admin; every action is
 *  checked again on the server and every table again in RLS. */
export default function GrovNewsAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-grovnews-admin>
      <GrovNewsAdminNav />
      {children}
    </div>
  );
}
