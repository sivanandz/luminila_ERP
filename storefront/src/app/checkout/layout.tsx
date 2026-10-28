import type { Metadata } from "next";

/**
 * The checkout page is a client component and cannot export metadata itself.
 * This layout keeps the transactional page out of the index and gives it a
 * canonical so it cannot compete with the storefront.
 */
export const metadata: Metadata = {
    title: "Checkout — Niththigal",
    description: "Review your bag and complete your Niththigal order.",
    alternates: { canonical: "/checkout" },
    robots: { index: false, follow: false },
};

export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
    return children;
}
