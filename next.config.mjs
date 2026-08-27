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
 * Realtime websockets are not used (no .channel() anywhere), so no wss:.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co",
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "Content-Security-Policy", value: csp },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '*.supabase.co' }],
  },
  // sharp ships prebuilt native binaries; bundling it breaks the .node loads.
  serverExternalPackages: ['sharp'],
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};
export default nextConfig;
