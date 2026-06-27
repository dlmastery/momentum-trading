import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SimpleTrade — Momentum ETF Backtester",
  description:
    "Backtest a daily end-of-day momentum strategy across ETF constituents.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
