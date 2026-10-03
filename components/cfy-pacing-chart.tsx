"use client";

import {
  CFY_PACING_COLORS,
  type CfyMonthRow,
  type CfyMetric,
} from "@/lib/cfy-pacing";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Props = {
  rows: CfyMonthRow[];
  metric: CfyMetric;
  onMetricChange: (m: CfyMetric) => void;
  bookingsAsOf: string | null;
};

function formatValue(n: number, metric: CfyMetric): string {
  if (metric === "nights") {
    return n.toLocaleString(undefined, {
      maximumFractionDigits: 1,
      minimumFractionDigits: 0,
    });
  }
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export function CfyPacingChart({
  rows,
  metric,
  onMetricChange,
  bookingsAsOf,
}: Props) {
  return (
    <div className="space-y-3">
      {bookingsAsOf ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Bookings as of {bookingsAsOf}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 border-b border-zinc-200 pb-3 dark:border-zinc-700">
        {(
          [
            ["revenue", "Revenue"],
            ["nights", "Bookings"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => onMetricChange(id)}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
              metric === id
                ? "bg-emerald-600 text-white dark:bg-emerald-600"
                : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} barCategoryGap="18%">
            <defs>
              {(
                [
                  ["cySegA", CFY_PACING_COLORS.cySegA],
                  ["cySegB", CFY_PACING_COLORS.cySegB],
                  ["pySegA", CFY_PACING_COLORS.pySegA],
                  ["pySegB", CFY_PACING_COLORS.pySegB],
                ] as const
              ).map(([id, color]) => (
                <pattern
                  key={id}
                  id={`cfy-hatch-${id}`}
                  patternUnits="userSpaceOnUse"
                  width="8"
                  height="8"
                >
                  <rect width="8" height="8" fill={color} />
                  <path
                    d="M-2,2 l4,-4 M0,8 l8,-8 M6,10 l4,-4"
                    stroke="#ffffff"
                    strokeWidth="1.5"
                    strokeOpacity="0.45"
                  />
                </pattern>
              ))}
            </defs>
            <CartesianGrid
              strokeDasharray="2 6"
              stroke="#a1a1aa"
              strokeOpacity={0.18}
            />
            <XAxis dataKey="label" stroke="#71717a" fontSize={12} />
            <YAxis
              stroke="#71717a"
              fontSize={11}
              tickFormatter={(v) =>
                metric === "revenue"
                  ? `$${Number(v).toLocaleString(undefined, {
                      maximumFractionDigits: 0,
                    })}`
                  : String(v)
              }
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0]?.payload as CfyMonthRow | undefined;
                return (
                  <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs shadow-md dark:border-zinc-700 dark:bg-zinc-900">
                    <p className="font-medium text-zinc-900 dark:text-zinc-50">
                      {label}
                    </p>
                    {row?.incomplete ? (
                      <p className="mt-1 font-medium text-amber-700 dark:text-amber-300">
                        Incomplete data
                      </p>
                    ) : null}
                    {payload.map((p) => (
                      <p
                        key={String(p.dataKey)}
                        className="mt-1"
                        style={{ color: String(p.color ?? "#71717a") }}
                      >
                        {p.name}:{" "}
                        {typeof p.value === "number"
                          ? formatValue(p.value, metric)
                          : "—"}
                      </p>
                    ))}
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: "12px" }} />

            <Bar
              dataKey="pySegA"
              name="Prior year (booked by snapshot)"
              stackId="prior"
              fill={CFY_PACING_COLORS.pySegA}
            >
              {rows.map((r) => (
                <Cell
                  key={`pyA-${r.month}`}
                  fill={
                    r.incomplete
                      ? "url(#cfy-hatch-pySegA)"
                      : CFY_PACING_COLORS.pySegA
                  }
                />
              ))}
            </Bar>
            <Bar
              dataKey="pySegB"
              name="Prior year (booked after snapshot)"
              stackId="prior"
              fill={CFY_PACING_COLORS.pySegB}
              radius={[4, 4, 0, 0]}
            >
              {rows.map((r) => (
                <Cell
                  key={`pyB-${r.month}`}
                  fill={
                    r.incomplete
                      ? "url(#cfy-hatch-pySegB)"
                      : CFY_PACING_COLORS.pySegB
                  }
                />
              ))}
            </Bar>

            <Bar
              dataKey="cySegA"
              name="Current year (elapsed)"
              stackId="current"
              fill={CFY_PACING_COLORS.cySegA}
            >
              {rows.map((r) => (
                <Cell
                  key={`cyA-${r.month}`}
                  fill={
                    r.incomplete
                      ? "url(#cfy-hatch-cySegA)"
                      : CFY_PACING_COLORS.cySegA
                  }
                />
              ))}
            </Bar>
            <Bar
              dataKey="cySegB"
              name="Current year (remaining)"
              stackId="current"
              fill={CFY_PACING_COLORS.cySegB}
              radius={[4, 4, 0, 0]}
            >
              {rows.map((r) => (
                <Cell
                  key={`cyB-${r.month}`}
                  fill={
                    r.incomplete
                      ? "url(#cfy-hatch-cySegB)"
                      : CFY_PACING_COLORS.cySegB
                  }
                />
              ))}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      </div>

    </div>
  );
}
