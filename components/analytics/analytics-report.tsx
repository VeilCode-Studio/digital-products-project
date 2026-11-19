import { ArrowDownRight, ArrowUpRight, Minus, ShoppingBag } from "lucide-react";
import type { Analytics, Metric } from "@/lib/analytics";
import { formatMoney } from "@/lib/store-config";
import { TrendChart } from "./trend-chart";

const percent = (value: number | null, digits = 0) => (value === null ? "—" : `${(value * 100).toFixed(digits)}%`);

function Delta({ metric, invert = false }: { metric: Metric; invert?: boolean }) {
  if (metric.change === null) return <span className="an-delta is-new">New this period</span>;
  if (Math.abs(metric.change) < 0.005) return <span className="an-delta"><Minus size={13} aria-hidden /> Same as before</span>;
  const up = metric.change > 0;
  const good = invert ? !up : up;
  return <span className={`an-delta ${good ? "is-up" : "is-down"}`}>{up ? <ArrowUpRight size={14} aria-hidden /> : <ArrowDownRight size={14} aria-hidden />}{percent(Math.abs(metric.change))} vs previous</span>;
}

function Kpi({ label, value, metric, note }: { label: string; value: string; metric: Metric; note?: string }) {
  return <div className="an-kpi"><span>{label}</span><strong>{value}</strong><Delta metric={metric} />{note && <small>{note}</small>}</div>;
}

