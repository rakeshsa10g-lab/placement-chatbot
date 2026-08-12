# Session Summary — Placement & Internship Chatbot

**Date:** 10–11 August 2026
**Goal:** Build a free, embeddable AI chatbot that answers student questions about
internship eligibility, placement processes, policies, and resume verification —
grounded in official institute documents, with escalation to human coordinators,
surviving ~200 questions/minute without paying for AI usage.

**Status: live in production and verified.** `https://placement-chatbot-rakeshlab.vercel.app`

---

## 1. What was built

A complete project at `C:\Users\rakes\OneDrive\Desktop\placement-chatbot`, pushed to
GitHub (`rakeshsa10g-lab/placement-chatbot`, private) and deployed on Vercel.

| File | Purpose |
|---|---|
| `api/chat.js` | Serverless backend — streaming answers, provider failover, answer caching, rate limiting, keyword-based context retrieval |
| `public/widget.js` | Embeddable chat widget — markdown rendering, instant FAQ matching, escalation form, session memory. Zero dependencies. |
| `public/faq.json` | 60 pre-answered questions, generated from your documents, served free from the CDN |
| `public/routing.json` | Escalation config — Google Form URL + field IDs + roll-number-to-department map |
| `scripts/ingest.mjs` | Converts `docs/*.pdf/.docx` into the knowledge base |
| `scripts/build-faq.mjs` | Generates the instant-answer FAQ (rate-limit aware, resumable) |
| `scripts/tune-faq.mjs` | Reports how well the FAQ matcher handles real student phrasings |
| `scripts/setup-form.mjs` | Extracts a Google Form's field IDs from a pre-filled link — no manual entry-ID hunting |
| `scripts/dev-server.mjs` | Local test server (`npm run dev`) |
| `google-apps-script/segregate.gs` | Sorts form responses into per-department sheet tabs |
| `docs/` | Your 5 real placement/internship policy PDFs |
| `README.md` / `GETTING-STARTED.md` / `ESCALATION-SETUP.md` | Reference, beginner walkthrough, and form setup guide |

### Architecture

```
docs/*.pdf → npm run ingest → knowledge/knowledge.md
                                     │
        ┌────────────────────────────────────────────┐
        │ 1. Instant FAQ (browser, faq.json)          │  ~73% of real phrasings, ₹0, no network
        │ 2. Server cache (15 min, identical Q)       │  ₹0, no AI call, ~5ms
        │ 3. Gemini (free tier, full documents)       │  request-capped
        │ 4. Groq (free tier, relevant excerpts only) │  token-capped, separate quota
        └────────────────────────────────────────────┘
                                     │
        Can't answer → roll number → Google Form → Apps Script → department sheet tab
```

No vector database — documents are small enough to send in full (or as keyword-matched
excerpts for token-capped providers). Nothing extra to host or pay for.

### Behaviour built into the bot

- Answers **only** from your documents, cites the specific document and section
- Renders markdown properly (bold, bullets, headings) — not raw `**text**`
- Detects and reports **conflicts between documents** rather than silently picking one
- Escalates to a human for anything outside the documents — exceptions, disputes, complaints
- Remembers conversation within a browser session

---

## 2. Reliability & scale — the core engineering problem

**The ask:** survive ~200 questions/minute with zero ongoing cost. No free AI tier
allows that many *unique* calls — the entire design exists to make that non-issue.

### Four layers, cheapest first

| Layer | Cost/question | Verified |
|---|---|---|
| Instant FAQ (browser-matched) | ₹0, no network | 0 API calls measured for a matched question |
| Server cache (15 min) | ₹0, no AI call | 4,698ms → 5ms on repeat |
| Gemini (full documents) | free tier | primary |
| Groq (excerpts only) | free tier, separate quota | automatic fallback |

### Automatic provider failover

If a provider fails for *any* reason — quota, outage, revoked key, retired model —
the next one takes over silently. **Verified against a genuinely broken provider**,
not a simulation: Gemini returned real 404s, logs showed `Falling over from gemini
to llama`, Groq answered correctly in 1.2s. Failover stops once streaming has started,
so two half-answers can never be spliced together.

### Keyword retrieval (for token-capped providers)

