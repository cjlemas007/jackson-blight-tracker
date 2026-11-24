/**
 * CSV exports of every public table, with the same filters as the page (so a download matches what's
 * on screen). Only public fields: no mailing addresses, notes, contact details or staff names.
 */
import { toCsv } from "./csv";
import { areaRankings, ownerDetail, ownerRankings, streetRankings, AREA_KINDS, type AreaKind, type OwnerTab } from "./rankings";
import { needsNewsroomCheck, recentChanges, waitingOnCity, STALE_DAYS_DEFAULT } from "./cityResponse";
import { blightRateLabel } from "./coverage";
import { STREET_MIN_PARCELS } from "@/config";

export interface Export {
  filename: string;
  header: string[];
  rows: (string | number | null)[][];
}

const pct = (x: number) => (x * 100).toFixed(2);
const day = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Chicago" });

export const EXPORTS = ["owners", "owner", "streets", "areas", "waiting", "recent", "needs-check"] as const;
export type ExportName = (typeof EXPORTS)[number];

/** Staff-only exports (the needs-check list is a work list, not published). */
export const STAFF_EXPORTS: ExportName[] = ["needs-check"];

export async function buildExport(name: ExportName, p: URLSearchParams): Promise<Export | null> {
  switch (name) {
    case "owners": {
      const tab = (["private", "state", "public"].includes(p.get("tab") ?? "") ? p.get("tab") : "private") as OwnerTab;
      const rows = await ownerRankings(tab, 5000);
      return {
        filename: `owners-${tab}-${day()}.csv`,
        header: ["rank", "owner", "portfolio_id", "blighted", "blighted_excluded_homestead_estate", "city_flagged",
          "parcels_in_jackson", "share_blighted_pct", "unpaid_current_taxes", "parcels_surveyed"],
        rows: rows.map((r, i) => [i + 1, r.name, r.portfolio_id, r.blighted, r.blighted_excluded, r.city_flagged, r.total_parcels,
          pct(r.share_blighted), r.taxes_owed.toFixed(2), r.surveyed]),
      };
    }
    case "owner": {
      const id = p.get("id");
      if (!id) return null;
      const d = await ownerDetail(id);
      if (!d) return null;
      return {
        filename: `owner-${id.replace(/[^\w-]+/g, "_").slice(0, 60)}-${day()}.csv`,
        header: ["parcel_id", "address", "owner_of_record", "status", "substatus", "status_since", "unpaid_current_taxes",
          "excluded_from_ranking", "surveyed_on", "ward"],
        rows: d.parcels.map((r: Record<string, string | number | null>) => [r.parcel_id, r.situs_address, r.owner_name,
          r.status === "submitted" ? "unreported" : r.status, r.substatus, r.status_since, r.current_due, r.ranking_excluded_reason,
          r.surveyed_on, r.ward]),
      };
    }
    case "streets": {
      const sort = p.get("sort") === "pct" ? "pct" : "count";
      const min = Math.min(500, Math.max(1, Number(p.get("min")) || STREET_MIN_PARCELS));
      const surveyedOnly = p.get("coverage") === "surveyed";
      const rows = await streetRankings({ sort, minParcels: min, surveyedOnly, limit: 5000 });
      return {
        filename: `streets-${day()}.csv`,
        header: ["rank", "street", "blighted", "city_flagged", "parcels", "share_blighted_pct", "share_label",
          "parcels_surveyed", "fully_surveyed"],
        rows: rows.map((r, i) => [i + 1, r.street_name, r.blighted, r.city_flagged, r.total_parcels, pct(r.share_blighted),
          blightRateLabel(r.blighted, r.total_parcels, r.surveyed), r.surveyed, r.fully_surveyed ? "yes" : "no"]),
      };
    }
    case "areas": {
      const kind = ((AREA_KINDS as readonly string[]).includes(p.get("kind") ?? "") ? p.get("kind") : "ward") as AreaKind;
      const rows = await areaRankings(kind, p.get("coverage") === "surveyed");
      return {
        filename: `areas-${kind}-${day()}.csv`,
        header: [kind, "code", "blighted", "city_flagged", "parcels", "share_blighted_pct", "share_label",
          "change_30_days", "change_90_days", "parcels_surveyed", "fully_surveyed", "unofficial_boundary"],
        rows: rows.map((r) => [r.name, r.code, r.blighted, r.city_flagged, r.total_parcels, pct(r.share_blighted),
          blightRateLabel(r.blighted, r.total_parcels, r.surveyed), r.blighted - r.blighted_30d_ago, r.blighted - r.blighted_90d_ago,
          r.surveyed, r.fully_surveyed ? "yes" : "no", r.unofficial ? "yes" : "no"]),
      };
    }
    case "waiting": {
      const days = Math.min(3650, Math.max(1, Number(p.get("days")) || STALE_DAYS_DEFAULT));
      const rows = await waitingOnCity(days, 10000);
      return {
        filename: `waiting-on-city-${days}d-${day()}.csv`,
        header: ["parcel_id", "address", "owner", "ward", "verified_on", "days_waiting"],
        rows: rows.map((r) => [r.parcel_id, r.situs_address, r.owner_name, r.ward, r.verified_on, r.days_waiting]),
      };
    }
    case "recent": {
      const rows = await recentChanges(1000);
      return {
        filename: `recent-changes-${day()}.csv`,
        header: ["date", "parcel_id", "address", "status", "substatus", "source", "document_url"],
        rows: rows.map((r) => [r.effective_date, r.parcel_id, r.situs_address, r.status, r.substatus, r.source,
          r.document_id ? `/api/documents/${r.document_id}` : null]),
      };
    }
    case "needs-check": {
      const rows = await needsNewsroomCheck({ ward: p.get("ward"), limit: 10000 });
      return {
        filename: `needs-newsroom-check-${day()}.csv`,
        header: ["parcel_id", "address", "owner", "city_action", "since", "ward", "photo_in_review"],
        rows: rows.map((r) => [r.parcel_id, r.situs_address, r.owner_name, r.substatus, r.since, r.ward, r.submission_open ? "yes" : "no"]),
      };
    }
  }
}

/** UTF-8 BOM so Excel opens accented names correctly. */
export function exportToCsv(e: Export): string {
  return "﻿" + toCsv([e.header, ...e.rows]) + "\n";
}
