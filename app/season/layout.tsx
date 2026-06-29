import type { Metadata } from "next";
import type { ReactNode } from "react";
import { createSeoMetadata } from "../lib/seo";

export const metadata: Metadata = createSeoMetadata({
  title: "Sea Battle Season Rewards",
  description:
    "Track the Sea Battle season reward pool, USDC drop countdown, and claim Battle Pass rewards earned by playing on Base.",
  path: "/season",
  keywords: ["Sea Battle season rewards", "USDC drop", "Battle Pass rewards"],
});

export default function SeasonLayout({ children }: { children: ReactNode }) {
  return children;
}
