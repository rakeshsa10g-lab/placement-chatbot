/**
 * Pre-answer the most common student questions and save them to public/faq.json.
 *
 * WHY THIS EXISTS
 * ---------------
 * Placement questions are extremely repetitive — during a results week hundreds of
 * students ask the same handful of things within minutes. Answering each one with a
 * live AI call is slow, rate-limited, and (on paid plans) expensive.
 *
 * This script answers those questions ONCE, at build time. The widget downloads
 * faq.json from the CDN and matches questions in the browser, so a common question
 * is answered instantly with NO server call and NO AI call. That's what makes high
 * traffic survivable on a free plan.
 *
 * Usage:   npm run build-faq            (default 60 questions)
 *          npm run build-faq -- 100     (more coverage, more build time)
 *
 * Re-run it whenever documents change, right after `npm run ingest`.
 */
import fs from "node:fs/promises";
import path from "node:path";

// ---- load .env (same simple parser as the dev server) ----
try {
  const envFile = await fs.readFile(path.resolve(".env"), "utf8");
  for (const line of envFile.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith("#") && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch { /* env may come from the shell */ }

const HOW_MANY = Number(process.argv[2]) || 60;
const DELAY_MS = Number(process.env.FAQ_DELAY_MS || 4000); // stay under free-tier rate limits
const INSTITUTION = process.env.INSTITUTION_NAME || "our institute";

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const LLAMA_MODEL = process.env.LLAMA_MODEL || "llama-3.3-70b-versatile";
const LLAMA_BASE_URL = (process.env.LLAMA_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/+$/, "");
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

function pickProvider() {
  const forced = (process.env.LLM_PROVIDER || "").toLowerCase();
  if (["anthropic", "gemini", "llama"].includes(forced)) return forced;
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.LLAMA_API_KEY) return "llama";
  return null;
}

const PROVIDER = pickProvider();
if (!PROVIDER) {
  console.error("No API key found. Set GEMINI_API_KEY (or LLAMA_API_KEY / ANTHROPIC_API_KEY) in .env first.");
  process.exit(1);
}

const ANSWER_RULES = `You are the official placement and internship assistant for ${INSTITUTION}.

Rules:
1. Answer ONLY from the reference documents. Never invent policies, dates, or cutoffs.
2. Cite your source: name the document and the section, e.g. "According to the Internship Policy (Section 3.2): ...".
3. If the documents do not answer the question, reply with exactly: [[ESCALATE]]
4. Be concise and student-friendly. Use markdown: **bold** for key figures, bullet lists for multiple points.`;

/** One non-streaming completion, whichever provider is configured. */
async function complete(system, user, maxTokens = 1200) {
  if (PROVIDER === "gemini") {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { maxOutputTokens: maxTokens },
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`${r.status} ${j.error?.message || ""}`);
    return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
  }

  if (PROVIDER === "llama") {
    const r = await fetch(`${LLAMA_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.LLAMA_API_KEY}` },
      body: JSON.stringify({
        model: LLAMA_MODEL,
        max_tokens: maxTokens,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`${r.status} ${j.error?.message || ""}`);
    return (j.choices?.[0]?.message?.content || "").trim();
  }

  // anthropic
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const msg = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: maxTokens,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
  });
  return msg.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Pull a JSON array out of a model reply that may be wrapped in prose or fences. */
function extractJsonArray(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("no JSON array found in model reply");
  return JSON.parse(body.slice(start, end + 1));
}

async function main() {
  const knowledge = await fs.readFile(path.resolve("knowledge", "knowledge.md"), "utf8").catch(() => "");
  if (!knowledge) {
    console.error("knowledge/knowledge.md not found. Run `npm run ingest` first.");
    process.exit(1);
  }

  console.log(`Provider: ${PROVIDER}`);
  console.log(`Generating the ${HOW_MANY} most likely student questions...\n`);

  // ---- 1. ask the model which questions students will actually ask ----
  const qPrompt =
    `Below are the official placement and internship documents for ${INSTITUTION}.\n\n` +
    `${knowledge}\n\n---\n\n` +
    `List the ${HOW_MANY} questions students are MOST likely to ask about these documents. ` +
    `Cover eligibility, deadlines, timelines, resume rules, offer policies, credits, penalties, and procedures. ` +
    `Every question must be answerable from the documents above.\n\n` +
    `Reply with ONLY a JSON array, no prose, in this exact shape:\n` +
    `[{"q":"the question as a student would type it","keywords":["4","to","8","distinctive","lowercase","words"]}]\n` +
    `Keywords must be single words that appear in a student's phrasing of that question ` +
    `(not generic words like "what" or "the").`;

  let questions;
  try {
    questions = extractJsonArray(await complete("You output only valid JSON arrays.", qPrompt, 8000));
  } catch (err) {
    console.error("Could not generate the question list:", err.message);
    process.exit(1);
  }

  questions = questions
    .filter((x) => x && typeof x.q === "string" && x.q.trim())
    .slice(0, HOW_MANY);
  console.log(`Got ${questions.length} questions. Answering each (about ${Math.ceil((questions.length * DELAY_MS) / 60000)} min)...\n`);

  // ---- 2. answer each one, grounded in the documents ----
  const entries = [];
  let skipped = 0;
  for (let i = 0; i < questions.length; i++) {
    const { q, keywords } = questions[i];
    const label = `[${String(i + 1).padStart(3)}/${questions.length}] ${q.slice(0, 58)}`;
    try {
      const answer = await complete(
        `${ANSWER_RULES}\n\nReference documents:\n\n${knowledge}`,
        q
      );
      if (!answer || answer.includes("[[ESCALATE]]")) {
        skipped++;
        console.log(`${label} — skipped (not answerable from documents)`);
      } else {
        entries.push({
          q: q.trim(),
          keywords: Array.isArray(keywords)
            ? keywords.map((k) => String(k).toLowerCase()).filter((k) => k.length > 2).slice(0, 10)
            : [],
          a: answer,
        });
        console.log(`${label} — ok`);
      }
    } catch (err) {
      skipped++;
      console.log(`${label} — FAILED: ${err.message}`);
    }
    if (i < questions.length - 1) await sleep(DELAY_MS);
  }

  // ---- 3. write the static file the widget downloads ----
  const out = {
    generated: new Date().toISOString(),
    institution: INSTITUTION,
    count: entries.length,
    entries,
  };
  const outPath = path.resolve("public", "faq.json");
  await fs.writeFile(outPath, JSON.stringify(out, null, 1), "utf8");

  const kb = (await fs.stat(outPath)).size / 1024;
  console.log(`\nWrote ${outPath}`);
  console.log(`${entries.length} instant answers (${skipped} skipped), ${kb.toFixed(0)} KB.`);
  console.log("\nThese are now served straight from the CDN — no AI call, no rate limit.");
  console.log("Next: git add -A && git commit -m 'update FAQ' && git push");
}

main();
