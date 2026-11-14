/** Dependency-free SVG charts for embeds (server-rendered). */

const INK = "#1d2433";
const MUTED = "#5f6675";

export function HBarChart({
  rows,
  width = 640,
  color = "#c62828",
  valueLabel = (v: number) => v.toLocaleString(),
  note,
}: {
  rows: { label: string; value: number }[];
  width?: number;
  color?: string;
  valueLabel?: (v: number) => string;
  note?: (i: number) => string | undefined;
}) {
  const barH = 22;
  const gap = 10;
  const labelW = 170;
  const valueW = 170;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const h = Math.max(1, rows.length * (barH + gap));
  return (
    <svg viewBox={`0 0 ${width} ${h}`} width="100%" role="img" aria-label="Bar chart" style={{ display: "block", fontFamily: "system-ui, sans-serif" }}>
      {rows.map((r, i) => {
        const y = i * (barH + gap);
        const w = ((width - labelW - valueW) * r.value) / max;
        const v = valueLabel(r.value);
        return (
          <g key={`${r.label}-${i}`}>
            <text x={labelW - 8} y={y + barH * 0.7} textAnchor="end" fontSize="13" fill={INK}>{r.label.length > 24 ? `${r.label.slice(0, 23)}…` : r.label}</text>
            <rect x={labelW} y={y} width={Math.max(r.value > 0 ? 2 : 0, w)} height={barH} rx="3" fill={color} />
            <text x={labelW + w + 6} y={y + barH * 0.7} fontSize="13" fill={INK} fontWeight="600">{v}</text>
            {note?.(i) && <text x={labelW + w + 12 + v.length * 8} y={y + barH * 0.7} fontSize="11" fill={MUTED}>{note(i)}</text>}
          </g>
        );
      })}
    </svg>
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
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label="Weekly chart" style={{ display: "block", fontFamily: "system-ui, sans-serif" }}>
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
            <line x1={padL} x2={width - 8} y1={y} y2={y} stroke="#e2ded5" />
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
