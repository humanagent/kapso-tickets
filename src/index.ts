import { Hono } from "hono";
import { ImageResponse, loadGoogleFont } from "workers-og";
import { example, parseTicket, ticketHeight, ticketHtml, totals, type Ticket } from "./ticket";

const app = new Hono();

// The ticket travels in the URL, so an image URL is the whole state:
// no storage, cacheable forever, and Kapso's image skill just GETs it.
const encode = (t: Ticket) => btoa(unescape(encodeURIComponent(JSON.stringify(t))))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const decode = (s: string): unknown =>
  JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))));

let fonts: Promise<{ name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" }[]> | undefined;
const loadFonts = () =>
  (fonts ??= Promise.all([
    loadGoogleFont({ family: "Space Mono", weight: 400 }),
    loadGoogleFont({ family: "Space Mono", weight: 700 }),
  ]).then(([r, b]) => [
    { name: "Space Mono", data: r, weight: 400, style: "normal" },
    { name: "Space Mono", data: b, weight: 700, style: "normal" },
  ]));

async function render(t: Ticket) {
  return new ImageResponse(ticketHtml(t), {
    width: 600,
    height: ticketHeight(t),
    fonts: await loadFonts(),
    headers: { "cache-control": "public, max-age=31536000, immutable" },
  });
}

app.get("/api", (c) =>
  c.json({
    what: "Renders a purchase ticket as a PNG for WhatsApp agents",
    post: "POST /tickets with a ticket JSON -> { image_url, totals }",
    example: new URL(`/t/${encode(example)}.png`, c.req.url).toString(),
  }),
);

app.get("/api/example", (c) => c.json(example));

app.post("/tickets", async (c) => {
  try {
    const t = parseTicket(await c.req.json());
    const image_url = new URL(`/t/${encode(t)}.png`, c.req.url).toString();
    if (image_url.length > 2048) return c.json({ error: "ticket too large for a WhatsApp image_url" }, 413);
    return c.json({ image_url, totals: totals(t) });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

app.get("/t/:data{.+\\.png}", async (c) => {
  try {
    return await render(parseTicket(decode(c.req.param("data").replace(/\.png$/, ""))));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

export default app;
