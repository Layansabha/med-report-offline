import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
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
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <SWRegister />
        {children}
      </body>
    </html>
  );
}
