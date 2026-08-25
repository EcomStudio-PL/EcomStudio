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
    start_url: "/home",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0F1015",
    theme_color: "#0F1015",
    // ?v=3 busts the icon cache on phones that pinned the old artwork.
    icons: [
      { src: "/icons/icon-192.png?v=3", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png?v=3", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512-maskable.png?v=3", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
