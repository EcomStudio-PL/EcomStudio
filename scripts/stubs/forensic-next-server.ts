/** Test stub for next/server: NextResponse.json as a plain Response; `after` dropped. */
export function after(_fn: () => unknown): void {}
export class NextResponse extends Response {
  static json(body: unknown, init?: { status?: number }) {
    return new Response(JSON.stringify(body), { status: init?.status ?? 200, headers: { "content-type": "application/json" } });
  }
}
