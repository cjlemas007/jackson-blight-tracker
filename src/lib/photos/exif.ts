import exifr from "exifr";

export interface PhotoExif {
  takenAt: string | null; // ISO timestamp
  lat: number | null;
  lon: number | null;
  camera: string | null;
}

/**
 * EXIF capture time has no zone unless OffsetTimeOriginal is present; phones in Jackson
 * record local time, so assume Central when it's missing.
 */
function toIso(raw: unknown, offset: unknown): string | null {
  if (typeof raw !== "string") return raw instanceof Date && !Number.isNaN(raw.getTime()) ? raw.toISOString() : null;
  const m = raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const local = `${y}-${mo}-${d}T${h}:${mi}:${s}`;
  if (typeof offset === "string" && /^[+-]\d{2}:\d{2}$/.test(offset)) return new Date(`${local}${offset}`).toISOString();
  // Central: CDT (-05:00) mid-March to early November, else CST (-06:00). Pick by trying both.
  for (const off of ["-05:00", "-06:00"]) {
    const dt = new Date(`${local}${off}`);
    const back = dt.toLocaleString("sv-SE", { timeZone: "America/Chicago" }).replace(" ", "T");
    if (back === local) return dt.toISOString();
  }
  return new Date(`${local}-06:00`).toISOString();
}

export async function readExif(buf: Buffer): Promise<PhotoExif> {
  try {
    const raw = await exifr.parse(buf, { gps: true, reviveValues: false, translateValues: false, mergeOutput: true });
    const gps = await exifr.gps(buf).catch(() => null);
    const lat = gps && Number.isFinite(gps.latitude) ? gps.latitude : null;
    const lon = gps && Number.isFinite(gps.longitude) ? gps.longitude : null;
    const valid = lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
    const camera = [raw?.Make, raw?.Model].filter((v) => typeof v === "string" && v.trim()).join(" ").trim() || null;
    return {
      takenAt: toIso(raw?.DateTimeOriginal ?? raw?.CreateDate, raw?.OffsetTimeOriginal),
      lat: valid ? lat : null,
      lon: valid ? lon : null,
      camera,
    };
  } catch {
    return { takenAt: null, lat: null, lon: null, camera: null };
  }
}
