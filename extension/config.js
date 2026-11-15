// All numbers use the LeetCode problem-rating scale, not Codeforces.
globalThis.LcConfig = Object.freeze({
  tiers: {
    Easy: { rating: 1250, low: 1000, high: 1500 },
    Medium: { rating: 1650, low: 1400, high: 1900 },
    Hard: { rating: 2150, low: 1850, high: 2450 }
  },
  prior: 1550,
  priorWeight: 4,
  tierWeight: 0.4,
  historyWeight: 0.65,
  retryPenalty: 0.13,
  acceptanceMidpoint: { Easy: 0.58, Medium: 0.47, Hard: 0.36 },
  acceptanceScale: 120,
  maxAcceptanceAdjustment: 225,
  minRating: 800,
  maxRating: 3800,
  scale: 400,
  recommendationOffsets: { warmup: -150, near: 0, stretch: 200 },
  recommendationCount: 5,
  // Dashboard + quality-of-life settings.
  goalPerDay: 3,          // default daily solve goal; user can change it.
  ratingBucket: 200,      // width of a rating-histogram bucket.
  heatmapWeeks: 27        // weeks shown in the activity heatmap (~6 months).
});
