import type { Metadata } from "next";
import { createSeoMetadata } from "../lib/seo";

export const metadata: Metadata = createSeoMetadata({
  title: "Sea Battle Impact & Traction",
  description:
    "Auditable production metrics for Sea Battle, the naval strategy game live on Base Mainnet.",
  path: "/stats",
  keywords: [
    "Sea Battle metrics",
    "Base Builder Grant",
    "onchain gaming analytics",
    "Base Mainnet game",
  ],
});

export default function StatsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
