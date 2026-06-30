import type { Metadata } from "next";
import type { ReactNode } from "react";
import { createSeoMetadata } from "../lib/seo";

export const metadata: Metadata = createSeoMetadata({
  title: "Play Sea Battle Online",
  description:
    "Start a Sea Battle match against AI, challenge a friend, or play USDC wager battles in an onchain Battleship game on Base.",
  path: "/play",
  keywords: ["play Sea Battle online", "Battleship online", "USDC wager game"],
});

export default function PlayLayout({ children }: { children: ReactNode }) {
  return children;
}
