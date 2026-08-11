# Session Summary — Placement & Internship Chatbot

**Date:** 10 August 2026
**Goal:** Build a free, embeddable AI chatbot that answers student questions about
internship eligibility, placement processes, policies, and resume verification —
grounded in official institute documents, with escalation to human coordinators.

---

## 1. What was built

A complete, deploy-ready project at `C:\Users\rakes\OneDrive\Desktop\placement-chatbot`.

| File | Purpose |
|---|---|
| `api/chat.js` | Serverless backend. Streams answers, validates input, rate-limits, handles CORS. Supports **two AI providers** (Gemini free tier / Anthropic Claude). |
| `public/widget.js` | The embeddable chat widget — floating bubble, streaming replies, session memory, escalation button. Zero dependencies. |
| `public/index.html` | Local test page simulating your institute website. |
| `scripts/ingest.mjs` | Converts PDFs/Word/text files in `docs/` into the chatbot's knowledge base. |
| `scripts/dev-server.mjs` | Local test server (`npm run dev`) so no Vercel CLI is needed. |
| `docs/` | Where your policy documents go (currently holds a sample policy). |
| `knowledge/knowledge.md` | Auto-generated knowledge file — never edit by hand. |
| `README.md` | Full technical reference: costs, scaling, troubleshooting. |
| `GETTING-STARTED.md` | Beginner's step-by-step guide to going live. |
| `.env` | Your secret API key. **Never uploaded to GitHub** (protected by `.gitignore`). |

### Architecture

```
docs/*.pdf, *.docx  --[npm run ingest]-->  knowledge/knowledge.md
                                                  |
student <--> widget.js <--> /api/chat  --(full documents as context)--> AI model
```

**Key design decision — no vector database.** Institutional policy documents are
small enough to send *in full* to the AI on every question. This means answers are
grounded in every document at once (no retrieval misses), and there's no extra
database to host, pay for, or maintain. The README documents the upgrade path
(Supabase pgvector) for if documents ever exceed ~150K tokens.

### Behaviour built into the bot

- Answers **only** from your documents — never invents policies, dates, or cutoffs.
- **Cites its source**: "According to the Internship Policy (Section 1.1): …"
- **Escalates to a human** when it can't answer, or when the question involves an
  exception, dispute, extension request, or complaint. It emits a hidden
  `[[ESCALATE]]` flag which the widget turns into a "📩 Contact a coordinator" button.
- Remembers the conversation within a browser session (clears when the tab closes).

---

## 1b. Reliability & scale architecture

Four layers stand between a student and a failed answer:

| Layer | Cost per question | Capacity |
|---|---|---|
| **Instant FAQ** — `faq.json` matched in the browser | ₹0, no network at all | unlimited |
| **Server cache** — identical question within 15 min | ₹0, no AI call | ~unlimited (5 ms) |
| **Provider 1: Gemini** — full documents in context | free tier | request-capped |
| **Provider 2: Groq** — relevant excerpts only | free tier (separate quota) | token-capped |

**Automatic failover:** if a provider can't answer for *any* reason — quota exhausted,
outage, revoked key, retired model — the next one silently takes over. Verified with a
real broken provider: Gemini returned 404, the bot logged `Falling over from gemini to
llama`, and Groq answered correctly in 1.2 s. Failover stops once text has started
streaming, so a student never sees two half-answers spliced together.

**Keyword retrieval:** Groq's free tier allows 12,000 tokens/minute but the full
knowledge base is ~43,000 tokens — it could never answer with every document attached.
So for token-capped providers the bot sends only the sections relevant to the question,
selected by keyword match. No vector database, no embeddings, no extra service.
Verified that citations stay accurate with excerpts only.

## 2. The cost question — and how it was solved

**Finding:** hosting is genuinely free (Vercel Hobby tier), but Anthropic's Claude
API has no ongoing free tier. So a second provider was added.

| Setup | Cost | Trade-off |
|---|---|---|
| **Google Gemini free tier** ← *chosen* | **₹0 / $0** | ~250 requests/day cap (`gemini-2.5-flash`), or ~1,000/day (`gemini-2.5-flash-lite`) |
| **Llama** (Groq / OpenRouter / Ollama) | **₹0 / $0** | Separate free quota; limited by *tokens per minute*, and 128K context |
| Anthropic Claude | ~$0.006–0.03 per question | Best answer quality, no daily cap |

Switching between them is just an environment variable — same widget, same
documents, same behaviour.

**Why Gemini remains the default here:** this design sends the whole knowledge
base with every question (~28K tokens for your five PDFs). Gemini's free tier is
capped by *requests per day* and has a ~1M-token context window, which suits that
pattern. Groq's free tier is capped by *tokens per minute*, so a 28K-token prompt
consumes the allowance quickly. Llama is the better choice for a small document
set, as a second free quota to fall back on, or if you later self-host.

### If the free daily cap is ever exceeded

1. **Add a static FAQ page** (best move regardless) — ~80% of placement questions
   are the same 30 questions. Publish canonical answers as plain text; the bot then
   only handles the long tail, staying well inside the free cap.
