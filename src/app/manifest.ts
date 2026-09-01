import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mini Market — Tu imperio de supermercados",
    short_name: "Mini Market",
    description: "Simulador 3D de supermercados, empleados y franquicias.",
    start_url: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#eaf7ee",
    theme_color: "#163c32",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
