/**
 * Minimal local dev server — mimics Vercel without needing the Vercel CLI.
 * Serves public/ as static files and routes POST /api/chat to api/chat.js.
 *
 * Usage:  npm run dev   →  http://localhost:3000
 * Reads ANTHROPIC_API_KEY (and friends) from a .env file if present.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Run from the project root no matter where the server was launched from
// (api/chat.js locates knowledge/ via process.cwd(), matching Vercel).
process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.resolve("public");

// --- load .env (simple KEY=VALUE parser, no dependency) ---
try {
  for (const line of fs.readFileSync(path.resolve(".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith("#") && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {} // no .env is fine — vars may come from the shell

const { default: chatHandler } = await import("../api/chat.js");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

// Add the Vercel-style helpers api/chat.js expects onto Node's raw res.
function vercelify(req, res, body) {
  req.body = body;
  res.status = (code) => ((res.statusCode = code), res);
  res.json = (obj) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(obj));
    return res;
  };
  return { req, res };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/api/chat") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch {}
    vercelify(req, res, body);
    try {
      await chatHandler(req, res);
    } catch (err) {
      console.error("handler error:", err);
      if (!res.writableEnded) res.status(500).json({ error: "internal error" });
    }
    return;
  }

  // static files from public/
  let filePath = path.join(PUBLIC_DIR, url.pathname === "/" ? "index.html" : url.pathname);
  filePath = path.normalize(filePath);
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.statusCode = 404;
    return res.end("Not found");
  }
  res.setHeader("Content-Type", MIME[path.extname(filePath)] || "application/octet-stream");
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`Placement chatbot dev server → http://localhost:${PORT}`);
  const forced = (process.env.LLM_PROVIDER || "").toLowerCase();
  const provider = ["anthropic", "gemini", "llama"].includes(forced)
    ? forced
    : null;

  const available = [];
  if (process.env.GEMINI_API_KEY) available.push("gemini");
  if (process.env.LLAMA_API_KEY) available.push("llama");
  if (process.env.ANTHROPIC_API_KEY) available.push("anthropic");
  const preferred = (process.env.LLM_PROVIDER || "")
    .toLowerCase().split(",").map((s) => s.trim())
    .filter((p) => available.includes(p));
  const chain = preferred.slice();
  for (const p of available) if (!chain.includes(p)) chain.push(p);

  const modelFor = {
    anthropic: process.env.ANTHROPIC_MODEL || "claude-opus-4-8",
    gemini: process.env.GEMINI_MODEL || "gemini-flash-lite-latest",
    llama: process.env.LLAMA_MODEL || "llama-3.3-70b-versatile",
  };

  if (!chain.length) {
    console.log("API key: MISSING — add GEMINI_API_KEY, LLAMA_API_KEY (both free), or ANTHROPIC_API_KEY to .env, then restart.");
  } else {
    console.log("Providers (failover order):");
    chain.forEach((p, i) => console.log(`  ${i + 1}. ${p} — ${modelFor[p]}`));
    if (chain.length === 1) {
      console.log("  ! Only one provider configured — students will hit a wall when its");
      console.log("    free quota runs out. Add a second (see README).");
    }
  }
});
