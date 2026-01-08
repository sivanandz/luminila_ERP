import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Manrope } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/layout";
import { AuthProvider } from "@/contexts/AuthContext";

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });



const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Luminila - Inventory Manager",
  description: "Premium fashion jewelry inventory management system with multi-channel sync",
  keywords: ["inventory", "jewelry", "pos", "shopify", "whatsapp"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={`dark ${inter.variable}`}>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} ${manrope.variable} antialiased flex h-screen w-full overflow-hidden bg-background`}
      >
        <AuthProvider>
          <Sidebar />
          <main className="flex-1 flex flex-col h-full min-w-0 overflow-hidden relative">
            {children}
          </main>
        </AuthProvider>
      </body>
    </html>
  );
}


