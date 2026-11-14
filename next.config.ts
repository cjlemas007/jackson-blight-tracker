import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "@google-cloud/bigquery", "sharp", "onnxruntime-web"],
};

export default nextConfig;
