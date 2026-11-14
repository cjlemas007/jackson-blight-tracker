"use client";

import { useEffect, useState } from "react";

interface HistoryItem {
  id: number;
  status: string;
  substatus: string | null;
  effective_date: string;
  source: string;
  note: string | null;
}

interface Parcel {
  parcel_id: string;
  situs_address: string | null;
  owner_name: string | null;
  owner_type: string;
  owner_estate_heirs: boolean;
  homestead: boolean;
  attributed_owner: string | null;
  portfolio_source: string;
  appraised_total: number | null;
  tv_imp: number | null;
  acreage: number | null;
  year_built: number | null;
  deed_date: string | null;
  current_due: number | null;
  latest_tax_year: number | null;
  delinquent: boolean | null;
  on_tax_roll: boolean;
  owner_source: "land_roll" | "parcel_map";
  current_due_estimated: boolean | null;
  tax_conflict: boolean | null;
  unpaid_years: number[] | null;
  in_city: boolean;
  ward: string | null;
  neighborhood_name: string | null;
  zip: string | null;
  tract_name: string | null;
  location_source: string;
  status: string;
  substatus: string | null;
  status_since: string | null;
  owner_as_of: string | null;
  history: HistoryItem[];
}

const OWNER_TYPE: Record<string, string> = {
  private: "Private owner",
  state_forfeited: "State of Mississippi (tax-forfeited)",
  city: "City of Jackson",
  public: "Other public body",
};
const STATUS: Record<string, string> = {
  unreported: "Not reported",
  verified_blighted: "Verified blighted",
  city_action: "City action pending",
  resolved: "Resolved",
};
const SUB: Record<string, string> = {
  cited: "Cited", hearing_set: "Hearing set", adjudicated: "Adjudicated by council",
  demolition_ordered: "Demolition ordered", lot_cleanup_ordered: "Lot cleanup ordered", lien_filed: "Lien filed",
  demolished: "Demolished", repaired: "Repaired", lot_cleared: "Lot cleared", rejected_on_recheck: "Rejected on re-check",
};
const SOURCE: Record<string, string> = {
  user_photo: "Reader photo", admin_entry: "Newsroom entry", city_record: "City record",
  council_agenda: "Council agenda", survey: "Newsroom survey", land_roll: "Land roll",
};
const LOCATION: Record<string, string> = {
  gis_polygon: "Parcel map",
  gis_situs_match: "Matched by address to the parcel map",
  gis_parent_parcel: "Approximate: parent parcel's location",
  census: "Approximate: Census geocoder",
  none: "Not located",
};

const usd = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function ParcelPanel({ county, parcelId, onClose }: { county: string; parcelId: string; onClose: () => void }) {
  const [data, setData] = useState<Parcel | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    fetch(`/api/parcels/${encodeURIComponent(county)}/${encodeURIComponent(parcelId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [county, parcelId]);

  return (
    <section className="panel" aria-label="Parcel details">
      <header>
        <h3>{data?.situs_address ?? (error ? "Parcel" : "Loading…")}</h3>
        <div className="pid">Parcel {parcelId} · Hinds County</div>
        <button className="close" onClick={onClose} aria-label="Close">×</button>
      </header>
      <div className="body">
        {error && <div className="empty">Couldn&apos;t load this parcel ({error}).</div>}
        {data && (
          <>
            <div>
              <span className="badge">
                {STATUS[data.status] ?? data.status}
                {data.substatus && ` · ${SUB[data.substatus] ?? data.substatus}`}
              </span>
              {data.status_since && <span className="flag"> since {data.status_since}</span>}
            </div>

            <div className="section">
              <h4>Photos</h4>
              <div className="empty">No approved photos yet.</div>
            </div>

            <div className="section">
              <h4>Owner of record</h4>
              <dl className="dl">
                <dt>Owner</dt>
                <dd>{data.owner_name ?? "—"}</dd>
                <dt>Type</dt>
                <dd>
                  {OWNER_TYPE[data.owner_type] ?? data.owner_type}
                  {data.owner_estate_heirs && " · estate/heirs"}
                  {data.homestead && " · homestead exemption"}
                </dd>
                {data.attributed_owner && (
                  <>
                    <dt>Portfolio</dt>
                    <dd>{data.attributed_owner}</dd>
                  </>
                )}
                <dt>Source</dt>
                <dd>
                  {data.owner_source === "land_roll" ? "Hinds County land roll" : "County parcel map"}
                  {data.owner_as_of && `, as of ${data.owner_as_of}`}
                </dd>
              </dl>
            </div>

            <div className="section">
              <h4>Land roll</h4>
              <dl className="dl">
                <dt>Appraised</dt>
                <dd>{usd(data.appraised_total)}</dd>
                <dt>Improvements</dt>
                <dd>{data.tv_imp === null ? "—" : usd(data.tv_imp)}</dd>
                <dt>Year built</dt>
                <dd>{data.year_built ?? "—"}</dd>
                <dt>Last deed</dt>
                <dd>{data.deed_date ?? "—"}</dd>
                <dt>{data.latest_tax_year ?? "Current"} taxes</dt>
                <dd>
                  {data.delinquent === null
                    ? data.on_tax_roll
                      ? "No tax record found"
                      : "Not in our tax data (parcel-map record only)"
                    : data.delinquent
                      ? `${usd(data.current_due)} unpaid`
                      : "Paid / none due"}
                  {data.delinquent && data.current_due_estimated && <div className="flag">Estimated from the bill; excludes interest.</div>}
                  {data.tax_conflict && <div className="flag">County records show both a payment and a balance.</div>}
                </dd>
              </dl>
            </div>

            <div className="section">
              <h4>Area</h4>
              <dl className="dl">
                <dt>Ward</dt>
                <dd>{data.ward ? `Ward ${data.ward}` : "—"}</dd>
                <dt>Neighborhood</dt>
                <dd>{data.neighborhood_name ?? "—"}</dd>
                <dt>ZIP</dt>
                <dd>{data.zip ?? "—"}</dd>
                <dt>Census tract</dt>
                <dd>{data.tract_name ?? "—"}</dd>
                <dt>Location</dt>
                <dd>{LOCATION[data.location_source] ?? data.location_source}</dd>
              </dl>
            </div>

            <div className="section">
              <h4>Status history</h4>
              {data.history.length === 0 ? (
                <div className="empty">No verified reports for this parcel.</div>
              ) : (
                <ul className="timeline">
                  {data.history.map((h) => (
                    <li key={h.id}>
                      <div>
                        {STATUS[h.status] ?? h.status}
                        {h.substatus && ` · ${SUB[h.substatus] ?? h.substatus}`}
                      </div>
                      <div className="when">
                        {h.effective_date} · {SOURCE[h.source] ?? h.source}
                      </div>
                      {h.note && <div>{h.note}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
