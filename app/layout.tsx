import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "VeroSTR",
    template: "%s | VeroSTR",
  },
  description: "STR owner analytics and PM accountability platform.",
  openGraph: {
    title: "VeroSTR",
    description: "STR owner analytics and PM accountability platform.",
    url: "https://verostr.com",
    siteName: "VeroSTR",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "VeroSTR",
    description: "STR owner analytics and PM accountability platform.",
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};

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
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
