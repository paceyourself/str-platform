/** Keys stored in survey_responses.dimension_scores (JSON). */
export const SURVEY_DIMENSIONS = [
  {
    key: "financial_accuracy",
    label: "Financial accuracy",
  },
  {
    key: "payment_timeliness",
    label: "Payment timeliness",
  },
  {
    key: "pricing_management",
    label: "Pricing management",
  },
  {
    key: "maintenance_responsiveness",
    label: "Maintenance responsiveness",
  },
  {
    key: "communication",
    label: "Communication",
  },
  {
    key: "guest_screening",
    label: "Guest screening",
  },
  {
    key: "listing_management",
    label: "Listing management",
  },
] as const;

export type SurveyDimensionKey = (typeof SURVEY_DIMENSIONS)[number]["key"];

export type DimensionScores = Record<SurveyDimensionKey, number>;

export function emptyDimensionScores(): Record<SurveyDimensionKey, number> {
  return {
    financial_accuracy: 0,
    payment_timeliness: 0,
    pricing_management: 0,
    maintenance_responsiveness: 0,
    communication: 0,
    guest_screening: 0,
    listing_management: 0,
  };
}

export function averageDimensionScore(
  scores: Record<string, unknown> | null | undefined
): number | null {
  if (!scores || typeof scores !== "object") return null;
  const vals: number[] = [];
  for (const { key } of SURVEY_DIMENSIONS) {
    const n = Number((scores as Record<string, unknown>)[key]);
    if (Number.isFinite(n) && n >= 1 && n <= 5) vals.push(n);
  }
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
