# Demo guide — Market Foundry

A click-by-click script for demonstrating the whole system: **Discover → Analyze → Structure → Validate → Review → Create**.
Use it for a live demo, for the walkthrough video, or just to try every feature once.

> Short on time? Do **Part 1 → Part 2 → Part 3** (about 6 minutes). Part 4 shows the failure cases, and
> Part 5 shows the API without the UI.

---

## Part 0 — Setup (one time, about 3 minutes)

```bash
cd omx-market-foundry
npm install
cp .env.example .env.local
```

Open `.env.local` and set at least:

```bash
GROQ_API_KEY=gsk_your_key_here        # free key: https://console.groq.com/keys
```

Without a key the app still works. It uses the rule-based fallback analyzer, which writes lower-quality
questions labelled **heuristic**. For a video, use a key.

Start the app:

```bash
npm run dev          # http://localhost:3000
```

The first request takes around 10 seconds while the embedded Postgres (PGlite) initialises and seeds itself. After that it's fast.

### Resetting to a clean demo
Stop the server, delete the `.data/` folder, then start it again. You get a fresh database with only the seed data.

### Which sources to enable for a demo
Go to **Sources** in the sidebar:

| Goal | Enable |
|---|---|
| Fully predictable demo (every edge case guaranteed) | Only **Demo Wire (synthetic fixtures)** |
| Realistic demo with real news | Demo Wire + Federal Reserve + BBC Business + BBC Sport + NASA |
| Show failure handling | Keep **Legacy wire feed (decommissioned)** enabled; it always fails |

Recommended for the video: Demo Wire, a few real feeds, and the legacy feed. You get real-world data and every edge case.

---

## Part 1 — Sign in and orient (about 45 seconds)

1. Open **http://localhost:3000**. You're redirected to **/login**, because pages need a reviewer session.
2. Type your name, e.g. `Suraj Kumar`.
3. Click **"Demo access code: omx-review — Use it →"**, or type `omx-review`.
4. Click **Sign in to the console**.

**What to say:**
> "Only authorised reviewers can use this. The name I type is recorded on every decision in the audit log. Automation can
> draft markets, but it can never publish one."

5. On the **Dashboard**, point out:
   - **Pipeline funnel**: Signals ingested → Filtered out → Analyzed → Candidates → Approved → Markets created.
   - **Analyzer** card (bottom-left of the sidebar): *Groq LLM · llama-3.3-70b-versatile*, or *Heuristic fallback*.
   - **Source health** (empty until the first run).

---

## Part 2 — Discover and Analyze (about 1.5 minutes)

1. Click **Run discovery** (top right of the Dashboard or the Discovery page).
2. Watch the **live log** as it streams in:

| Log line | Meaning |
|---|---|
| ✅ `BBC Sport — 25 items · 25 new` | Source fetched; how many articles were new |
| ❌ `Legacy wire feed … ENOTFOUND` | A broken source. The run **continues**; its health is marked red |
| ⏳ `Analyzing: …` | An LLM call is running for this story |
| ✨ `Will the … ?` | A **new candidate** was created (q = quality score) |
| 🔀 `Evidence added to: …` | A second article about the **same event** was merged instead of creating a duplicate |
| ⚪ `Not a market: …` | The analyzer judged the article unsuitable (opinion, no date, and so on) |

3. When it finishes, the summary shows sources ok/failed, new items, analyzed, new candidates and merged.
   A toast says *"Discovery finished with errors"*. That's expected, because the legacy feed failed on purpose.

**What to say:**
> "Each source is fetched independently with a timeout and one retry. One broken feed doesn't stop the run. Before
> any LLM call, a cheap prefilter throws out opinion pieces, galleries and articles with no upcoming date, so we only spend free-tier
> quota on promising items, at most 8 per run."

4. Click **Run discovery** again straight away. You get a **cooldown** message (HTTP 429). Wait about 20 seconds and run again.
   The log now shows **0 new** items per source.

**What to say:**
> "Article URLs are canonicalised and hashed, so re-reading the same feed never re-analyses the same news."

---

## Part 3 — Validate, Review and Create (about 3 minutes)

### 3.1 The review queue
1. Click **Review queue** (the sidebar shows the pending count).
2. Point out:
   - Candidates are sorted by **quality score** (the coloured ring).
   - Tabs: Pending review / Approved / Market created / Rejected / All.
   - Search, category filter and sort.
   - Chips on each row: **N blocking** (red) and **N warnings** (amber).

### 3.2 A good candidate: edit, approve, create
Open the **European Parliament … AI Liability Directive** candidate (from the Demo Wire), or the best real-news candidate.

