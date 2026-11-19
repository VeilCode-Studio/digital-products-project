// Loading states for the workspace (app/admin/(workspace)/**/loading.tsx). Each one reuses the real
// page's containers and shows its real heading, so the frame, the title and the shape of the data
// arrive at once and nothing jumps when the content swaps in.

/** One placeholder shape. Width and height are CSS lengths. */
export function Bone({ w = "100%", h = 12, r, className = "" }: { w?: string | number; h?: string | number; r?: number; className?: string }) {
  return <span className={`sk ${className}`} style={{ width: w, height: h, borderRadius: r }} aria-hidden="true" />;
}

function Busy({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="sk-page" aria-busy="true" aria-live="polite"><span className="sr-only">{label}</span>{children}</div>;
}

export function SkHeading({ eyebrow, title, text, actions = 0 }: { eyebrow?: string; title: string; text: string; actions?: number }) {
  return <div className="admin-page-heading">
    <div>{eyebrow ? <span className="eyebrow">{eyebrow}</span> : <Bone w={170} h={11} />}<h1>{title}</h1><p>{text}</p></div>
    {actions > 0 && <div className="admin-heading-actions">{Array.from({ length: actions }, (_, index) => <Bone key={index} w={index ? 120 : 150} h={42} r={12} />)}</div>}
  </div>;
}

function PanelHead({ title, meta = true }: { title: string; meta?: boolean }) {
  return <div className="panel-heading"><h2>{title}</h2>{meta && <Bone w={90} h={12} />}</div>;
}

/** Rows shaped like the orders table: who and what, amount, status pill, date, and an optional action. */
export function SkOrderRows({ rows = 6, actions = false }: { rows?: number; actions?: boolean }) {
  return <div className="table-scroll"><table className="orders-table sk-table"><thead><tr><th>Customer / product</th><th>Amount</th><th>Delivery</th><th>Date</th>{actions && <th>Support</th>}</tr></thead>
    <tbody>{Array.from({ length: rows }, (_, index) => <tr key={index}>
      <td><Bone w={`${62 - (index % 3) * 9}%`} h={13} /><Bone w={`${44 - (index % 2) * 10}%`} h={10} className="sk-gap" /></td>
      <td><Bone w={58} h={13} /></td>
      <td><Bone w={78} h={24} r={99} /></td>
      <td><Bone w={84} h={12} /></td>
      {actions && <td><Bone w={96} h={30} r={10} /></td>}
    </tr>)}</tbody></table></div>;
}

/** Rows shaped like the product and store lists: cover, name and tagline, price, status, two buttons. */
export function SkCatalogRows({ rows = 4 }: { rows?: number }) {
  return <div className="catalog-list">{Array.from({ length: rows }, (_, index) => <div className="catalog-row" key={index}>
    <Bone w={48} h={48} r={12} className="catalog-icon" />
    <div className="catalog-name"><Bone w={`${70 - (index % 3) * 12}%`} h={14} /><Bone w={`${52 - (index % 2) * 14}%`} h={11} className="sk-gap" /></div>
    <Bone w={64} h={14} className="catalog-price" />
    <Bone w={74} h={24} r={99} />
    <div className="catalog-actions"><Bone w={70} h={34} r={10} /><Bone w={70} h={34} r={10} /></div>
  </div>)}</div>;
}

export function SkDashboard() {
  return <Busy label="Loading your overview"><div className="dash">
    <SkHeading title="Good to see you." text="Here’s how the studio is doing." actions={2} />
    <div className="dash-grid">
      <section className="dash-sales sk-dark">
        <div className="dash-sales-top"><div><Bone w={90} h={12} /><Bone w={190} h={38} className="sk-gap-lg" /><Bone w={220} h={11} className="sk-gap" /></div><div className="dash-sales-period"><Bone w={70} h={11} /><Bone w={90} h={18} className="sk-gap" /></div></div>
        <div className="dash-chart sk-bars">{[38, 52, 30, 64, 48, 72, 44, 58, 36, 80, 62, 50, 70, 88].map((height, index) => <Bone key={index} h={`${height}%`} r={6} />)}</div>
        <div className="dash-chart-axis"><Bone w={44} h={10} /><Bone w={36} h={10} /></div>
      </section>
      <div className="dash-stats">{["Orders", "Live products", "Needs attention"].map((label) => <div className="dash-stat sk-stat" key={label}>
        <Bone w={40} h={40} r={12} /><div><span>{label}</span><Bone w={64} h={26} className="sk-gap" /></div>
      </div>)}</div>
    </div>
    <div className="dash-lower">
      <section className="workspace-panel"><PanelHead title="Recent orders" /><SkOrderRows rows={5} /></section>
      <div className="dash-actions sk-dark"><h2>Quick actions</h2>{Array.from({ length: 4 }, (_, index) => <div className="sk-action" key={index}><Bone w={38} h={38} r={12} /><span><Bone w="70%" h={13} /><Bone w="88%" h={10} className="sk-gap" /></span></div>)}</div>
    </div>
  </div></Busy>;
}

export function SkOrders() {
  return <Busy label="Loading orders">
    <SkHeading eyebrow="FROM YOUR STUDIO TO THEIR INBOX" title="Orders" text="Your latest 100 purchases and their delivery status." actions={1} />
    <section className="workspace-panel"><PanelHead title="Purchase history" /><SkOrderRows rows={8} actions /></section>
    <section className="workspace-panel"><PanelHead title="Abandoned checkouts" /><div className="abandoned-list">{Array.from({ length: 2 }, (_, index) => <div className="sk-line-row" key={index}><Bone w="38%" h={13} /><Bone w={70} h={13} /><Bone w={110} h={32} r={10} /></div>)}</div></section>
  </Busy>;
}

export function SkCatalog({ kind }: { kind: "digital" | "physical" }) {
  const digital = kind === "digital";
  return <Busy label={digital ? "Loading digital products" : "Loading physical stores"}>
    <SkHeading eyebrow={digital ? "YOUR SHELF" : "ONE PRODUCT, ONE STORE"} title={digital ? "Digital products" : "Physical stores"}
      text={digital ? "Guides, templates and downloads, delivered by email the moment someone pays." : "Single-product stores for items shipped from your supplier."} actions={1} />
    <section className="workspace-panel"><PanelHead title={digital ? "Your downloads" : "Your stores"} /><SkCatalogRows rows={4} /></section>
  </Busy>;
}

export function SkFulfilment() {
  return <Busy label="Loading fulfilment">
    <SkHeading eyebrow="FROM SUPPLIER TO DOORSTEP" title="Fulfilment" text="Order each item from its supplier, add tracking, and we’ll keep the customer updated." />
    <div className="fulfil-tabs sk-tabs">{[110, 80, 80, 90, 96].map((width, index) => <Bone key={index} w={width} h={38} r={12} />)}</div>
    {Array.from({ length: 3 }, (_, index) => <section className="workspace-panel sk-card" key={index}>
      <div className="sk-card-top"><Bone w={72} h={72} r={14} /><div className="sk-grow"><Bone w="46%" h={15} /><Bone w="30%" h={11} className="sk-gap" /><Bone w="60%" h={11} className="sk-gap" /></div><Bone w={86} h={24} r={99} /></div>
      <div className="sk-card-foot"><Bone w="24%" h={36} r={10} /><Bone w="24%" h={36} r={10} /><Bone w={140} h={38} r={12} /></div>
    </section>)}
  </Busy>;
}

export function SkResearch() {
  return <Busy label="Loading research">
    <SkHeading eyebrow="FIND THE NEXT WINNER" title="Product research" text="Spot what’s selling, check the numbers, then turn it into a store." />
    <div className="sk-tabs"><Bone w={120} h={38} r={12} /><Bone w={120} h={38} r={12} /></div>
    <Bone h={52} r={14} className="sk-gap-lg" />
    <div className="sk-filters">{Array.from({ length: 4 }, (_, index) => <Bone key={index} w={130} h={36} r={10} />)}</div>
    <div className="sk-grid">{Array.from({ length: 6 }, (_, index) => <section className="workspace-panel sk-tile" key={index}><Bone h={150} r={14} /><Bone w="72%" h={14} className="sk-gap-lg" /><Bone w="46%" h={11} className="sk-gap" /><div className="sk-tile-foot"><Bone w={70} h={22} r={99} /><Bone w={56} h={14} /></div></section>)}</div>
  </Busy>;
}

export function SkConnections() {
  return <Busy label="Loading connections">
    <SkHeading eyebrow="YOUR ASSISTANTS" title="Connections" text="Let Claude, ChatGPT, Codex and Claude Code read the store, research products and build drafts." />
    <section className="workspace-panel sk-pad"><Bone w={180} h={16} /><div className="sk-tabs sk-gap-lg">{Array.from({ length: 4 }, (_, index) => <Bone key={index} w={104} h={36} r={10} />)}</div>{Array.from({ length: 3 }, (_, index) => <Bone key={index} w={`${86 - index * 12}%`} h={12} className="sk-gap-lg" />)}</section>
    <section className="workspace-panel"><PanelHead title="Connected assistants" />{Array.from({ length: 3 }, (_, index) => <div className="sk-line-row" key={index}><Bone w={40} h={40} r={12} /><div className="sk-grow"><Bone w="34%" h={13} /><Bone w="52%" h={10} className="sk-gap" /></div><Bone w={92} h={32} r={10} /></div>)}</section>
  </Busy>;
}

function SkFormPanel({ fields }: { fields: number }) {
  return <section className="workspace-panel form-panel"><div className="sk-row"><Bone w={28} h={28} r={99} /><Bone w={180} h={16} /></div>
    {Array.from({ length: fields }, (_, index) => <div className="sk-field" key={index}><Bone w={110} h={11} /><Bone h={index === fields - 1 ? 90 : 44} r={10} className="sk-gap" /></div>)}</section>;
}

export function SkSettings() {
  return <Busy label="Loading store settings">
    <SkHeading eyebrow="MAKE YOURSELF AT HOME" title="Store settings" text="A few details that make this space yours." />
    <SkFormPanel fields={4} /><SkFormPanel fields={2} />
  </Busy>;
}

export function SkEditor() {
  return <Busy label="Loading the editor">
    <Bone w={150} h={14} className="sk-back" />
    <div className="admin-page-heading"><div><Bone w={160} h={11} /><Bone w={260} h={36} className="sk-gap-lg" /><Bone w={210} h={12} className="sk-gap" /></div><div className="admin-heading-actions"><Bone w={130} h={42} r={12} /></div></div>
    <div className="product-editor"><div className="editor-main"><SkFormPanel fields={4} /><SkFormPanel fields={3} /></div><aside className="editor-aside"><section className="workspace-panel sk-pad"><Bone w="60%" h={14} /><Bone h={180} r={14} className="sk-gap-lg" /><Bone h={44} r={12} className="sk-gap-lg" /></section></aside></div>
  </Busy>;
}

export function SkAnalytics() {
  return <Busy label="Loading analytics">
    <SkHeading eyebrow="HOW THE STORE IS DOING" title="Analytics" text="Sales over time, what sells, and where shoppers drop off." actions={1} />
    <div className="an-filters sk-filters">{[230, 150, 190].map((width, index) => <Bone key={index} w={width} h={40} r={12} />)}</div>
    <div className="an-kpis">{Array.from({ length: 4 }, (_, index) => <div className="an-kpi" key={index}><Bone w={90} h={11} /><Bone w={130} h={30} className="sk-gap-lg" /><Bone w={110} h={11} className="sk-gap" /></div>)}</div>
    <section className="workspace-panel an-trend"><PanelHead title="Sales trend" /><div className="an-chart-wrap"><div className="sk-area" /></div></section>
    <div className="an-split">{["Top products", "Checkout funnel"].map((title) => <section className="workspace-panel" key={title}><PanelHead title={title} meta={false} /><div className="sk-pad">{Array.from({ length: 4 }, (_, index) => <div className="sk-bar-row" key={index}><Bone w={`${36 - index * 4}%`} h={12} /><Bone w={`${84 - index * 16}%`} h={10} r={99} /></div>)}</div></section>)}</div>
  </Busy>;
}

export function SkLinks() {
  return <Busy label="Loading short links">
    <SkHeading eyebrow="LINKS PEOPLE CAN TYPE" title="Short links" text="Readable links for videos and captions, with the clicks and sales each one brings in." />
    <section className="workspace-panel form-panel"><Bone w={170} h={16} /><Bone w="52%" h={11} className="sk-gap" />
      <div className="sl-grid sk-gap-lg">{[0, 1, 2, 3].map((index) => <div className={`sk-field${index < 2 ? " sl-wide" : ""}`} key={index}><Bone w={80} h={11} /><Bone h={42} r={10} className="sk-gap" /></div>)}</div>
      <Bone w={190} h={42} r={12} className="sk-gap-lg" /></section>
    <section className="workspace-panel"><div className="panel-heading"><h2>Your links</h2><Bone w={160} h={12} /></div>
      {Array.from({ length: 4 }, (_, index) => <div className="sk-line-row" key={index}><div className="sk-grow"><Bone w="44%" h={14} /><Bone w="28%" h={10} className="sk-gap" /></div><Bone w={170} h={34} r={10} /><Bone w={50} h={14} /><Bone w={60} h={14} /><Bone w={76} h={32} r={10} /></div>)}</section>
  </Busy>;
}

export function SkDiscounts() {
  return <Busy label="Loading discount codes">
    <SkHeading eyebrow="A REASON TO BUY TODAY" title="Discount codes" text="Codes shoppers type at checkout, like TIKTOK10, and the sales each one brings in." />
    <section className="workspace-panel form-panel"><Bone w={170} h={16} /><Bone w="52%" h={11} className="sk-gap" />
      <div className="sl-grid sk-gap-lg">{[0, 1, 2, 3, 4, 5].map((index) => <div className="sk-field" key={index}><Bone w={80} h={11} /><Bone h={42} r={10} className="sk-gap" /></div>)}</div>
      <Bone w={190} h={42} r={12} className="sk-gap-lg" /></section>
    <section className="workspace-panel"><div className="panel-heading"><h2>Your codes</h2><Bone w={160} h={12} /></div>
      {Array.from({ length: 3 }, (_, index) => <div className="sk-line-row" key={index}><div className="sk-grow"><Bone w="30%" h={14} /><Bone w="22%" h={10} className="sk-gap" /></div><Bone w={90} h={14} /><Bone w={60} h={14} /><Bone w={70} h={14} /><Bone w={76} h={32} r={10} /></div>)}</section>
  </Busy>;
}

/** Any other workspace page: a heading and a panel of rows. */
export function SkGeneric() {
  return <Busy label="Loading your workspace">
    <div className="admin-page-heading"><div><Bone w={140} h={11} /><Bone w={240} h={36} className="sk-gap-lg" /><Bone w={320} h={12} className="sk-gap" /></div></div>
    <section className="workspace-panel"><div className="panel-heading"><Bone w={160} h={16} /><Bone w={80} h={12} /></div><SkCatalogRows rows={4} /></section>
  </Busy>;
}
