"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { TrendPoint } from "@/lib/analytics";
import { formatMoney } from "@/lib/store-config";

const PAD = { top: 16, right: 12, bottom: 30, left: 56 };

/** Sales over the period, with the previous period dashed behind it. Revenue or orders, one at a time. */
export function TrendChart({ points, currency, granularity }: { points: TrendPoint[]; currency: string; granularity: "day" | "week" | "month" }) {
  const [metric, setMetric] = useState<"revenue" | "orders">("revenue");
  const [hover, setHover] = useState<number | null>(null);
  const gradient = useId();
  // Drawn at the box's real size, so text and lines keep their proportions at any width.
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 760, h: 280 });
  useEffect(() => {
    const node = wrap.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ w: Math.round(width), h: Math.round(height) });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const W = size.w, H = size.h;
  const value = (point: TrendPoint) => (metric === "revenue" ? point.revenue : point.orders);
  const before = (point: TrendPoint) => (metric === "revenue" ? point.previousRevenue : point.previousOrders);
  const peak = Math.max(1, ...points.map(value), ...points.map(before));
  const step = niceStep(peak / 4);
  const top = Math.ceil(peak / step) * step;
  const innerW = W - PAD.left - PAD.right, innerH = H - PAD.top - PAD.bottom;
  const x = (index: number) => PAD.left + (points.length > 1 ? (index / (points.length - 1)) * innerW : innerW / 2);
  const y = (amount: number) => PAD.top + innerH - (amount / top) * innerH;
  const line = (pick: (point: TrendPoint) => number) => points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(pick(point)).toFixed(1)}`).join("");
  const area = `${line(value)}L${x(points.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
  const format = (amount: number) => (metric === "revenue" ? formatMoney(amount, currency) : amount.toLocaleString("en-US"));
  const short = (amount: number) => (metric === "revenue" ? compactMoney(amount, currency) : amount.toLocaleString("en-US"));
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(innerW / 90))));
  const active = hover !== null ? points[hover] : null;
  const unit = granularity === "day" ? "day" : granularity === "week" ? "week of" : "month";

  return <div className="an-chart">
    <div className="an-chart-head">
      <div className="an-segment" role="radiogroup" aria-label="Chart metric">
        {(["revenue", "orders"] as const).map((key) => <button key={key} type="button" role="radio" aria-checked={metric === key} className={metric === key ? "active" : ""} onClick={() => setMetric(key)}>{key === "revenue" ? "Revenue" : "Orders"}</button>)}
      </div>
      <div className="an-legend" aria-hidden="true"><span><i className="an-key-now" />This period</span><span><i className="an-key-prev" />Previous period</span></div>
    </div>
    <div className="an-chart-wrap" ref={wrap} onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${metric === "revenue" ? "Revenue" : "Orders"} per ${granularity}`}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const position = ((event.clientX - box.left) / box.width) * W;
          const index = Math.round(((position - PAD.left) / innerW) * (points.length - 1));
          setHover(Math.min(points.length - 1, Math.max(0, index)));
        }}>
        <defs><linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#2b59ff" stopOpacity=".28" /><stop offset="100%" stopColor="#2b59ff" stopOpacity="0" /></linearGradient></defs>
        {Array.from({ length: Math.round(top / step) + 1 }, (_, index) => index * step).map((tick) => <g key={tick}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(tick)} y2={y(tick)} className="an-grid" />
          <text x={PAD.left - 10} y={y(tick)} dy="0.32em" textAnchor="end" className="an-axis">{short(tick)}</text>
        </g>)}
        {points.map((point, index) => (index % labelEvery === 0 || index === points.length - 1) && (index === points.length - 1 || points.length - 1 - index >= labelEvery / 2) &&
          <text key={point.key} x={x(index)} y={H - 8} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"} className="an-axis">{point.label}</text>)}
        <path d={line(before)} className="an-line-prev" />
        <path d={area} fill={`url(#${gradient})`} />
        <path d={line(value)} className="an-line" />
        {active && hover !== null && <g>
          <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={y(0)} className="an-cursor" />
          <circle cx={x(hover)} cy={y(before(active))} r="3.5" className="an-dot-prev" />
          <circle cx={x(hover)} cy={y(value(active))} r="5" className="an-dot" />
        </g>}
      </svg>
      {active && hover !== null && <div className="an-tooltip" style={{ left: `${(x(hover) / W) * 100}%` }} role="status">
        <span>{granularity === "day" ? active.label : `${unit} ${active.label}`}</span>
        <strong>{format(value(active))}</strong>
        <small>Previous: {format(before(active))}</small>
      </div>}
    </div>
    <table className="an-sr"><caption>{metric === "revenue" ? "Revenue" : "Orders"} per {granularity}</caption><thead><tr><th>Period</th><th>This period</th><th>Previous period</th></tr></thead>
      <tbody>{points.map((point) => <tr key={point.key}><td>{point.label}</td><td>{format(value(point))}</td><td>{format(before(point))}</td></tr>)}</tbody></table>
  </div>;
}

function niceStep(raw: number) {
  const power = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  const scaled = raw / power;
  return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10) * power;
}

function compactMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(amount / 100);
}
