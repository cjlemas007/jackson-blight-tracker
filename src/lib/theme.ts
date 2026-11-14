"use client";
/** Reader's light/dark choice. The inline script in layout.tsx sets data-theme before first paint. */
import { useSyncExternalStore } from "react";
import type { Theme } from "./palette";

export function readTheme(): Theme {
  return typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function saved(): string | null {
  return /(?:^|; )theme=(light|dark)/.exec(document.cookie)?.[1] ?? null;
}

function subscribe(cb: () => void) {
  const root = document.documentElement;
  const mo = new MutationObserver(cb);
  mo.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  // With no saved choice, follow the system setting live.
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const onSystem = () => {
    if (saved() === null && !location.pathname.startsWith("/embed")) root.dataset.theme = mq.matches ? "dark" : "light";
  };
  mq.addEventListener("change", onSystem);
  return () => {
    mo.disconnect();
    mq.removeEventListener("change", onSystem);
  };
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, readTheme, () => "light");
}

export function setTheme(t: Theme) {
  // A cookie (not localStorage) so the server can render the chosen theme with no flash.
  document.cookie = `theme=${t}; path=/; max-age=31536000; samesite=lax`;
  document.documentElement.dataset.theme = t;
}
