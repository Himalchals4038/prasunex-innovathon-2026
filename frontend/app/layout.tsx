import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CAMPUS-NEXUS · Cognitive Campus OS",
  description: "A cognitive operating system for higher education campuses.",
  manifest: "/manifest.webmanifest",
  themeColor: "#173e32",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
