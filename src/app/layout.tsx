import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/ui/ThemeProvider";
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
  title: "KaufNest Dashboard",
  description: "Business bookkeeping dashboard for multi-platform sales in Germany",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      {/* Blocking script: set data-theme before first paint to avoid flash */}
      <head>
        <script
          // verifier:allow dangerous-html — static literal, no interpolation
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('kaufnest-theme');document.documentElement.setAttribute('data-theme',t||'dark')}catch(e){}})()`,
          }}
        />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
