import "server-only";
import { STORE_ID } from "../store-config";
import { getSupabase } from "../supabase";
import type { McpActivity } from "../database.types";

// The owner's log of what assistants did (/admin/connections). A failed write here never fails the tool.

export async function logActivity(connectionId: string, tool: string, summary: string, ok: boolean) {
  try {
    await getSupabase().from("mcp_activity").insert({ connection_id: connectionId, tool: tool.slice(0, 80), summary: summary.replace(/\s+/g, " ").trim().slice(0, 300), ok });
  } catch { /* the log is best effort */ }
}

export async function recentActivity(limit = 60, storeId = STORE_ID) {
  const { data: connections, error: connectionError } = await getSupabase().from("mcp_connections").select("id").eq("store_id", storeId);
  if (connectionError) throw new Error("Could not load assistant connections");
  if (!connections?.length) return [];
  const { data, error } = await getSupabase().from("mcp_activity").select("*").in("connection_id", connections.map(c => c.id)).order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error("Could not load assistant activity");
  return (data ?? []) as McpActivity[];
}
