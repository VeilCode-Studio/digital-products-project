import type { Metadata } from "next";
import { SiteHeader } from "@/components/site/chrome";
import { findByUnsubscribeToken } from "@/lib/subscribers";
import { monaSans } from "../studio-fonts";
import "../studio.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<{ token?: string; done?: string }> };

/** The unsubscribe link in emails opens this page; the button does the unsubscribing (never the link itself). */
export default async function UnsubscribePage({ searchParams }: Props) {
  const { token, done } = await searchParams;
  const subscriber = done ? null : await findByUnsubscribeToken(token).catch(() => null);
  const already = subscriber && !subscriber.marketing_consent;
  return (
    <div className={`vc ${monaSans.variable}`}>
      <SiteHeader nav={false} />
      <main className="vc-wrap vc-unavailable">
        <p className="vc-eyebrow">PodStore emails</p>
        {done || already ? <>
          <h1 className="vc-heading">You&apos;re unsubscribed.</h1>
          <p className="vc-body">We won&apos;t send you product news or offers again. Emails about anything you buy still arrive as usual.</p>
        </> : subscriber ? <>
          <h1 className="vc-heading">Stop emails about new products and offers?</h1>
          <p className="vc-body">This stops marketing emails to {subscriber.email}. Emails about anything you buy still arrive as usual.</p>
          <form method="post" action={`/api/unsubscribe?token=${encodeURIComponent(token ?? "")}`} style={{ marginTop: 32 }}>
            <input type="hidden" name="from" value="page" />
            <button type="submit" className="vc-button">Unsubscribe</button>
          </form>
        </> : <>
          <h1 className="vc-heading">This link isn&apos;t valid.</h1>
          <p className="vc-body">It may be incomplete. Reply to any email from us and we&apos;ll take you off the list.</p>
        </>}
      </main>
    </div>
  );
}
