"use client";

/**
 * Alert and status-announcement primitives.
 *
 * Alert covers the previously-silent failure path: the execute route can return
 * a bare { error } with no `mode`, which the old UI rendered as an empty
 * paragraph. Errors now surface visibly and are announced via role="alert".
 *
 * LiveRegion announces async progress (settling, verifying) to assistive tech,
 * which otherwise gets silence during the one irreversible action on the page.
 */

import type { ReactNode } from "react";

type AlertTone = "error" | "warn" | "good";

interface AlertProps {
  tone?: AlertTone;
  title: string;
  children?: ReactNode;
}

const TONE_CLASS: Record<AlertTone, string> = {
  error: "bad",
  warn: "warn",
  good: "good",
};

export function Alert({ tone = "error", title, children }: AlertProps) {
  return (
    <div className={`callout ${TONE_CLASS[tone]}`} role="alert">
      <strong>{title}</strong>
      {children ? <> {children}</> : null}
    </div>
  );
}

interface LiveRegionProps {
  /** Message to announce. Empty string announces nothing. */
  message: string;
}

/**
 * Visually hidden polite live region. Kept mounted at all times — a region that
 * mounts alongside its message is frequently missed by screen readers.
 */
export function LiveRegion({ message }: LiveRegionProps) {
  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </div>
  );
}
