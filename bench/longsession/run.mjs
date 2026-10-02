// Usage: node --env-file=.env bench/longsession/run.mjs --phase pilot|full [--concurrency 24] [--smoke]
// The belcore key is read from BELCORE_BENCH_API_KEY and is never printed or written.
import { generateText } from "ai"
import { execSync } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { GRADER_VERSION, grade, sha256File, sleep } from "./lib.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true])
    return acc
  }, []),
)

const PHASE = args.phase
if (PHASE !== "pilot" && PHASE !== "full") {
  console.error("--phase pilot|full is required")
  process.exit(1)
}
const SMOKE = Boolean(args.smoke)
const MODEL = typeof args.model === "string" ? args.model : "openai/gpt-4o-mini"
const MAX_COST_USD = args["max-cost"] !== undefined ? Number(args["max-cost"]) : Infinity
if (Number.isNaN(MAX_COST_USD)) {
  console.error("--max-cost must be a number (USD)")
  process.exit(1)
}
const ARMS = SMOKE && args.arms ? String(args.arms).split(",") : ["A", "B", "C"]
const WINDOW_TURNS = 10
const TURN_INTERVAL_MS = SMOKE ? 0 : 8000
const MAX_ATTEMPTS = 4
const BELCORE_URL = "https://belcore.xyz/api/v1/chat"
const ALL_SCENARIOS = ["support", "coaching", "companion", "project", "counsel"]
const SCENARIO_IDS = PHASE === "pilot" ? ALL_SCENARIOS.slice(0, 2) : ALL_SCENARIOS
const N_LIST = SMOKE ? [2] : typeof args.n === "string" ? args.n.split(",").map(Number) : [10, 30, 60, 100]
if (N_LIST.some((n) => !Number.isInteger(n) || n < 1 || n > 100)) {
  console.error("--n must be a comma list of integers 1-100")
  process.exit(1)
}
const REPS = PHASE === "pilot" ? 1 : 3
const CONCURRENCY = Number(args.concurrency ?? 24)
const RECALL_LIMIT = SMOKE ? 1 : Infinity

// ── Verify the locked scenarios before doing anything ──────────────────────
const lock = JSON.parse(readFileSync(join(HERE, "scenarios", "LOCK.json"), "utf8"))
const scenarios = SCENARIO_IDS.map((id) => {
  const file = join(HERE, "scenarios", `${id}.json`)
  const hash = sha256File(file)
  if (lock.files[`${id}.json`] !== hash) {
    console.error(`scenarios/${id}.json does not match LOCK.json; refusing to run.`)
    process.exit(1)
  }
  return { ...JSON.parse(readFileSync(file, "utf8")), sha256: hash }
})

if (ARMS.includes("B") && !process.env.BELCORE_BENCH_API_KEY) {
  console.error("BELCORE_BENCH_API_KEY is not set.")
  process.exit(1)
}

// ── Pricing snapshot (one version per run) ─────────────────────────────────
const models = await (await fetch("https://ai-gateway.vercel.sh/v1/models")).json()
const priceEntry = models.data.find((m) => m.id === MODEL)
if (!priceEntry) {
  console.error(`${MODEL} is not listed by AI Gateway.`)
  process.exit(1)
}
const PRICE = {
  input: Number(priceEntry.pricing.input),
  output: Number(priceEntry.pricing.output),
  cacheRead: Number(priceEntry.pricing.input_cache_read ?? priceEntry.pricing.input),
}
const pricingJson = JSON.stringify({ model: MODEL, pricing: priceEntry.pricing })
const PRICING_VERSION = `gateway-${new Date().toISOString().slice(0, 10)}-${createHash("sha256").update(pricingJson).digest("hex").slice(0, 8)}`

function costUsd(input, cached, output) {
  const c = cached ?? 0
  return (input - c) * PRICE.input + c * PRICE.cacheRead + output * PRICE.output
}

