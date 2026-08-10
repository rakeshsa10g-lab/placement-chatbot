/**
 * Placement chatbot widget — embed on any page with one script tag:
 *
 *   <script src="https://YOUR-APP.vercel.app/widget.js" defer
 *           data-api="https://YOUR-APP.vercel.app/api/chat"
 *           data-title="Placement & Internship Help"
 *           data-escalate-url="https://forms.gle/YOUR-FORM-ID"></script>
 *
 * No dependencies. Conversation history lives in sessionStorage (cleared when
 * the tab closes). When the bot can't answer it emits [[ESCALATE]], which this
 * widget converts into a "Contact a coordinator" button.
 */
(function () {
  "use strict";

  var script = document.currentScript;
  var CONFIG = {
    api: (script && script.dataset.api) || "/api/chat",
    title: (script && script.dataset.title) || "Placement & Internship Help",
    escalateUrl: (script && script.dataset.escalateUrl) || "",
    greeting:
      (script && script.dataset.greeting) ||
      "Hi! Ask me anything about internship eligibility, placement processes, policies, or resume verification. My answers come straight from the official documents.",
  };

  var STORAGE_KEY = "pbot-history-v1";
  var ESCALATE_TOKEN = "[[ESCALATE]]";
  var MAX_INPUT_CHARS = 2000;

  // ---------- styles ----------
  var css = [
    "#pbot-bubble{position:fixed;bottom:20px;right:20px;width:56px;height:56px;border-radius:50%;background:#1d4ed8;color:#fff;border:none;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);font-size:26px;line-height:56px;text-align:center;z-index:99998;transition:transform .15s}",
    "#pbot-bubble:hover{transform:scale(1.07)}",
    "#pbot-panel{position:fixed;bottom:88px;right:20px;width:360px;max-width:calc(100vw - 32px);height:520px;max-height:calc(100vh - 120px);background:#fff;border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,.28);display:none;flex-direction:column;overflow:hidden;z-index:99999;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}",
    "#pbot-panel.pbot-open{display:flex}",
    "#pbot-head{background:#1d4ed8;color:#fff;padding:12px 16px;font-weight:600;font-size:15px;display:flex;justify-content:space-between;align-items:center}",
    "#pbot-head button{background:none;border:none;color:#fff;font-size:18px;cursor:pointer;padding:0 4px}",
    "#pbot-log{flex:1;overflow-y:auto;padding:14px;background:#f5f7fb}",
    ".pbot-msg{margin:0 0 10px;padding:9px 12px;border-radius:10px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word;max-width:85%}",
    ".pbot-user{background:#1d4ed8;color:#fff;margin-left:auto;border-bottom-right-radius:3px}",
    ".pbot-bot{background:#fff;color:#1f2937;border:1px solid #e5e7eb;border-bottom-left-radius:3px}",
    ".pbot-escalate{display:inline-block;margin:2px 0 12px;padding:8px 14px;background:#fff;border:1.5px solid #dc2626;color:#dc2626;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;cursor:pointer}",
    ".pbot-escalate:hover{background:#fef2f2}",
    "#pbot-form{display:flex;gap:8px;padding:10px;border-top:1px solid #e5e7eb;background:#fff}",
    "#pbot-input{flex:1;border:1px solid #d1d5db;border-radius:8px;padding:9px 11px;font-size:14px;font-family:inherit;resize:none;max-height:96px;outline:none}",
    "#pbot-input:focus{border-color:#1d4ed8}",
    "#pbot-send{background:#1d4ed8;color:#fff;border:none;border-radius:8px;padding:0 16px;font-size:14px;font-weight:600;cursor:pointer}",
    "#pbot-send:disabled{opacity:.5;cursor:default}",
    ".pbot-typing{color:#6b7280;font-size:13px;font-style:italic}",
    "#pbot-foot{font-size:10.5px;color:#9ca3af;text-align:center;padding:4px 8px 7px;background:#fff}",
  ].join("\n");

  // ---------- state ----------
  function loadHistory() {
    try {
      return JSON.parse(sessionStorage.getItem(STORAGE_KEY)) || [];
    } catch {
      return [];
    }
  }
  function saveHistory(h) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(h.slice(-24)));
    } catch {}
  }
  var history = loadHistory();
  var busy = false;

  // ---------- DOM ----------
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
      id: "pbot-input",
      rows: "1",
      maxlength: String(MAX_INPUT_CHARS),
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
    function addMsg(role, text) {
      var div = el("div", { class: "pbot-msg " + (role === "user" ? "pbot-user" : "pbot-bot") });
      div.textContent = text;
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

    function renderAll() {
      log.textContent = "";
      addMsg("assistant", CONFIG.greeting);
      history.forEach(function (m) {
        if (m.role === "assistant" && m.escalate) {
          addMsg("assistant", m.content);
          addEscalate();
        } else {
          addMsg(m.role, m.content);
        }
      });
    }

    // ---------- chat ----------
    async function ask(question) {
      busy = true;
      send.disabled = true;
      history.push({ role: "user", content: question });
      saveHistory(history);
      addMsg("user", question);

      var botDiv = addMsg("assistant", "");
      botDiv.classList.add("pbot-typing");
      botDiv.textContent = "Thinking…";

      var full = "";
      try {
        var resp = await fetch(CONFIG.api, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: history.map(function (m) {
              return { role: m.role, content: m.content };
            }),
          }),
        });

        if (!resp.ok) {
          var errBody = {};
          try { errBody = await resp.json(); } catch {}
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
          // hide the escalate token while streaming
          botDiv.textContent = full.split(ESCALATE_TOKEN).join("").trim();
          log.scrollTop = log.scrollHeight;
        }

        var escalate = full.indexOf(ESCALATE_TOKEN) !== -1;
        var clean = full.split(ESCALATE_TOKEN).join("").trim() || "Sorry, I couldn't produce an answer. Please try again.";
        botDiv.textContent = clean;
        if (escalate) addEscalate();

        history.push({ role: "assistant", content: clean, escalate: escalate });
        saveHistory(history);
      } catch (err) {
        botDiv.classList.remove("pbot-typing");
        botDiv.textContent = "⚠️ " + (err.message || "Couldn't reach the assistant. Check your connection and try again.");
        history.pop(); // drop the unanswered user turn so retry works cleanly
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
    closeBtn.addEventListener("click", function () {
      panel.classList.remove("pbot-open");
    });
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
      ask(q);
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        form.dispatchEvent(new Event("submit"));
      }
    });

    renderAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
