import type { Metadata } from "next";
import "./globals.css";
import { RouteChrome } from "@/components/RouteChrome";

export const metadata: Metadata = {
  title: { default: "R.A. Training CRM", template: "%s | R.A. Training CRM" },
  description: "Sistema de Gestión de Relaciones con Clientes de R.A. Training.",
  icons: {
    icon: [
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-48x48.png", sizes: "48x48", type: "image/png" },
    ],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <RouteChrome>{children}</RouteChrome>
      </body>
    </html>
  );
}
