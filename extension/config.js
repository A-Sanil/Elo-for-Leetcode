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
  minRating: 800,
  maxRating: 3800,
  scale: 400,
  recommendationOffsets: { warmup: -150, near: 0, stretch: 200 },
  recommendationCount: 5
});
