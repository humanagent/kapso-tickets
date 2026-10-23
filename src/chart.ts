// A bar chart for backoffice questions ("¿cómo vendimos esta semana?").
// Same rule as tickets: the model sends the numbers, the total is computed here.

export type Point = { label: string; value: number };

export type Chart = {
  title: string;
  subtitle?: string;
  currency?: string;
  points: Point[];
};

const MAX_POINTS = 14;

export function parseChart(input: unknown): Chart {
  const c = input as Partial<Chart>;
  if (!c || typeof c !== "object") throw new Error("chart must be an object");
  if (!c.title) throw new Error("title is required");
  if (!Array.isArray(c.points) || c.points.length === 0) throw new Error("points must be a non-empty array");
  if (c.points.length > MAX_POINTS) throw new Error(`at most ${MAX_POINTS} points`);
  for (const p of c.points) {
    if (!p?.label || !Number.isFinite(p.value) || p.value < 0) throw new Error(`bad point: ${JSON.stringify(p)}`);
  }
  return c as Chart;
}

export const chartTotal = (c: Chart) =>
  c.points.reduce((s, p) => s + Math.round(p.value * 100), 0) / 100;

// workers-og parses HTML but does not decode entities, so drop markup characters instead of escaping them.
const esc = (s: string) => s.replace(/[<>"]/g, "");

const num = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 0 });
const short = (n: number) =>
  n >= 1e6 ? `${num(n / 1e6)}M` : n >= 1e4 ? `${num(n / 1e3)}k` : num(n);

export const CHART_W = 600;
export const CHART_H = 530;
const PLOT_H = 220;

export function chartHtml(c: Chart): string {
  const cur = c.currency ? `${esc(c.currency)} ` : "";
  const max = Math.max(...c.points.map((p) => p.value), 1);
  const best = c.points.reduce((a, p) => (p.value > a.value ? p : a));
  const gap = c.points.length > 8 ? 6 : 12;

  const col = (inner: string) =>
    `<div style="display:flex;flex-direction:column;align-items:center;justify-content:flex-end;flex:1;height:100%;margin:0 ${gap / 2}px">${inner}</div>`;
  const bars = c.points
    .map((p) => {
      const h = Math.max(2, Math.round((p.value / max) * PLOT_H));
      const color = p === best ? "#16a34a" : "#bbb6aa";
      return col(
        `<div style="display:flex;font-size:13px;color:#57534b;margin-bottom:4px">${short(p.value)}</div>` +
          `<div style="display:flex;width:100%;height:${h}px;background:${color};border-radius:4px 4px 0 0"></div>`,
      );
    })
    .join("");
  const labels = c.points
    .map((p) => col(`<div style="display:flex;font-size:14px;color:#57534b">${esc(p.label)}</div>`))
    .join("");

  return `
<div style="display:flex;width:${CHART_W}px;height:100%;background:#e9e6df;padding:28px 36px;font-family:'Space Mono';color:#2b2a27">
  <div style="display:flex;flex-direction:column;width:100%;background:#fffdf8;border-radius:6px;padding:26px 28px;box-shadow:0 6px 18px rgba(0,0,0,0.12)">
    <div style="display:flex;font-size:24px;font-weight:700">${esc(c.title)}</div>
    ${c.subtitle ? `<div style="display:flex;font-size:15px;color:#77736a;margin-top:2px">${esc(c.subtitle)}</div>` : ""}
    <div style="display:flex;align-items:flex-end;width:100%;height:${PLOT_H + 30}px;margin-top:14px;border-bottom:2px solid #d6d1c5">${bars}</div>
    <div style="display:flex;width:100%;height:28px;margin-top:6px">${labels}</div>
    <div style="display:flex;justify-content:space-between;width:100%;margin-top:10px;font-size:20px;font-weight:700"><span>TOTAL</span><span>${cur}${num(chartTotal(c))}</span></div>
  </div>
</div>`;
}

export const exampleChart: Chart = {
  title: "Ventas de la semana",
  subtitle: "Pizzería La Esquina · 13 al 19 de oct",
  currency: "ARS",
  points: [
    { label: "Lun", value: 182000 },
    { label: "Mar", value: 156500 },
    { label: "Mié", value: 201000 },
    { label: "Jue", value: 238500 },
    { label: "Vie", value: 412000 },
    { label: "Sáb", value: 486500 },
    { label: "Dom", value: 351000 },
  ],
};
