import { notFound } from "next/navigation";
import { Brand } from "@/components/store";
import { AccountForm } from "@/components/account-form";
import { onboardingEnabled } from "@/lib/onboarding-mode";
export const dynamic = "force-dynamic";
export const metadata = { title: "Your workspace", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
const titles = { signup: "Your store starts here.", recover: "Reset your password.", reset: "Choose a new password.", confirm: "Verify your email." };
export default async function AccountPage({ params }: { params: Promise<{ screen: string }> }) {
  const { screen } = await params;
  if (!(screen in titles) || ((screen === "signup" || screen === "confirm") && !onboardingEnabled())) notFound();
  const mode = screen as keyof typeof titles;
  return <main className="login-page"><section className="login-panel"><Brand /><div className="login-heading"><h1>{titles[mode]}</h1><p>{mode === "signup" ? "Create your own workspace for products, customers, and payments." : "Manage access to your studio."}</p></div><AccountForm mode={mode} /></section></main>;
}
