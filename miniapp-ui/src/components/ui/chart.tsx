import { cn } from '@/lib/utils';

/**
 * A week of one metric, as bars.
 *
 * Scaled to the week's own peak rather than an absolute axis: most of these
 * numbers are small, and a shared scale flattens every one of them into the
 * same empty strip. A zero day still draws a stub, so "nothing happened" is
 * visible as a value rather than as a hole.
 */
export function BarRow({
  values,
  labels,
  accent,
}: {
  values: number[];
  labels: string[];
  accent?: boolean;
}) {
  const peak = Math.max(...values, 1);
  return (
    <div className="flex h-14 items-end gap-[3px]">
      {values.map((v, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-1">
          <div
            className={cn(
              'w-full rounded-[3px] transition-all',
              v === 0
                ? 'bg-muted-foreground/20'
                : accent
                  ? 'bg-primary'
                  : 'bg-link/70',
            )}
            style={{ height: v === 0 ? '4px' : `${Math.max(10, (v / peak) * 100)}%` }}
            title={`${labels[i]}: ${v}`}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * A day's hours as a ring.
 *
 * Meeting load is the one number here that has a natural denominator — a
 * working day — so it is the one worth drawing as a proportion rather than a
 * bar. Everything else is a count with no ceiling.
 */
export function Ring({
  value,
  max,
  label,
  sub,
}: {
  value: number;
  max: number;
  label: string;
  sub: string;
}) {
  const fraction = Math.min(1, max > 0 ? value / max : 0);
  const size = 92;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;

  return (
    <div className="flex items-center gap-3">
      <svg width={size} height={size} className="shrink-0 -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-muted-foreground/20"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circumference * fraction} ${circumference}`}
          className="stroke-primary transition-all"
        />
      </svg>
      <div>
        <div className="text-2xl leading-none font-semibold">{label}</div>
        <div className="text-muted-foreground mt-1 text-[12.5px]">{sub}</div>
      </div>
    </div>
  );
}
