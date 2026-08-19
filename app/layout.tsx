import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Capitol Ledger — US political trading disclosures",
  description:
    "Live dashboard of stocks, ETFs, bonds, funds, options and crypto disclosed by US politicians and executive-branch officials, with per-filer profiles, per-asset history and portfolio-size rankings. Auto-refreshes every 30 seconds.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#0b1220] text-gray-100 antialiased">{children}</body>
    </html>
  );
}
