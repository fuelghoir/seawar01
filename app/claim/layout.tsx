import type { Metadata } from "next";
import type { ReactNode } from "react";
import { createSeoMetadata } from "../lib/seo";

export const metadata: Metadata = createSeoMetadata({
  title: "Claim Sea Battle Rewards",
  description: "Sea Battle reward claim screen.",
  path: "/claim",
  noIndex: true,
});

export default function ClaimLayout({ children }: { children: ReactNode }) {
  return children;
}
