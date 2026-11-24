import type { Metadata, Viewport } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import { IBM_Plex_Mono, Inter, Newsreader, Space_Grotesk } from "next/font/google";

// Self-hosted by next/font at build time: no requests to Google from readers' browsers.
const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const serif = Newsreader({ subsets: ["latin"], variable: "--font-serif", display: "swap", style: ["normal", "italic"] });
// Dark theme only, so not preloaded.
const grotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-grotesk", display: "swap", preload: false });
const mono = IBM_Plex_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap", weight: ["400", "500", "600"], preload: false });
import Script from "next/script";
import { cookies } from "next/headers";
import { SITE_NAME } from "@/config";
import { query } from "@/lib/db";

export const metadata: Metadata = {
  title: SITE_NAME,
  description: "Blighted property in Jackson, Mississippi, built on the Hinds County land roll.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1116" },
  ],
};

/**
 * A reader's explicit choice is a cookie, so the server renders the right theme. With no choice,
 * this script follows the system setting before first paint. Embeds always render light (they sit
 * inside story pages).
 */
const THEME_SCRIPT = `(function(){var d=document.documentElement;if(location.pathname.indexOf('/embed')===0){d.dataset.theme='light';return}if(!d.dataset.theme){d.dataset.theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}})()`;

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
  const [demo, jar] = await Promise.all([hasDemoData(), cookies()]);
  const saved = jar.get("theme")?.value;
  const theme = saved === "dark" || saved === "light" ? saved : undefined;
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${grotesk.variable} ${mono.variable}`} data-theme={theme} suppressHydrationWarning>
      <body>
        <Script id="theme" strategy="beforeInteractive">{THEME_SCRIPT}</Script>
        {demo && (
          <div role="alert" className="demo-banner">
            DEMO DATA: blight statuses on this local copy are invented for testing (npm run dev:demo -- --clear removes them).
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
