"use client";
import * as maplibregl from "maplibre-gl";
import { useEffect, useRef, type RefObject } from "react";
import type { LayerSpecification } from "maplibre-gl";
import { BASEMAP_STYLE, BASEMAP_STYLE_DARK } from "@/config";
import type { Theme } from "@/lib/palette";
import { readTheme, useTheme } from "@/lib/theme";

// Worker copied into /public by scripts/copy-maplibre-worker.mjs (predev/prebuild).
maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

export default maplibregl;
export { maplibregl };

const styleTheme = new WeakMap<maplibregl.Map, Theme>();

/** Basemap for the current theme; call when creating a map so it starts in the right theme. */
export function initialBasemap(): string {
  return readTheme() === "dark" ? BASEMAP_STYLE_DARK : BASEMAP_STYLE;
}

type PaintFor = (theme: Theme) => Record<string, Record<string, unknown>>;

/**
 * Keeps a map in step with the light/dark toggle: swaps the basemap and re-themes our own layers
 * (those on `ownSources`) without tearing them down, so filters, selection and view survive.
 */
export function useMapTheme(mapRef: RefObject<maplibregl.Map | null>, ready: boolean, ownSources: string[], paintFor: PaintFor) {
  const theme = useTheme();
  const paint = useRef(paintFor);
  paint.current = paintFor;
  const sources = useRef(ownSources);
  sources.current = ownSources;

  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready) return;
    const was = styleTheme.get(m);
    if (!was) {
      // First run after load: the map was created with initialBasemap(); just theme our layers.
      styleTheme.set(m, readTheme());
      if (readTheme() === theme) {
        for (const [id, props] of Object.entries(paint.current(theme))) {
          if (!m.getLayer(id)) continue;
          for (const [k, v] of Object.entries(props)) (m.setPaintProperty as (l: string, p: string, v: unknown) => void).call(m, id, k, v);
        }
        return;
      }
    } else if (was === theme) return;
    styleTheme.set(m, theme);
    const own = sources.current;
    const overrides = paint.current(theme);
    m.setStyle(theme === "dark" ? BASEMAP_STYLE_DARK : BASEMAP_STYLE, {
      diff: false,
      transformStyle: (prev, next) => {
        if (!prev) return next;
        const srcs = { ...next.sources };
        for (const id of own) if (prev.sources[id]) srcs[id] = prev.sources[id];
        const layers = prev.layers
          .filter((l) => "source" in l && own.includes(l.source as string))
          .map((l) => {
            const o = overrides[l.id];
            return o ? ({ ...l, paint: { ...("paint" in l ? l.paint : {}), ...o } } as LayerSpecification) : l;
          });
        return { ...next, sources: srcs, layers: [...next.layers, ...layers] };
      },
    });
  }, [mapRef, ready, theme]);

  return theme;
}
