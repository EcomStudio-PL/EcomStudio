import { legalPdfResponse } from "@/lib/server/legal/pdf-route";

// The published data processing agreement (Załącznik nr 2 do Regulaminu) as
// an A4 PDF (lib/server/legal/pdf-route.ts).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return legalPdfResponse(request, "umowa-powierzenia-danych");
}
