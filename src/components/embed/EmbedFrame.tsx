import { SITE_NAME } from "@/config";

/** Shared wrapper: kicker-style title, content, and a source line linking back to the site. */
export default function EmbedFrame({ title, children, link = "/" }: { title?: string; children: React.ReactNode; link?: string }) {
  const asOf = new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "long", day: "numeric", year: "numeric" });
  return (
    <div className="embed">
      {title && <div className="embed-title">{title}</div>}
      {children}
      <div className="embed-source">
        <span className="brand-mark" aria-hidden /> Source: <a href={link} target="_blank" rel="noreferrer">{SITE_NAME}</a> · as of {asOf} ·{" "}
        <a href="/methodology" target="_blank" rel="noreferrer">how this works</a>
      </div>
    </div>
  );
}
