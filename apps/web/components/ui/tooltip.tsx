"use client";

/**
 * Tooltip primitive (Radix), skinned to the ArcTreasury token system.
 *
 * Composition mirrors shadcn/ui's tooltip (Provider > Root > Trigger > Portal >
 * Content), but the styling hooks into globals.css classes instead of Tailwind
 * utilities so the existing dark treasury skin is preserved.
 *
 * Used to define treasury jargon inline without bloating the page copy.
 */

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

export const TooltipProvider = TooltipPrimitive.Provider;

interface InfoTipProps {
  /** The term being defined. Rendered as the dotted-underline trigger. */
  label: ReactNode;
  /** Plain-language definition shown on hover/focus. */
  children: ReactNode;
}

/**
 * An inline, keyboard-reachable definition. The trigger is a real <button> so
 * it is tabbable and announced; Radix wires aria-describedby to the content.
 */
export function InfoTip({ label, children }: InfoTipProps) {
  return (
    <TooltipPrimitive.Root delayDuration={120}>
      <TooltipPrimitive.Trigger asChild>
        <button type="button" className="infotip-trigger">
          {label}
          <span aria-hidden="true" className="infotip-mark">
            ?
          </span>
        </button>
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content className="infotip" sideOffset={7} collisionPadding={12}>
          {children}
          <TooltipPrimitive.Arrow className="infotip-arrow" width={11} height={5} />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
