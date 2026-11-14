# Elo for LeetCode

An unofficial Chrome extension that adds a difficulty badge to LeetCode problem pages and suggests what to practice next. No backend, account login, or build step.

## Install in Chrome

1. Download this repository as a ZIP and extract it (or clone it).
2. Go to `chrome://extensions`, turn on **Developer mode**, and click **Load unpacked**.
3. Select the **`extension/`** folder, the one containing `manifest.json`.
4. Refresh any already-open LeetCode tabs. Open a problem and expand the rating badge at the bottom right. Pin the extension to open the practice dashboard.

## How it works

- **Contest · 1730** means a rounded contest-derived rating from [ZeroTrac](https://github.com/zerotrac/leetcode_problem_rating). These are third-party estimates, not official LeetCode account ratings.
- **Estimate · ~1650** means a fallback using the problem's visible Easy/Medium/Hard tag. MVP defaults are 1250, 1650, and 2150. Problems within the same tier get the same estimate, and the shown range is a heuristic, not a confidence interval. If neither source is available, no badge shows.
- Click **Solved solo** or **Not solved** after an independent attempt. The extension stores one editable outcome per problem. Use **Clear** to remove it. For previous independent solves, the popup accepts pasted slugs or LeetCode URLs already known to the extension. It does not scrape your account history. For a meaningful practice estimate, log misses too.
- The popup suggests **Warm-up**, **At my level**, or **Stretch** problems from the bundled catalog plus tagged problems the extension has seen locally. Logged problems are excluded. The fallback can cover newly visited pages without an upstream rating, but recommendations are **not an exhaustive list of all LeetCode problems**.

### Practice level

The model fits a regularized logistic curve using problem difficulty and your self-reported outcomes. It starts with a prior centered at 1550, weights rough tier estimates below contest-derived ratings, and rounds to the nearest 25. With fewer than 12 observations or only one kind of outcome, the estimate is flagged as provisional. This is an **Elo-style practice score**, not an official rating, a percentile, or an exact Codeforces conversion. Using selected solves, hints, retries, or differing time limits can bias it.

Recommendations rank unlogged problems by distance from the target level (or the default if nothing is logged). The warm-up and stretch bands shift the target by −150 and +200, respectively.

## Tune it

- `extension/config.js` — tier values, prior, estimate weights, and recommendation offsets.
- `extension/model.js` — model and recommendation logic.
- `extension/data/seed.js` — small fallback catalog for common problems.
- `extension/content.js` — page detection, badge, and outcome controls.
- `extension/worker.js` — local persistence and request handling.

Run `npm test` with Node 20+ (no dependencies to install). To regenerate the bundled contest catalog, use `npm run refresh-ratings`. For a reproducible refresh from a pinned snapshot, download that commit's `data.json` and run `node scripts/refresh-ratings.mjs path/to/data.json COMMIT_SHA`. Reload the extension after changing files.

## Data and privacy

The bundled ZeroTrac snapshot is credited in the generated data file and includes [the upstream MIT notice](extension/data/ZEROTRAC-LICENSE.txt). The extension reads problem URLs and visible title/difficulty metadata on `leetcode.com`; it runs there to support navigation without a page reload. Outcomes and encountered metadata are saved to Chrome's local extension storage, not sent to a server. No cookies, submissions, credentials, analytics, or external network requests are required at runtime. Uninstalling removes local extension data.

Not affiliated with LeetCode, Codeforces, or ZeroTrac. Distributed here as an unpacked extension, not as a Chrome Web Store listing.
