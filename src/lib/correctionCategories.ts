/** Shared with the client-side correction form. */
export const CORRECTION_CATEGORIES = [
  { id: "not_blighted", label: "This property isn't blighted" },
  { id: "fixed_or_demolished", label: "It's been repaired, cleared or demolished" },
  { id: "wrong_owner", label: "The owner is wrong" },
  { id: "wrong_parcel", label: "Wrong address or parcel" },
  { id: "privacy", label: "A face, plate or private detail is visible in a photo" },
  { id: "wrong_status", label: "The City action or status is wrong" },
  { id: "other", label: "Something else" },
] as const;
