import type { Metadata } from "next";
import "./globals.css";
import { RouteChrome } from "@/components/RouteChrome";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: { default: "R.A. Training CRM", template: "%s | R.A. Training CRM" },
  description: "Sistema de Gestión de Relaciones con Clientes de R.A. Training.",
  manifest: "/manifest.webmanifest",
  icons: {
    shortcut: "/favicon.ico",
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-48x48.png", sizes: "48x48", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    locale: "es_EC",
    siteName: "R.A. Training CRM",
    title: "R.A. Training CRM",
    description: "Sistema de Gestión de Relaciones con Clientes de R.A. Training.",
    images: [{ url: "/crm-og.png", width: 1200, height: 630, alt: "R.A. Training CRM" }],
  },
};

export const viewport = {
  themeColor: "#082a5c",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" data-scroll-behavior="smooth">
      <body>
        <RouteChrome>{children}</RouteChrome>
      </body>
    </html>
  );
}
