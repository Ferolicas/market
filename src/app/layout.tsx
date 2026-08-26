import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mini Market — Tu imperio de supermercados",
  description: "Simulador 3D de empresa, empleados, producción y franquicias.",
  applicationName: "Mini Market",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Mini Market" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false, viewportFit: "cover", themeColor: "#173f35", interactiveWidget: "resizes-content" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
