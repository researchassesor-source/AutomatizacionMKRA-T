import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "R.A. Training CRM",
    short_name: "R.A. CRM",
    description: "Sistema de Gestión de Relaciones con Clientes de R.A. Training.",
    start_url: "/admin",
    display: "standalone",
    background_color: "#f4f7fb",
    theme_color: "#082a5c",
    lang: "es-EC",
    icons: [
      { src: "/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
