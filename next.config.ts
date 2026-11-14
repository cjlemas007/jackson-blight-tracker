import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "@google-cloud/bigquery"],
};

export default nextConfig;
