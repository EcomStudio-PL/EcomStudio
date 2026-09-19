/**
 * Security headers are set here so every route — pages, API handlers,
 * static assets — carries them without per-route wiring.
 *
 * The CSP is built from the origins the app ACTUALLY uses:
 *  - connect-src: Supabase (auth, PostgREST, storage uploads/signed URLs)
 *  - img/media:   signed Supabase URLs plus arbitrary https, because the
 *                 admin CMS/media/inspirations accept external https media
 *  - frame-src:   YouTube/Vimeo — the only allowed CMS embeds
 *  - script/style: 'unsafe-inline' is required by Next's bootstrap script
 *                 and next-themes' theme snippet; external script hosts stay
 *                 blocked, which is the attack CSP is here to stop.
 *  - challenges.cloudflare.com: Turnstile on /register — its api.js
 *                 (script-src), the challenge iframe it opens (frame-src)
 *                 and the widget's own verification calls (connect-src).
 * Realtime websockets are not used (no .channel() anywhere), so no wss:.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co https://challenges.cloudflare.com",
  // 'self' is here for the CMS builder: the page preview is this app's own
  // preview route in an iframe, which is the only way a preview can answer a
  // media query the way a real 375px phone does. A container scaled with a
  // transform looks right and lies — it still reports the desktop viewport.
  "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://challenges.cloudflare.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // SAME-ORIGIN, not 'none'. Clickjacking is a CROSS-origin attack: another
  // site framing ours and stealing a click. That is still refused. What is now
  // allowed is GrovBase framing GrovBase, which is the builder previewing a
  // page, and carries none of that risk. A custom-code block runs in a
  // sandboxed frame with no same-origin access and is unaffected either way.
  "frame-ancestors 'self'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Paired with frame-ancestors above: third-party framing stays refused.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "Content-Security-Policy", value: csp },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    /*
      THE OPTIMISER FETCHES WHATEVER THIS ALLOWS (P1-32).

      `*.supabase.co` is every Supabase project in the world, not ours. Next's
      image route takes an arbitrary `url` query parameter and fetches it
      server-side, so a permissive pattern turns /_next/image into an open
      proxy for that entire domain: anyone can have our deployment fetch and
      cache a stranger's project, on our bandwidth and behind our IP.

      Narrowed to the one project this deployment actually reads from, and
      derived rather than written out, so a preview or a development
      deployment allows ITS OWN project and no other. On production it
      resolves to exactly the host the app already used, so no image that
      renders today stops rendering.

      THE PATH IS DELIBERATELY NOT PINNED. Pinning
      /storage/v1/object/public/** would be tighter and is wrong here: most of
      what this app renders is a SIGNED url under /storage/v1/object/sign/,
      because generated work is private. The two prefixes would have to be
      listed exactly, and a third one nobody remembered would break the
      Library silently. Narrowing the host is what closes the finding — the
      proxy could reach every Supabase project in the world; now it reaches
      one, whose contents we serve anyway.
    */
    remotePatterns: [{
      protocol: 'https',
      hostname: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL
        ?? 'https://orjkxijqpecnbzhxhfct.supabase.co').hostname,
    }],
  },
  // sharp ships prebuilt native binaries; bundling it breaks the .node loads.
  // imapflow and mailparser reach for their encodings and TLS pieces through
  // dynamic requires the bundler cannot follow, so they stay external too —
  // bundled, they fail at runtime on the first IMAP connection.
  serverExternalPackages: ['sharp', 'imapflow', 'mailparser'],
  experimental: {
    // Replying with an attachment posts the file through a server action, and
    // the 1MB default rejects anything past a screenshot. 4.5mb is where Vercel
    // itself stops a serverless request body, so accepting more here would only
    // trade the action's own "attachment too large" for an opaque platform 413.
    serverActions: { bodySizeLimit: '4.5mb' },
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};
export default nextConfig;
