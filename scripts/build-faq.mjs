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
// Free tiers are strict — Gemini's current flash model allows only ~5 requests/minute.
// 13s between calls keeps us under that. Raise FAQ_DELAY_MS if you still see 429s.
const DELAY_MS = Number(process.env.FAQ_DELAY_MS || 13000);
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

// Schema for the question-list step. Asking the provider to *guarantee* valid JSON
// is far more reliable than parsing whatever prose the model feels like emitting.
const QUESTION_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      q: { type: "STRING" },
      keywords: { type: "ARRAY", items: { type: "STRING" } },
    },
    required: ["q", "keywords"],
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Wraps completeOnce with automatic retry when the free tier says "slow down".
 * Providers tell us how long to wait ("Please retry in 1.39s") — we honour that,
 * with exponential backoff as a floor. Without this, a long build loses a large
 * fraction of its questions to 429s.
 */
async function complete(system, user, maxTokens = 1200, wantJson = false, attempts = 4) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await completeOnce(system, user, maxTokens, wantJson);
    } catch (err) {
      lastErr = err;
      const msg = String(err.message || "");
      const isRateLimit = msg.startsWith("429") || /quota|rate limit/i.test(msg);
      if (!isRateLimit || i === attempts - 1) throw err;
      const hinted = msg.match(/retry in ([\d.]+)s/i);
      const waitMs = hinted
        ? Math.ceil(parseFloat(hinted[1]) * 1000) + 1500
        : Math.min(60000, 8000 * 2 ** i);
      process.stdout.write(` [rate limited, waiting ${Math.round(waitMs / 1000)}s] `);
      await sleep(waitMs);
    }
  }
  throw lastErr;
}

/** One non-streaming completion, whichever provider is configured. */
async function completeOnce(system, user, maxTokens = 1200, wantJson = false) {
  if (PROVIDER === "gemini") {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
    const generationConfig = { maxOutputTokens: maxTokens };
    if (wantJson) {
      generationConfig.responseMimeType = "application/json";
      generationConfig.responseSchema = QUESTION_SCHEMA;
    }
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig,
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`${r.status} ${j.error?.message || ""}`);
    return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
  }

  if (PROVIDER === "llama") {
    const body = {
      model: LLAMA_MODEL,
      max_tokens: maxTokens,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    };
    if (wantJson) body.response_format = { type: "json_object" };
    const r = await fetch(`${LLAMA_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.LLAMA_API_KEY}` },
      body: JSON.stringify(body),
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

/**
 * Pull a JSON array out of a model reply that may be wrapped in prose or fences.
 * Falls back to salvaging whole `{...}` objects if the array as a whole is malformed,
 * so one bad entry doesn't cost us the entire batch.
 */
function extractJsonArray(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  let body = fenced ? fenced[1] : text;

  // Some providers wrap the array in an object, e.g. {"questions": [...]}
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start !== -1 && end > start) {
    const slice = body.slice(start, end + 1);
    try {
      return JSON.parse(slice);
    } catch {
      body = slice; // fall through to salvage
    }
  }

  // Salvage: collect each individually-parseable {...} object.
  const salvaged = [];
  const objects = body.match(/\{[^{}]*\}/g) || [];
  for (const o of objects) {
    try {
      const parsed = JSON.parse(o);
      if (parsed && typeof parsed.q === "string") salvaged.push(parsed);
    } catch { /* skip this one */ }
  }
  if (salvaged.length) return salvaged;
  throw new Error("no usable JSON found in model reply");
}

/** Generate questions in small batches — more reliable than one huge request. */
async function generateQuestions(knowledge, target) {
  const BATCH = 25;
  const seen = new Set();
  const all = [];
  const topicHints = [
    "eligibility, CGPA cutoffs, and who can register",
    "timelines, dates, slots and deadlines",
    "resume rules, verification and proof documents",
    "offer policies, PPOs, deregistration and upgrades",
    "credits, penalties, blacklisting and code of conduct",
  ];

  for (let round = 0; all.length < target && round < 8; round++) {
    const hint = topicHints[round % topicHints.length];
    const want = Math.min(BATCH, target - all.length);
    const prompt =
      `Below are the official placement and internship documents for ${INSTITUTION}.\n\n` +
      `${knowledge}\n\n---\n\n` +
      `List ${want} questions students are most likely to ask, focusing on ${hint}. ` +
      `Every question must be answerable from the documents above.\n` +
      `Each item needs: "q" (the question as a student would type it) and ` +
      `"keywords" (4-8 distinctive lowercase single words a student would use — ` +
      `never generic words like "what", "the", "is").\n` +
      (all.length ? `Do NOT repeat these already-collected questions:\n${all.map((x) => "- " + x.q).join("\n")}\n` : "");

    try {
      const raw = await complete("You output only valid JSON matching the requested shape.", prompt, 16000, true);
      const batch = extractJsonArray(raw);
      let added = 0;
      for (const item of batch) {
        if (!item || typeof item.q !== "string" || !item.q.trim()) continue;
        const norm = item.q.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
        if (seen.has(norm)) continue;
        seen.add(norm);
        all.push(item);
        added++;
        if (all.length >= target) break;
      }
      console.log(`  batch ${round + 1}: +${added} questions (total ${all.length})`);
      if (added === 0) break; // model has run dry
    } catch (err) {
      console.log(`  batch ${round + 1}: failed (${err.message}) — continuing`);
    }
    if (all.length < target) await sleep(DELAY_MS);
  }
  return all;
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
  const questions = await generateQuestions(knowledge, HOW_MANY);
  if (!questions.length) {
    console.error("Could not generate any questions. Check your API key and try again.");
    process.exit(1);
  }
  console.log(`Got ${questions.length} questions. Answering each (about ${Math.ceil((questions.length * DELAY_MS) / 60000)} min)...\n`);

  // ---- 2. answer each one, grounded in the documents ----
  const outPath = path.resolve("public", "faq.json");
  const entries = [];
  let skipped = 0;

  // Save progress periodically — a 20-minute build should never lose everything
  // to one bad network moment.
  const save = async () => {
    await fs.writeFile(
      outPath,
      JSON.stringify(
        { generated: new Date().toISOString(), institution: INSTITUTION, count: entries.length, entries },
        null,
        1
      ),
      "utf8"
    );
  };

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
        if (entries.length % 10 === 0) await save();
      }
    } catch (err) {
      skipped++;
      console.log(`${label} — FAILED: ${String(err.message).slice(0, 90)}`);
    }
    if (i < questions.length - 1) await sleep(DELAY_MS);
  }

  // ---- 3. write the static file the widget downloads ----
  await save();

  const kb = (await fs.stat(outPath)).size / 1024;
  console.log(`\nWrote ${outPath}`);
  console.log(`${entries.length} instant answers (${skipped} skipped), ${kb.toFixed(0)} KB.`);
  console.log("\nThese are now served straight from the CDN — no AI call, no rate limit.");
  console.log("Next: git add -A && git commit -m 'update FAQ' && git push");
}

main();
