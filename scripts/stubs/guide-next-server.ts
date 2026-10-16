/** Test-only stand-in for next/server (tool-guide suite): NextResponse.json
 *  as a plain Response that KEEPS the status and the headers it is given
 *  (the guide route's Cache-Control is part of what is tested). */

export function after(_fn: () => unknown): void {}

export class NextResponse extends Response {
  static json(body: unknown, init?: ResponseInit): NextResponse {
    const headers = new Headers(init?.headers);
    headers.set("content-type", "application/json");
    return new NextResponse(JSON.stringify(body), { status: init?.status ?? 200, headers });
  }
}
