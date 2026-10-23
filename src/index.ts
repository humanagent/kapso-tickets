import { Hono, type Context } from "hono";
import { ImageResponse, loadGoogleFont } from "workers-og";
import { example, parseTicket, ticketHeight, ticketHtml, totals } from "./ticket";
import { CHART_H, chartHtml, chartTotal, exampleChart, parseChart } from "./chart";
import { mcp } from "./mcp";

const app = new Hono<{ Bindings: { SIGNING_KEY: string } }>();

// The ticket travels in the URL, so an image URL is the whole state:
// no storage, cacheable forever, and Kapso's image skill just GETs it.
const encode = (t: unknown) => btoa(unescape(encodeURIComponent(JSON.stringify(t))))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const decode = (s: string): unknown =>
  JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))));

// The URL carries the whole ticket, so without a signature anyone could edit the
// base64 and render a ticket with a different total. Each image URL carries an
// HMAC of its kind and data; a URL we did not sign renders nothing.
const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const keys = new Map<string, Promise<CryptoKey>>();
const hmacKey = (secret: string) => {
  if (!keys.has(secret)) {
    keys.set(secret, crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]));
  }
  return keys.get(secret)!;
};

// 16 bytes of HMAC-SHA256 keeps the URL short and is still far beyond guessing.
async function sign(secret: string, kind: string, data: string) {
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(`${kind}:${data}`));
  return b64url(mac.slice(0, 16));
}

async function verified(secret: string, kind: string, param: string): Promise<string | null> {
  const [data, sig] = param.replace(/\.png$/, "").split(".");
  if (!data || !sig) return null;
  const expected = await sign(secret, kind, data);
  // Constant-time compare: a short-circuit compare leaks how many characters match.
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? data : null;
}

async function imageUrl(c: { req: { url: string }; env: { SIGNING_KEY: string } }, kind: "t" | "c", value: unknown) {
  const data = encode(value);
  return new URL(`/${kind}/${data}.${await sign(c.env.SIGNING_KEY, kind, data)}.png`, c.req.url).toString();
}

app.use("*", async (c, next) => {
  if (!c.env.SIGNING_KEY) return c.json({ error: "SIGNING_KEY is not configured" }, 500);
  await next();
});

let fonts: Promise<{ name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" }[]> | undefined;
const loadFonts = () =>
  (fonts ??= Promise.all([
    loadGoogleFont({ family: "Space Mono", weight: 400 }),
    loadGoogleFont({ family: "Space Mono", weight: 700 }),
  ]).then(([r, b]) => [
    { name: "Space Mono", data: r, weight: 400, style: "normal" },
    { name: "Space Mono", data: b, weight: 700, style: "normal" },
  ]));

// Image URLs are immutable (the data is the URL), but Cloudflare does not cache
// Worker responses on its own: without this, every WhatsApp fetch re-rendered.
async function cached(c: Context, make: () => Promise<Response>) {
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(c.req.raw);
  if (hit) return hit;
  const res = await make();
  if (res.ok) c.executionCtx.waitUntil(cache.put(c.req.raw, res.clone()));
  return res;
}

async function render(html: string, height: number) {
  return new ImageResponse(html, {
    width: 600,
    height,
    fonts: await loadFonts(),
    headers: { "cache-control": "public, max-age=31536000, immutable" },
  });
}

app.get("/api", async (c) =>
  c.json({
    what: "Quick Images MCP (prototype, not an official Kapso product): tickets and charts as PNGs for WhatsApp agents",
    post: "POST /tickets with a ticket JSON -> { image_url, totals }",
    charts: "POST /charts with { title, points: [{ label, value }] } -> { image_url, total }",
    mcp: "MCP server (Streamable HTTP): POST /mcp, tools render_ticket and render_chart",
    example: await imageUrl(c, "t", example),
  }),
);

app.get("/api/example", (c) => c.json(example));
app.get("/api/example-chart", (c) => c.json(exampleChart));

// Shared by the REST routes and the MCP tools.
type Ctx = { req: { url: string }; env: { SIGNING_KEY: string } };
class TooLarge extends Error {}

async function makeTicket(c: Ctx, input: unknown) {
  const t = parseTicket(input);
  const image_url = await imageUrl(c, "t", t);
  if (image_url.length > 2048) throw new TooLarge("ticket too large for a WhatsApp image_url");
  return { image_url, totals: totals(t) };
}

async function makeChart(c: Ctx, input: unknown) {
  const ch = parseChart(input);
  const image_url = await imageUrl(c, "c", ch);
  if (image_url.length > 2048) throw new TooLarge("chart too large for a WhatsApp image_url");
  return { image_url, total: chartTotal(ch) };
}

const errorStatus = (e: unknown) => (e instanceof TooLarge ? 413 : 400);

app.post("/tickets", async (c) => {
  try {
    return c.json(await makeTicket(c, await c.req.json()));
  } catch (e) {
    return c.json({ error: (e as Error).message }, errorStatus(e));
  }
});

app.get("/t/:data{.+\\.png}", async (c) => {
  try {
    const data = await verified(c.env.SIGNING_KEY, "t", c.req.param("data"));
    if (!data) return c.json({ error: "invalid signature" }, 403);
    const t = parseTicket(decode(data));
    return await cached(c, () => render(ticketHtml(t), ticketHeight(t)));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

app.get("/charts/example.png", async (c) => c.redirect(await imageUrl(c, "c", exampleChart)));

app.post("/charts", async (c) => {
  try {
    return c.json(await makeChart(c, await c.req.json()));
  } catch (e) {
    return c.json({ error: (e as Error).message }, errorStatus(e));
  }
});

app.all("/mcp", (c) =>
  mcp(c.req.raw, {
    render_ticket: (args) => makeTicket(c, args),
    render_chart: (args) => makeChart(c, args),
  }),
);

app.get("/c/:data{.+\\.png}", async (c) => {
  try {
    const data = await verified(c.env.SIGNING_KEY, "c", c.req.param("data"));
    if (!data) return c.json({ error: "invalid signature" }, 403);
    const ch = parseChart(decode(data));
    return await cached(c, () => render(chartHtml(ch), CHART_H));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

export default app;
