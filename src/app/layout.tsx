import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Market Foundry · OmniMarketX", template: "%s · Market Foundry" },
  description: "Internal tool to discover, validate, review and create prediction markets for OmniMarketX.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full app-backdrop">
        {children}
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{ style: { background: "#131620", border: "1px solid #2b3143", color: "#e8eaf0" } }}
        />
      </body>
    </html>
  );
}
