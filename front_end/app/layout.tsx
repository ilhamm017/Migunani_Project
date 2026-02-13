import type { Metadata, Viewport } from "next";
import "./globals.css";
import Header from "@/components/layout/Header";
import BottomNav from "@/components/layout/BottomNav";
import AdminBottomNav from "@/components/layout/AdminBottomNav";
import WebChatWidget from "@/components/chat/WebChatWidget";
import HydrationProvider from "@/components/providers/HydrationProvider";

export const metadata: Metadata = {
  title: "Migunani Motor - Suku Cadang Motor Terpercaya",
  description: "Penyedia suku cadang motor berkualitas dengan harga terbaik di Indonesia",
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Migunani Motor',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#10b981',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" suppressHydrationWarning>
      <body className="antialiased min-h-screen bg-slate-50 pb-24 font-sans text-slate-900 select-none">
        <HydrationProvider>
          <Header />
          <main>
            {children}
          </main>
          <BottomNav />
          <AdminBottomNav />
          <WebChatWidget />
        </HydrationProvider>
      </body>
    </html>
  );
}