/** The analytics page body: headline numbers, the trend, and the breakdowns below it. */
export function AnalyticsReport({ data }: { data: Analytics & { truncated?: boolean } }) {
  const money = (amount: number) => formatMoney(amount, data.currency);
  const { kpis, funnel } = data;
  const empty = kpis.orders.value === 0 && kpis.orders.previous === 0 && funnel.started === 0;
  const splitTotal = data.split.digital + data.split.physical;
  const weekdayPeak = Math.max(1, ...data.weekdays.map((day) => day.revenue));
  const bestDay = data.weekdays.reduce((best, day) => (day.revenue > best.revenue ? day : best), data.weekdays[0]);
  const funnelSteps = [
    { label: "Checkouts started", value: funnel.started },
    { label: "Paid orders", value: funnel.paid },
    { label: "Abandoned", value: funnel.abandoned },
    { label: "Recovered by link", value: funnel.recovered },
  ];
  const funnelPeak = Math.max(1, ...funnelSteps.map((step) => step.value));

  return <>
    <div className="an-kpis">
      <Kpi label="Gross revenue" value={money(kpis.revenue.value)} metric={kpis.revenue} />
      <Kpi label="Orders" value={kpis.orders.value.toLocaleString("en-US")} metric={kpis.orders} note={`${kpis.units.value.toLocaleString("en-US")} ${kpis.units.value === 1 ? "item" : "items"} sold`} />
      <Kpi label="Average order" value={money(kpis.aov.value)} metric={kpis.aov} />
      <Kpi label="Net after refunds" value={money(kpis.net.value)} metric={kpis.net} note={data.refunds.orders ? `${money(data.refunds.amount)} refunded on ${data.refunds.orders} ${data.refunds.orders === 1 ? "order" : "orders"}` : "No refunds"} />
    </div>
    {(data.otherCurrencies.length > 0 || data.truncated) && <p className="an-note">
      {data.otherCurrencies.length > 0 && <>Amounts are in {data.currency.toUpperCase()}; sales in {data.otherCurrencies.map((code) => code.toUpperCase()).join(", ")} aren&apos;t included. </>}
      {data.truncated && <>This period has more orders than one report reads, so the oldest are left out. Choose a shorter period for exact numbers.</>}
    </p>}

    <section className="workspace-panel an-trend">
      <div className="panel-heading"><div><h2>Sales trend</h2><p>By {data.granularity}, compared with the period just before.</p></div></div>
      {empty ? <div className="empty-state"><ShoppingBag size={28} /><h3>No sales in this period yet.</h3><p>Try a longer period, or clear the type and product filters.</p></div>
        : <TrendChart points={data.trend} currency={data.currency} granularity={data.granularity} />}
    </section>

    <div className="an-split">
      <section className="workspace-panel">
        <div className="panel-heading"><div><h2>Top products</h2><p>What earned the most this period.</p></div></div>
        {data.products.length ? <div className="table-scroll"><table className="an-table">
          <thead><tr><th>Product</th><th>Orders</th><th>Revenue</th><th>Share</th></tr></thead>
          <tbody>{data.products.slice(0, 8).map((product) => <tr key={product.id}>
            <td><strong>{product.name}</strong><span>{product.kind === "physical" ? `Physical · ${product.units} ${product.units === 1 ? "item" : "items"}` : "Digital"}</span></td>
            <td>{product.orders}</td>
            <td>{money(product.revenue)}</td>
            <td><span className="an-share"><i style={{ width: `${Math.max(2, product.share * 100)}%` }} /></span><small>{percent(product.share)}</small></td>
          </tr>)}</tbody>
        </table></div> : <p className="an-empty">No products sold in this period.</p>}
      </section>

      <section className="workspace-panel">
        <div className="panel-heading"><div><h2>Checkout funnel</h2><p>{funnel.conversion === null ? "No checkouts started in this period." : `${percent(funnel.conversion)} of checkouts became orders.`}</p></div></div>
        <ul className="an-bars">{funnelSteps.map((step) => <li key={step.label}>
          <span>{step.label}</span><b>{step.value.toLocaleString("en-US")}</b>
          <span className="an-bar"><i style={{ width: `${(step.value / funnelPeak) * 100}%` }} /></span>
        </li>)}</ul>
      </section>
    </div>

    <div className="an-trio">
      <section className="workspace-panel an-card">
        <h2>Digital vs physical</h2>
        <div className="an-stack" aria-hidden="true"><i className="is-digital" style={{ width: `${splitTotal ? (data.split.digital / splitTotal) * 100 : 50}%` }} /><i className="is-physical" style={{ width: `${splitTotal ? (data.split.physical / splitTotal) * 100 : 50}%` }} /></div>
        <dl className="an-dl">
          <div><dt><i className="an-dot-key is-digital" />Digital</dt><dd>{money(data.split.digital)} <small>{percent(splitTotal ? data.split.digital / splitTotal : null)}</small></dd></div>
          <div><dt><i className="an-dot-key is-physical" />Physical</dt><dd>{money(data.split.physical)} <small>{percent(splitTotal ? data.split.physical / splitTotal : null)}</small></dd></div>
        </dl>
      </section>

      <section className="workspace-panel an-card">
        <h2>Best days to sell</h2>
        <ol className="an-week" aria-label="Revenue by day of the week">{data.weekdays.map((day) => <li key={day.label} title={`${day.label}: ${money(day.revenue)}, ${day.orders} ${day.orders === 1 ? "order" : "orders"}`}>
          <span className="an-week-bar"><i data-best={day === bestDay && day.revenue > 0 ? true : undefined} style={{ height: `${Math.max(4, (day.revenue / weekdayPeak) * 100)}%` }} /></span>
          <span>{day.label}</span>
        </li>)}</ol>
        <p className="an-caption">{bestDay.revenue ? `${bestDay.label} brings in the most (${money(bestDay.revenue)}).` : "No sales yet to compare days."}</p>
      </section>

      <section className="workspace-panel an-card">
        <h2>Customers</h2>
        <dl className="an-dl">
          <div><dt>Customers</dt><dd>{data.customers.unique.toLocaleString("en-US")} <Delta metric={kpis.customers} /></dd></div>
          <div><dt>Bought more than once</dt><dd>{data.customers.repeat} <small>{percent(data.customers.repeatRate)}</small></dd></div>
          {data.fulfilment.physicalOrders > 0 && <>
            <div><dt>Physical orders shipped</dt><dd>{data.fulfilment.shipped} of {data.fulfilment.physicalOrders}</dd></div>
            <div><dt>Typical time to ship</dt><dd>{data.fulfilment.medianHoursToShip === null ? "—" : data.fulfilment.medianHoursToShip < 48 ? `${Math.round(data.fulfilment.medianHoursToShip)} hours` : `${(data.fulfilment.medianHoursToShip / 24).toFixed(1)} days`}</dd></div>
            {data.fulfilment.cancelled > 0 && <div><dt>Cancelled</dt><dd>{data.fulfilment.cancelled}</dd></div>}
          </>}
        </dl>
      </section>
    </div>

    {data.regions.length > 0 && <section className="workspace-panel">
      <div className="panel-heading"><div><h2>Where physical orders ship</h2><p>US states, or the country for orders abroad.</p></div></div>
      <ul className="an-bars an-regions">{data.regions.map((region) => <li key={region.name}>
        <span>{region.name}</span><b>{money(region.revenue)} <small>· {region.orders} {region.orders === 1 ? "order" : "orders"}</small></b>
        <span className="an-bar"><i style={{ width: `${(region.revenue / Math.max(1, data.regions[0].revenue)) * 100}%` }} /></span>
      </li>)}</ul>
    </section>}

    <p className="workspace-note">Gross amounts are what customers paid, before Stripe fees. Dates are in UTC.</p>
  </>;
}
