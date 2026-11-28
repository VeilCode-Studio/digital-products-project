import { LegalPage, legalMetadata } from "@/components/site/legal-page";
import "@/app/studio.css";
export const dynamic = "force-dynamic";
export const metadata = legalMetadata("terms");
export default async function Page({ params }: { params: Promise<{ storeId: string }> }) { return <LegalPage kind="terms" storeId={(await params).storeId} />; }
