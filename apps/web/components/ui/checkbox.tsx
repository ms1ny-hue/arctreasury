"use client";

/**
 * Checkbox primitive (Radix), skinned to the ArcTreasury token system.
 *
 * This control gates a real on-chain settlement, so it gets a proper hit area,
 * a visible focus ring, and a label association rather than a bare native input.
 */

import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import type { ReactNode } from "react";

interface ApprovalCheckboxProps {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
}

export function ApprovalCheckbox({
  id,
  checked,
  onCheckedChange,
  disabled = false,
  children,
}: ApprovalCheckboxProps) {
  return (
    <div className="appr-row">
      <CheckboxPrimitive.Root
        id={id}
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        disabled={disabled}
        className="appr-box"
      >
        <CheckboxPrimitive.Indicator className="appr-ind">
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
            <path
              d="M2.5 8.4l3.3 3.3 7.7-7.7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      <label htmlFor={id} className="appr-label">
        {children}
      </label>
    </div>
  );
}
