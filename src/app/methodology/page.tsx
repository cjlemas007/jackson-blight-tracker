import SiteHeader from "@/components/SiteHeader";
import PageHead from "@/components/PageHead";
import { currentStaff } from "@/lib/auth/session";
import { APPROVAL_STANDARD, CONDITIONS } from "@/lib/approval";
import { FULLY_SURVEYED_SHARE, STREET_MIN_PARCELS, SURVEY_VALID_DAYS, SITE_NAME } from "@/config";
import { STALE_DAYS_DEFAULT } from "@/lib/cityResponse";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata = { title: `How this works · ${SITE_NAME}` };

export default async function Methodology() {
  const [staff, counts] = await Promise.all([
    currentStaff(),
    query<{ map_only: number; total: number }>(
      "SELECT count(*) FILTER (WHERE NOT on_tax_roll)::int AS map_only, count(*)::int AS total FROM app.parcel_facts WHERE in_city",
    ),
  ]);
  const { map_only, total } = counts[0];
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return (
    <div className="page">
      <SiteHeader staff={staff} />
      <main className="wrap" style={{ lineHeight: 1.55 }}>
        <PageHead kicker="Methodology" title="How this works" />
        <p className="dek">
          {SITE_NAME} tracks blighted property inside Jackson city limits: which parcels are blighted, who owns them, and what the
          City is doing about them. Every figure on the site is calculated from a dated history kept for each parcel. No number
          is typed in by hand.
        </p>

        <section className="article-section">
          <h2>Where the property data comes from</h2>
          <ul>
            <li><strong>Owners, values and taxes</strong> come from the Hinds County land roll and tax records, updated nightly. Each parcel shows the date of the record its owner comes from.</li>
            <li><strong>Parcel shapes and addresses</strong> come from the county parcel map published by the City of Jackson. Of Jackson&apos;s {total.toLocaleString()} parcels, {map_only.toLocaleString()} are on the parcel map but not in the tax records we have, many of them public land. For those, ownership comes from the parcel map and tax status is shown as unknown.</li>
            <li><strong>Areas</strong>: city limits and council wards come from the City of Jackson; census tracts and ZIP code areas from the U.S. Census Bureau. <strong>Neighborhood lines are unofficial</strong> (the City publishes none) and don&apos;t cover every part of the city.</li>
            <li><strong>Owner groups</strong>: different LLCs and spellings often belong to one owner. Some groups were researched by the newsroom using mailing addresses and Secretary of State filings. Others are grouped automatically because the parcels share a mailing address, and those are labeled as unverified, since a shared address can belong to an agent or management company.</li>
          </ul>
        </section>

        <section className="article-section">
          <h2>How a parcel becomes &ldquo;verified blighted&rdquo;</h2>
          <ol>
            <li>A member of the newsroom staff photographs the property from the street, the sidewalk, or their own property, and marks which conditions they see: {CONDITIONS.map((c) => c.label.toLowerCase()).join("; ")}.</li>
            <li>The photo&apos;s location and time are read from the camera data and checked against the parcel, then removed from the published copy. Faces and license plates are blurred, automatically and then checked by an editor.</li>
            <li>An editor reviews the submission against a written standard. Every item must be met:
              <ul>{APPROVAL_STANDARD.map((a) => <li key={a.id}>{a.text}</li>)}</ul>
            </li>
            <li>Only then does anything about the parcel become public, dated the day it was approved. Later photos of the same parcel build a dated photo timeline, which is how repairs and demolitions are documented.</li>
          </ol>
          <p style={{ marginBottom: 0 }}>
            <strong>City-flagged parcels.</strong> When City records show a citation, hearing or council action on a parcel our staff
            hasn&apos;t checked, we show it separately as &ldquo;City-flagged&rdquo; and do not count it as verified blight until we do.
          </p>
        </section>

        <section className="article-section">
          <h2>What the numbers mean</h2>
          <ul>
            <li><strong>Blighted</strong> means a parcel the newsroom has verified whose current status is &ldquo;verified blighted&rdquo; or &ldquo;City action pending.&rdquo; Repaired, cleared or demolished parcels no longer count.</li>
            <li><strong>Owner rankings</strong> count an owner&apos;s blighted parcels across every name and LLC in their group. Homestead-exempt homes and parcels held by heirs or estates are left out of owner rankings, though they still count in street and area totals.</li>
            <li><strong>Street rankings</strong> divide blighted parcels by all parcels on the street. Streets with fewer than {STREET_MIN_PARCELS} parcels are left out so a short street can&apos;t top the list.</li>
            <li><strong>Change over 30 and 90 days</strong> compares the number of blighted parcels today with the same count on that earlier date, using each parcel&apos;s dated history.</li>
            <li><strong>Demolitions</strong> count the first time a parcel is recorded as demolished, from City records or our own reporting, whether or not we had verified it as blighted before.</li>
            <li><strong>City response times</strong> are medians: days from our verification to the City&apos;s first recorded action, and to resolution. Parcels the City acted on before we verified them aren&apos;t included in those medians. &ldquo;Waiting on the City&rdquo; lists parcels we verified more than {STALE_DAYS_DEFAULT} days ago with no City action since.</li>
          </ul>
        </section>

        <section className="article-section">
          <h2>Coverage: why many figures say &ldquo;reported so far&rdquo;</h2>
          <p>
            A neighborhood where several people have sent photos would otherwise look worse than one nobody has visited. So newsroom
            staff also <strong>survey</strong> streets and areas, looking at every parcel and recording blighted or not blighted.
            A survey counts for {SURVEY_VALID_DAYS} days.
          </p>
          <ul>
            <li>Every ranking shows how much of it has been surveyed (&ldquo;62% of parcels surveyed&rdquo;).</li>
            <li>A street or area is <strong>fully surveyed</strong> when at least {pct(FULLY_SURVEYED_SHARE)} of its parcels have been surveyed. Only then is its share shown as a rate.</li>
            <li>Everywhere else, the share is shown as &ldquo;at least X% (reported so far)&rdquo;: a floor, because parcels nobody has checked may also be blighted.</li>
            <li>Rankings can be limited to fully surveyed streets and areas.</li>
          </ul>
        </section>

        <section className="article-section">
          <h2>City actions and sources</h2>
          <p style={{ marginBottom: 0 }}>
            Citations, hearings, council adjudications, demolition and cleanup orders, liens and demolitions come from City records
            obtained by records request, City Council agendas, and our own reporting. Each entry is dated and, where possible, links
            to its source document. Changes in the land roll, such as a new owner or a building&apos;s value dropping to zero, are
            flagged for an editor to check, never applied automatically. Mistaken entries are voided with a reason, never edited
            or deleted.
          </p>
        </section>

        <section className="article-section">
          <h2>Requesting a correction</h2>
          <p style={{ marginBottom: 0 }}>
            Every parcel and owner page has a <strong>&ldquo;Request a correction&rdquo;</strong> link. Tell us what&apos;s wrong and how you
            know: the house was repaired, the owner changed, a face is visible in a photo, or anything else. A name and email are
            optional and seen only by our editors. Every request is reviewed, and the outcome is logged.
          </p>
        </section>
      </main>
    </div>
  );
}
