import { SITE_NAME } from "@/config";

/** Shared wrapper: title, content, and a source line linking back to the site. */
export default function EmbedFrame({ title, children, link = "/" }: { title?: string; children: React.ReactNode; link?: string }) {
  const asOf = new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "long", day: "numeric", year: "numeric" });
  return (
    <div style={{ padding: 12, background: "#fff", fontFamily: "system-ui, sans-serif", color: "#1d2433", minHeight: "100%" }}>
      {title && <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>{title}</div>}
      {children}
      <div style={{ fontSize: 11, color: "#5f6675", marginTop: 8 }}>
        Source: <a href={link} target="_blank" rel="noreferrer" style={{ color: "#5f6675" }}>{SITE_NAME}</a> · as of {asOf} ·{" "}
        <a href="/methodology" target="_blank" rel="noreferrer" style={{ color: "#5f6675" }}>how this works</a>
      </div>
    </div>
  );
}
