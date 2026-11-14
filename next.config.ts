import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // NEXT_DIST_DIR lets a production check-build run without clobbering a running dev server's .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["pg", "@google-cloud/bigquery", "sharp", "onnxruntime-web"],
};

export default nextConfig;
