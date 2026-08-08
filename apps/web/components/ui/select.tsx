"use client";

/**
 * Select primitive (Radix), skinned to the ArcTreasury token system.
 *
 * Replaces the native <select> so the control matches the dark skin and gets
 * consistent keyboard behaviour (type-ahead, arrow navigation, Home/End) across
 * browsers. Radix renders a hidden native select for form semantics.
 */

import * as SelectPrimitive from "@radix-ui/react-select";

export interface SelectChoice {
  value: string;
  label: string;
}

interface ScenarioSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  choices: readonly SelectChoice[];
  disabled?: boolean;
  /** Accessible name; there is no visible <label> next to this control. */
  ariaLabel: string;
}

export function ScenarioSelect({
  value,
  onValueChange,
  choices,
  disabled = false,
  ariaLabel,
}: ScenarioSelectProps) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectPrimitive.Trigger className="sel-trigger" aria-label={ariaLabel}>
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon asChild>
          <span aria-hidden="true" className="sel-caret">
            ▾
          </span>
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content className="sel-content" position="popper" sideOffset={6}>
          <SelectPrimitive.Viewport>
            {choices.map((c) => (
              <SelectPrimitive.Item key={c.value} value={c.value} className="sel-item">
                <SelectPrimitive.ItemText>{c.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="sel-ind">✓</SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
