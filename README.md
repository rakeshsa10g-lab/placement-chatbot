# Placement & Internship Chatbot

An embeddable Claude-powered chat widget that answers student questions about
internship eligibility, placement processes, policies, and resume verification —
grounded in your institution's actual documents, with citations, and with
automatic escalation to a human coordinator when it can't answer.

**How it works (one paragraph):** you drop your policy PDFs/Word docs into
`docs/`, run one command to convert them into a single knowledge file, and
deploy to Vercel's free tier. The serverless function sends the entire
knowledge file to Claude as a *cached* system prompt (Anthropic's prompt
caching makes repeat reads ~90% cheaper), so every answer is grounded in the
full text of every document — no vector database to run or maintain. The
widget is one `<script>` tag on your website.

```
docs/*.pdf, *.docx  --npm run ingest-->  knowledge/knowledge.md
                                              |
student <--> widget.js <--> /api/chat  --(cached system prompt)--> Claude API
```

---

## What you need

| Thing | Cost | Where |
|---|---|---|
| Node.js 18+ | free | https://nodejs.org |
| GitHub account | free | https://github.com |
| Vercel account (Hobby) | free | https://vercel.com — sign in with GitHub |
| An LLM API key — **one** of: | | |
| &nbsp;&nbsp;Google Gemini key | **free** (daily caps — see "Deploying completely free") | https://aistudio.google.com |
| &nbsp;&nbsp;Anthropic API key | pay-per-use, best quality (see cost table below) | https://platform.claude.com |

---

## Step 1 — Local setup (10 min)

```bash
cd placement-chatbot
npm install
```

## Step 2 — Add your documents

Copy your policy files into the `docs/` folder. Supported: **.pdf, .docx, .txt, .md**.
(A sample policy is included so you can test first — delete it later.)

Then build the knowledge base:

```bash
npm run ingest
```

This writes `knowledge/knowledge.md` and prints the size. Notes:

- **Scanned PDFs** (images of pages) have no extractable text — the script will
  flag them as SKIPPED. Re-export them as text PDFs or run OCR first.
- Re-run `npm run ingest` **every time documents change**, then redeploy (Step 4).
- Keep documents current — the bot only knows what's in this folder.

## Step 3 — Test locally

```bash
npm i -g vercel
cp .env.example .env        # then paste your ANTHROPIC_API_KEY into .env
vercel dev
```

Open http://localhost:3000 — a test page with the chat bubble appears. Ask
something covered by your documents ("What CGPA do I need for internships?")
and something *not* covered ("Can I get a deadline extension?") — the second
should end with a "Contact a coordinator" prompt.

## Step 4 — Deploy free on Vercel

```bash
git init && git add -A && git commit -m "placement chatbot"
# create an empty repo on github.com, then:
git remote add origin https://github.com/YOUR-USER/placement-chatbot.git
git push -u origin main
```

1. On https://vercel.com → **Add New → Project** → import the repo → **Deploy**
   (no build settings needed).
2. Project → **Settings → Environment Variables**, add:
   - **One API key** (required): `GEMINI_API_KEY` (free — see "Deploying completely
     free") **or** `ANTHROPIC_API_KEY` (paid, best quality)
   - `INSTITUTION_NAME` — e.g. `IIT Madras`
   - `ANTHROPIC_MODEL` — `claude-opus-4-8` (best answers) or `claude-haiku-4-5`
     (cheapest), only if using Claude
   - `ALLOWED_ORIGIN` — your website origin, e.g. `https://placements.example.edu`
     (leave unset/`*` while testing)
3. **Redeploy** (Deployments → ⋯ → Redeploy) so the env vars take effect.

Your bot now lives at `https://YOUR-APP.vercel.app`. Updating documents later is:
`npm run ingest` → `git commit -am "update docs"` → `git push` (auto-redeploys).

**Vercel free-tier limits (Hobby):** 1M function invocations & 100 GB-hours
compute per month — far more than this bot needs; 60s max function duration
(configured in `vercel.json`). Hobby is licensed for non-commercial use;
a student placement cell fits, but a revenue-generating org needs Pro ($20/mo).

## Step 5 — Embed on your website

Paste before `</body>` on any page of your site:

```html
<script src="https://YOUR-APP.vercel.app/widget.js" defer
        data-api="https://YOUR-APP.vercel.app/api/chat"
        data-faq="https://YOUR-APP.vercel.app/faq.json"
        data-title="Placement & Internship Help"
        data-escalate-url="https://forms.gle/YOUR-FORM-ID"></script>
```

`data-faq` is what enables instant, zero-cost answers to common questions — don't omit it.

- `data-escalate-url` — a Google Form (or `mailto:coordinator@...`) shown as a
  **"Contact a coordinator"** button whenever the bot flags a question for human
  handling. Create a short form: name, roll number, question, urgency.
- Works on any CMS that allows script tags (WordPress, Wix custom code, plain HTML).
- Conversation history persists for the browser session (per tab) and clears on close.

---

## Deploying completely free ($0 total)

Hosting is already free (Vercel Hobby). To make the AI free too, use **Google
Gemini's free tier** instead of Claude:

1. Go to https://aistudio.google.com → **Get API key** (Google account only, no
   credit card). Because there's no billing attached, you can **never be charged** —
   the free tier just stops serving when the daily cap is hit.
