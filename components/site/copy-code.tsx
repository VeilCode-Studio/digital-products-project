"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** A discount code with a copy button; the code stays selectable text if copying isn't allowed. */
export function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" className="tyo-copy" onClick={() => { void navigator.clipboard?.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {}); }} aria-label={`Copy code ${code}`}>
    <code>{code}</code>{copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
    <span className="tyo-sr" aria-live="polite">{copied ? "Copied" : ""}</span>
  </button>;
}
