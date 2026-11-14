import type { Metadata, Viewport } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import { SITE_NAME } from "@/config";
import { query } from "@/lib/db";

export const metadata: Metadata = {
  title: SITE_NAME,
  description: "Verified blighted property in Jackson, Mississippi, built on the Hinds County land roll.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1d2433" };

/** True when scripts/dev-demo.ts has put fake history in this (local) database. */
async function hasDemoData(): Promise<boolean> {
  try {
    const rows = await query("SELECT 1 FROM app.status_events WHERE recorded_by = 'dev-demo' LIMIT 1");
    return rows.length > 0;
  } catch {
    return false;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const demo = await hasDemoData();
  return (
    <html lang="en">
      <body>
        {demo && (
          <div role="alert" style={{ background: "#b3261e", color: "#fff", padding: "6px 16px", fontSize: 13, fontWeight: 700, textAlign: "center" }}>
            DEMO DATA: blight statuses on this local copy are invented for testing (npm run dev:demo -- --clear removes them).
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