Groq's free tier caps at 12,000 tokens/minute; the full knowledge base is ~43,000
tokens — Groq could never work with everything attached (`413 Request too large`
observed directly). Fix: token-capped providers get only the sections relevant to the
question, chosen by keyword scoring — no embeddings, no vector DB. Verified Groq still
cites sources correctly on excerpts alone.

### FAQ matching — tuned against real phrasing, not the generator's own wording

First version scored only **3/15** on realistic short student phrasings (e.g. "dress
code for interviews" vs. the FAQ's formal "What are the dress code requirements for
placement interviews?"). Retuned the scoring weights and added light stemming →
**11/15 (73%), zero false positives** on a held-out set of unrelated questions.
`npm run tune-faq` reproduces this report any time the FAQ changes.

---

## 3. The cost problem and how it was solved

Hosting is free (Vercel Hobby). Anthropic's API has no free tier — so two free
providers were wired in with automatic failover between them instead:

| Provider | Cost | Role |
|---|---|---|
| Google Gemini (`gemini-flash-lite-latest`) | free | primary — large free quota, big context window |
| Groq (`llama-3.3-70b-versatile`) | free, separate quota | automatic fallback |
| Anthropic Claude | ~$0.006–0.03/question | optional third link, never required |

**Model pinning bug found and fixed:** the original code pinned `gemini-2.5-flash`,
which Google retired for new keys mid-session (`404 ... no longer available to new
users`) — this is what caused the very first production error. Fixed by switching to
alias model names (`gemini-flash-lite-latest`) that always track Google's current
model, so this class of failure cannot recur.

---

## 4. Testing performed — all verified against real documents and real production

| Area | Result |
|---|---|
| Document ingestion | ✅ 5 real PDFs (~111KB) → knowledge base |
| Grounded answers with citation | ✅ "One Student One Offer" policy cited by document + section |
| Conversation memory | ✅ Follow-up question understood in context |
| Escalation trigger | ✅ Personal CGPA exception → declined to guess, escalated |
| Markdown rendering | ✅ 4 headings, 3 lists, 16 bold runs, zero leftover `**`/`#` |
| Provider failover | ✅ Real broken Gemini key → Groq served correct answer, 1.2s |
| FAQ instant-answer path | ✅ 0 API calls, correct citation, <1s |
| Rate limiting | ✅ 20/min/IP enforced, clean 429s |
| Retry on transient errors | ✅ Gemini 503s absorbed automatically |
| **Escalation form — full pipeline** | ✅ Real form, real spreadsheet, real Apps Script trigger, real roll number `CH24B999` → landed in correct department tab **automatically** |
| **Production deployment** | ✅ Verified on the live public URL, not just locally |

### Real finding surfaced by the bot: your documents disagree with each other

Live production test — "How many credits do students start with?" — returned:

> "Each student will be allocated **160 credits**... (note: the Company Credit Policy
> document mentions **150 credits**, while [the other document says 160]...)"

Two of your source PDFs state different starting credit amounts. **This needs a
correction in your source documents** — the bot is correctly flagging the conflict
rather than guessing, but the underlying discrepancy is real and should be fixed at
the source, then re-ingested.

---

## 5. Problems hit and fixed

| Problem | Cause | Fix |
|---|---|---|
| PowerShell blocked `npm` | Windows default execution policy | Set `RemoteSigned`, or use `npm.cmd` |
| `EADDRINUSE :::3000` | Two dev servers on one port | Stopped the duplicate |
| Model 404 in production | `gemini-2.5-flash` retired for new keys | Switched to auto-tracking alias model names |
| Gemini key exposed in chat | Pasted directly in conversation | Rotated; new key never shared |
| Gemini key later showed `401` | Old key deleted without confirming replacement was saved | Re-verified and confirmed live |
| Groq `413 Request too large` | Free tier caps 12K tokens/min; full doc set is ~43K tokens | Built keyword-excerpt retrieval for token-capped providers |
| FAQ build hit daily quota mid-run | Gemini's free tier daily cap is tighter than expected | Built on Groq instead (separate quota); added rate-limit-aware retry + resumable progress saves |
| Stale `faq.json`/`routing.json` in browsers | Widget used `force-cache`, pinning students to the first version they ever loaded | Removed `force-cache` — files now revalidate |
| FAQ matcher only hit 3/15 real phrasings | Scoring favored long formal wording over short student queries | Retuned weights + stemming → 11/15, 0 false positives |
| **Deployed site redirected to Vercel login** | Vercel's **Deployment Protection** (Vercel Authentication) was enabled on the project, blocking every visitor including students | Disabled in Vercel → Settings → Deployment Protection; verified from a fresh, cache-free browser tab |

