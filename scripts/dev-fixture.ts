/** Writes a test JPEG with Jackson GPS + capture time EXIF to public/dev-fixtures (dev only, gitignored). */
import { writeFileSync } from "node:fs";
import { jpegWithExif } from "../tests/helpers/images";
const [lat, lon, out] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4]];
writeFileSync(out, await jpegWithExif({ lat, lon, takenAt: "2026:11:12 10:15:00", width: 1600, height: 1200 }));
console.log(`wrote ${out}`);
