import type { CalendarMonth } from "@/lib/coverage-completeness";
import { coverageHoles, monthKey } from "@/lib/coverage-completeness";

export type PeriodMode = "cytd" | "ltm" | "lfy";

type CoverageMapRow = {
  data_complete?: boolean;
  admin_override?: boolean;
};

type InclusionByMode = Record<
  PeriodMode,
  { currIncluded: number; priorIncluded: number }
>;

type PeriodWindows = Record<
  PeriodMode,
  { curr: CalendarMonth[]; prior: CalendarMonth[] }
>;

/**
 * Default period toggle: CYTD if available → LTM → LFY.
 * Shared by dashboard and analytics — must stay identical.
 */
export function resolveDefaultPeriodMode(args: {
  periodWindows: PeriodWindows;
  unionCoverageMap: Map<string, CoverageMapRow>;
  coverageInclusionByMode: InclusionByMode;
}): PeriodMode | null {
  const { periodWindows, unionCoverageMap, coverageInclusionByMode } = args;
  const order: PeriodMode[] = ["cytd", "ltm", "lfy"];

  return (
    order.find((mode) => {
      if (mode === "cytd") {
        const { curr, prior } = periodWindows.cytd;
        if (curr.length === 0) return false;
        const anyCompleteCurr = curr.some((mo) => {
          const r = unionCoverageMap.get(monthKey(mo.year, mo.month));
          return r?.data_complete || r?.admin_override;
        });
        if (!anyCompleteCurr) return false;
        return coverageHoles(unionCoverageMap, prior).length === 0;
      }
      return coverageInclusionByMode[mode].currIncluded > 0;
    }) ?? null
  );
}
