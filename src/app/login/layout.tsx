import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Login - Luminila",
    description: "Sign in to your Luminila account",
};

export default function LoginLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    // Login page has its own full-screen layout without sidebar
    return <>{children}</>;
}
