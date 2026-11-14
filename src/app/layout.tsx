import type { Metadata, Viewport } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import { SITE_NAME } from "@/config";

export const metadata: Metadata = {
  title: SITE_NAME,
  description: "Verified blighted property in Jackson, Mississippi, built on the Hinds County land roll.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1d2433" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
