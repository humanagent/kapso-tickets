// Render latency against a deployed Worker, no model involved.
//   node evals/bench.mjs [base] [n]
// cold = a ticket never rendered before (unique note per request, so no cache);
// warm = the same image URL fetched again (edge cache).
const base = process.argv[2] ?? "https://quick-images-mcp.fguespe.workers.dev";
const n = Number(process.argv[3] ?? 40);
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const time = async (f) => { const t = performance.now(); await f(); return performance.now() - t; };

const cold = [], warm = [], post = [], sizes = [];
for (let i = 0; i < n; i++) {
  const ticket = {
    store: { name: "Pizzería La Esquina" },
    customer: "Bench",
    items: [{ name: "Muzza grande", qty: 2, price: 12500 }, { name: "Fainá", qty: 1, price: 3000 }],
    currency: "ARS",
    note: `bench ${Date.now()}-${i}`,
  };
  let url;
  post.push(await time(async () => {
    const r = await fetch(`${base}/tickets`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ticket) });
    url = (await r.json()).image_url;
  }));
  cold.push(await time(async () => sizes.push((await (await fetch(url)).arrayBuffer()).byteLength)));
  warm.push(await time(async () => { await (await fetch(url)).arrayBuffer(); }));
}
const row = (name, xs) => `| ${name} | ${pct(xs, 50).toFixed(0)} | ${pct(xs, 95).toFixed(0)} |`;
console.log([
  `${base}, n=${n}, from ${Intl.DateTimeFormat().resolvedOptions().timeZone}, ${new Date().toISOString().slice(0, 10)}`,
  "",
  "| step | p50 ms | p95 ms |",
  "|---|---|---|",
  row("POST /tickets", post),
  row("GET image, cold (render)", cold),
  row("GET image, warm (cached)", warm),
  `| PNG size | ${Math.round(pct(sizes, 50) / 1024)} KB | |`,
].join("\n"));
