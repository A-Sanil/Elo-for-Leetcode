# Elo for LeetCode

An unofficial Chrome extension that shows a problem difficulty rating and recommends what to practice next. No backend, external analytics, or build step.

## Install in Chrome

1. Download this repository as a ZIP and extract it (or clone it).
2. Go to `chrome://extensions`, turn on **Developer mode**, and click **Load unpacked**.
3. Select the **`extension/`** folder, the one containing `manifest.json`.
4. Reload any already-open LeetCode tabs. Open a problem to see its badge and the **Current problem** card in the extension popup.

**Upgrading from 0.1?** Replace the files in the same unpacked `extension/` directory. Use **Reload** on its existing card rather than uninstalling so your existing manual history stays in place.

## Sync your existing history

On a signed-in `leetcode.com` tab, open the extension popup and click **Sync LeetCode history**. Keep that tab open while it reads the paginated submission list; you can close the popup. Sync again after more submissions to refresh the local snapshot. **Clear history** deletes imported submission counts but leaves manual practice logs intact.

- The extension counts each distinct judged submission once. It treats accepted submissions as solves and unsuccessful judged submissions without any AC as attempted problems. It ignores unknown verdicts, system statuses, and pending rows. It also tracks attempts up to the first AC, across languages, using the order of submissions in the imported history.
- The history is whatever LeetCode's signed-in endpoint exposes. It can depend on the account/session and may not match the public profile calendar, which covers a different time window. Access failures, incompatible responses, and pagination problems are reported without replacing the last successful import. Sync stops on rate limits and caps at 20,000 rows.
- If LeetCode denies access, verify that you're signed in on the active tab and reload it. Its website endpoints are not a supported public API and may change. You can still log outcomes by hand or paste independent solve links into the popup.

## What the numbers mean

- **Contest · 1730:** Rounded rating from [ZeroTrac](https://github.com/zerotrac/leetcode_problem_rating). This takes precedence over an estimate. The bundled contest snapshot is not a live contest rating feed.
- **Estimate · ~1475:** For non-contest problems, the extension adjusts an Easy/Medium/Hard baseline by the problem's aggregate acceptance rate when available. The baseline controls the scale; lower acceptance than its tier's reference point raises the estimate. Small samples are shrunk toward that reference point. If stats are unavailable, it falls back to the tier. A heuristic band is not a confidence interval.
- **Your practice level:** The model compares the difficulty of each known problem against the imported outcome. One problem gives one contribution. A first-submit AC gets full solve credit; retries before the first AC reduce credit modestly. Submissions after the first AC do not change that credit. A manual **Solved solo** or **Not solved** entry overrides that problem's imported evidence. Unrated problems can count in the history totals but not in the proficiency estimate. History-based scores are always provisional because the data cannot distinguish editorials, hints, untimed practice, or old retries.
- **Next problems:** Choose **Warm-up**, **At my level**, or **Stretch**. The popup excludes imported and manually logged problems and hides known premium-only problems. Recommendations use the bundled catalog plus metadata it has fetched or seen; coverage depends on what is available.

This is an **Elo-style practice estimate**, not an official LeetCode rating, a Codeforces equivalent, or a percentile. Submission count by itself is not a measure of ability.

## Tune it

- `extension/config.js` — baseline difficulties, acceptance adjustments, retry weighting, prior, and recommendation offsets.
- `extension/model.js` — practice level and recommendation logic.
- `extension/leetcode.js` — first-party metadata and history adapters.
- `extension/content.js` — badge, page detection, and sync orchestration.
- `extension/worker.js` — local persistence and request handling.

Run `npm test` with Node 20+ (no dependencies to install). To regenerate the bundled contest catalog, use `npm run refresh-ratings`. For a pinned refresh, download the upstream commit's `data.json` and run `node scripts/refresh-ratings.mjs path/to/data.json COMMIT_SHA`.

## Data and privacy

The bundled ZeroTrac snapshot includes [the upstream MIT notice](extension/data/ZEROTRAC-LICENSE.txt). The extension reads the current LeetCode problem URL and displayed difficulty. It can fetch problem stats from LeetCode, and on explicit sync it also reads submission history using your existing browser session and loads public problem metadata. It does not ask for a password or read or store cookies. Only normalized problem metadata and aggregate per-problem counts are persisted; raw solution code and submission IDs are not stored. Your history is never sent to a third-party server. The extension runs on leetcode.com to support in-site navigation and first-party requests.

Not affiliated with LeetCode, Codeforces, or ZeroTrac. Unpacked extension; not a Chrome Web Store listing.
