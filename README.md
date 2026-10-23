# Quick Images MCP

JSON in, image URL out. An MCP server that gives WhatsApp agents tickets and bar charts: the agent sends the data, the server does the math and renders the PNG.

[![Demo video](https://img.youtube.com/vi/tjG1KP2XuCc/hqdefault.jpg)](https://youtu.be/tjG1KP2XuCc)

Live: https://quick-images-mcp.fguespe.workers.dev · A prototype by Fabri Guespe.

| Ticket | Chart |
|---|---|
| <img src="https://quick-images-mcp.fguespe.workers.dev/tickets/example.png" width="300"> | <img src="https://quick-images-mcp.fguespe.workers.dev/charts/example.png" width="300"> |

## Install

**01 · Add the MCP server**

```
Name        Quick Images MCP
Server URL  https://quick-images-mcp.fguespe.workers.dev/mcp
Headers     { "Authorization": "Bearer <your key>" }
```

The client reads `render_ticket` and `render_chart` with their schemas from `tools/list`. Keys are issued by hand while this is a prototype: [ask for one](https://github.com/humanagent/quick-images-mcp/issues).

**02 · One line per tool in the system prompt**

```
Tickets: call render_ticket and send the image_url as an image, with the caption "Order for <customer>. Total: $<total>" using the total the tool returns.
```

```
Sales: find the tickets in this chat and in past chats. Call render_chart with one point per ticket (label: customer, value: total) and send it the same way, with the tool's total in the caption. If there are no tickets, say so. Sales and tickets are the same thing.
```

## API

The same tools over REST.

```bash
curl -X POST https://quick-images-mcp.fguespe.workers.dev/tickets \
  -H 'authorization: Bearer $KEY' \
  -H 'content-type: application/json' \
  -d '{
  "store": { "name": "Café Tortoni" },
  "items": [
    { "name": "Café con leche", "qty": 2, "price": 4200 },
    { "name": "Medialunas",     "qty": 3, "price": 1500 }
  ],
  "taxRate": 0.21,
  "payment": "Mercado Pago"
}'
```

```json
{
  "image_url": "https://quick-images-mcp.fguespe.workers.dev/t/eyJzdG9y….png",
  "totals": { "subtotal": 12900, "discount": 0, "tax": 2709, "total": 15609 }
}
```

Optional ticket fields: `number`, `date`, `customer`, `discount`, `note`. Up to 12 items.

```bash
POST /charts  { "title": "Ventas", "currency": "ARS", "points": [{ "label": "Lun", "value": 182000 }] }
→ { "image_url": "…/c/….png", "total": 182000 }
```

Up to 14 points, the highest bar in green.

## How it works

- **No storage.** The data travels inside the image URL, so every PNG is cacheable forever.
- **Signed URLs.** Each URL carries an HMAC of its data, so nobody can edit the base64 and render another total (403).
- **The model never does math.** Totals are computed server side, in integer cents.
- **Errors the model can fix.** Bad input is a 400 (an `isError` result over MCP); a URL past WhatsApp's 2,048 characters is a 413.
- **Keys.** Creating an image needs `Authorization: Bearer <key>`; fetching one does not, since WhatsApp GETs it without headers. Only the key's SHA-256 is stored.

Cloudflare Workers, Hono, workers-og (satori + resvg).

## Numbers

Render benchmark (`node evals/bench.mjs`, 40 tickets against production from Buenos Aires, 2026-10-23):

| step | p50 ms | p95 ms |
|---|---|---|
| POST /tickets | 73 | 107 |
| GET image, first fetch | 247 | 496 |
| GET image, second fetch | 191 | 284 |

Tool-call eval (`evals/`, 22 owner messages through the agent's prompt and schemas): written, not run yet.

## Develop

```bash
npm install
echo "SIGNING_KEY=$(openssl rand -hex 32)" > .dev.vars
npm run dev
node scripts/new-key.mjs smoke --local   # prints a local key
QI_KEY=<key> npm run smoke               # 22 checks
npm run deploy
```
