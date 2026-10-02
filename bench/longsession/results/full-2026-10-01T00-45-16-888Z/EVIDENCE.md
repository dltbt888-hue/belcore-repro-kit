# Long-session savings curve — evidence

Run `full-2026-10-01T00-45-16-888Z`. Measured savings of the belcore API
(`/api/v1/chat`) over long sessions vs. full history and a sliding window.
No new features, no production defaults changed.

## Headline

- Cost of B relative to A: N=10 **1.014**, N=30 **1.067**, N=60 **0.947**, N=100 **0.597**.
  Short sessions cost slightly more through belcore; savings appear from N=60 and reach
  **40.3% at N=100**. Rep ranges for A and B do not overlap at any N.
- B recall is **never lower than A** (equal at N=10/30, higher at N=60/100).
- C (last 10 turns) collapses from N=30 (2–5/120) because all facts are planted in
  turns 1–10; this is expected by design. B holds 95% under the same condition.
- Errors / retries / failed calls: **0 / 0 / 0**. B degraded responses: 0.
- Total cost: **$4.2443** (A $2.1030, B $1.4288, C $0.7125).

## Results (5 scenarios × 3 reps; 120 recall questions per cell)

| N | Arm | Mean input tok | Mean cost (USD) | Cost vs A | Recall | Cost min–max over reps |
|---|---|---|---|---|---|---|
| 10 | A | 4,148 | 0.000952 | 1.000 | 120/120 | 0.000926–0.000973 |
| 10 | B | 4,205 | 0.000965 | 1.014 | 120/120 | 0.000954–0.000985 |
| 10 | C | 4,194 | 0.000958 | 1.006 | 120/120 | 0.000943–0.000968 |
| 30 | A | 41,248 | 0.007246 | 1.000 | 117/120 | 0.007013–0.007535 |
| 30 | B | 42,201 | 0.007729 | 1.067 | 117/120 | 0.007612–0.007891 |
| 30 | C | 24,446 | 0.004955 | 0.684 | 2/120 | 0.004802–0.005115 |
| 60 | A | 183,099 | 0.027225 | 1.000 | 110/120 | 0.026642–0.027738 |
| 60 | B | 150,946 | 0.025774 | 0.947 | 114/120 | 0.025665–0.025947 |
| 60 | C | 57,908 | 0.011530 | 0.424 | 2/120 | 0.011110–0.011759 |
| 100 | A | 602,239 | 0.080743 | 1.000 | 96/120 | 0.078724–0.082433 |
| 100 | B | 277,435 | 0.048229 | 0.597 | 114/120 | 0.047651–0.049086 |
| 100 | C | 117,755 | 0.023512 | 0.291 | 5/120 | 0.023169–0.023931 |

Full columns (including recall min/max over reps): `summary.csv`.

## Caveats

- **Cache vs. compression share cannot be separated.** There is no flag for it and the
  belcore API does not return cached input tokens, so B is costed with no cache discount
  while A gets one (37% of input at N=100). This biases the comparison **against B**.
  With no cache discount on either arm, B/A at N=100 is 0.494.
- **Temperature:** not sent in any arm (provider default). `/api/v1/chat` has no
  temperature parameter and adding one would be a new feature (decision approved before the run).
- Cost counts model calls only; belcore fees are excluded.
- Facts were planted in turns 1–10 (not 1–15) so N=10 can score 8/8 (approved before the run).
- Scenarios and grader were fixed before the pilot and not changed afterwards.

## Configuration

- Model `openai/gpt-4o-mini` via AI Gateway; turn interval 8 s; up to 4 attempts per call.
- Arms: A = full history each turn, direct; B = belcore `https://belcore.xyz/api/v1/chat`,
  stateless, full history sent, engine trims; C = last 10 turns + current message, direct.
- Recall probe: each question sent once after turn N, not added to history.
- Grader `keyword-substring-v1`; pricing `gateway-2026-10-01-50d96241`.
- A belcore benchmark key was used. The key value is not stored anywhere in this folder (`sk_live_` search: 0 hits).
- No real user data; all scenario facts are synthetic.

## Counts

| Item | Value |
|---|---|
| Sessions complete / failed | 180 / 0 |
| API call attempts / OK | 10,440 / 10,440 |
| Error attempts | 0 |
| Retried calls that succeeded | 0 |
| Fatal errors | 0 |
| B degraded | 0 |
| `results.jsonl` rows | 10,620 (9,000 turn + 1,440 recall + 180 session summaries) |

## Provenance

- Git commit hashes of the run are recorded in `run-config.json`. The production deployment SHA was not retrievable (recorded as `null`).
- Pilot: `../pilot-2026-09-30T20-21-12-253Z/`.

## File hashes (SHA-256)

| File | SHA-256 |
|---|---|
| `results.jsonl` | `1520dc51e54340319ef7c39289cf52185d604458b496f470bd7288813c54b7f4` |
| `summary.csv` | `fa29fc871bc9c84cb81adcdfeba8d1e33206209fd1239e0f206753d12bbe2ec7` |
| `report.json` | `743dab838188eae77b74b332b49e8fa76692c876f05fbd3a1e3039a580295549` |
| `run-config.json` | `d8b35c6fe449b8a1821faa36e550bfb7d7738dc9b6f6eed75821f3c5de42702b` |
| `pricing.json` | `29a2e968510f19c5e9dc8aa1bfb7cf8b08d46ed7c8462d9c0dff544738b62e27` |

Scenario hashes are in `run-config.json` (`config.scenarios[].sha256`).
