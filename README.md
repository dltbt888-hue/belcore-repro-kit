# belcore-repro-kit

Scripts, scenarios, and raw results for the long-session cost and recall measurements of the belcore API (`/api/v1/chat`).

Disclosure: this repository is published by belcore, a memory and context layer for LLM apps. It contains measurement material only. It does not contain belcore's engine code.

Every number below is copied from the files in `bench/longsession/results/` (`EVIDENCE.md`, `range-table.md`, `summary.csv`, `report.json`). Nothing is estimated.

## What is measured

Three arms run the same scripted conversations at four lengths (N = 10, 30, 60, 100 turns). After turn N, each recall question is sent once and is not added to the history.

| Arm | What it does |
|---|---|
| A | Full history sent on every turn, direct model call, no memory layer |
| B | The belcore API, stateless (no emotion, no end-user ID). The full history is sent and the engine trims it |
| C | Last 10 turns (20 messages) plus the current message, direct model call |

- **Scenarios:** 5 fixed 100-turn conversations (`support`, `coaching`, `companion`, `project`, `counsel`), written in Korean, with 8 recall questions each. All facts are synthetic. There is no real user data.
- **Facts are planted in turns 1-10.** Arm C drops them by design once N exceeds 10.
- **Grader:** `keyword-substring-v1` (keyword match, defined in `lib.mjs`).
- **Cost:** model-call cost only, from the token usage the provider returns and the price table saved in each run's `pricing.json`. belcore fees are not included. Session cost counts the conversation turns only. The cost of the recall probes is reported separately (`meanProbeCostUsd` in `summary.csv`).
- **Temperature:** not sent in any arm (provider default).
- `scenarios/LOCK.json` holds the SHA-256 of each scenario file. `run.mjs` refuses to run if a scenario was changed.

## Results

### gpt-4o-mini: full run

5 scenarios x 3 repetitions, 120 recall questions per cell. Run `full-2026-10-01T00-45-16-888Z`.

| N | Arm | Mean input tokens | Cost vs A | Recall | B/A range over the 3 reps |
|---|---|---|---|---|---|
| 10 | A | 4,148 | 1.000 | 120/120 | |
| 10 | B | 4,205 | 1.014 | 120/120 | 0.981 - 1.064 |
| 10 | C | 4,194 | 1.006 | 120/120 | |
| 30 | A | 41,248 | 1.000 | 117/120 | |
| 30 | B | 42,201 | 1.067 | 117/120 | 1.020 - 1.125 |
| 30 | C | 24,446 | 0.684 | 2/120 | |
| 60 | A | 183,099 | 1.000 | 110/120 | |
| 60 | B | 150,946 | 0.947 | 114/120 | 0.927 - 0.963 |
| 60 | C | 57,908 | 0.424 | 2/120 | |
| 100 | A | 602,239 | 1.000 | 96/120 | |
| 100 | B | 277,435 | 0.597 | 114/120 | 0.578 - 0.609 |
| 100 | C | 117,755 | 0.291 | 5/120 | |

Reading it: at short lengths belcore costs slightly more than full replay. The saving appears from N = 60 and is 40.3% at N = 100. B's recall is never below A's. Arm C loses almost every fact once N exceeds 10, as expected.

Conditions and caveats:

- **The comparison is tilted against B.** Arm A got the provider's cache discount (37% of input at N = 100). Arm B was costed with no cache discount, because the belcore API does not return cached-token counts. With no cache discount on either arm, B/A at N = 100 is 0.494.
- **The cache share and the compression share of the saving cannot be separated** with this data. There is no flag for it.
- 10,440 call attempts, all succeeded. 0 errors, 0 retries, 0 failed sessions. 0 degraded B responses.
- Total cost: $4.2443 (A $2.1030, B $1.4288, C $0.7125).
- One model only: `openai/gpt-4o-mini`.

### GPT-5: pilot, the opposite result

2 scenarios (`support`, `coaching`) x 1 repetition, 16 recall questions per cell. **This is a pilot, not a confirmed result.** Source: `gpt5-pilot-combined`.

