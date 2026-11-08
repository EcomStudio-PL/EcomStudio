import { notFound } from "next/navigation";
import { ProcessView } from "@/components/admin/grovshot-process/view";

/**
 * GROVBASE SHOT → the process view of one order. Under /admin: the admin
 * layout checks the role on the server before anything renders; the data
 * route behind the view checks it again. Customers never load this code.
 */
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function GrovshotProcessPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ shot?: string }>;
}) {
  const { id } = await params;
  const { shot } = await searchParams;
  if (!UUID.test(id)) notFound();
  const n = shot && /^\d{1,2}$/.test(shot) ? Number(shot) : null;
  return <ProcessView runId={id} initialShot={n} />;
}
