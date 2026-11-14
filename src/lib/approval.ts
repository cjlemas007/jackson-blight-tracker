/**
 * The approval standard, shown as a checklist on every review so verification is consistent
 * across staff. Every item must be ticked to approve. DRAFT wording: the newsroom should edit it.
 */
export const APPROVAL_STANDARD = [
  { id: "right_parcel", text: "The photos show the property at this address (camera location, house number, or street view agree)." },
  { id: "public_vantage", text: "Taken from the street, sidewalk, or the submitter's own property, not from inside the lot or building." },
  { id: "condition_visible", text: "At least one checked condition is clearly visible in the photos." },
  { id: "current", text: "The photos are recent (camera date within about 90 days, or the submitter says so)." },
  { id: "not_active_work", text: "No sign of active construction or renovation that explains the condition." },
  { id: "privacy", text: "Every face and license plate is blurred, and no person is identifiable." },
] as const;

export type ApprovalItem = (typeof APPROVAL_STANDARD)[number]["id"];

export const CONDITIONS = [
  { id: "vacant_open", label: "Vacant and open" },
  { id: "fire_damage", label: "Fire damage" },
  { id: "structural_collapse", label: "Roof or structural collapse" },
  { id: "overgrown", label: "Overgrown" },
  { id: "dumping", label: "Dumping" },
  { id: "boarded", label: "Boarded" },
  { id: "vacant_lot_overgrown_dumping", label: "Vacant lot: overgrown or dumping" },
] as const;

export const NOTE_MAX = 300;
export const MAX_PHOTOS = 5;
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
export const ACCEPTED_MIME = ["image/jpeg", "image/png", "image/webp"];
