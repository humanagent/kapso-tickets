// A purchase ticket ("ticket de compra") rendered as an image for WhatsApp.
// Totals are computed here, never taken from the model: an LLM that adds
// prices is the bug this service exists to avoid.

export type Item = { name: string; qty: number; price: number };

export type Ticket = {
  store: { name: string; address?: string };
  number?: string;
  date?: string;
  customer?: string;
  items: Item[];
  currency?: string;
  discount?: number; // absolute amount
  taxRate?: number; // 0.21 for 21%
  payment?: string;
  note?: string;
};

export type Totals = { subtotal: number; discount: number; tax: number; total: number };

const MAX_ITEMS = 12;

export function parseTicket(input: unknown): Ticket {
  const t = input as Partial<Ticket>;
  if (!t || typeof t !== "object") throw new Error("ticket must be an object");
  if (!t.store?.name) throw new Error("store.name is required");
  if (!Array.isArray(t.items) || t.items.length === 0) throw new Error("items must be a non-empty array");
  if (t.items.length > MAX_ITEMS) throw new Error(`at most ${MAX_ITEMS} items`);
  for (const it of t.items) {
    if (!it?.name || !Number.isFinite(it.qty) || !Number.isFinite(it.price) || it.qty <= 0 || it.price < 0) {
      throw new Error(`bad item: ${JSON.stringify(it)}`);
    }
  }
  if (t.taxRate !== undefined && !(t.taxRate >= 0 && t.taxRate < 1)) throw new Error("taxRate must be in [0, 1)");
  if (t.discount !== undefined && !(t.discount >= 0)) throw new Error("discount must be >= 0");
  return t as Ticket;
}

export function totals(t: Ticket): Totals {
  const cents = (n: number) => Math.round(n * 100);
  const subtotal = t.items.reduce((s, it) => s + cents(it.qty * it.price), 0);
  const discount = Math.min(cents(t.discount ?? 0), subtotal);
  const tax = Math.round((subtotal - discount) * (t.taxRate ?? 0));
  return {
    subtotal: subtotal / 100,
    discount: discount / 100,
    tax: tax / 100,
    total: (subtotal - discount + tax) / 100,
  };
}

// workers-og parses HTML but does not decode entities, so drop markup characters instead of escaping them.
const esc = (s: string) => s.replace(/[<>"]/g, "");

const money = (n: number, currency: string) =>
  `${currency} ${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const W = 600;
const ROW = 34;

export function ticketHeight(t: Ticket): number {
  const extras = [t.customer, t.note, t.discount, t.taxRate].filter(Boolean).length;
  return 470 + t.items.length * ROW + extras * ROW;
}

export function ticketHtml(t: Ticket): string {
  const cur = t.currency ?? "$";
  const tot = totals(t);
  const line = (l: string, r: string, style = "") =>
    `<div style="display:flex;justify-content:space-between;width:100%;height:${ROW}px;align-items:center;${style}"><span>${l}</span><span>${r}</span></div>`;
  const dash = `<div style="display:flex;width:100%;border-top:2px dashed #b9b4a8;margin:14px 0"></div>`;

  const meta = [
    t.number ? `N° ${esc(t.number)}` : "",
    t.date ? esc(t.date) : "",
  ].filter(Boolean).join("  ·  ");

  const items = t.items
    .map((it) =>
      line(
        `${it.qty} x ${esc(it.name)}`,
        money(it.qty * it.price, cur),
      ),
    )
    .join("");

  return `
<div style="display:flex;width:${W}px;height:100%;background:#e9e6df;padding:28px 36px;font-family:'Space Mono';color:#2b2a27">
  <div style="display:flex;flex-direction:column;width:100%;background:#fffdf8;border-radius:6px;padding:30px 32px;box-shadow:0 6px 18px rgba(0,0,0,0.12)">
    <div style="display:flex;flex-direction:column;align-items:center;width:100%">
      <div style="display:flex;font-size:30px;font-weight:700;letter-spacing:1px">${esc(t.store.name.toUpperCase())}</div>
      ${t.store.address ? `<div style="display:flex;font-size:16px;color:#77736a;margin-top:4px">${esc(t.store.address)}</div>` : ""}
      ${meta ? `<div style="display:flex;font-size:16px;color:#77736a;margin-top:6px">${meta}</div>` : ""}
    </div>
    ${dash}
    ${t.customer ? line("Cliente", esc(t.customer), "font-size:18px;color:#57534b") : ""}
    <div style="display:flex;flex-direction:column;width:100%;font-size:19px">${items}</div>
    ${dash}
    <div style="display:flex;flex-direction:column;width:100%;font-size:18px;color:#57534b">
      ${line("Subtotal", money(tot.subtotal, cur))}
      ${t.discount ? line("Descuento", "-" + money(tot.discount, cur)) : ""}
      ${t.taxRate ? line(`IVA ${Math.round(t.taxRate * 100)}%`, money(tot.tax, cur)) : ""}
    </div>
    ${line("TOTAL", money(tot.total, cur), "margin-top:10px;font-size:28px;font-weight:700;height:44px")}
    ${t.payment ? `<div style="display:flex;width:100%;margin-top:6px;font-size:17px;color:#57534b">Pagado con ${esc(t.payment)}</div>` : ""}
    ${dash}
    ${t.note ? `<div style="display:flex;justify-content:center;width:100%;font-size:16px;color:#77736a;margin-bottom:8px">${esc(t.note)}</div>` : ""}
    <div style="display:flex;justify-content:center;width:100%;font-size:18px;font-weight:700">gracias!</div>
  </div>
</div>`;
}

export const example: Ticket = {
  store: { name: "Café Tortoni", address: "Av. de Mayo 825, CABA" },
  number: "0042-00018734",
  date: "21/10/2026 18:42",
  items: [
    { name: "Café con leche", qty: 2, price: 4200 },
    { name: "Medialunas", qty: 3, price: 1500 },
    { name: "Submarino", qty: 1, price: 5800 },
    { name: "Tostado J&Q", qty: 1, price: 7900 },
  ],
  currency: "$",
  discount: 1500,
  taxRate: 0.21,
  payment: "Mercado Pago",
  note: "Pedido #18734 · retiro en mostrador",
};
