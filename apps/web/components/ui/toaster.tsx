"use client";

/**
 * Toast host (sonner), themed to the ArcTreasury token system.
 *
 * Covers actions that previously gave no feedback at all — notably the evidence
 * download, which silently triggered a browser save with no confirmation.
 */

import { Toaster as Sonner } from "sonner";

export { toast } from "sonner";

export function Toaster() {
  return (
    <Sonner
      theme="dark"
      position="bottom-right"
      toastOptions={{
        style: {
          background: "rgba(8, 13, 26, 0.94)",
          border: "1px solid var(--line-2)",
          color: "var(--ink)",
          fontFamily: "var(--mono)",
          fontSize: "12.5px",
          backdropFilter: "blur(12px)",
        },
      }}
    />
  );
}
