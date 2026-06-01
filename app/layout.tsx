import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "ContractHunter",
  description:
    "Personal dashboard for high-quality government contract opportunities.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full font-sans antialiased">{children}</body>
    </html>
  );
}
