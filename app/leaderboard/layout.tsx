import type { Metadata } from "next";
import type { ReactNode } from "react";
import { createSeoMetadata } from "../lib/seo";

export const metadata: Metadata = createSeoMetadata({
  title: "Sea Battle Leaderboard",
  description:
    "Track top Sea Battle captains by points, wins, streaks, and onchain game rewards on Base.",
  path: "/leaderboard",
  keywords: ["Sea Battle leaderboard", "Base game leaderboard", "onchain game rankings"],
});

export default function LeaderboardLayout({ children }: { children: ReactNode }) {
  return children;
}