// ── Run folder + config record (written before the first call) ────────────
const RUN_ID = `${SMOKE ? "smoke" : PHASE}-${new Date().toISOString().replace(/[:.]/g, "-")}`
const RUN_DIR = join(HERE, "results", RUN_ID)
mkdirSync(RUN_DIR, { recursive: true })
const git = (cmd) => {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim()
  } catch {
    return null
  }
}
writeFileSync(join(RUN_DIR, "pricing.json"), JSON.stringify({ version: PRICING_VERSION, fetchedAt: new Date().toISOString(), ...JSON.parse(pricingJson) }, null, 2) + "\n")
writeFileSync(
  join(RUN_DIR, "run-config.json"),
  JSON.stringify(
    {
      runId: RUN_ID,
      phase: PHASE,
      smoke: SMOKE,
      startedAt: new Date().toISOString(),
      git: {
        localHead: git("git rev-parse HEAD"),
        branch: git("git rev-parse --abbrev-ref HEAD"),
        originMain: git("git rev-parse origin/main"),
        productionDeploymentSha:
          (typeof args["prod-sha"] === "string" ? args["prod-sha"] : null) ??
          git(`gh api "repos/dltbt888-hue/soyullink-dashboard-ui/deployments?environment=Production&per_page=1" --jq ".[0].sha"`),
      },
      config: {
        model: MODEL,
        maxCostUsd: Number.isFinite(MAX_COST_USD) ? MAX_COST_USD : null,
        costCapNote: "run stops starting new calls once the summed costUsdNoCache of all arms reaches maxCostUsd",
        temperature: "not sent in any arm (provider default); /api/v1/chat has no temperature parameter",
        arms: {
          A: "full history every turn, direct AI Gateway call, no memory layer",
          B: `belcore ${BELCORE_URL}, stateless (no emotion, no endUserId), full history sent, engine trims`,
          C: `last ${WINDOW_TURNS} turns (${WINDOW_TURNS * 2} messages) + current message, direct AI Gateway call`,
        },
        armsRun: ARMS,
        nList: N_LIST,
        reps: REPS,
        turnIntervalMs: TURN_INTERVAL_MS,
        maxAttemptsPerCall: MAX_ATTEMPTS,
        concurrency: CONCURRENCY,
        recallProbe: "each question sent once after turn N, appended to the arm's context, not added to history",
        graderVersion: GRADER_VERSION,
        pricingVersion: PRICING_VERSION,
        scenarios: scenarios.map((s) => ({ id: s.id, sha256: s.sha256 })),
        belcoreKey: "env BELCORE_BENCH_API_KEY (value never logged or stored)",
      },
    },
    null,
    2,
  ) + "\n",
)
const RESULTS = join(RUN_DIR, "results.jsonl")
const log = (row) => appendFileSync(RESULTS, JSON.stringify(row) + "\n")

// ── Arm calls ──────────────────────────────────────────────────────────────
class FatalError extends Error {}

async function callGateway(system, messages) {
  const r = await generateText({ model: MODEL, system, messages, maxRetries: 0 })
  return {
    reply: r.text,
    model: r.response?.modelId ?? MODEL,
    inputTokens: r.usage.inputTokens ?? 0,
    outputTokens: r.usage.outputTokens ?? 0,
    cachedInputTokens: r.usage.cachedInputTokens ?? r.usage.inputTokenDetails?.cacheReadTokens ?? 0,
    reasoningTokens: r.usage.reasoningTokens ?? r.usage.outputTokenDetails?.reasoningTokens ?? null,
  }
}

