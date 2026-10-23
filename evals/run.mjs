// Tool-call eval: does the agent turn an owner's message into a correct ticket or chart?
//   ANTHROPIC_API_KEY=... node evals/run.mjs [--base https://...] [--runs 3]
// For each case: one Messages API call with the Kapso agent's prompt and tools,
// then the tool input is POSTed to the live service and the image is fetched.
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { EFFORT, MENU, MODEL, SALES, SYSTEM, TOOLS } from "./agent.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "https://quick-images-mcp.fguespe.workers.dev");
const RUNS = Number(arg("--runs", "1"));
const cases = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url)));
const client = new Anthropic();

const norm = (s) => String(s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
// "Muzza", "muzza grande" and "Muzza grande" all mean the menu item; anything else is not on the menu.
const canonical = (name) =>
  Object.keys(MENU).find((m) => norm(m) === norm(name) || norm(m).split(" ")[0] === norm(name).split(" ")[0]);
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };

async function runCase(c) {
  const t0 = performance.now();
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    tools: TOOLS,
    output_config: { effort: EFFORT },
    messages: [{ role: "user", content: c.msg }],
  });
  const modelMs = performance.now() - t0;
  const r = { id: c.id, modelMs, stop: msg.stop_reason, checks: {} };
  if (msg.stop_reason === "refusal") return { ...r, pass: false, why: "refusal" };

  const uses = msg.content.filter((b) => b.type === "tool_use");
  if (c.tool === null) return { ...r, pass: uses.length === 0, why: uses.length ? `called ${uses[0].name}` : "" };
  const use = uses.find((u) => u.name === c.tool);
  if (!use) {
    const pass = !!c.allowNoTool && uses.length === 0;
    return { ...r, pass, why: uses.length ? `called ${uses[0].name}` : pass ? "asked first (allowed)" : "no tool call" };
  }

  const path = c.tool === "render_ticket" ? "/tickets" : "/charts";
  const t1 = performance.now();
  const res = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(use.input) });
  const body = await res.json();
  r.checks.accepted = res.status === 200;
  if (r.checks.accepted) {
    const img = await fetch(body.image_url);
    r.checks.renders = img.ok && img.headers.get("content-type") === "image/png";
  }
  r.renderMs = performance.now() - t1;

  const inp = use.input;
  if (c.tool === "render_ticket") {
    const got = {};
    let menuPrices = true;
    for (const it of inp.items ?? []) {
      const k = canonical(it.name);
      if (!k) { got[`?${it.name}`] = it.qty; continue; }
      got[k] = (got[k] ?? 0) + it.qty;
      if (it.price !== MENU[k]) menuPrices = false;
    }
    const want = c.items;
    r.checks.items = Object.keys(got).length === Object.keys(want).length && Object.entries(want).every(([k, q]) => got[k] === q);
    r.checks.menuPrices = menuPrices;
    r.checks.customer = norm(inp.customer).includes(norm(c.customer));
    if (c.payment) r.checks.payment = norm(inp.payment).includes(norm(c.payment));
    const expected = Object.entries(want).reduce((s, [k, q]) => s + MENU[k] * q, 0);
    r.checks.total = body.totals?.total === expected;
  } else {
    const pts = inp.points ?? [];
    r.checks.points = pts.length === 7 && Object.entries(SALES).every(([d, v]) => pts.some((p) => norm(p.label).startsWith(norm(d).slice(0, 2)) && p.value === v));
    r.checks.total = body.total === Object.values(SALES).reduce((a, b) => a + b, 0);
  }
  r.pass = Object.values(r.checks).every(Boolean);
  r.why = Object.entries(r.checks).filter(([, ok]) => !ok).map(([k]) => k).join(", ");
  r.input = inp;
  return r;
}

const results = [];
for (let run = 1; run <= RUNS; run++) {
  for (const c of cases) {
    const r = await runCase(c).catch((e) => ({ id: c.id, pass: false, why: `error: ${e.message}` }));
    r.run = run;
    results.push(r);
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${run}/${c.id}${r.why ? `  (${r.why})` : ""}`);
  }
}

const passed = results.filter((r) => r.pass).length;
const tickets = results.filter((r) => cases.find((c) => c.id === r.id)?.tool === "render_ticket");
const rate = (rs, k) => { const xs = rs.filter((r) => r.checks?.[k] !== undefined); return `${xs.filter((r) => r.checks[k]).length}/${xs.length}`; };
const model = results.map((r) => r.modelMs).filter(Boolean);
const render = results.map((r) => r.renderMs).filter(Boolean);
const summary = [
  `model ${MODEL}, effort ${EFFORT}, ${cases.length} cases x ${RUNS} run(s), ${new Date().toISOString().slice(0, 10)}`,
  "",
  "| metric | result |",
  "|---|---|",
  `| cases passed | ${passed}/${results.length} |`,
  `| ticket accepted by the API | ${rate(tickets, "accepted")} |`,
  `| ticket items exactly right | ${rate(tickets, "items")} |`,
  `| menu prices used | ${rate(tickets, "menuPrices")} |`,
  `| ticket total right | ${rate(tickets, "total")} |`,
  `| model latency p50 / p95 | ${pct(model, 50)?.toFixed(0)} / ${pct(model, 95)?.toFixed(0)} ms |`,
  `| POST + image fetch p50 / p95 | ${pct(render, 50)?.toFixed(0)} / ${pct(render, 95)?.toFixed(0)} ms |`,
].join("\n");
console.log("\n" + summary);
mkdirSync(new URL("./results/", import.meta.url), { recursive: true });
writeFileSync(new URL(`./results/${Date.now()}.json`, import.meta.url), JSON.stringify({ summary, results }, null, 2));
process.exit(passed === results.length ? 0 : 1);
