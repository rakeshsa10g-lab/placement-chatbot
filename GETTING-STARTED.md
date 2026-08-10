# Getting Started — complete beginner's guide

You'll use three free websites. Here's what each one is for:

| Website | What it is, in plain terms |
|---|---|
| **Google AI Studio** (aistudio.google.com) | Where you get a free "API key" — a secret password that lets your chatbot talk to Google's AI |
| **GitHub** (github.com) | Online storage for your project's code — think Google Drive, but for code. Vercel reads from it. |
| **Vercel** (vercel.com) | Takes the code from GitHub and turns it into a live website, for free |

The flow: your code lives on GitHub → Vercel publishes it as a website → the website uses your AI Studio key to answer questions.

---

## Step 1 — Get a fresh Gemini API key (5 min)

Your current key was shared in a chat, so replace it with a private one.

1. Go to **https://aistudio.google.com** and sign in with any Google account.
2. Click **"Get API key"** (left sidebar or top banner) → **"Create API key"**.
3. Copy the new key somewhere safe (Notepad for now).
4. On the same page, **delete the old key** (the one starting `AQ.Ab8RN6...`).
5. Open the file `placement-chatbot\.env` in Notepad and replace the old key so the line reads:
   `GEMINI_API_KEY=your-new-key-here`

**Rule for life:** never share this key or paste it in chats/emails. Anyone who has it can use your quota.

---

## Step 2 — Put your real documents in (10 min)

1. Copy your real policy files (PDF, Word, or text) into the `placement-chatbot\docs\` folder.
2. Delete `sample-internship-policy.md` from that folder.
3. Open a terminal **in the project folder**: open `placement-chatbot` in File Explorer, click the address bar, type `powershell`, press Enter.
4. Run:
   ```
   npm run ingest
   ```
   This reads every document and builds the chatbot's "knowledge file". It prints
   each file it processed. If it says SKIPPED for a PDF, that PDF is a scanned
   image — re-export it as a text PDF.
5. Optional — test on your PC before publishing:
   ```
   npm run dev
   ```
   Then open http://localhost:3000 in your browser and ask the bot questions.
   Press `Ctrl+C` in the terminal to stop it.

---

## Step 3 — Put the project on GitHub (15 min)

1. Create a free account at **https://github.com** (Sign up → follow prompts).
2. Once logged in, click the **+** icon (top-right) → **"New repository"**.
   - Repository name: `placement-chatbot`
   - Visibility: **Private** (your docs won't be public)
   - Do **not** tick "Add a README"
   - Click **Create repository**
3. GitHub shows you a page of commands — ignore it and use these instead.
   In your PowerShell window (still inside the `placement-chatbot` folder), run
   these lines one at a time, replacing `YOUR-USERNAME` with your GitHub username:
   ```
   git init
   git add -A
   git commit -m "placement chatbot"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/placement-chatbot.git
   git push -u origin main
   ```
   - If git asks for your name/email first, run:
     `git config --global user.name "Your Name"` and
     `git config --global user.email "you@example.com"`, then retry the commit.
   - On `git push`, a browser window pops up asking you to sign in to GitHub —
     click **Authorize**. That's normal (it's how git proves you're you).
4. Refresh your GitHub repository page — you should see all the project files.

**Don't worry about your key:** the `.env` file (which holds your key) is listed in
`.gitignore`, so git will never upload it. Your documents *are* uploaded, but the
repository is Private.

---

## Step 4 — Publish with Vercel (10 min)

1. Go to **https://vercel.com** → **Sign Up** → **Continue with GitHub** (this links
   the two accounts — exactly what we want).
2. Click **Add New… → Project**. You'll see your GitHub repositories — click
   **Import** next to `placement-chatbot`. (If it asks to "Install Vercel" on your
   GitHub account, approve it and select the repository.)
3. On the import screen, **before** clicking Deploy, open the
   **Environment Variables** section and add:

   | Name | Value |
   |---|---|
   | `GEMINI_API_KEY` | your new key from Step 1 |
   | `INSTITUTION_NAME` | e.g. `IIT Madras` |

4. Click **Deploy** and wait about a minute.
5. Click **Visit** — your chatbot is now live at an address like
   `https://placement-chatbot-xxxx.vercel.app`. Open it on your phone too — it's
   a real public website now. Ask it a question to confirm everything works.

---

## Step 5 — Put it on your placement website (5 min)

1. Create a **Google Form** titled "Contact a placement coordinator" with fields:
   name, roll number, your question. Copy its share link.
2. Give this snippet to whoever manages your placement website, telling them to
   paste it just before `</body>` (replace both URLs with your real ones):
   ```html
   <script src="https://YOUR-APP.vercel.app/widget.js" defer
           data-api="https://YOUR-APP.vercel.app/api/chat"
           data-title="Placement & Internship Help"
           data-escalate-url="https://forms.gle/YOUR-FORM-LINK"></script>
   ```
3. No website of your own? Just share the Vercel link directly — it's a working
   chat page on its own.

---

## Routine: updating documents later (2 min)

Whenever policies change, in PowerShell inside the project folder:

```
npm run ingest
git add -A
git commit -m "update documents"
git push
```

Vercel notices the push and republishes automatically within a minute. That's the
entire maintenance workflow.

---

## If something goes wrong

- Bot says "hit its usage limit" → free tier's daily cap reached; it resets daily.
  See README → "Deploying completely free" for options.
- Bot doesn't know a new document → you forgot `npm run ingest` or the `git push`.
- Widget missing on your website → the script URLs don't match your Vercel address.
- Anything else → the README's Troubleshooting table.
