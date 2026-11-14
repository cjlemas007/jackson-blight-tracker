import sharp from "sharp";

/** Decimal degrees -> EXIF rational "deg/1 min/1 sec*100/100". */
function dms(v: number): string {
  const a = Math.abs(v);
  const d = Math.floor(a);
  const m = Math.floor((a - d) * 60);
  const s = Math.round(((a - d) * 60 - m) * 60 * 100);
  return `${d}/1 ${m}/1 ${s}/100`;
}

/** A JPEG carrying camera EXIF: GPS, capture time, make/model, optional orientation. */
export async function jpegWithExif(opts: {
  lat?: number;
  lon?: number;
  takenAt?: string; // "YYYY:MM:DD HH:MM:SS"
  width?: number;
  height?: number;
  orientation?: number;
  color?: string;
}): Promise<Buffer> {
  const { width = 400, height = 300 } = opts;
  // Left half dark, right half light, so we can check blur stays inside its box.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="${width / 2}" height="${height}" fill="#202020"/>
    <rect x="${width / 2}" width="${width / 2}" height="${height}" fill="${opts.color ?? "#e0e0e0"}"/>
    ${Array.from({ length: 20 }, (_, i) => `<rect x="${i * 20}" y="0" width="10" height="${height}" fill="#ff0000"/>`).join("")}
  </svg>`;
  const exif: Record<string, Record<string, string>> = { IFD0: { Make: "TestCam", Model: "X1" } };
  if (opts.takenAt) exif.IFD2 = { DateTimeOriginal: opts.takenAt };
  if (opts.lat !== undefined && opts.lon !== undefined) {
    exif.IFD3 = {
      GPSLatitudeRef: opts.lat >= 0 ? "N" : "S",
      GPSLatitude: dms(opts.lat),
      GPSLongitudeRef: opts.lon >= 0 ? "E" : "W",
      GPSLongitude: dms(opts.lon),
    };
  }
  let img = sharp(Buffer.from(svg)).jpeg().withExif(exif);
  // withExif doesn't write Orientation; withMetadata does.
  if (opts.orientation) img = img.withMetadata({ orientation: opts.orientation });
  return img.toBuffer();
}