| N | B/A cost | C/A cost | Recall A | Recall B | Recall C |
|---|---|---|---|---|---|
| 10 | 1.102 | 1.083 | 16/16 | 16/16 | 16/16 |
| 30 | 1.262 | 1.088 | 16/16 | 16/16 | 3/16 |
| 60 | 1.278 | 1.134 | 16/16 | 8/8 * | 2/16 |
| 100 | 1.346 | 1.121 | 16/16 | 16/16 | 2/16 |

\* One of the two N = 60 sessions for arm B failed, so only 8 questions were graded.

With GPT-5, belcore cost more than full replay at every length. The reason is the cache discount, not the input size:

- B still sends fewer input tokens. At N = 100: B 442,182 vs A 977,162.
- At N = 100, 94% of A's input (921,728 of 977,162 tokens) was billed at the cached price. In the gpt-4o-mini run it was 37%.
- With no cache discount on either arm, B/A at N = 100 is 0.665.

Conditions:

- **N = 10, 30, 60** come from run `pilot-2026-10-01T10-39-19-078Z` on default settings (belcore model wait of 20 s).
- **N = 100** comes from run `pilot-2026-10-01T13-45-44-875Z`, measured with a longer timeout enabled for the benchmark key. It is not a default-settings measurement for B at N = 100.
- The first run had 24 `HTTP 502: timeout` attempts. 12 calls succeeded on retry and 1 session (N = 60, arm B) failed. The N = 100 rerun had 0 errors.
- 8 B responses are marked degraded in `report.json`.
- An earlier N = 100 attempt on default settings (`pilot-2026-10-01T13-28-44-094Z`) was aborted and is not included in the combined data or in this repository.
- 1,352 call attempts. Total cost $13.98 (A $4.28, B $4.92, C $4.78).

## Not measured

- Cost per successful task including retries and fixes.
- Models other than gpt-4o-mini and GPT-5.
- Production traffic. The scenarios are scripted and synthetic.
- Repeated GPT-5 runs. The GPT-5 numbers are one repetition.

## Run it yourself

You need your own keys: a belcore key (free keys at https://belcore.xyz) and a Vercel AI Gateway key. Never commit keys.

```bash
npm install ai
cp .env.example .env     # add your own keys
node --env-file=.env bench/longsession/run.mjs --phase pilot
```

Options (see the top of `run.mjs`): `--phase pilot|full`, `--model <id>` (default `openai/gpt-4o-mini`), `--n 10,30,60,100`, `--concurrency 24`, `--max-cost <USD>`, `--smoke`.

A pilot run uses 2 scenarios and 1 repetition. A full run uses 5 scenarios and 3 repetitions. Costs are real provider charges on your account. Use `--max-cost` to cap a run.

Rebuild the summary tables from the raw results:

```bash
node bench/longsession/summarize.mjs bench/longsession/results/<runId>
node bench/longsession/range-table.mjs bench/longsession/results/<runId>
```

The Node.js and `ai` package versions used are not recorded in the run files.

Check any results you publish for leaked keys:

```bash
grep -r "sk_live_" bench/longsession/results/ | wc -l
```

Each `EVIDENCE.md` lists SHA-256 hashes of its run's files, so you can confirm the files in this repository are unchanged.

## Layout

```
bench/longsession/
  run.mjs               run the arms
  summarize.mjs         build summary.csv / report.json
  range-table.mjs       build range-table.md
  gen-scenarios.mjs     how the scenarios were generated
  scenario-seeds.mjs    scenario seeds
  lib.mjs               grader and helpers
  scenarios/            5 locked scenarios + LOCK.json
  results/
    full-2026-10-01T00-45-16-888Z/    gpt-4o-mini full run
    gpt5-pilot-combined/              GPT-5 pilot (N=10-60 + N=100 rerun)
    pilot-2026-10-01T10-39-19-078Z/   GPT-5 pilot, first run
    pilot-2026-10-01T13-45-44-875Z/   GPT-5 pilot, N=100 rerun
    pilot-2026-09-30T20-21-12-253Z/   gpt-4o-mini pilot
```

## What is not in this repository

belcore's engine code, internal configuration, retrieval context, and real keys. Requests to the belcore API are black-box: inputs and outputs only.

## Questions and corrections

If your numbers differ from ours, we want to know. Open an issue with your `run-config.json` and `summary.csv`.
