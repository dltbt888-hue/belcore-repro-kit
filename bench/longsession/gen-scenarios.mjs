// One-time generator. Refuses to run if scenarios/LOCK.json exists, so the
// fixed scenarios can never be regenerated after the first successful run.
import { generateText } from "ai"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { SCENARIOS } from "./scenario-seeds.mjs"
import { GRADER_VERSION, allAnswerKeywords, leakedKeywords, sha256File } from "./lib.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, "scenarios")
const LOCK = join(OUT, "LOCK.json")
const GEN_MODEL = "openai/gpt-4.1-mini"
const TOTAL_TURNS = 100
const SEED_TURNS = 10
const FILLER = TOTAL_TURNS - SEED_TURNS

if (existsSync(LOCK)) {
  console.error("scenarios/LOCK.json exists: scenarios are fixed and must not be regenerated.")
  process.exit(1)
}
mkdirSync(OUT, { recursive: true })

function parseTurns(text) {
  const start = text.indexOf("[")
  const end = text.lastIndexOf("]")
  const arr = JSON.parse(text.slice(start, end + 1))
  if (!Array.isArray(arr)) throw new Error("not an array")
  return arr.map((s) => String(s).trim())
}

async function ask(prompt) {
  const { text } = await generateText({ model: GEN_MODEL, prompt })
  return parseTurns(text)
}

function basePrompt(s, count, forbidden) {
  return [
    `다음은 "${s.title}" 대화에서 사용자가 보낸 처음 ${SEED_TURNS}개의 발화다.`,
    `상대 역할: ${s.system}`,
    ...s.seedTurns.map((t, i) => `${i + 1}. ${t}`),
    "",
    `이어지는 사용자 발화 ${count}개를 한국어로 만들어라. 주제 흐름: ${s.topic}.`,
    "규칙:",
    "- 사용자 발화만 쓴다. 상대의 답이 무엇이든 자연스럽게 이어질 수 있게 쓴다.",
    "- 한 발화는 10~60자. 질문, 근황, 짧은 반응을 섞는다.",
    "- 처음 10개 발화에 나온 개인 정보(이름, 번호, 날짜, 시간, 장소, 사람·동물 이름, 선호, 기록 등)를 다시 언급하거나 묻지 않는다.",
    `- 다음 단어는 어떤 형태로도 쓰지 않는다: ${forbidden.join(", ")}`,
    `- 출력은 문자열 ${count}개로 된 JSON 배열 하나만.`,
  ].join("\n")
}

async function buildFiller(s) {
  const forbidden = [...new Set(s.recall.flatMap((q) => q.answer.flat()))]
  const keywords = allAnswerKeywords(s)
  let turns = await ask(basePrompt(s, FILLER, forbidden))
  for (let topUp = 0; turns.length < FILLER && topUp < 3; topUp++) {
    turns = turns.concat(await ask(basePrompt(s, FILLER - turns.length, forbidden)))
  }
  if (turns.length < FILLER) throw new Error(`${s.id}: got ${turns.length} turns, need ${FILLER}`)
  turns = turns.slice(0, FILLER)
  for (let round = 1; round <= 5; round++) {
    const bad = turns.map((t, i) => (leakedKeywords(t, keywords).length || !t ? i : -1)).filter((i) => i >= 0)
    if (bad.length === 0) return { turns, rewriteRounds: round - 1 }
    const repl = await ask(basePrompt(s, bad.length, forbidden))
    bad.forEach((idx, k) => {
      if (repl[k]) turns[idx] = repl[k]
    })
  }
  throw new Error(`${s.id}: filler still leaks answer keywords after 5 rewrite rounds`)
}

const lock = { createdAt: new Date().toISOString(), generatorModel: GEN_MODEL, graderVersion: GRADER_VERSION, files: {} }
for (const s of SCENARIOS) {
  for (const q of s.recall) {
    const leak = leakedKeywords(q.question, q.answer.flat().map((k) => k.toLowerCase()))
    if (leak.length) throw new Error(`${s.id}/${q.id}: question contains its answer`)
    const factText = s.seedTurns[q.factTurn - 1]
    if (!q.answer.every((g) => g.some((k) => leakedKeywords(factText, [k.toLowerCase().replace(/\s+/g, "")]).length)))
      throw new Error(`${s.id}/${q.id}: fact turn ${q.factTurn} does not contain the answer`)
  }
  const file = join(OUT, `${s.id}.json`)
  if (existsSync(file)) {
    lock.files[`${s.id}.json`] = sha256File(file)
    console.log(`${s.id}: already generated, kept as-is`)
    continue
  }
  const { turns, rewriteRounds } = await buildFiller(s)
  const doc = {
    id: s.id,
    title: s.title,
    system: s.system,
    turns: [...s.seedTurns, ...turns],
    recall: s.recall,
    grading: {
      version: GRADER_VERSION,
      rule: "Correct iff every answer group has at least one alternative that is a substring of the reply after NFKC, lowercase, and whitespace removal.",
    },
    generation: { seedTurns: "hand-written (turns 1-10)", fillerModel: GEN_MODEL, rewriteRounds },
  }
  if (doc.turns.length !== TOTAL_TURNS) throw new Error(`${s.id}: ${doc.turns.length} turns`)
  writeFileSync(file, JSON.stringify(doc, null, 2) + "\n")
  lock.files[`${s.id}.json`] = sha256File(file)
  console.log(`${s.id}: 100 turns written (rewrite rounds: ${rewriteRounds})`)
}
writeFileSync(LOCK, JSON.stringify(lock, null, 2) + "\n")
console.log("LOCK.json written")
