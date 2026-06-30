import type { Metadata } from "next";
import type { ReactNode } from "react";
import { createSeoMetadata } from "../lib/seo";

export const metadata: Metadata = createSeoMetadata({
  title: "Async Sea Battle Challenges",
  description:
    "Create async Sea Battle challenges, attack a fleet, defend your ships, and settle rewards in a strategy game on Base.",
  path: "/challenge",
  keywords: ["async Battleship game", "Sea Battle challenge", "Base strategy game"],
});

export default function ChallengeLayout({ children }: { children: ReactNode }) {
  return children;
}
