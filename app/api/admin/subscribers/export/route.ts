import { requireOwner } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { csvCell } from "@/lib/csv";
import { listSubscribers } from "@/lib/subscribers";

export const runtime = "nodejs";

/** The list as a spreadsheet, with each person's consent, ready for an email tool. */
export async function GET() {
  try {
    await requireOwner();
    const { subscribers } = await listSubscribers();
    const rows: (string | number | null)[][] = [
      ["Email", "Marketing emails", "Consented at", "Consent wording", "Unsubscribed at", "Joined", "Source"],
      ...subscribers.map((entry) => [entry.email, entry.marketing_consent ? "yes" : "no", entry.consented_at, entry.consent_text, entry.unsubscribed_at, entry.created_at, entry.source]),
    ];
    const date = new Date().toISOString().slice(0, 10);
    return new Response("\ufeff" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n"), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="podstore-subscribers-${date}.csv"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) { return apiError(error); }
}
