import "./globals.css";
import type { ReactNode } from "react";
import { Space_Grotesk, IBM_Plex_Mono } from "next/font/google";

const display = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata = {
  title: "ArcTreasury — Settlement-liquidity assurance for stablecoin payments",
  description:
    "Know whether every critical payout is covered before settlement time. ArcTreasury forecasts stressed liquidity, recommends the smallest safe funding action, independently verifies settlement coverage with correct arrival timing, and requires human approval before USDC moves on Arc.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${mono.variable}`}>{children}</body>
    </html>
  );
}
