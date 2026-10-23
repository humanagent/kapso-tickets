// Smoke test against a running Worker: node scripts/smoke.mjs [base url]
// Checks that signed URLs render and that edited ones are refused.
const base = process.argv[2] ?? "http://localhost:8787";
let failed = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);
  if (!ok) failed++;
};
const post = (path, body) =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const status = async (url) => (await fetch(url, { redirect: "manual" })).status;

const ticket = { store: { name: "La Esquina" }, items: [{ name: "Muzza", qty: 2, price: 12500 }], currency: "ARS" };
const r = await post("/tickets", ticket);
const { image_url, totals } = await r.json();
check("POST /tickets returns a signed url", r.status === 200 && /\/t\/[\w-]+\.[\w-]{22}\.png$/.test(image_url), image_url?.slice(-40));
check("total computed server side", totals?.total === 25000, String(totals?.total));
check("signed ticket renders", (await status(image_url)) === 200);

// Edit the ticket inside the URL: same signature, price changed.
const [, data, sig] = image_url?.match(/\/t\/([\w-]+)\.([\w-]+)\.png$/) ?? [, image_url?.match(/\/t\/([\w-]+)\.png$/)?.[1] ?? "", "AAAAAAAAAAAAAAAAAAAAAA"];
const forged = { ...ticket, items: [{ name: "Muzza", qty: 2, price: 1 }] };
const forgedData = Buffer.from(JSON.stringify(forged)).toString("base64url");
check("edited ticket with old signature is refused", (await status(`${base}/t/${forgedData}.${sig}.png`)) === 403);
check("flipped signature is refused", (await status(`${base}/t/${data}.${sig.replace(/^./, (ch) => (ch === "A" ? "B" : "A"))}.png`)) === 403);
check("unsigned url is refused", (await status(`${base}/t/${data}.png`)) === 403);
check("ticket signature does not open a chart", (await status(`${base}/c/${data}.${sig}.png`)) === 403);

const cr = await post("/charts", { title: "Semana", points: [{ label: "Lun", value: 10 }, { label: "Mar", value: 20 }] });
const chart = await cr.json();
check("POST /charts returns a signed url", cr.status === 200 && /\/c\/[\w-]+\.[\w-]{22}\.png$/.test(chart.image_url));
check("signed chart renders", (await status(chart.image_url)) === 200);
check("ticket example redirects to a signed url", (await status(`${base}/tickets/example.png`)) === 302);
check("chart example redirects to a signed url", (await status(`${base}/charts/example.png`)) === 302);

const bad = await post("/tickets", { store: { name: "x" }, items: [] });
check("bad ticket is a 400", bad.status === 400);

// MCP: the same tools over JSON-RPC, as an MCP client calls them.
const rpc = async (method, params, id = 1) => {
  const res = await post("/mcp", { jsonrpc: "2.0", id, method, params });
  return { status: res.status, body: res.status === 202 ? null : await res.json() };
};
const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } });
check("mcp initialize", init.body?.result?.capabilities?.tools !== undefined, init.body?.result?.protocolVersion);
check("mcp notification is a 202", (await post("/mcp", { jsonrpc: "2.0", method: "notifications/initialized" })).status === 202);
const list = await rpc("tools/list", {});
check("mcp lists both tools", list.body?.result?.tools?.map((t) => t.name).join(",") === "render_ticket,render_chart");
const call = await rpc("tools/call", { name: "render_ticket", arguments: ticket });
const sc = call.body?.result?.structuredContent;
check("mcp render_ticket matches REST", sc?.totals?.total === 25000 && sc?.image_url === image_url);
check("mcp image renders", (await status(sc?.image_url)) === 200);
const badCall = await rpc("tools/call", { name: "render_ticket", arguments: { store: { name: "x" }, items: [] } });
check("mcp bad input is a readable tool error", badCall.body?.result?.isError === true);

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
