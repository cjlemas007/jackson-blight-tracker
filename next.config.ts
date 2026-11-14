import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // NEXT_DIST_DIR lets a production check-build run without clobbering a running dev server's .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["pg", "@google-cloud/bigquery", "sharp", "onnxruntime-web"],
  // Only /embed/* may be framed by other sites (stories). Everything else, especially admin pages,
  // refuses framing to prevent clickjacking.
  async headers() {
    const noFrame = [
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
    ];
    return [
      { source: "/", headers: noFrame },
      { source: "/:path((?!embed/).*)", headers: noFrame },
      { source: "/embed/:path*", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors *" }] },
    ];
  },
};

export default nextConfig;