Walk through the page top to bottom:
1. **Header**: status, category, *AI drafted* or *heuristic*, confidence, the question, and the lifecycle stepper
   (Discovered → Validated → **Human review** → Approved → Market created).
2. **Market definition**: outcomes, event time, close time (always at or before the event), resolution criteria,
   resolution source.
3. **Supporting sources**: expand the card. It shows the publisher, reliability tier, the date *this article* reports,
   and a link to the original article.
4. **Analyzer output**: the rationale and the raw JSON the model returned. This is kept so wrong AI output can be audited.
5. Right column, **Quality checks**: score ring, blockers, warnings and notes, each with a hint and a rule code.

**Now edit it:**
1. Click **Edit**.
2. Change the question to something vague:
   `Will the European Parliament significantly back the AI Liability Directive?`
3. The **Quality checks** panel turns into a **live preview** and immediately shows:
   - ⚠️ `AMBIGUOUS_WORDING — "significantly"`
   - ⚠️ `NO_DEADLINE_IN_QUESTION`
4. Fix it:
   `Will the European Parliament adopt the AI Liability Directive in its plenary vote on October 19, 2026?`
   (use the date shown on your candidate). The warnings disappear.
5. Click **Save changes**. The toast says *"Changes saved and re-validated."*
6. Scroll to **Activity & revisions**, then **Edit history**, and expand **v2**. It shows the old and new question as a diff.

**What to say:**
> "The same validation code runs in the browser for instant feedback and on the server, which has the final say. Every edit is
> versioned. If two reviewers edit at once, the second gets a version-conflict message instead of overwriting the first."

**Approve it:**
1. Click **Approve**. A dialog lists the remaining warnings.
2. The **Approve** button stays disabled until you tick
   *"I have reviewed these warnings…"*.
3. Optionally add a note, e.g. `Confirmed date on the Parliament agenda.`, then click **Approve**.
4. A green banner shows **Approved by Suraj Kumar**. The status is now **Approved**.

**Create the market:**
1. Click **Create market**. The toast says *"Market created on OmniMarketX (mock API)."*
2. Click **View market**. It shows:
   - The market header (outcomes, closes, expected resolution, created by).
   - **Market payload**: the exact JSON sent to `POST /v1/markets`.
   - **Provenance**: the original source article(s), which carried through from discovery to the market.
   - **Lifecycle**: created → edited → approved → market_created, with actors.
3. Go back to the candidate and click **Create market** again (or refresh and try). You get
   *"Market already existed — returned the original (idempotent)."* No second market is created.

**What to say:**
> "Market creation goes through a service boundary: a publisher interface with an API key and an Idempotency-Key equal to the
> candidate id. Double clicks, retries and timeouts can never create two markets. The market payload keeps every
> source, so anyone can see why this market exists."

### 3.3 Reject a candidate
1. Open another candidate, e.g. **Nimbus Robotics … IPO**.
2. Click **Reject**. The **Reject** button is disabled until a reason is given.
3. Click the reason chip **"Low trader interest"** (or type one), then click **Reject**.
4. The banner shows **Rejected by … — "Low trader interest"**. There's a **Reopen** button.

**What to say:**
> "Rejected candidates stay in the database, so the same event isn't proposed again on every run. A later article about
> it is attached as evidence instead."

---

## Part 4 — The hard parts and failure cases (about 2 minutes)

### 4.1 Conflicting sources (same event, different dates)
Open the **Starship flight test** candidate (Demo Wire):
- **Supporting sources (2)**: one article says **Oct 8** ("SpaceX targets…"), the other says **Oct 15**
  ("…slips to…"). The badges read *reports event: …*, and the conflicting one is highlighted amber.
- The quality panel shows ⚠️ **CONFLICTING_SOURCES — Sources disagree on the event date**.
- The Activity feed shows *discovery added supporting evidence · conflicts with existing sources*.

**What to say:**
> "The second article was recognised as the same event through the event key and similarity, so it was merged rather than duplicated.
> Each article's own claimed date is stored separately, which is how the conflict is detected. If this candidate had already been
> approved, the new conflicting evidence would automatically send it back to review."

### 4.2 Duplicate of a live market
Open the **Bitcoin close above $150,000** candidate:
- 🛑 **DUPLICATE_MARKET — 100% similar to existing live market**
- **Approve is disabled.** The red banner says blocking issues must be fixed.
- The **Similar markets & candidates** panel links to the existing market (a seed market under **Markets → Already live**).

### 4.3 A broken source
1. Go to **Sources**. **Legacy wire feed** has a red dot, *"1 consecutive failure(s)"*, and the error text.
2. Click **Test** on it. The dry run says *Fetch failed … ENOTFOUND*, and notes that other sources continue.
3. Click **Test** on **BBC Sport**. It shows real items with their **prefilter scores** and the reasons for each.

