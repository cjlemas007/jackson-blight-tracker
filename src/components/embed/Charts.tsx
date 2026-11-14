/** Dependency-free SVG charts for embeds (server-rendered). */

import { INK, MUTED, RULE, STATUS_COLORS } from "@/lib/palette";

/**
 * Horizontal bars as HTML (not SVG), so labels stay real-size text on phones and in narrow embeds.
 */
export function HBarChart({
  rows,
  color = STATUS_COLORS.verified_blighted,
  valueLabel = (v: number) => v.toLocaleString(),
  note,
}: {
  rows: { label: string; value: number }[];
  width?: number;
  color?: string;
  valueLabel?: (v: number) => string;
  note?: (i: number) => string | undefined;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="hbar" role="list">
      {rows.map((r, i) => (
        <div className="hbar-row" role="listitem" key={`${r.label}-${i}`}>
          <span className="hbar-label" title={r.label}>{r.label}</span>
          <span className="hbar-track">
            <span className="hbar-fill" style={{ width: `${(100 * r.value) / max}%`, background: color, minWidth: r.value > 0 ? 2 : 0 }} />
          </span>
          <span className="hbar-val">
            {valueLabel(r.value)}
            {note?.(i) && <small>{note(i)}</small>}
          </span>
        </div>
      ))}
    </div>
  );
}

export function WeeklyColumns({
  points,
  series,
  width = 640,
  height = 240,
}: {
  points: { week: string; [k: string]: number | string }[];
  series: { key: string; label: string; color: string }[];
  width?: number;
  height?: number;
}) {
  const padL = 36, padB = 34, padT = 26;
  const plotW = width - padL - 8;
  const plotH = height - padB - padT;
  const max = Math.max(1, ...points.flatMap((p) => series.map((s) => Number(p[s.key]))));
  const step = plotW / Math.max(1, points.length);
  const bw = Math.max(2, (step - 6) / series.length);
  const ticks = [...new Set([0, Math.ceil(max / 2), max])];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label="Weekly chart" style={{ display: "block", fontFamily: "var(--font-sans-stack)" }}>
      {series.map((s, i) => (
        <g key={s.key} transform={`translate(${padL + i * 170}, 12)`}>
          <rect width="10" height="10" y="-9" fill={s.color} rx="2" />
          <text x="14" fontSize="12" fill={INK}>{s.label}</text>
        </g>
      ))}
      {ticks.map((t) => {
        const y = padT + plotH - (plotH * t) / max;
        return (
          <g key={t}>
            <line x1={padL} x2={width - 8} y1={y} y2={y} stroke={RULE} />
            <text x={padL - 6} y={y + 4} textAnchor="end" fontSize="11" fill={MUTED}>{t}</text>
          </g>
        );
      })}
      {points.map((p, i) => (
        <g key={p.week}>
          {series.map((s, j) => {
            const v = Number(p[s.key]);
            const h = (plotH * v) / max;
            return (
              <rect key={s.key} x={padL + i * step + 3 + j * bw} y={padT + plotH - h} width={bw - 1} height={h} fill={s.color} rx="1">
                <title>{`${s.label}, week of ${p.week}: ${v}`}</title>
              </rect>
            );
          })}
          {(i % Math.ceil(points.length / 6) === 0 || i === points.length - 1) && (
            <text x={padL + i * step + step / 2} y={height - 12} textAnchor="middle" fontSize="11" fill={MUTED}>
              {new Date(`${p.week}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

/**
 * Single-series weekly columns as HTML, newest week highlighted (it's the partial, current week).
 * Colors come from CSS tokens, so it follows the light/dark theme.
 */
export function WeeklyBars({ points, label }: { points: { week: string; value: number }[]; label: string }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const fmt = (w: string) => new Date(`${w}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return (
    <figure className="wcols" style={{ margin: 0 }} aria-label={label}>
      <div className="wcols-plot" role="list">
        {points.map((p, i) => (
          <div key={p.week} role="listitem" className={`wcols-col${i === points.length - 1 ? " last" : ""}`} title={`Week of ${fmt(p.week)}: ${p.value}`}>
            <span className="wcols-val">{p.value}</span>
            <span className="wcols-bar" style={{ height: `${(100 * p.value) / max * 0.82}%`, minHeight: p.value > 0 ? 2 : 0 }} />
          </div>
        ))}
      </div>
      <div className="wcols-axis" aria-hidden>
        {points.map((p, i) => <span key={p.week}>{i === points.length - 1 ? "This wk" : fmt(p.week)}</span>)}
      </div>
    </figure>
  );
}
