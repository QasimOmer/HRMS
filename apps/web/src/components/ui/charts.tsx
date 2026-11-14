/**
 * Lightweight, dependency-free SVG charts (ADB-02, ADB-04, DSH-07).
 * Every chart has a text alternative for screen readers.
 */
import { cn } from '@/lib/format';

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

export function Donut({ slices, center, sub, className, showLegend = true }: { slices: DonutSlice[]; center?: string; sub?: string; className?: string; showLegend?: boolean }) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  const r = 42;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const desc = slices.map((s) => `${s.label}: ${s.value}`).join(', ');
  return (
    <div className={cn('flex flex-wrap items-center gap-6', className)}>
      <svg viewBox="0 0 100 100" className="h-36 w-36 shrink-0" role="img" aria-label={desc}>
        <g transform="rotate(-90 50 50)">
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--muted)" strokeWidth="12" />
          {total > 0 &&
            slices.map((s) => {
              const len = (s.value / total) * c;
              const el = <circle key={s.label} cx="50" cy="50" r={r} fill="none" stroke={s.color} strokeWidth="12" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} />;
              offset += len;
              return el;
            })}
        </g>
        {center && <text x="50" y={sub ? 50 : 54} textAnchor="middle" className="fill-foreground text-[14px] font-semibold">{center}</text>}
        {sub && <text x="50" y="63" textAnchor="middle" className="fill-muted-foreground text-[8px]">{sub}</text>}
      </svg>
      {showLegend && <ul className="space-y-1.5 text-sm">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
            <span className="text-muted-foreground">{s.label}</span>
            <span className="ml-auto pl-4 font-medium tabular-nums">{s.value}</span>
          </li>
        ))}
      </ul>}
    </div>
  );
}

/** Vertical bars with an optional reference value per bar (e.g. worked vs shift hours). */
export function Bars({
  items,
  format = (n) => String(n),
  height = 160,
}: {
  items: { label: string; value: number; target?: number; color?: string; title?: string }[];
  format?: (n: number) => string;
  height?: number;
}) {
  const max = Math.max(1, ...items.map((i) => Math.max(i.value, i.target ?? 0)));
  if (!items.length) return <p className="py-8 text-center text-sm text-muted-foreground">No data for this period</p>;
  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-fit items-end gap-1" style={{ height }} role="list">
        {items.map((i) => (
          <div key={i.label} role="listitem" className="relative flex w-5 shrink-0 flex-col items-center justify-end sm:w-6" style={{ height }} title={i.title ?? `${i.label}: ${format(i.value)}`}>
            {i.target !== undefined && i.target > 0 && (
              <div className="absolute left-0 right-0 border-t-2 border-dashed border-muted-foreground/60" style={{ bottom: `${(i.target / max) * 100}%` }} aria-hidden />
            )}
            <div className="w-full rounded-t-sm" style={{ height: `${(i.value / max) * 100}%`, background: i.color ?? 'var(--primary)' }} />
            <span className="sr-only">{`${i.label}: ${format(i.value)}${i.target ? ` of ${format(i.target)}` : ''}`}</span>
          </div>
        ))}
      </div>
      <div className="mt-1 flex min-w-fit gap-1" aria-hidden>
        {items.map((i) => (
          <span key={i.label} className="w-5 shrink-0 text-center text-[10px] text-muted-foreground sm:w-6">{i.label}</span>
        ))}
      </div>
    </div>
  );
}