2. Switch `GEMINI_MODEL` to `gemini-2.5-flash-lite` for ~4× the daily cap.
3. Use a small paid budget (`claude-haiku-4-5`, ~$5.50 per 1,000 questions) only
   during peak weeks.
4. If it must be $0 with no caps at all: publish `knowledge.md` as a searchable
   static FAQ page instead of a chatbot — zero cost per query, zero wrong answers,
   but no natural-language conversation.

---

## 3. Testing performed ✅

All tests run locally against the sample policy document.

| Test | Result |
|---|---|
| Document ingestion | ✅ Sample policy converted to knowledge base |
| Input validation | ✅ Malformed requests → clear 400 error; wrong method → 405 |
| Rate limiting | ✅ Exactly 20 requests/min/IP allowed, then clean 429s |
| Graceful failure | ✅ Missing/invalid key → friendly student-facing message, no crash |
| **Grounded answer** | ✅ *"What CGPA do I need?"* → "According to the Internship & Placement Policy (Section 1.1): 'Students must have a CGPA of 6.0 or above with no active backlogs…'" |
| **Conversation memory** | ✅ Follow-up *"And does that change if I have a backlog?"* understood in context |
| **Escalation** | ✅ *"My CGPA is 5.8 — can an exception be made?"* → declined to guess, showed "Contact a coordinator" button |

**Conclusion: the chatbot works end-to-end on the free Gemini tier.**

### Verified again on the REAL documents

Five real policy PDFs (~111 KB / ~28K tokens of text) were ingested and tested:

| Question | Result |
|---|---|
| "What are the rules for resume verification?" | ✅ Detailed rules extracted from the resume guidelines |
| "How does the company credit policy work?" | ✅ "Each student is allocated 150 credits at the beginning of the placement season *(Company Credit Policy)*" |
| "Am I still eligible if I already have an offer?" | ✅ Cited the **"One Student One Offer"** policy, naming the document *and* section |
| "What CGPA do I need for internships?" | ✅ Correctly said the documents don't specify this → escalated instead of guessing |

**Issue found and fixed during this test:** Google's free tier intermittently returns
`503 service unavailable` under rapid requests. Automatic retry (3 attempts with
backoff) was added, which turns those into successful answers. Quota errors (429)
are deliberately *not* retried, since waiting doesn't help.

---

## 4. Problems hit along the way (and fixes)

| Problem | Cause | Fix |
|---|---|---|
| `running scripts is disabled on this system` | Windows blocks all PowerShell scripts by default; `npm` is a script | Set execution policy to `RemoteSigned` for your user. Fallback that always works: type **`npm.cmd`** instead of `npm` |
| `EADDRINUSE: address already in use :::3000` | The assistant's test server was still occupying port 3000 | Stopped it. Only one server can use a port at a time |
| `API key: MISSING` despite key being present | Bug in the dev server's status line — it only checked for an *Anthropic* key, ignoring Gemini | Fixed. It now reports the actual provider in use |

> **Note:** none of these issues exist on Vercel — they are purely local Windows
> quirks. Once deployed, students just visit a URL.

---

## 5. ⚠️ Security action required

The Gemini API key was pasted into the chat during testing, so treat it as exposed.

1. Go to https://aistudio.google.com → **Get API key**
2. **Create** a new key, **delete** the old one (starts `AQ.Ab8RN…`)
3. Open `.env` in Notepad, replace the value after `GEMINI_API_KEY=`
4. Never share an API key in chats, emails, or screenshots

---

## 6. What's left to do

| # | Step | Time | Where |
|---|---|---|---|
| 1 | Rotate the Gemini API key | 5 min | aistudio.google.com |
| 2 | Replace the sample doc with real policy files, run `npm.cmd run ingest` | 10 min | `docs/` folder |
| 3 | Create a GitHub account and upload the project | 15 min | github.com |
| 4 | Import into Vercel, add environment variables, deploy | 10 min | vercel.com |
| 5 | Create a Google Form for escalations, embed the widget script on your site | 5 min | Your website |

**Full instructions with every click spelled out: see `GETTING-STARTED.md`.**

### Routine maintenance (whenever policies change)

```
npm.cmd run ingest
git add -A
git commit -m "update documents"
git push
```

Vercel republishes automatically within a minute.

---

## 7. Useful commands

| Command | What it does |
|---|---|
| `npm.cmd run ingest` | Rebuild knowledge base after changing documents |
| `npm.cmd run dev` | Start local test server → http://localhost:3000 |
| `Ctrl+C` | Stop the local server |

**Environment variables** (set in `.env` locally, and in Vercel → Settings for production):

| Variable | Value |
|---|---|
| `GEMINI_API_KEY` | Your free Google AI Studio key |
| `GEMINI_MODEL` | `gemini-2.5-flash` (default) or `gemini-2.5-flash-lite` (higher cap) |
| `INSTITUTION_NAME` | e.g. `IIT Madras` |
| `ALLOWED_ORIGIN` | Your website address once live; `*` while testing |
| `ANTHROPIC_API_KEY` | Only if switching to paid Claude |
