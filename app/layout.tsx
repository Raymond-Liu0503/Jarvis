import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Jarvis Research", description: "A private research workspace for markets, travel, and shopping." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
