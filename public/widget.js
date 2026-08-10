/**
 * Placement chatbot widget — embed on any page with one script tag:
 *
 *   <script src="https://YOUR-APP.vercel.app/widget.js" defer
 *           data-api="https://YOUR-APP.vercel.app/api/chat"
 *           data-faq="https://YOUR-APP.vercel.app/faq.json"
 *           data-title="Placement & Internship Help"
 *           data-escalate-url="https://forms.gle/YOUR-FORM-ID"></script>
 *
 * No dependencies. Three things worth knowing:
 *
 * 1. MARKDOWN — the model replies in markdown (**bold**, bullets, headings).
 *    We render it into real DOM nodes. All text goes through textContent /
 *    createTextNode, never innerHTML, so a document containing HTML can never
 *    inject markup into the page.
 *
 * 2. INSTANT FAQ — faq.json holds pre-answered common questions. A confident
 *    match is answered in the browser with NO server call at all. This is what
 *    lets the bot survive traffic spikes on a free plan (see README "Scaling").
 *
 * 3. HISTORY — conversation lives in sessionStorage (cleared when the tab closes).
 */
(function () {
  "use strict";

  var script = document.currentScript;
  var CONFIG = {
    api: (script && script.dataset.api) || "/api/chat",
    faq: (script && script.dataset.faq) || "/faq.json",
    title: (script && script.dataset.title) || "Placement & Internship Help",
    escalateUrl: (script && script.dataset.escalateUrl) || "",
    greeting:
      (script && script.dataset.greeting) ||
      "Hi! Ask me anything about internship eligibility, placement processes, policies, or resume verification. My answers come straight from the official documents.",
  };

  var STORAGE_KEY = "pbot-history-v1";
  var ESCALATE_TOKEN = "[[ESCALATE]]";
  var MAX_INPUT_CHARS = 2000;
  var FAQ_THRESHOLD = 0.62; // conservative — below this we ask the model

  // ---------- styles ----------
  var css = [
    "#pbot-bubble{position:fixed;bottom:20px;right:20px;width:56px;height:56px;border-radius:50%;background:#1d4ed8;color:#fff;border:none;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);font-size:26px;line-height:56px;text-align:center;z-index:99998;transition:transform .15s}",
    "#pbot-bubble:hover{transform:scale(1.07)}",
    "#pbot-panel{position:fixed;bottom:88px;right:20px;width:380px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 120px);background:#fff;border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,.28);display:none;flex-direction:column;overflow:hidden;z-index:99999;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}",
    "#pbot-panel.pbot-open{display:flex}",
    "#pbot-head{background:#1d4ed8;color:#fff;padding:12px 16px;font-weight:600;font-size:15px;display:flex;justify-content:space-between;align-items:center}",
    "#pbot-head button{background:none;border:none;color:#fff;font-size:18px;cursor:pointer;padding:0 4px}",
    "#pbot-log{flex:1;overflow-y:auto;padding:14px;background:#f5f7fb}",
    ".pbot-msg{margin:0 0 10px;padding:10px 13px;border-radius:10px;font-size:14px;line-height:1.5;word-wrap:break-word;overflow-wrap:anywhere;max-width:88%}",
    ".pbot-user{background:#1d4ed8;color:#fff;margin-left:auto;border-bottom-right-radius:3px;white-space:pre-wrap}",
    ".pbot-bot{background:#fff;color:#1f2937;border:1px solid #e5e7eb;border-bottom-left-radius:3px}",
    // --- markdown elements ---
    ".pbot-bot p{margin:0 0 8px}",
    ".pbot-bot p:last-child{margin-bottom:0}",
    ".pbot-bot h4{margin:10px 0 6px;font-size:14px;font-weight:700;color:#111827}",
    ".pbot-bot h4:first-child{margin-top:0}",
    ".pbot-bot ul,.pbot-bot ol{margin:4px 0 8px;padding-left:20px}",
    ".pbot-bot li{margin:3px 0}",
    ".pbot-bot li.pbot-sub{margin-left:14px}",
    ".pbot-bot strong{font-weight:700;color:#111827}",
    ".pbot-bot em{font-style:italic}",
    ".pbot-bot code{background:#f3f4f6;padding:1px 5px;border-radius:4px;font-family:ui-monospace,Consolas,monospace;font-size:12.5px}",
    ".pbot-bot hr{border:none;border-top:1px solid #e5e7eb;margin:8px 0}",
    // --- escalation + helpers ---
    ".pbot-escalate{display:inline-block;margin:2px 0 12px;padding:8px 14px;background:#fff;border:1.5px solid #dc2626;color:#dc2626;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;cursor:pointer}",
    ".pbot-escalate:hover{background:#fef2f2}",
    ".pbot-retry{display:block;margin:-4px 0 12px;background:none;border:none;color:#1d4ed8;font-size:12px;cursor:pointer;text-decoration:underline;padding:0 2px}",
    "#pbot-form{display:flex;gap:8px;padding:10px;border-top:1px solid #e5e7eb;background:#fff}",
    "#pbot-input{flex:1;border:1px solid #d1d5db;border-radius:8px;padding:9px 11px;font-size:14px;font-family:inherit;resize:none;max-height:96px;outline:none}",
    "#pbot-input:focus{border-color:#1d4ed8}",
    "#pbot-send{background:#1d4ed8;color:#fff;border:none;border-radius:8px;padding:0 16px;font-size:14px;font-weight:600;cursor:pointer}",
    "#pbot-send:disabled{opacity:.5;cursor:default}",
    ".pbot-typing{color:#6b7280;font-size:13px;font-style:italic}",
    "#pbot-foot{font-size:10.5px;color:#9ca3af;text-align:center;padding:4px 8px 7px;background:#fff}",
  ].join("\n");

  // ================= markdown rendering (XSS-safe by construction) =================

  /** Apply **bold**, *italic* and `code` inside one line, as real DOM nodes. */
  function appendInline(el, text) {
    var re = /(\*\*([^*]+)\*\*|__([^_]+)__|(?:^|[\s(])\*([^*\n]+)\*(?=$|[\s.,;:)])|`([^`]+)`)/g;
    var last = 0;
    var m;
    while ((m = re.exec(text)) !== null) {
      var start = m.index + (m[0].length - m[0].replace(/^[\s(]/, "").length);
      if (start > last) el.appendChild(document.createTextNode(text.slice(last, start)));
      var node;
      if (m[2] !== undefined || m[3] !== undefined) {
        node = document.createElement("strong");
        node.textContent = m[2] !== undefined ? m[2] : m[3];
      } else if (m[4] !== undefined) {
        node = document.createElement("em");
        node.textContent = m[4];
      } else {
        node = document.createElement("code");
        node.textContent = m[5];
      }
      el.appendChild(node);
      last = re.lastIndex;
    }
    if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
  }

  /** Render a markdown string into `container` (headings, lists, paragraphs). */
  function renderMarkdown(container, text) {
    container.textContent = "";
    var lines = String(text).split("\n");
    var list = null;

    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i].replace(/\s+$/, "");
      if (!raw.trim()) { list = null; continue; }

      // horizontal rule
      if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(raw)) {
        list = null;
        container.appendChild(document.createElement("hr"));
        continue;
      }

      // heading  (#, ##, ### ...) — all rendered at one visual size
      var h = raw.match(/^\s*#{1,6}\s+(.*)$/);
      if (h) {
        list = null;
        var head = document.createElement("h4");
        appendInline(head, h[1].replace(/\s*#+\s*$/, ""));
        container.appendChild(head);
        continue;
      }

      // bullet list item (supports one level of indentation)
      var b = raw.match(/^(\s*)[-*•]\s+(.*)$/);
      if (b) {
        if (!list || list.tagName !== "UL") {
          list = document.createElement("ul");
          container.appendChild(list);
        }
        var li = document.createElement("li");
        if (b[1].length >= 2) li.className = "pbot-sub";
        appendInline(li, b[2]);
        list.appendChild(li);
        continue;
      }

      // numbered list item
      var n = raw.match(/^\s*\d+[.)]\s+(.*)$/);
      if (n) {
        if (!list || list.tagName !== "OL") {
          list = document.createElement("ol");
          container.appendChild(list);
        }
        var oli = document.createElement("li");
        appendInline(oli, n[1]);
        list.appendChild(oli);
        continue;
      }

      // plain paragraph
      list = null;
      var p = document.createElement("p");
      appendInline(p, raw.replace(/^\s+/, ""));
      container.appendChild(p);
    }
  }

  // ================= instant FAQ matching (runs in the browser) =================

  var FAQ = null; // { entries: [{q, keywords, a}] }

  var STOPWORDS = {
    the: 1, a: 1, an: 1, is: 1, are: 1, was: 1, were: 1, do: 1, does: 1, did: 1,
    i: 1, my: 1, me: 1, we: 1, you: 1, your: 1, to: 1, for: 1, of: 1, in: 1, on: 1,
    at: 1, and: 1, or: 1, if: 1, can: 1, will: 1, would: 1, should: 1, what: 1,
    when: 1, how: 1, where: 1, which: 1, who: 1, it: 1, this: 1, that: 1, be: 1,
    have: 1, has: 1, get: 1, got: 1, any: 1, there: 1, about: 1, please: 1, tell: 1,
  };

  function tokenize(s) {
    var out = [];
    var words = String(s).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/);
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (w.length > 2 && !STOPWORDS[w]) out.push(w);
    }
    return out;
  }

  function scoreEntry(qTokens, entry) {
    if (!qTokens.length) return 0;
    var set = {};
    for (var i = 0; i < qTokens.length; i++) set[qTokens[i]] = 1;

    // how many of the entry's keywords the student actually used
    var kw = entry.keywords || [];
    var kwHits = 0;
    for (var j = 0; j < kw.length; j++) if (set[String(kw[j]).toLowerCase()]) kwHits++;
    var kwScore = kw.length ? kwHits / kw.length : 0;

    // overlap with the canonical question's own wording
    var qt = entry._tokens || (entry._tokens = tokenize(entry.q));
    var hits = 0;
    for (var k = 0; k < qt.length; k++) if (set[qt[k]]) hits++;
    var coverage = qt.length ? hits / qt.length : 0;      // of the FAQ question
    var precision = hits / qTokens.length;                 // of what the student typed

    return 0.45 * kwScore + 0.35 * coverage + 0.20 * precision;
  }

  function faqLookup(question) {
    if (!FAQ || !FAQ.entries || !FAQ.entries.length) return null;
    var qTokens = tokenize(question);
    if (qTokens.length < 2) return null; // too vague to match safely
    var best = null;
    var bestScore = 0;
    for (var i = 0; i < FAQ.entries.length; i++) {
      var s = scoreEntry(qTokens, FAQ.entries[i]);
      if (s > bestScore) { bestScore = s; best = FAQ.entries[i]; }
    }
    return bestScore >= FAQ_THRESHOLD ? best : null;
  }

  function loadFaq() {
    try {
      fetch(CONFIG.faq, { cache: "force-cache" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { if (j && j.entries) FAQ = j; })
        .catch(function () { /* no FAQ file — every question goes to the model */ });
    } catch (e) { /* ignore */ }
  }

  // ================= state =================

  function loadHistory() {
    try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY)) || []; }
    catch (e) { return []; }
  }
  function saveHistory(h) {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(h.slice(-24))); } catch (e) {}
  }
  var history = loadHistory();
  var busy = false;

  // ================= DOM =================

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    for (var k in attrs || {}) node.setAttribute(k, attrs[k]);
    if (text) node.textContent = text;
    return node;
  }

  function build() {
    var style = el("style");
    style.textContent = css;
    document.head.appendChild(style);

    var bubble = el("button", { id: "pbot-bubble", "aria-label": "Open placement help chat" }, "💬");
    var panel = el("div", { id: "pbot-panel", role: "dialog", "aria-label": CONFIG.title });

    var head = el("div", { id: "pbot-head" });
    head.appendChild(el("span", {}, CONFIG.title));
    var headBtns = el("div", {});
    var resetBtn = el("button", { title: "New conversation", "aria-label": "New conversation" }, "⟳");
    var closeBtn = el("button", { title: "Close", "aria-label": "Close chat" }, "✕");
    headBtns.appendChild(resetBtn);
    headBtns.appendChild(closeBtn);
    head.appendChild(headBtns);

    var log = el("div", { id: "pbot-log" });

    var form = el("form", { id: "pbot-form" });
    var input = el("textarea", {
      id: "pbot-input", rows: "1", maxlength: String(MAX_INPUT_CHARS),
      placeholder: "Ask about eligibility, deadlines, policies…",
    });
    var send = el("button", { id: "pbot-send", type: "submit" }, "Send");
    form.appendChild(input);
    form.appendChild(send);

    var foot = el("div", { id: "pbot-foot" }, "AI assistant — answers come from official documents but may contain mistakes. Verify critical details with a coordinator.");

    panel.appendChild(head);
    panel.appendChild(log);
    panel.appendChild(form);
    panel.appendChild(foot);
    document.body.appendChild(bubble);
    document.body.appendChild(panel);

    // ---------- rendering ----------
    function addUserMsg(text) {
      var div = el("div", { class: "pbot-msg pbot-user" });
      div.textContent = text;
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
      return div;
    }

    function addBotMsg(markdown) {
      var div = el("div", { class: "pbot-msg pbot-bot" });
      if (markdown) renderMarkdown(div, markdown);
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
      return div;
    }

    function addEscalate() {
      if (!CONFIG.escalateUrl) return;
      var a = el("a", { class: "pbot-escalate", href: CONFIG.escalateUrl, target: "_blank", rel: "noopener" }, "📩 Contact a coordinator");
      log.appendChild(a);
      log.scrollTop = log.scrollHeight;
    }

    /** Offered under an instant FAQ answer, so a student is never stuck with it. */
    function addFaqFallback(question) {
      var btn = el("button", { class: "pbot-retry", type: "button" }, "Not what you needed? Ask the assistant →");
      btn.addEventListener("click", function () {
        if (busy) return;
        btn.remove();
        ask(question, true); // bypass FAQ this time
      });
      log.appendChild(btn);
      log.scrollTop = log.scrollHeight;
    }

    function renderAll() {
      log.textContent = "";
      addBotMsg(CONFIG.greeting);
      history.forEach(function (m) {
        if (m.role === "user") { addUserMsg(m.content); return; }
        addBotMsg(m.content);
        if (m.escalate) addEscalate();
      });
    }

    // ---------- chat ----------
    function ask(question, bypassFaq) {
      busy = true;
      send.disabled = true;
      history.push({ role: "user", content: question });
      saveHistory(history);
      addUserMsg(question);

      // --- instant FAQ path: no network call at all ---
      // Only for the opening question; follow-ups need real conversation context.
      var isFirstQuestion = history.filter(function (m) { return m.role === "user"; }).length === 1;
      if (!bypassFaq && isFirstQuestion) {
        var hit = faqLookup(question);
        if (hit) {
          addBotMsg(hit.a);
          history.push({ role: "assistant", content: hit.a, escalate: false });
          saveHistory(history);
          addFaqFallback(question);
          busy = false;
          send.disabled = false;
          input.focus();
          return;
        }
      }

      var botDiv = addBotMsg("");
      botDiv.classList.add("pbot-typing");
      botDiv.textContent = "Thinking…";

      streamAnswer(question, botDiv);
    }

    async function streamAnswer(question, botDiv) {
      var full = "";
      try {
        var resp = await fetch(CONFIG.api, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: history.map(function (m) { return { role: m.role, content: m.content }; }),
          }),
        });

        if (!resp.ok) {
          var errBody = {};
          try { errBody = await resp.json(); } catch (e) {}
          throw new Error(errBody.error || "Request failed (" + resp.status + ")");
        }

        botDiv.classList.remove("pbot-typing");
        botDiv.textContent = "";

        var reader = resp.body.getReader();
        var decoder = new TextDecoder();
        while (true) {
          var chunk = await reader.read();
          if (chunk.done) break;
          full += decoder.decode(chunk.value, { stream: true });
          renderMarkdown(botDiv, full.split(ESCALATE_TOKEN).join("").trim());
          log.scrollTop = log.scrollHeight;
        }

        var escalate = full.indexOf(ESCALATE_TOKEN) !== -1;
        var clean = full.split(ESCALATE_TOKEN).join("").trim() || "Sorry, I couldn't produce an answer. Please try again.";
        renderMarkdown(botDiv, clean);
        if (escalate) addEscalate();

        history.push({ role: "assistant", content: clean, escalate: escalate });
        saveHistory(history);
      } catch (err) {
        botDiv.classList.remove("pbot-typing");
        renderMarkdown(botDiv, "⚠️ " + (err.message || "Couldn't reach the assistant. Check your connection and try again."));
        history.pop(); // drop the unanswered user turn so a retry works cleanly
        saveHistory(history);
      } finally {
        busy = false;
        send.disabled = false;
        input.focus();
      }
    }

    // ---------- events ----------
    bubble.addEventListener("click", function () {
      panel.classList.toggle("pbot-open");
      if (panel.classList.contains("pbot-open")) input.focus();
    });
    closeBtn.addEventListener("click", function () { panel.classList.remove("pbot-open"); });
    resetBtn.addEventListener("click", function () {
      history = [];
      saveHistory(history);
      renderAll();
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var q = input.value.trim();
      if (!q || busy) return;
      input.value = "";
      ask(q, false);
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        form.dispatchEvent(new Event("submit", { cancelable: true }));
      }
    });

    renderAll();
    loadFaq();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
