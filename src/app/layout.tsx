import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RA-Training | Capacitate gratis y certifica tu futuro",
  description:
    "Cursos gratuitos de enganche para dar tu primer paso profesional. Capacitacion online, practica y sin costo.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>
        <header className="site-header">
          <div className="container">
            <a className="brand" href="/">
              RA<span>-Training</span>
            </a>
            <nav>
              <a href="/#cursos" style={{ textDecoration: "none", fontWeight: 600 }}>
                Cursos
              </a>
            </nav>
          </div>
        </header>
        {children}
        <footer className="footer">
          <div className="container">
            RA-Training · ra-training.com — Capacitacion profesional online.
          </div>
        </footer>
      </body>
    </html>
  );
}
