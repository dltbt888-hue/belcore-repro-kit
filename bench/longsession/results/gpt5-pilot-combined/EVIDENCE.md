# GPT-5 long-session pilot — evidence

> **파일럿: 시나리오 2개, 반복 1회, 칸당 16문항. 확정 결과 아님.**

Source folder: `bench/longsession/results/gpt5-pilot-combined/`.
Every number below is copied from `range-table.md`, `summary.csv`, or `report.json` in this folder.
No numbers are estimated.

## Result: the opposite of gpt-4o-mini

With `openai/gpt-5`, **arm B (belcore) cost more than arm A (full history) at every session length.**
This is the opposite of the gpt-4o-mini full run, where B was 40.3% cheaper than A at N=100
(`bench/longsession/results/full-2026-10-01T00-45-16-888Z/EVIDENCE.md`).

| N | B/A cost | change |
|---|---|---|
| 10 | 1.102 | +10.2% |
| 30 | 1.262 | +26.2% |
| 60 | 1.278 | +27.8% |
| 100 | 1.346 | +34.6% |

One repetition only, so the per-rep min and max equal the mean.

## Why: A's cache discount, not B's input size

- **B still sends fewer input tokens.** Mean input tokens at N=100: **B 442,182 vs A 977,162**.
- **With no cache discount on either arm**, B/A cost at N=100 is **0.665**
  (B 1.36373 ÷ A 2.05015 USD, `meanCostUsdNoCache` in `summary.csv`).
- **A's cache share is much higher with GPT-5.** At N=100, cached input is 921,728 of 977,162 tokens for A (**94%**).
  In the gpt-4o-mini full run it was **37%**.
- B is costed with **no cache discount**, because the belcore API returns no cached-token count.
  Cache and compression shares are **not separable** (no flag exists). This bias against B is the same as in the gpt-4o-mini run, but it is much larger here because A's cache share is higher.

## Recall (correct / questions)

| N | A | B | C |
|---|---|---|---|
| 10 | 16/16 | 16/16 | 16/16 |
| 30 | 16/16 | 16/16 | 3/16 |
| 60 | 16/16 | **8/8** | 2/16 |
| 100 | 16/16 | 16/16 | 2/16 |

- B's recall was never below A's.
- **N=60 B was scored on 8 questions only.** One of its two sessions failed (`sessionsFailed` = 1), so only one session was graded.
- C (last-10-turn window) drops from N=30, as expected: the facts are planted in turns 1–10.

## Conditions

- **N=10, 30, 60:** first run `pilot-2026-10-01T10-39-19-078Z`, **production default settings** (belcore model wait 20 s).
- **N=100:** rerun `pilot-2026-10-01T13-45-44-875Z`, with **the Benchmark key's timeout extended**.
  This is not a production-default measurement for B at N=100.
- **Errors:** first run had **24 `HTTP 502: timeout`** attempts. 12 calls succeeded on retry. 1 session (N=60 B) failed.
  The N=100 rerun had **0 errors**.
- `report.json` also records **8 B responses marked degraded** (`bDegraded`) across the combined data.
- An earlier aborted N=100 attempt (`pilot-2026-10-01T13-28-44-094Z`, production default timeout) is **not** included in this combined data.
- Model `openai/gpt-5` in all arms. Temperature not sent in any arm (provider default). Turn interval 8 s.
- Grader `keyword-substring-v1`, unchanged. Scenarios `support` and `coaching`, unchanged (SHA-256 in `run-config.json`).
- Cost is model-call cost only. belcore fees are excluded.
- Pricing version `gateway-2026-10-01-a42e073b`.

## Counts

| Item | Value |
|---|---|
| Call attempts | 1,352 |
| Successful calls | 1,328 |
| Error attempts | 24 (all `HTTP 502: timeout`) |
| Calls succeeded after retry | 12 |
| Fatal errors | 0 |
| Sessions complete / failed | 23 / 1 |
| Total cost (USD) | 13.98 (A 4.28, B 4.92, C 4.78) |
| `results.jsonl` lines | 1,376 |

## Provenance

Git commit hashes of each run are recorded in `run-config.json`.

The belcore key value is not stored anywhere in this folder (`sk_live_` search: 0 hits).

## SHA-256

```
5f6b9b8b728544dd25f65f2d20833ad8127177390d2be03aa5463e62815a9cb6  results.jsonl
f60ec530ef840c4a8962394f5b96928c7652de8bf9aa5f3739a6e96861c24c0b  summary.csv
f7005767b7c41fb8d7dcf5814c891f92356c7aebe84b64c7222d5df407a7bc35  report.json
664f0012c210992036df8a6a2f0e0d8e5cceb4aa8ca19a4efe38bd6ef7eb131a  run-config.json
13023bfb53c539eebbc294ff2139ef8b7ce4a137b4ea85fcb0b354581665c6c9  pricing.json
563bdf5cb516ad05099e76132142aca85b3d06a90ea4ef28fd291e57ef5ed8bf  range-table.md
```
