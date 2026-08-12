import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "EcomStudio",
    short_name: "EcomStudio",
    description: "Professional e-commerce product content, faster.",
    id: "/",
    // Launching the installed app straight into the workspace: signed-in
    // users land on the dashboard, signed-out users are sent to /login by
    // middleware and return to the dashboard once they authenticate.
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0B0E11",
    theme_color: "#0B0E11",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
