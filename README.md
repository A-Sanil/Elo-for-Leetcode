# Elo for LeetCode

An unofficial Chrome extension that rates LeetCode problems, tracks the practice and submission history you import, and turns it into a practice dashboard, a roadmap, and next-problem picks. No backend, no external analytics, no build step. Everything stays in your browser.

## Install in Chrome

1. Download this repository as a ZIP and extract it (or clone it).
2. Go to `chrome://extensions`, turn on **Developer mode**, and click **Load unpacked**.
3. Select the **`extension/`** folder, the one containing `manifest.json`.
4. Reload any already-open LeetCode tabs. Open a problem to see its badge, or click the toolbar icon and **Open dashboard**.

**Upgrading?** Replace the files in the same unpacked `extension/` directory and hit **Reload** on its card so your saved history, notes and roadmaps stay in place.

## What you get

**On a problem page**
- A rating badge: a ZeroTrac **contest** rating when one exists, otherwise an acceptance-adjusted **estimate**.
- A notes box saved to that problem's memory.
- **Focus mode** blurs difficulty, acceptance and topic tags until you hover, so you can attempt a problem cold.
- Keyboard shortcuts (hold **Alt+Shift**): `P` toggle the panel, `N` open the next recommended problem, `R` focus mode, `S` mark solved, `X` mark not solved.

**In problem / company / study-plan lists**
- A small rating chip next to each problem link, tinted when you've already solved it.

**Popup**
- Today's solved count, your current streak, and an editable daily goal (also shown on the toolbar icon).
- Your practice level and next-problem picks (Warm-up / At my level / Stretch).

**Dashboard** (click **Open dashboard** in the popup)
- **Overview** — practice level, totals, streaks, an activity heatmap, a solved-over-time curve, difficulty and topic breakdowns, a solved-rating histogram, and a "what to work on" panel that surfaces your weakest topics.
- **Problem memory** — a searchable, filterable table of every problem you've touched: filter by text, difficulty, topic, status, rating range, and date range, sort it, and export the current view as CSV.
- **Roadmap** — the NeetCode 150 grouped by phase and topic with your live progress, plus custom roadmaps you build from pasted problems or an imported collection URL.
- **Data** — set your goal, export a full JSON backup (or all problems as CSV), restore from a backup, or clear imported history.

## Sync your existing history

On a signed-in `leetcode.com` tab, open the popup and click **Sync LeetCode history**. Keep that tab open while it reads the paginated submission list; you can close the popup. Sync again after more submissions to refresh the snapshot. **Clear history** (in the dashboard's Data tab) deletes imported submission counts, public recent solves, and the activity calendar but leaves manual outcomes, notes and roadmaps intact.

- Each distinct judged submission is counted once. Accepted submissions are solves; unsuccessful judged submissions without any AC are attempts. Unknown verdicts, system statuses and pending rows are ignored. Attempts up to the first AC are tracked across languages, in submission order.
- Sync also records **when** each problem was first attempted and first solved, which powers the heatmap, the solved-over-time curve and date-range queries. Topic tags are fetched best-effort during sync to drive the topic breakdowns; if that fetch is unavailable the rest of the sync still succeeds.
- The history is whatever LeetCode's signed-in endpoint exposes. It can depend on the account/session and may not match the public profile calendar. Access failures, incompatible responses and pagination problems are reported without replacing the last successful import. Sync stops on rate limits and caps at 20,000 rows.

If full sync is blocked, select **Import recent profile solves** in the popup on a LeetCode tab. Enter your LeetCode username. This imports distinct problems from up to 20 publicly visible Accepted entries. It can inform your provisional rating, exclude those problems from recommendations, and show solves in Problem memory and the roadmaps. It does not import retry counts, first-solve dates, or calendar activity. It leaves your full-history snapshot and manual outcomes intact.

## Custom roadmaps

In the dashboard's **Roadmap** tab, open **+ New roadmap**:

- **Paste problems** — drop in LeetCode URLs or slugs (one per line) and click *Create from pasted problems*. Works offline.
- **Import a collection URL** — paste a company list (`?favoriteSlug=amazon-all`), study plan (`/studyplan/top-interview-150/`) or personal list (`?selectedList=…`) and click *Import collection URL*. This reads the list through an **open, signed-in leetcode.com tab** in the same browser (so no cookies are copied); open one first if prompted. Collection import is best-effort and depends on LeetCode's unofficial endpoints.

## What the numbers mean

- **Contest · 1730** — rounded rating from [ZeroTrac](https://github.com/zerotrac/leetcode_problem_rating). Takes precedence over an estimate. The bundled snapshot is not a live feed.
- **Estimate · ~1475** — for non-contest problems, an Easy/Medium/Hard baseline nudged by the problem's acceptance rate. A heuristic band, not a confidence interval.
- **Your practice level** — a regularized estimate from your solved/attempted outcomes weighted by problem rating. History-based scores are provisional because the data can't tell editorials, hints or old retries apart.

This is an **Elo-style practice estimate**, not an official LeetCode rating, a Codeforces equivalent, or a percentile.

## Tune it

- `extension/config.js` — ratings, acceptance adjustments, recommendation offsets, default daily goal, histogram bucket width, heatmap length.
- `extension/model.js` — pure logic: ratings, practice level, recommendations, and all the dashboard aggregates (streaks, heatmap, breakdowns, queries, roadmap progress). Unit-tested.
- `extension/leetcode.js` — first-party metadata, history, tags and collection adapters (content-script side).
- `extension/content.js` — badge, notes, focus mode, list chips, shortcuts, sync orchestration.
- `extension/worker.js` — local persistence, message handling, the toolbar badge.
- `extension/dashboard.html` / `dashboard.js` / `dashboard.css` — the dashboard page.

Run `npm test` with Node 20+ (no dependencies to install). To regenerate the bundled contest catalog, use `npm run refresh-ratings`.

## Data and privacy

The extension reads the current LeetCode problem URL and displayed difficulty, and can fetch problem stats and topic tags from LeetCode. On an explicit **Sync** it reads your submission history and the public problem list using your existing browser session. It **never reads or stores your login cookie** — all first-party requests are same-origin from a leetcode.com tab, so the browser attaches the session itself. Only normalized problem metadata, aggregate per-problem counts, first-attempt/first-solve timestamps, your notes, outcomes and roadmaps are stored, all in `chrome.storage.local`. Raw solution code and submission IDs are never stored, and nothing is sent to any third-party server. The optional public recent-solves import sends the username you enter to LeetCode without login credentials.

The extension requests host access to `https://leetcode.com/*` — the one site it works on — so the dashboard can read a collection list from an open signed-in tab. The bundled ZeroTrac snapshot includes [the upstream MIT notice](extension/data/ZEROTRAC-LICENSE.txt).

Not affiliated with LeetCode, Codeforces, ZeroTrac or NeetCode. Unpacked extension; not a Chrome Web Store listing.