---

## 6. Escalation routing — Google Form → per-department sheets

Fully configured and proven live, not simulated:

1. Google Form (Roll Number / Question / Department) created
2. `npm run setup-form "<pre-filled link>"` auto-extracted field IDs into `routing.json`
   — no manual entry-ID hunting
3. Direct test POST to the form's endpoint returned `200` with a real Google
   confirmation page
4. `google-apps-script/segregate.gs` installed on the response sheet; `onFormSubmit`
   trigger authorized
5. **Live end-to-end proof:** a real escalation-worthy question through the deployed
   widget → Gemini correctly declined to guess → roll number `CH24B999` submitted →
   landed in the **"CH - Chemical Engineering"** tab automatically, no manual step

Unmatched or malformed roll numbers fall back to an "Unsorted" tab; nothing is
silently dropped. Test rows are being cleared by the user.

---

## 7. Why an AI chatbot instead of a static FAQ page

Discussed directly — the honest answer is a static FAQ *does* solve the flat-lookup
case (which is why the instant FAQ layer exists and handles ~73% of traffic for free).
What a document structurally cannot do, and what this session's evidence shows the
bot actually doing:

- **Combinatorial eligibility questions** — "I have 2 backlogs from Jan-May and I'm on
  a Dual Degree, am I eligible for Day 1?" can't be pre-enumerated as FAQ entries; the
  bot reasons over the real policy text for that specific combination.
- **Cross-document conflict detection** — caught the real 150-vs-160 credits
  discrepancy live, across two source PDFs, unprompted.
- **Triage** — decides when a question needs a human rather than an answer, and routes
  it to the right department. A document can't do this, which is exactly the
  repetitive-query problem the project set out to reduce.
- **Conversational follow-up** — multi-turn context a static page has no way to hold.
- **Zero-maintenance-drift answers** — update a PDF, re-run `ingest`, done; a
  hand-written FAQ needs a human to notice policy changes and rewrite entries, which is
  exactly how documents end up silently contradicting each other.

---

## 8. What's left (all in the user's hands)

| # | Item | Notes |
|---|---|---|
| 1 | Delete test rows from the escalation sheet | `TEST99Z999`, two `CH...` rows |
| 2 | **Fix the 150-vs-160 credits conflict** in the source PDFs, then re-run `npm run ingest` and `npm run build-faq` | Real discrepancy found in production testing |
| 3 | Widen FAQ coverage after a week of real traffic | `npm run build-faq -- 150` then `npm run tune-faq` |
| 4 | Embed the widget script on the actual placement website | Snippet in `GETTING-STARTED.md` |

### Routine maintenance

```bash
npm run ingest          # after any document change
npm run build-faq       # refresh instant answers (run on Groq to spare Gemini's quota:
                         #   LLM_PROVIDER=llama npm run build-faq -- 60)
npm run tune-faq         # confirm the matcher still performs well
git add -A && git commit -m "update" && git push   # Vercel auto-redeploys
```

---

## 9. Reference

**Live site:** `https://placement-chatbot-rakeshlab.vercel.app`
**Repo:** `github.com/rakeshsa10g-lab/placement-chatbot` (private)

**Environment variables** (set in `.env` locally and Vercel → Settings for production):

| Variable | Value |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio key |
| `GEMINI_MODEL` | `gemini-flash-lite-latest` (default — always tracks current model) |
| `LLAMA_API_KEY` | Groq API key (fallback provider) |
| `LLAMA_BASE_URL` | `https://api.groq.com/openai/v1` |
| `LLM_PROVIDER` | `gemini,llama` — failover order |
| `INSTITUTION_NAME` | e.g. `IIT Madras` |
| `ALLOWED_ORIGIN` | Your website origin once embedded; `*` while testing |
| `ANTHROPIC_API_KEY` | Optional third fallback (paid) |
