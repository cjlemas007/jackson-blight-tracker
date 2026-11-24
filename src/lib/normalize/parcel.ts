/**
 * Hinds parcel IDs as the land roll and tax records write them: uppercase, no spaces, and no zero
 * padding in any part. The County parcel map pads some sub-parcel numbers ("59-10-010" for the land
 * roll's "59-10-10"), which hid those parcels' shapes from the app until 2026-11-24.
 *
 *   "59-10-010" -> "59-10-10"   "0059-10" -> "59-10"   " 4854 104-6 " -> "4854104-6"
 */
export function canonicalParcelId(v: string | null | undefined): string | null {
  const s = (v ?? "").toUpperCase().replace(/\s+/g, "").replace(/(^|-)0+(?=\d)/g, "$1");
  return s || null;
}