async function callBelcore(system, messages) {
  const res = await fetch(BELCORE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.BELCORE_BENCH_API_KEY}` },
    body: JSON.stringify({ model: MODEL, system, messages }),
    signal: AbortSignal.timeout(MODEL === "openai/gpt-4o-mini" ? 45000 : 180000),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = `HTTP ${res.status}: ${String(body?.error?.message ?? body?.error ?? "").slice(0, 160)}`
    if ([400, 401, 402, 403].includes(res.status)) throw new FatalError(msg)
    const e = new Error(msg)
    e.httpStatus = res.status
    throw e
  }
  return {
    reply: body.reply ?? "",
    model: body.model ?? MODEL,
    inputTokens: body.usage?.inputTokens ?? 0,
    outputTokens: body.usage?.outputTokens ?? 0,
    cachedInputTokens: null,
    reasoningTokens: body.usage?.reasoningTokens ?? null,
    degraded: body.degraded ?? null,
    memory: body.memory ?? null,
  }
}

let spentUsd = 0

async function call(ctx, system, messages) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (spentUsd >= MAX_COST_USD) throw new FatalError(`cost cap reached: $${spentUsd.toFixed(2)} >= $${MAX_COST_USD}`)
    const t0 = Date.now()
    try {
      const r = ctx.arm === "B" ? await callBelcore(system, messages) : await callGateway(system, messages)
      const row = {
        ...ctx,
        attempt,
        status: "ok",
        model: r.model,
        sentMessages: messages.length,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        cachedInputTokens: r.cachedInputTokens,
        reasoningTokens: r.reasoningTokens,
        latencyMs: Date.now() - t0,
        pricingVersion: PRICING_VERSION,
        costUsd: costUsd(r.inputTokens, r.cachedInputTokens, r.outputTokens),
        costUsdNoCache: costUsd(r.inputTokens, 0, r.outputTokens),
        ...(ctx.arm === "B" ? { degraded: r.degraded, memory: r.memory } : {}),
      }
      spentUsd += row.costUsdNoCache
      return { r, row }
    } catch (e) {
      const fatal = e instanceof FatalError
      log({
        ...ctx,
        attempt,
        status: "error",
        fatal,
        error: String(e.message ?? e).replaceAll(process.env.BELCORE_BENCH_API_KEY ?? "\u0000", "[key]").slice(0, 200),
        latencyMs: Date.now() - t0,
        model: MODEL,
        pricingVersion: PRICING_VERSION,
      })
      if (fatal || attempt === MAX_ATTEMPTS) throw e
      await sleep(2000 * 2 ** (attempt - 1))
    }
  }
}

let fatalStop = null

async function runSession(s, N, arm, rep) {
  const base = { runId: RUN_ID, phase: PHASE, scenario: s.id, N, arm, rep }
  const history = []
  const context = (next) => [...(arm === "C" ? history.slice(-WINDOW_TURNS * 2) : history), { role: "user", content: next }]
  try {
    for (let t = 1; t <= N; t++) {
      if (fatalStop) throw fatalStop
      const user = s.turns[t - 1]
      const { r, row } = await call({ ...base, kind: "turn", turn: t }, s.system, context(user))
      log(row)
      history.push({ role: "user", content: user }, { role: "assistant", content: r.reply })
      await sleep(TURN_INTERVAL_MS)
    }
    for (const q of s.recall.slice(0, RECALL_LIMIT)) {
      if (fatalStop) throw fatalStop
      const { r, row } = await call({ ...base, kind: "recall", turn: N + 1, recallId: q.id }, s.system, context(q.question))
      log({ ...row, correct: grade(r.reply, q.answer), reply: r.reply })
      await sleep(TURN_INTERVAL_MS)
    }
    log({ ...base, kind: "session", status: "complete" })
  } catch (e) {
    if (e instanceof FatalError) fatalStop = e
    log({ ...base, kind: "session", status: "failed", error: String(e.message ?? e).slice(0, 200), turnsDone: history.length / 2 })
  }
}

const jobs = []
for (let rep = 1; rep <= REPS; rep++)
  for (const s of scenarios) for (const N of N_LIST) for (const arm of ARMS) jobs.push(() => runSession(s, N, arm, rep))

console.log(`run ${RUN_ID}: ${jobs.length} sessions, concurrency ${CONCURRENCY}`)
let next = 0
let done = 0
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++]
      await job()
      done++
      if (done % 4 === 0 || done === jobs.length) console.log(`${done}/${jobs.length} sessions finished`)
    }
  }),
)
if (fatalStop) console.log(`stopped early: ${fatalStop.message}`)
console.log(`estimated spend (no cache discount): $${spentUsd.toFixed(2)}`)
console.log(`results: ${RESULTS}`)
