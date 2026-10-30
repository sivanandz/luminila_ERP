import { redirect } from "next/navigation";
import { isSingleAccountMode } from "@/lib/deployment-mode";

/**
 * Setup surface gate.
 *
 * Single mode provisions its one account at boot, so the setup wizard is never
 * reachable: /setup redirects to /login before the wizard renders. Multi mode
 * keeps the wizard unchanged.
 */
export default function SetupLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  if (isSingleAccountMode()) {
    redirect("/login");
  }

  return <>{children}</>;
}
