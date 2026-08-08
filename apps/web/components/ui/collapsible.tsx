"use client";

/**
 * Collapsible disclosure (Radix), skinned to the ArcTreasury token system.
 *
 * Wraps long, low-signal payloads (the evidence JSON bundle) so the page reads
 * cleanly on first paint while keeping the raw record one click away. Radix
 * handles aria-expanded / aria-controls and the open state.
 */

import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import { useState, type ReactNode } from "react";

interface DisclosureProps {
  /** Trigger copy shown when collapsed and expanded. */
  label: string;
  /** Optional muted hint after the label (e.g. a size or line count). */
  hint?: string;
  /** Start expanded. Defaults to collapsed. */
  defaultOpen?: boolean;
  children: ReactNode;
}

export function Disclosure({ label, hint, defaultOpen = false, children }: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <CollapsiblePrimitive.Root open={open} onOpenChange={setOpen} className="disclosure">
      <CollapsiblePrimitive.Trigger asChild>
        <button type="button" className="disclosure-trigger">
          <span aria-hidden="true" className={`disclosure-chevron ${open ? "open" : ""}`}>
            ›
          </span>
          <span>{label}</span>
          {hint ? <span className="disclosure-hint">{hint}</span> : null}
        </button>
      </CollapsiblePrimitive.Trigger>
      <CollapsiblePrimitive.Content>{children}</CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  );
}
