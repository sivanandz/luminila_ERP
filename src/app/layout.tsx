import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";
import { Sidebar, MobileBottomNav } from "@/components/layout";
import { AuthProvider } from "@/contexts/AuthContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { WhatsAppDrawer } from "@/components/whatsapp/WhatsAppDrawer";

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#001F3F",
};

export const metadata: Metadata = {
  title: "Luminila - Inventory Manager",
  description: "Premium fashion jewelry inventory management system with multi-channel sync",
  keywords: ["inventory", "jewelry", "pos", "shopify", "whatsapp"],
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Luminila",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={`dark ${inter.variable}`}>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased flex h-screen w-full overflow-hidden bg-background`}
      >
        <AuthProvider>
          <Sidebar />
          <main className="flex-1 flex flex-col h-full min-w-0 overflow-hidden relative pb-16 md:pb-0">
            <ErrorBoundary>
              {children}
            </ErrorBoundary>
          </main>
          <MobileBottomNav />
          <WhatsAppDrawer />
          <Toaster position="top-right" richColors closeButton />
        </AuthProvider>
      </body>
    </html>
  );
}


