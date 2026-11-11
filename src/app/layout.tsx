import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Manrope } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";
import { AppChrome } from "@/components/layout/AppChrome";
import { AuthProvider } from "@/contexts/AuthContext";
import { AuthGate } from "@/components/auth/AuthGate";
import { PricingRulesBootstrap } from "@/components/pricing/PricingRulesBootstrap";

// The CSS variables here are the ones globals.css consumes: `--font-inter` for
// body text and `--font-manrope` for display headings. Naming them after the
// font (rather than `--font-sans`) keeps the Tailwind token from referencing
// itself, which made `font-sans` resolve to nothing.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

const manrope = Manrope({ subsets: ['latin'], variable: '--font-manrope' });

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

/**
 * Applies the theme before content paints. The palettes live in :root (light)
 * and .dark in globals.css; the app previously forced `dark` on <html>, so the
 * light palette could never be reached and every dark: utility was the only
 * branch rendered. Follow the OS preference instead.
 */
const themeScript = `(function(){try{var dark=window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',dark);}catch(e){document.documentElement.classList.add('dark');}})();`;

/**
 * Dev-only sidecar token handoff. The browser dev server has no desktop shell to
 * inject `window.__WPPCONNECT_SECRET__`, and the token must never become a
 * NEXT_PUBLIC value (Next inlines those into the shipped bundle, WA-9). Read it
 * from the server environment at request time; production renders nothing here.
 */
const devSidecarScript =
  process.env.NODE_ENV === "development" && process.env.WPPCONNECT_SECRET
    ? `window.__WPPCONNECT_SECRET__=${JSON.stringify(process.env.WPPCONNECT_SECRET)};`
    : "";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
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
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${manrope.variable}`}>
      <body
        className={`${inter.variable} ${manrope.variable} ${jetbrainsMono.variable} antialiased flex h-screen w-full overflow-hidden bg-background`}
      >
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {devSidecarScript ? (
          <script dangerouslySetInnerHTML={{ __html: devSidecarScript }} />
        ) : null}
        <AuthProvider>
          <AuthGate>
            <PricingRulesBootstrap />
            <AppChrome>
              {children}
            </AppChrome>
            <Toaster position="top-right" richColors closeButton />
          </AuthGate>
        </AuthProvider>
      </body>
    </html>
  );
}