/** Simple line chart for percentages or amounts over time. */
export function Line({ points, format = (n) => String(n), max: fixedMax, highlightLast = false }: { points: { label: string; value: number | null }[]; format?: (n: number) => string; max?: number; highlightLast?: boolean }) {
  const w = 300;
  const h = 120;
  const pad = 16;
  const vals = points.map((p) => p.value).filter((v): v is number => v !== null);
  const max = fixedMax ?? Math.max(1, ...vals);
  const x = (i: number) => pad + (i * (w - pad * 2)) / Math.max(1, points.length - 1);
  const y = (v: number) => h - pad - (v / max) * (h - pad * 2);
  const path = points
    .map((p, i) => (p.value === null ? null : `${x(i)},${y(p.value)}`))
    .filter(Boolean)
    .join(' L ');
  return (
    <figure>
      <svg viewBox={`0 0 ${w} ${h + 14}`} className="w-full" role="img" aria-label={points.map((p) => `${p.label}: ${p.value === null ? 'no data' : format(p.value)}`).join(', ')}>
        <line x1={pad} x2={w - pad} y1={h - pad} y2={h - pad} stroke="var(--border)" />
        {path && <path d={`M ${path}`} fill="none" stroke="var(--primary)" strokeWidth="2" />}
        {points.map((p, i) =>
          p.value === null ? null : (
            <g key={p.label}>
              <circle cx={x(i)} cy={y(p.value)} r={highlightLast && i === points.length - 1 ? 4.5 : 3} fill="var(--primary)" />
              <text x={x(i)} y={y(p.value) - 8} textAnchor="middle" className={highlightLast && i === points.length - 1 ? 'fill-primary text-[10px] font-semibold' : 'fill-muted-foreground text-[9px]'}>{format(p.value)}</text>
            </g>
          ),
        )}
        {points.map((p, i) => (
          <text key={`l${p.label}`} x={x(i)} y={h + 8} textAnchor="middle" className={highlightLast && i === points.length - 1 ? 'fill-primary text-[9px] font-semibold' : 'fill-muted-foreground text-[9px]'}>{p.label}</text>
        ))}
      </svg>
    </figure>
  );
}

/**
 * Daily working hours (ADB-04): one bar per working day coloured by status, an hour axis,
 * a dashed shift line and "Abs" / "Lv" markers for absent and leave days.
 */
export function HoursChart({
  days,
  shiftMinutes,
  colors,
}: {
  days: { date: string; status: string; workedMinutes: number }[];
  shiftMinutes: number;
  colors: Record<string, string>;
}) {
  if (!days.length) return <p className="py-12 text-center text-sm text-muted-foreground">No working days recorded this month</p>;
  const W = 720;
  const H = 240;
  const left = 34;
  const right = 34;
  const top = 12;
  const bottom = 26;
  const maxH = Math.max(Math.ceil(Math.max(...days.map((d) => d.workedMinutes)) / 60), Math.ceil(shiftMinutes / 60) + 2, 1);
  const y = (minutes: number) => top + (H - top - bottom) * (1 - minutes / 60 / maxH);
  const slot = (W - left - right) / days.length;
  const bar = Math.min(26, slot * 0.62);
  const ticks = [0, Math.round(maxH * 0.4), maxH];
  const color = (s: string) => colors[s] ?? 'var(--muted-foreground)';
  const shiftY = y(shiftMinutes);
  const fmt = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={days.map((d) => `${d.date}: ${d.status === 'ABSENT' ? 'absent' : d.status === 'ON_LEAVE' ? 'leave' : fmt(d.workedMinutes)}`).join(', ')}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={W - right} y1={y(t * 60)} y2={y(t * 60)} stroke="var(--border)" />
            <text x={left - 6} y={y(t * 60) + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">{t === 0 ? '0' : `${t}h`}</text>
          </g>
        ))}
        {days.map((d, i) => {
          const cx = left + slot * i + slot / 2;
          const label = String(Number(d.date.slice(8)));
          const marker = d.status === 'ABSENT' ? 'Abs' : d.status === 'ON_LEAVE' ? 'Lv' : null;
          return (
            <g key={d.date}>
              <title>{`${d.date} · ${marker ?? fmt(d.workedMinutes)}`}</title>
              {marker ? (
                <text x={cx} y={y(0) - 5} textAnchor="middle" className="text-[10px] font-semibold" fill={color(d.status)}>{marker}</text>
              ) : (
                <rect x={cx - bar / 2} y={y(d.workedMinutes)} width={bar} height={Math.max(0, y(0) - y(d.workedMinutes))} rx={3} fill={color(d.status)} />
              )}
              <text x={cx} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[10px]">{label}</text>
            </g>
          );
        })}
        <line x1={left} x2={W - right} y1={shiftY} y2={shiftY} stroke="var(--foreground)" strokeWidth={1.5} strokeDasharray="5 4" opacity={0.7} />
        <text x={W - right + 4} y={shiftY + 3} className="fill-foreground text-[10px] font-semibold">{Math.round((shiftMinutes / 60) * 10) / 10}h</text>
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {[['PRESENT', 'Present'], ['LATE', 'Late'], ['ABSENT', 'Absent'], ['ON_LEAVE', 'Leave']].map(([k, l]) => (
          <span key={k} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: color(k!) }} aria-hidden />{l}</span>
        ))}
        <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-foreground/70" aria-hidden />Shift hours</span>
      </figcaption>
    </figure>
  );
}