2. Set `GEMINI_API_KEY` in Vercel → Settings → Environment Variables (leave
   `ANTHROPIC_API_KEY` unset), redeploy. That's it — same widget, same documents,
   same citations and escalation behavior.

**Honest limits of the free tier** (check https://ai.google.dev/pricing — these move):

| Model (`GEMINI_MODEL` env var) | Rate limit | Daily cap | Notes |
|---|---|---|---|
| `gemini-2.5-flash` (default) | ~10 req/min | ~250 requests/day | Better answers |
| `gemini-2.5-flash-lite` | ~15 req/min | ~1,000 requests/day | Higher cap, slightly weaker |

Two caveats to accept with the free tier:

- **Daily caps are real.** ~250–1,000 questions/day is plenty in normal weeks but
  can run out during peak (results week). When the cap is hit, students see
  "the assistant has hit its usage limit — try again later, or contact a
  coordinator", and the escalation form still works. If that's unacceptable,
  see the fallback strategies below.
- **Data policy.** On the unpaid tier, Google may use prompts to improve its
  products. Placement policies are public documents, so this is usually fine —
  but don't let students paste sensitive personal data into the bot (the widget
  disclaimer already warns them it's an AI assistant).

### Using Llama instead of Gemini (also free)

The bot also speaks the **OpenAI-compatible** API format, which is what almost every
Llama host uses. Set `LLAMA_API_KEY` (leave the other keys unset) and pick a host:

| Host | `LLAMA_BASE_URL` | `LLAMA_MODEL` | Notes |
|---|---|---|---|
| **Groq** (default) | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` | Free key at console.groq.com, no card. Extremely fast. |
| OpenRouter | `https://openrouter.ai/api/v1` | `meta-llama/llama-3.3-70b-instruct:free` | Free tier across many models |
| Together AI | `https://api.together.xyz/v1` | `meta-llama/Llama-3.3-70B-Instruct-Turbo` | Small free credit |
| **Ollama** (your own PC/server) | `http://localhost:11434/v1` | `llama3.3` | Fully offline, no API key needed, no caps — but the machine must stay on |

**Gemini vs Llama for *this* chatbot — the honest comparison.** The deciding factor
isn't answer quality (both are fine at citing documents); it's that this design
resends your entire knowledge base with **every** question:

| | Gemini free tier | Llama on Groq free tier |
|---|---|---|
| Limit that bites first | **Requests per day** (~250) | **Tokens per minute** — and every question spends your whole knowledge base |
| Context window | ~1M tokens (huge headroom) | 128K tokens — a very large document set won't fit |
| Best when | Knowledge base is big; questions are spread through the day | Knowledge base is small (a few short policies); you want very fast replies |

So: **keep Gemini as the default** if your documents run to dozens of pages. Llama
is the better pick if your policy set is small, if you want a second free provider to
switch to when Gemini's daily cap is hit, or if you want the option to self-host
later. Check each provider's current limits — they change.

Switching is one environment variable in Vercel — no code edits, no redeploy of
documents.

### If the free-tier caps aren't enough

In rough order of preference:

1. **Absorb most traffic with a static FAQ (free forever).** 80% of placement
   questions are the same 30 questions. Once the bot has run for a week, export
   the most-asked questions, write (or have the bot draft) canonical answers, and
   publish them as a plain FAQ section on the same page. The chatbot then only
   handles the long tail — comfortably inside the free cap. This is the highest-
   leverage move regardless of which model you use.
2. **Switch `GEMINI_MODEL` to `gemini-2.5-flash-lite`** for ~4x the daily cap.
3. **Switch to Llama on Groq** (see the table above) — a completely separate free
   quota. Set `LLAMA_API_KEY` and `LLM_PROVIDER=llama` in Vercel and the bot changes
   providers on the next request, no code changes.
4. **Tiny paid budget as overflow:** keep Gemini free tier as primary and accept
   that peak weeks cost a few dollars on `claude-haiku-4-5` (~$5.50 per 1,000
   questions) — set `ANTHROPIC_API_KEY` + `LLM_PROVIDER=anthropic` only during
   peak weeks, with a spend limit set in the Anthropic console.

### If it must be $0 with no daily caps at all

Then a live LLM isn't the right tool — publish the knowledge as a **searchable
FAQ page** instead: a static page with all policies plus client-side keyword
search (e.g. Fuse.js) costs nothing per query, scales infinitely, and still cuts
most repetitive coordinator questions. You lose natural-language answers and
gain zero cost and zero wrong answers. The `knowledge/knowledge.md` file this
project already generates is exactly the content such a page needs.

---

## Costs when using Claude (the honest version)

Everything is free **except Claude API usage** (no free tier; new accounts often
get small trial credits). With prompt caching active, a realistic per-question
cost for a ~30K-token knowledge base (≈50 pages of policies) and a ~400-token answer:

| Model (env `ANTHROPIC_MODEL`) | Per question | 1,000 questions | 10,000 questions/mo |
|---|---|---|---|
| `claude-opus-4-8` (best quality) | ~$0.03 | ~$27 | ~$270 |
| `claude-haiku-4-5` (fast, cheapest) | ~$0.006 | ~$5.50 | ~$55 |

- Costs scale with knowledge-base size — keep `docs/` to what students actually ask about.
- Set a **monthly spend limit** in the Anthropic console (Settings → Limits) so a
  traffic spike can never surprise-bill you.
- Opus 4.8 is the default because policy questions punish wrong answers; if budget
  is the constraint, Haiku 4.5 is still very good at grounded Q&A over documents —
  test both on your real docs and decide.

## Surviving traffic spikes (200+ questions/minute) — free

**The honest constraint first:** no free AI tier on earth serves 200 *unique* questions
per minute. Free tiers allow roughly 10–15 AI calls/minute. If every one of those 200
questions were genuinely different, this would cost real money — several ₹thousand per
peak hour on any paid model.

**But placement questions are massively repetitive.** During results week, hundreds of
students ask the same ~40 things. This project exploits that with three layers, so the
number of *actual AI calls* stays tiny:

```
Student asks a question
   │
   ├─ Layer 1: INSTANT FAQ (in the browser)      ← ~80-90% of questions
   │    matched against faq.json, downloaded once per student.
   │    Zero server calls. Zero AI calls. Instant. Infinitely scalable.
   │
   ├─ Layer 2: SERVER CACHE (in the function)    ← most of the remainder
   │    identical question asked in the last 15 min → replayed from memory.
   │    Measured: 4,698ms → 5ms, and no AI call.
   │
   └─ Layer 3: LIVE AI CALL                      ← only genuinely novel questions
        rate-limited to 20/min per student; on overload the student gets a
        "busy, try again" message plus the coordinator escalation form.
```

### Setting it up (do this before launch)

```bash
npm run ingest        # rebuild knowledge from docs/
npm run build-faq     # pre-answer the ~60 most likely questions  (takes a few minutes)
git add -A && git commit -m "update knowledge + FAQ" && git push
```

`npm run build-faq -- 150` generates more entries for wider coverage — worth it before
a peak period. Each entry is answered from your documents with the same citation rules,
and any question the documents *can't* answer is dropped rather than guessed at.

**Re-run both commands whenever documents change.** A stale FAQ is the one real risk of
this design: it will happily serve last semester's deadline. Rebuilding takes minutes and
costs nothing.

### What the layers actually buy you

| Layer | Cost per question | Capacity | Latency |
|---|---|---|---|
| Instant FAQ | ₹0, no network | unlimited | instant |
| Server cache | ₹0, no AI call | ~unlimited | ~5 ms |
| Live AI call | 1 free-tier request | ~10–15/min | 3–5 s |

At 200 questions/minute with a good FAQ, roughly 20–40 reach the server and only a
handful become real AI calls — inside the free tier. The `faq.json` file is downloaded
**once per student** (browser + CDN cached), so 1,200 students cost about 120 MB of
Vercel's 100 GB monthly bandwidth.

### If you still saturate the free tier

1. **Grow the FAQ** — `npm run build-faq -- 200`. This is the highest-leverage lever;
   every added entry permanently removes load.
2. **Publish the FAQ as a normal web page too.** Many students will read it and never
   open the chat.
3. **Add Groq as a second free provider** (see the Llama table above) and switch
   `LLM_PROVIDER` during peak weeks — a completely separate free quota.
4. **Spend a little during peak week only.** `claude-haiku-4-5` is ~$5.50 per 1,000
   questions; a peak week might cost a few dollars. Set a spend limit in the console.

## Scaling to ~1,200 users & peak periods

- **Vercel autoscales** serverless functions — 1,200 concurrent *visitors* is no
  problem. What matters is questions-per-minute hitting the Claude API.
- **Anthropic rate limits**: a fresh account (Tier 1) allows ~50 requests/min.
  Peak season (results week!) can exceed that. Deposit $40 → Tier 2 (~1,000 RPM);
  tiers upgrade automatically with usage. When the limit is hit, the widget shows
  "the assistant is very busy — try again in a minute" rather than breaking.
- **Built-in rate limiter**: 20 requests/min per IP (in `api/chat.js`) blunts
  abuse and runaway costs. It's per-serverless-instance (resets on cold starts) —
  fine for this scale; for hard guarantees, add Upstash Redis (free tier) later.
- **Prompt caching = spike-friendly**: during busy periods the cache stays
  permanently warm (5-min TTL, refreshed by every request), so peak traffic is
  the *cheapest* traffic per question.
- **Monitoring**: Vercel → Project → Observability (invocations, errors, duration);
  Anthropic console → Usage (tokens, spend). Check both weekly; also watch
  `cache_read` usage in the Anthropic console — if it's near zero, caching broke
  (usually means the knowledge file changes on every request).

## Routing escalations by roll number

When the bot can't answer, it can send the student to **their own department's**
coordinator instead of one shared inbox. Roll numbers are parsed as
`<2-letter department><2-digit year><programme><serial>` — so `CH23B043` → `CH` →
Chemical Engineering.

**What the student sees:** the bot says it can't answer, then shows a small card:
*"Enter your roll number and I'll point you to the right coordinator."* They type
`CH23B043`, and get a button that opens an email addressed to the Chemical
Engineering coordinator with the subject, roll number, department, and their original
question **already filled in**. They just press send.

### Setting it up

Edit `public/routing.json`:

```jsonc
{
  "default":     { "name": "Placement & Internship Cell", "email": "placement@yourinstitute.edu", "form": "" },
  "departments": {
    "CH": { "name": "Chemical Engineering", "email": "ch.placement@yourinstitute.edu", "form": "" },
    "CS": { "name": "Computer Science",     "email": "",  "form": "https://forms.gle/XXXX" }
  }
}
```

- Fill in `email` for each department you want routed. Leave the rest blank.
- Set `form` instead if a department prefers a Google Form (`form` wins over `email`).
- **Always set `default`** — it catches unknown codes, PhD/exchange roll formats, and typos.
- Then `git add -A && git commit -m "routing" && git push`.

### Fallback behaviour (all verified)

| Student enters | Goes to |
|---|---|
| `CH23B043` (configured department) | Chemical Engineering coordinator |
| `ME22B105` (department left blank) | the `default` office |
| `XX23B001` (unknown code) | the `default` office |
| `hello` (not a roll number) | the `default` office |
| — routing.json not filled in at all — | the single `data-escalate-url` link, as before |

Nothing breaks if you skip this: until at least one email or form is filled in, the
widget keeps using the plain "Contact a coordinator" link.

> **Privacy note:** the roll number is used only to build the email — it is typed in
> the browser, never sent to the server, and never stored.

## Escalation flow (what coordinators see)

The system prompt instructs Claude to append `[[ESCALATE]]` whenever a question
is (a) not answerable from the documents, (b) a personal-case exception, dispute,
extension request, or complaint, or (c) contradicted across documents. The widget
strips the token and renders the **Contact a coordinator** button pointing at your
`data-escalate-url` form. Route the form to a shared coordinator inbox/sheet.

## When to switch to a vector database

This design intentionally skips vector search. Revisit that only if:

- `npm run ingest` warns the knowledge base exceeds ~150K tokens, **or**
- per-question cost grows past your budget as documents pile up.

The upgrade path: chunk documents (~500 tokens each), embed them (e.g. Voyage AI),
store in **Supabase pgvector (free tier)**, and change `api/chat.js` to retrieve
the top ~10 chunks per question instead of sending everything. It roughly
doubles the moving parts — don't do it before you need it.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Knowledge base missing" error | Run `npm run ingest`, commit, push/redeploy |
| Bot answers from a deleted document | You changed `docs/` but didn't re-run ingest + redeploy |
| Widget doesn't appear on your site | Check the script `src` URL; check browser console for CORS — set `ALLOWED_ORIGIN` to your site's origin (scheme + domain, no path) |
| 429 / "very busy" during peaks | Anthropic rate tier too low — deposit to reach Tier 2 |
| PDF ingested but bot knows nothing from it | Scanned/image PDF — OCR it or re-export as text |
| Logs show `404 … model … no longer available to new users` | You pinned a retired model. Set `GEMINI_MODEL=gemini-flash-latest` (an alias that always tracks the current model), or delete the `GEMINI_MODEL` variable entirely to use the built-in default. Redeploy after changing it. |
| Answers are wrong | Check the source document actually says what you think; the bot cites the section it used — verify that passage |
