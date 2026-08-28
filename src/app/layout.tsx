import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MakeMyTrip AI Trip Planner",
  description: "A grounded, conversational workspace for planning connected trips.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
