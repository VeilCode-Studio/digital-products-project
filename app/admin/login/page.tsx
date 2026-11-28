import { redirect } from "next/navigation";
import { ownerUser } from "@/lib/auth";
import { Brand } from "@/components/store";
import { LoginForm } from "@/components/login-form";
import Link from "next/link";
import { onboardingEnabled } from "@/lib/onboarding-mode";

export const dynamic = "force-dynamic";
/** Only the studio's own pages may follow a sign-in: the admin, an assistant asking to connect, or a store preview. */
function safeNext(value: string | string[] | undefined) {
  const next = Array.isArray(value) ? value[0] : value;
  return next && /^\/(admin|oauth\/authorize|s\/[a-z0-9-]+|shops\/[0-9a-f-]{36}(?:\/[ps]\/[a-z0-9-]+)?)(?:[/?#]|$)/.test(next) && !next.startsWith("//") && !/[\\\u0000-\u001f]/.test(next) ? next : "/admin";
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const next = safeNext((await searchParams).next);
  if (await ownerUser()) redirect(next);
  return <main className="login-page"><div className="login-panel"><Brand /><div className="login-heading"><span className="eyebrow">THE SPACE BEHIND YOUR STORE</span><h1>Welcome<br /> to your studio.</h1><p>Your products, your customers, your next good idea.</p></div><LoginForm next={next} /><p className="login-footnote"><Link href="/auth/recover">Forgot your password?</Link>{onboardingEnabled() && <> ? <Link href="/auth/signup">Create a workspace</Link></>}</p></div><aside className="login-art" aria-hidden="true"><span>PODSTORE / WORKSPACE</span><div><p>Make something<br />worth sharing.</p><span>We&apos;ll take care of the handoff.</span></div><span>GOOD SYSTEMS. BETTER WORK.</span></aside></main>;
}
