import "./globals.css";
import type { Metadata } from "next";
import SWRegister from "./sw-register";

export const metadata: Metadata = {
  title: "Instant Medication Report",
  description: "Offline system-based medication report generator",
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar">
      <body className="min-h-screen bg-[rgb(var(--bg))] text-[rgb(var(--text))] antialiased">
        <SWRegister />
        {children}
      </body>
    </html>
  );
}
