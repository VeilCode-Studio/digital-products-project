import { LegalPage, legalMetadata } from "@/components/site/legal-page";
import "@/app/studio.css";
export const dynamic = "force-dynamic";
export const metadata = legalMetadata("refunds");
export default async function Page({ params }: { params: Promise<{ storeId: string }> }) { return <LegalPage kind="refunds" storeId={(await params).storeId} />; }
