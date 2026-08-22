import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { AlertProvider } from "@/components/ui/alert-provider";
import { DocumentTitleSync } from "@/components/layout/document-title-sync";
import { documentTitle } from "@/lib/page-title";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const pathname = (await headers()).get("x-naviyra-pathname") ?? "";
  return {
    title: { absolute: documentTitle(pathname) },
    description:
      "Self-hosted control panel for domains, mail, FTP, SSL, and files",
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "any" },
        { url: "/logo.png", type: "image/png", sizes: "512x512" },
      ],
      apple: [{ url: "/logo.png", type: "image/png" }],
      shortcut: "/favicon.ico",
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex h-full min-h-full flex-col overflow-hidden">
        <AlertProvider>
          <DocumentTitleSync />
          {children}
        </AlertProvider>
      </body>
    </html>
  );
}
