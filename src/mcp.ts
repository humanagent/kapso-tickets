// MCP over Streamable HTTP, stateless: every POST /mcp is one JSON-RPC message
// (or a batch) answered with plain JSON. An MCP client takes one URL
// and reads the tools from tools/list, so nobody pastes schemas by hand.

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

export type ToolResult = Record<string, unknown>;
export type ToolHandlers = Record<string, (args: unknown) => Promise<ToolResult>>;

export const TOOLS = [
  {
    name: "render_ticket",
    description:
      "Render an order ticket as a PNG for WhatsApp. Returns image_url (send it with an image UI skill) and totals computed server side; never compute totals yourself.",
    inputSchema: {
      type: "object",
      properties: {
        store: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
        customer: { type: "string", description: "Customer name" },
        items: {
          type: "array",
          maxItems: 12,
          items: {
            type: "object",
            properties: { name: { type: "string" }, qty: { type: "number" }, price: { type: "number" } },
            required: ["name", "qty", "price"],
          },
        },
        currency: { type: "string", description: "e.g. ARS" },
        payment: { type: "string", description: "Payment method, e.g. Mercado Pago" },
        discount: { type: "number", description: "Absolute amount" },
        taxRate: { type: "number", description: "0.21 for 21%" },
        note: { type: "string" },
      },
      required: ["store", "items"],
    },
  },
  {
    name: "render_chart",
    description:
      "Render a bar chart (e.g. sales per day) as a PNG for WhatsApp. Returns image_url (send it with an image UI skill) and the total.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        subtitle: { type: "string" },
        currency: { type: "string" },
        points: {
          type: "array",
          maxItems: 14,
          items: {
            type: "object",
            properties: { label: { type: "string" }, value: { type: "number" } },
            required: ["label", "value"],
          },
        },
      },
      required: ["title", "points"],
    },
  },
];

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function handle(msg: Rpc, handlers: ToolHandlers) {
  // Notifications (no id) get no response.
  if (msg.id === undefined) return null;
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return ok(msg.id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: "quick-images-mcp", version: "1.0.0" },
      });
    }
    case "ping":
      return ok(msg.id, {});
    case "tools/list":
      return ok(msg.id, { tools: TOOLS });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const run = handlers[name];
      if (!run) return fail(msg.id, -32602, `unknown tool: ${name}`);
      try {
        const out = await run(msg.params?.arguments ?? {});
        return ok(msg.id, { content: [{ type: "text", text: JSON.stringify(out) }], structuredContent: out });
      } catch (e) {
        // Tool errors go back to the model as a result it can read and fix.
        return ok(msg.id, { content: [{ type: "text", text: (e as Error).message }], isError: true });
      }
    }
    default:
      return fail(msg.id, -32601, `method not found: ${msg.method}`);
  }
}

export async function mcp(req: Request, handlers: ToolHandlers): Promise<Response> {
  if (req.method !== "POST") return new Response("MCP endpoint: POST JSON-RPC here", { status: 405, headers: { allow: "POST" } });
  let body: Rpc | Rpc[];
  try {
    body = await req.json();
  } catch {
    return Response.json(fail(null, -32700, "parse error"), { status: 400 });
  }
  const batch = Array.isArray(body);
  const msgs: Rpc[] = Array.isArray(body) ? body : [body];
  const out = (await Promise.all(msgs.map((m) => handle(m, handlers)))).filter(Boolean);
  if (out.length === 0) return new Response(null, { status: 202 });
  return Response.json(batch ? out : out[0]);
}
