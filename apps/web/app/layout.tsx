import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "ArcTreasury — Settlement Liquidity Control Plane",
  description: "Non-custodial decisioning and orchestration for stablecoin settlement liquidity on Arc. AI analyzes; humans approve; deterministic policy executes.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
