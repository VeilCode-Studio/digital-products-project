"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CopyPlus } from "lucide-react";
import { toast } from "sonner";

/** Copies a store into a new draft (page, variants, shipping, media) and opens it in the editor. */
export function DuplicateStoreButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return <button type="button" className="button secondary small" disabled={pending} aria-label={`Duplicate ${name}`} onClick={async () => {
    setPending(true);
    try {
      const response = await fetch("/api/admin/stores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "duplicate", id }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Couldn't duplicate the store. Please try again.");
      toast.success("Store duplicated", { description: `Your copy is a draft at /s/${result.slug}.` });
      router.push(`/admin/products/${result.id}#product`);
    } catch (cause) {
      toast.error((cause as Error).message);
      setPending(false);
    }
  }}><CopyPlus size={14} aria-hidden />{pending ? "Copying…" : "Duplicate"}</button>;
}
