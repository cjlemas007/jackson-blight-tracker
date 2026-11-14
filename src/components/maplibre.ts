"use client";
import * as maplibregl from "maplibre-gl";

// Worker copied into /public by scripts/copy-maplibre-worker.mjs (predev/prebuild).
maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

export default maplibregl;
export { maplibregl };
