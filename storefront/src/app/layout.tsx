import type { Metadata } from "next";
import { Suspense } from "react";
import { CartProvider } from "@/context/CartContext";
import { CustomerAuthProvider } from "@/context/CustomerAuthContext";
import { Header } from "@/components/Header";
import { CartDrawer } from "@/components/CartDrawer";
import { CustomerAuthModal } from "@/components/CustomerAuthModal";
import { Footer } from "@/components/Footer";
import { ThemeRuntime } from "@/components/ThemeRuntime";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
    title: "Jewellery Atelier & Fashion Boutique | Designer Storefront",
    description: "Curated handcrafted jewellery, temple heirlooms, and artisanal suites. Express insured dispatch.",
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en">
            <body className="bg-white text-black min-h-screen flex flex-col antialiased selection:bg-black selection:text-white">
                <ThemeRuntime />
                <CustomerAuthProvider>
                    <CartProvider>
                        <Suspense fallback={<div className="h-20 bg-white" />}>
                            <Header />
                        </Suspense>
                        <CartDrawer />
                        <CustomerAuthModal />
                        <main className="flex-1">
                            {children}
                        </main>
                        <Footer />
                        <Toaster
                            position="bottom-right"
                            toastOptions={{
                                style: {
                                    background: "#000000",
                                    color: "#ffffff",
                                    border: "1px solid #222222",
                                },
                            }}
                        />
                    </CartProvider>
                </CustomerAuthProvider>
            </body>
        </html>
    );
}
