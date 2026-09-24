import { execSync } from "node:child_process";
import type { NextConfig } from "next";

// Every bundle carries the commit it was built from; the client compares it
// with /api/health and reloads once its game is saved, so an installed PWA
// cannot keep running last week's code for days.
function buildId() {
  const fromCi = process.env.GITHUB_SHA ?? process.env.MARKET_BUILD_ID;
  if (fromCi) return fromCi.slice(0, 7);
  try { return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || "dev"; } catch { return "dev"; }
}

const nextConfig: NextConfig = {
  // React 19 development StrictMode double-mounts WebGL roots. R3F disposes the
  // first renderer asynchronously and can lose the live canvas context afterwards.
  // Production never double-mounts; keep local development on the same lifecycle.
  reactStrictMode: false,
  poweredByHeader: false,
  env: { NEXT_PUBLIC_BUILD_ID: buildId() },
  allowedDevOrigins: (process.env.LOCAL_DEV_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/^https?:\/\//, ""))
    .filter(Boolean),
  experimental: {
    optimizePackageImports: ["@react-three/drei"],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
