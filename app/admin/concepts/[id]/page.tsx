import { redirect } from "next/navigation";

/** One concept session, now under the control centre. */
export default async function Moved({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/admin/ai/sesje/${id}`);
}
