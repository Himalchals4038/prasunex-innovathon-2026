import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CAMPUS-NEXUS · Cognitive Campus OS",
  description: "A cognitive operating system for higher education campuses.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = { themeColor: "#041D18" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