### 4.4 AI or analysis failure, and retrying
1. Go to **Discovery**, pick a run in **Run history**, and look at the **Signal inspector**.
2. Filter chips: *Candidate · Merged · Same story · Not a market · Filtered · Failed · Queued*. Every item shows
   **why** it ended up where it did (e.g. *"Low market signal (0.05). Looks like opinion/gallery…"*).
3. Items that are **Failed**, **Not a market** or **Filtered** have a **Re-queue** button, which puts them back in line for the next run.

To reproduce a real LLM failure, set `GROQ_API_KEY=invalid` in `.env.local`, restart and run discovery. The run
stops analysing with an auth error, the items are marked **Failed** with the reason, and no bad candidates are created.

**What to say about bad AI output:**
> "The model must return JSON matching a strict schema. If it doesn't, I send the exact errors back once for a repair. If that also
> fails, the item is marked failed, not turned into a half-broken candidate. And even valid AI output goes through the
> deterministic rules, which catch things like closing after the event, subjective wording or untrusted resolution sources."

### 4.5 Rules that block a bad edit
On any pending candidate, click **Edit** and try:
- Setting **Trading closes** *after* the event time: 🛑 `CLOSE_AFTER_EVENT`
- Deleting the resolution criteria: 🛑 `WEAK_RESOLUTION_CRITERIA`
- Adding the word "best" to the question: 🛑 `SUBJECTIVE_OUTCOME`

Save it. The **Approve** button is then disabled until you fix it.

---

## Part 5 — API demo without the UI (optional)

Run these in Git Bash while `npm run dev` is running.

```bash
# health (public)
curl -s localhost:3000/api/health

# sign in and keep the cookie
curl -s -c jar.txt -H "Content-Type: application/json" \
  -d '{"name":"API Demo","code":"omx-review"}' localhost:3000/api/auth/login

# run discovery: the response streams one JSON event per line
curl -s -N -b jar.txt -X POST localhost:3000/api/discovery/run

# pending candidates
curl -s -b jar.txt "localhost:3000/api/candidates?status=pending_review"

# without the cookie, 401
curl -s localhost:3000/api/candidates

# mock OmniMarketX API with a wrong key, 401
curl -s -X POST -H "x-api-key: wrong" -H "Idempotency-Key: demo-key-123" \
  localhost:3000/api/mock-omx/v1/markets -d '{}'
```

The full API reference is in `docs/API.md`.

---

## Part 6 — Show the tests (optional, about 1 minute)

```bash
npm test          # 45 unit + integration tests, about 40 s
npm run test:e2e  # production build + 4 Playwright browser tests
```

Point out that the integration test proves **the original article URL survives into the market payload**, and that
**two simultaneous "create market" calls produce exactly one market**.

---

## Expected Demo Wire results

The Demo Wire feed is synthetic. Its dates are generated relative to *today*, so they're always in the future.

| Article | Expected outcome |
|---|---|
| Federal Reserve rate decision (in about 14 days) | New candidate (Economics) |
| SpaceX targets Starship test (in about 9 days) | Merged into the Starship candidate, with a conflict |
| Starship test slips (in about 16 days) | New Starship candidate |
| European Parliament AI Liability vote (in about 20 days) | New candidate (Politics); use this one for the approve flow |
| Nimbus Robotics IPO (in about 12 days) | New candidate; `UNVERIFIED_RESOLUTION_SOURCE` warning (nasdaq.com isn't on the trusted list) |
| India vs Australia third Test (in about 6 days) | New candidate (Sports) |
| Bitcoin toward $150,000 | New candidate, **blocked** as a duplicate of a live market |
| "Opinion: The tech industry needs to slow down…" | Filtered out (opinion) |
| "In pictures: Autumn lantern festival…" | Filtered out (gallery) |

With Groq, the question wording is better than with the heuristic analyzer. Which article becomes the "lead" of the merged
Starship pair can vary.

## Troubleshooting

| Symptom | Fix |
|---|---|
| First page load takes about 10 s | Normal: PGlite initialises the database on first use |
| "Please wait 20s between discovery runs" | Cooldown; wait, or set `DISCOVERY_COOLDOWN_SECONDS=0` |
| No new candidates on a second run | Expected: everything was already ingested. Enable more sources or reset `.data/` |
| Candidates labelled **heuristic** | No `GROQ_API_KEY` set (check the Analyzer card in the sidebar) |
| "Groq rate limit reached" in the log | Free-tier limit; the app falls back to the 8B model automatically. Otherwise wait and re-run; unprocessed items stay queued |
| Want a clean slate | Stop the server, delete `.data/`, start again |
