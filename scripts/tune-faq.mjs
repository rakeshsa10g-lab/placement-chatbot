/**
 * Measure how well the FAQ matcher handles real student phrasings.
 *
 *     npm run tune-faq
 *
 * Students type short queries ("dress code for interviews") while generated FAQ
 * entries are long and formal ("What are the dress code requirements for placement
 * interviews?"). This script reports what fraction of realistic phrasings get an
 * instant answer, and — more importantly — whether any UNRELATED question wrongly
 * matches. A false positive means a student gets a confidently wrong answer, which
 * is far worse than an extra API call.
 *
 * Run it after every `npm run build-faq`. If the hit rate drops, add more entries
 * (`npm run build-faq -- 150`) rather than lowering the threshold.
 *
 * Edit SHOULD_MATCH / SHOULD_NOT_MATCH to reflect what your students actually ask —
 * the real list is in your escalation sheet and Vercel logs.
 */
import fs from "node:fs/promises";
import path from "node:path";

// Keep these in sync with public/widget.js
const THRESHOLD = 0.5;
const WEIGHTS = { keyword: 0.4, precision: 0.45, coverage: 0.15 };

const STOPWORDS = new Set(
  ("the a an is are was were do does did i my me we you your to for of in on at and or if can " +
   "will would should what when how where which who it this that be have has get got any there " +
   "about please tell am not with from by as but so than then they them their our us also more").split(" ")
);

const stem = (w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
const tokenize = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w)).map(stem);

function score(qTokens, entry) {
  const set = new Set(qTokens);
  const kw = (entry.keywords || []).map((k) => stem(String(k).toLowerCase()));
  const kwScore = kw.length ? kw.filter((k) => set.has(k)).length / kw.length : 0;
  const qt = entry._t || (entry._t = tokenize(entry.q));
  const hits = qt.filter((t) => set.has(t)).length;
  const coverage = qt.length ? hits / qt.length : 0;
  const precision = qTokens.length ? hits / qTokens.length : 0;
  return WEIGHTS.keyword * kwScore + WEIGHTS.precision * precision + WEIGHTS.coverage * coverage;
}

// Short, informal phrasings a student would actually type.
const SHOULD_MATCH = [
  "dress code for interviews",
  "what is the registration fee",
  "how many credits do I start with",
  "when do placement interviews start",
  "can I round off my CGPA on my resume",
  "proof needed for internship on resume",
  "what is one student one offer",
  "penalty for placement violations",
  "when does phase 2 start",
  "deadline for closed PPO",
  "how long to accept an offer",
  "what is a backlog",
  "minimum credits to sit for placements",
  "can I put department rank on resume",
  "when is resume submission period",
];

// Must NEVER match — a wrong instant answer is worse than no instant answer.
const SHOULD_NOT_MATCH = [
  "dress code for the department farewell party",
  "what is the wifi password in the hostel",
  "can I bring my parents to the interview",
  "who won the cricket match",
  "how do I apply for a hostel room change",
];

const faq = JSON.parse(await fs.readFile(path.resolve("public", "faq.json"), "utf8"));
const bestFor = (q) => {
  const qT = tokenize(q);
  let best = 0, which = null;
  for (const e of faq.entries) {
    const s = score(qT, e);
    if (s > best) { best = s; which = e.q; }
  }
  return { best, which };
};

console.log(`FAQ entries: ${faq.entries.length}   threshold: ${THRESHOLD}\n`);

let hits = 0;
console.log("Should be answered instantly:");
for (const q of SHOULD_MATCH) {
  const { best } = bestFor(q);
  const ok = best >= THRESHOLD;
  if (ok) hits++;
  console.log(`  ${ok ? "HIT " : "miss"}  ${best.toFixed(2)}  ${q}`);
}

let falsePositives = 0;
console.log("\nMust NOT match:");
for (const q of SHOULD_NOT_MATCH) {
  const { best, which } = bestFor(q);
  const bad = best >= THRESHOLD;
  if (bad) falsePositives++;
  console.log(`  ${bad ? "WRONG" : "ok   "}  ${best.toFixed(2)}  ${q}${bad ? `  -> "${which}"` : ""}`);
}

const rate = Math.round((hits / SHOULD_MATCH.length) * 100);
console.log(`\nInstant-answer rate: ${hits}/${SHOULD_MATCH.length} (${rate}%)`);
console.log(`False positives:     ${falsePositives}`);

if (falsePositives > 0) {
  console.log("\n! False positives found. Raise THRESHOLD in this file AND public/widget.js.");
  process.exit(1);
}
if (rate < 60) {
  console.log("\n! Low hit rate — most questions will spend API quota.");
  console.log("  Generate more entries:  npm run build-faq -- 150");
}
