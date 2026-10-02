import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

export const GRADER_VERSION = "keyword-substring-v1"

export function normalize(s) {
  return String(s ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, "")
}

export function grade(reply, groups) {
  const r = normalize(reply)
  return groups.every((g) => g.some((k) => r.includes(normalize(k))))
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function allAnswerKeywords(scenario) {
  return scenario.recall.flatMap((q) => q.answer.flat()).map(normalize)
}

export function leakedKeywords(text, keywords) {
  const t = normalize(text)
  return keywords.filter((k) => t.includes(k))
}
