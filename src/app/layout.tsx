import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cleartrip AI Trip Workspace",
  description: "A grounded, agentic workspace for planning connected trips.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
