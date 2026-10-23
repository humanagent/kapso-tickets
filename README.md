# Kapso Quick Images

JSON in, PNG out: tickets and bar charts a Kapso WhatsApp agent can send. A WhatsApp agent sends the order data and gets back an image URL it can send with the Kapso image UI skill.

Live: https://kapso-tickets.fguespe.workers.dev

A prototype by Fabri Guespe, built on Kapso Agent UI skills. Not an official Kapso product.

## Why

The Kapso agent node can send images, but only from a URL that already exists. Image apps in the App step take HTML and need an external account. Here the LLM passes only data, a template renders it, and nothing needs setup.

## API

```
POST /tickets
{
  "store": { "name": "Pizzería La Esquina" },
  "items": [{ "name": "Muzza grande", "qty": 2, "price": 12500 }],
  "currency": "ARS"
}

→ 200 { "image_url": "https://kapso-tickets.fguespe.workers.dev/t/<data>.png", "totals": { "subtotal": 25000, "discount": 0, "tax": 0, "total": 25000 } }
```

Optional fields: `number`, `date`, `customer`, `discount`, `taxRate` (0 to <1), `payment`, `note`.

- The ticket is base64url-encoded in the image URL, so there is no storage and the PNG is cached as immutable.
- **Every image URL is signed** (HMAC-SHA256 over kind + data, 16 bytes, `/t/<data>.<sig>.png`). Without it, anyone could edit the base64 and render a ticket with another total. Edited, unsigned or cross-kind URLs get a 403; the compare is constant time.
- Totals are computed server side in integer cents. The model never does the math.
- Up to 12 items; `image_url` must fit WhatsApp's 2048-character limit (413 otherwise).

`GET /api/example` returns a sample ticket.

### Charts

```
POST /charts
{ "title": "Ventas de la semana", "currency": "ARS", "points": [{ "label": "Lun", "value": 182000 }, { "label": "Mar", "value": 156500 }] }

→ 200 { "image_url": "https://kapso-tickets.fguespe.workers.dev/c/<data>.png", "total": 338500 }
```

A bar chart for backoffice questions (*"how did we sell this week?"*), up to 14 points, the highest bar in green. Example: `/charts/example.png`.

## Evals

**Tool-call eval** (`evals/`): 22 owner messages (typos, "x2", words for numbers, English, an item not on the menu, a price override, sales questions, small talk) run through the same prompt, model (`claude-sonnet-5-5`, effort high) and tool schemas as the Kapso agent node. Each tool input is POSTed to the live service and the PNG fetched. Checks per ticket: accepted by the API, items exactly right, menu prices used, customer and payment carried, total right; per chart: the 7 days and the total.

```
ANTHROPIC_API_KEY=... node evals/run.mjs --runs 3
```

Results: not run yet (needs an API key).

**Render benchmark** (`node evals/bench.mjs`, no model): 40 unique tickets against production, from Buenos Aires, 2026-10-23, before the cache fix:

| step | p50 ms | p95 ms |
|---|---|---|
| POST /tickets | 79 | 162 |
| GET image, first fetch (render) | 279 | 531 |
| GET image, second fetch | 288 | 537 |

The second fetch cost the same as the first: the `immutable` header was not enough, Cloudflare does not cache Worker responses by itself, so every fetch re-rendered. Rendered PNGs now go into the Cache API. Locally (`wrangler dev`, n=10) that took the second fetch from 118 to 4 ms p50; production numbers after deploy are pending.

## Wiring it in Kapso

1. Workflow with a WhatsApp message trigger.
2. AI Agent node with a webhook tool `render_ticket`: `POST https://kapso-tickets.fguespe.workers.dev/tickets`, body schema `store`, `items`, `currency`.
3. UI skill, format Image: use the `image_url` returned by `render_ticket`.

## Stack

Cloudflare Workers, Hono, workers-og (satori + resvg), Space Mono.

```
npm install
echo "SIGNING_KEY=$(openssl rand -hex 32)" > .dev.vars
npm run dev
npm run smoke                         # 11 checks against localhost, including forged URLs
npx wrangler secret put SIGNING_KEY   # once, before the first deploy
npm run deploy
```
