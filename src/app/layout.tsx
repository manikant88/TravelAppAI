import type { Metadata } from "next";
import "@fontsource/lato/latin-400.css";
import "@fontsource/lato/latin-400-italic.css";
import "@fontsource/lato/latin-700.css";
import "@fontsource/lato/latin-700-italic.css";
import "@fontsource/lato/latin-900.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "MakeMyTrip AI Trip Planner",
  description: "A grounded, conversational workspace for planning connected trips.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
