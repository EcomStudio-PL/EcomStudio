/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '*.supabase.co' }],
  },
  // sharp ships prebuilt native binaries; bundling it breaks the .node loads.
  serverExternalPackages: ['sharp'],
};
export default nextConfig;
