import type { Metadata } from "next";
import { Space_Grotesk, Spectral } from "next/font/google";
import "./globals.css";

const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-display" });
const serif = Spectral({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-serif" });

export const metadata: Metadata = {
  title: "Costco Receipt Parser",
  description: "Upload a Costco receipt image and export itemized CSV/XLSX with tax, deposits, and discounts applied."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${serif.variable}`}>{children}</body>
    </html>
  );
}
