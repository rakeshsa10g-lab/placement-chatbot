/**
 * Configure the escalation Google Form without touching entry IDs by hand.
 *
 * In your Google Form:  ⋮ menu → "Get pre-filled link", type these EXACT values:
 *      Roll Number = ROLLNUMBER
 *      Question    = QUESTION
 *      Department  = DEPARTMENT
 * then "Get link" → "COPY LINK", and run:
 *
 *      npm run setup-form -- "<paste the link>"
 *
 * This reads the entry IDs out of that link and writes them into public/routing.json.
 */
import fs from "node:fs/promises";
import path from "node:path";

const MARKERS = {
  rollNumber: "ROLLNUMBER",
  question: "QUESTION",
  department: "DEPARTMENT",
};

const raw = process.argv.slice(2).join(" ").trim().replace(/^["']|["']$/g, "");

if (!raw) {
  console.error(`
Usage:  npm run setup-form -- "<pre-filled Google Form link>"

Get that link from your form:  ⋮ menu → "Get pre-filled link"
Fill the three questions with exactly:  ROLLNUMBER / QUESTION / DEPARTMENT
then click "Get link" → "COPY LINK".
`);
  process.exit(1);
}

let url;
try {
  url = new URL(raw);
} catch {
  console.error("That doesn't look like a URL. Paste the whole link, in quotes.");
  process.exit(1);
}

if (!/docs\.google\.com$/.test(url.hostname) || !/\/forms\//.test(url.pathname)) {
  console.error("That isn't a Google Forms link. It should look like:\n  https://docs.google.com/forms/d/e/XXXX/viewform?usp=pp_url&entry.123=ROLLNUMBER...");
  process.exit(1);
}

// The pre-filled link ends in /viewform; submissions go to /formResponse.
const actionUrl = url.origin + url.pathname.replace(/\/viewform.*$/, "/formResponse");

// Map each marker value back to the entry.NNNN parameter that carried it.
const fields = {};
const missing = [];
for (const [key, marker] of Object.entries(MARKERS)) {
  let found = null;
  for (const [param, value] of url.searchParams.entries()) {
    if (!param.startsWith("entry.")) continue;
    if (value.trim().toUpperCase() === marker) { found = param; break; }
  }
  if (found) fields[key] = found;
  else missing.push(`${key}  (expected a field pre-filled with "${marker}")`);
}

if (missing.length) {
  console.error("Could not find these fields in the link:\n  " + missing.join("\n  "));
  console.error(`
Re-do "Get pre-filled link" and type the dummy values EXACTLY as:
  Roll Number = ROLLNUMBER
  Question    = QUESTION
  Department  = DEPARTMENT
(no extra spaces, no other text)
`);
  process.exit(1);
}

const routingPath = path.resolve("public", "routing.json");
const routing = JSON.parse(await fs.readFile(routingPath, "utf8"));
routing.form = { actionUrl, fields };
await fs.writeFile(routingPath, JSON.stringify(routing, null, 2) + "\n", "utf8");

console.log("Escalation form configured:\n");
console.log("  submits to : " + actionUrl);
for (const [k, v] of Object.entries(fields)) console.log(`  ${k.padEnd(11)}: ${v}`);
console.log(`
Written to public/routing.json.

Next:
  1. Attach google-apps-script/segregate.gs to the form's response sheet
     (see ESCALATION-SETUP.md) so answers are filed by department.
  2. git add -A && git commit -m "escalation form" && git push
`);
