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
  title: "ArcTreasury — Treasury platform for stablecoin businesses",
  description:
    "Treasury, bills, and cash in one place, settled in USDC on Arc. Put your finance team's rules around every dollar — who approves, how much, when money moves — size the funding each wallet needs, and prove coverage on-chain. AI analyzes, humans approve, policy executes.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${mono.variable}`}>{children}</body>
    </html>
  );
}
