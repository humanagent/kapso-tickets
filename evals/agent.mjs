// The agent under test: same system prompt, model and tool schemas as the
// WhatsApp agent it was tested in. This replays the model's side only; it does
// not run any agent platform's runtime.
export const MODEL = "claude-sonnet-5-5";
export const EFFORT = "high";

export const MENU = {
  "Muzza grande": 12500,
  "Napolitana grande": 14000,
  "Fugazzeta grande": 15000,
  "Fainá": 3000,
  "Cerveza 1L": 4500,
};

export const SALES = { Lun: 182000, Mar: 156500, Mié: 201000, Jue: 238500, Vie: 412000, Sáb: 486500, Dom: 351000 };

const menuLines = Object.entries(MENU).map(([n, p]) => `- ${n}: ${p}`).join("\n");
const salesLine = Object.entries(SALES).map(([d, v]) => `${d} ${v}`).join(", ");

export const SYSTEM = `Sos el asistente de backoffice del dueño de Pizzería La Esquina. Quien te escribe es el dueño. Respondé corto y en español.

Menú (precios en ARS):
${menuLines}

Ventas de la semana (13 al 19 de oct, ARS): ${salesLine}.

Cuando el dueño pida un ticket para un cliente (por ejemplo "generame un ticket para Juan: 2 muzza y una fainá, pagó con Mercado Pago"):
1. Llamá a render_ticket con store {"name": "Pizzería La Esquina"}, customer (el nombre del cliente), items (name, qty, price del menú), currency "ARS" y payment si lo dice.
2. Mandá la imagen con el image_url que devuelve la tool, con un texto corto: "Listo, reenviáselo a <cliente>. Total: <total>".
No preguntes de más: si falta el pago, generá el ticket sin pago.

Cuando pregunte por las ventas (por ejemplo "¿cómo vendimos esta semana?"):
1. Llamá a render_chart con title "Ventas de la semana", subtitle "Pizzería La Esquina · 13 al 19 de oct", currency "ARS" y points con las ventas de arriba.
2. Mandá la imagen con el image_url que devuelve la tool, con el total y el mejor día.

No inventes productos, precios ni ventas fuera de estos datos.`;

export const TOOLS = [
  {
    name: "render_ticket",
    description: "Genera la imagen del ticket del pedido y devuelve image_url y totals. Body: store {name}, items [{name, qty, price}], currency.",
    input_schema: {
      type: "object",
      properties: {
        store: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
        customer: { type: "string", description: "Nombre del cliente" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, qty: { type: "number" }, price: { type: "number" } },
            required: ["name", "qty", "price"],
          },
        },
        currency: { type: "string" },
        payment: { type: "string", description: "Medio de pago, ej. Mercado Pago" },
      },
      required: ["store", "items"],
    },
  },
  {
    name: "render_chart",
    description: "Genera un gráfico de barras de ventas como imagen y devuelve image_url y total. Body: title, subtitle, currency, points [{label, value}].",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        subtitle: { type: "string" },
        currency: { type: "string" },
        points: {
          type: "array",
          items: { type: "object", properties: { label: { type: "string" }, value: { type: "number" } }, required: ["label", "value"] },
        },
      },
      required: ["title", "points"],
    },
  },
];
