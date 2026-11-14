// MapLibre v6 loads its web worker as a separate module file, which Next's bundler doesn't
// emit. Serve the installed version's worker from /public instead (see MapApp setWorkerUrl).
import { copyFileSync } from "node:fs";
copyFileSync("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", "public/maplibre-gl-worker.mjs");
