// Usage: node bench/longsession/summarize.mjs results/<runId>
// Session cost = conversation turns only; recall-probe cost is reported separately.
import { readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const dir = resolve(process.argv[2])
const rows = readFileSync(join(dir, "results.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)

const sessions = new Map()
const key = (r) => `${r.scenario}|${r.N}|${r.arm}|${r.rep}`
for (const r of rows) {
  if (!sessions.has(key(r)))
    sessions.set(key(r), { scenario: r.scenario, N: r.N, arm: r.arm, rep: r.rep, input: 0, cached: 0, output: 0, cost: 0, costNoCache: 0, probeCost: 0, recallOk: 0, recallN: 0, status: "incomplete" })
  const s = sessions.get(key(r))
  if (r.kind === "session") s.status = r.status
  if (r.status !== "ok") continue
  if (r.kind === "turn") {
    s.input += r.inputTokens
    s.cached += r.cachedInputTokens ?? 0
    s.output += r.outputTokens
    s.cost += r.costUsd
    s.costNoCache += r.costUsdNoCache
  } else if (r.kind === "recall") {
    s.probeCost += r.costUsd
    s.recallN++
    if (r.correct) s.recallOk++
  }
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
const groups = new Map()
for (const s of sessions.values()) {
  const g = `${s.N}|${s.arm}`
  if (!groups.has(g)) groups.set(g, [])
  groups.get(g).push(s)
}

const summary = []
for (const [g, list] of [...groups].sort(([a], [b]) => {
  const [na, aa] = a.split("|")
  const [nb, ab] = b.split("|")
  return Number(na) - Number(nb) || aa.localeCompare(ab)
})) {
  const [N, arm] = g.split("|")
  const ok = list.filter((s) => s.status === "complete")
  const reps = [...new Set(ok.map((s) => s.rep))]
  const perRep = reps.map((rep) => {
    const rs = ok.filter((s) => s.rep === rep)
    return { cost: mean(rs.map((s) => s.cost)), input: mean(rs.map((s) => s.input)), acc: rs.reduce((a, s) => a + s.recallOk, 0) / rs.reduce((a, s) => a + s.recallN, 0) }
  })
  const recallOk = ok.reduce((a, s) => a + s.recallOk, 0)
  const recallN = ok.reduce((a, s) => a + s.recallN, 0)
  summary.push({
    N: Number(N),
    arm,
    sessions: list.length,
    sessionsFailed: list.length - ok.length,
    meanInputTokens: mean(ok.map((s) => s.input)),
    meanCachedInputTokens: arm === "B" ? null : mean(ok.map((s) => s.cached)),
    meanCostUsd: mean(ok.map((s) => s.cost)),
    meanCostUsdNoCache: mean(ok.map((s) => s.costNoCache)),
    meanProbeCostUsd: mean(ok.map((s) => s.probeCost)),
    recallAccuracy: recallN ? recallOk / recallN : NaN,
    recallCorrect: recallOk,
    recallTotal: recallN,
    costMinRep: Math.min(...perRep.map((p) => p.cost)),
    costMaxRep: Math.max(...perRep.map((p) => p.cost)),
    inputMinRep: Math.min(...perRep.map((p) => p.input)),
    inputMaxRep: Math.max(...perRep.map((p) => p.input)),
    recallMinRep: Math.min(...perRep.map((p) => p.acc)),
    recallMaxRep: Math.max(...perRep.map((p) => p.acc)),
  })
}

for (const s of summary) {
  const a = summary.find((x) => x.N === s.N && x.arm === "A")
  const c = summary.find((x) => x.N === s.N && x.arm === "C")
  s.costVsA = a ? s.meanCostUsd / a.meanCostUsd : NaN
  if (s.arm === "B") {
    s.recallBelowA = a ? s.recallAccuracy < a.recallAccuracy : null
    s.recallVsC = c ? s.recallAccuracy - c.recallAccuracy : null
  }
}

const cols = Object.keys(summary[0] ?? {})
const fmt = (v) => (v == null ? "" : typeof v === "number" ? (Number.isInteger(v) ? v : v.toPrecision(6)) : v)
writeFileSync(join(dir, "summary.csv"), [cols.join(","), ...summary.map((s) => cols.map((c) => fmt(s[c])).join(","))].join("\n") + "\n")

const calls = rows.filter((r) => r.kind === "turn" || r.kind === "recall")
const counts = {
  callAttempts: calls.length,
  okCalls: calls.filter((r) => r.status === "ok").length,
  errorAttempts: calls.filter((r) => r.status === "error").length,
  retriedCallsSucceeded: calls.filter((r) => r.status === "ok" && r.attempt > 1).length,
  fatalErrors: calls.filter((r) => r.fatal).length,
  sessionsComplete: [...sessions.values()].filter((s) => s.status === "complete").length,
  sessionsFailed: [...sessions.values()].filter((s) => s.status !== "complete").length,
  bDegraded: calls.filter((r) => r.arm === "B" && r.degraded === true).length,
  bMemoryRecent: calls.filter((r) => r.arm === "B" && r.memory === "recent").length,
  errorsByMessage: Object.entries(
    calls.filter((r) => r.status === "error").reduce((m, r) => ((m[r.error] = (m[r.error] ?? 0) + 1), m), {}),
  ),
  totalCostUsd: calls.filter((r) => r.status === "ok").reduce((a, r) => a + r.costUsd, 0),
  totalCostByArm: Object.fromEntries(
    ["A", "B", "C"].map((arm) => [arm, calls.filter((r) => r.status === "ok" && r.arm === arm).reduce((a, r) => a + r.costUsd, 0)]),
  ),
}
writeFileSync(join(dir, "report.json"), JSON.stringify({ counts, summary }, null, 2) + "\n")
console.log(JSON.stringify(counts, null, 2))
console.table(summary.map((s) => ({ N: s.N, arm: s.arm, fail: s.sessionsFailed, inTok: Math.round(s.meanInputTokens), cost: s.meanCostUsd.toFixed(5), vsA: s.costVsA.toFixed(3), recall: `${s.recallCorrect}/${s.recallTotal}` })))
