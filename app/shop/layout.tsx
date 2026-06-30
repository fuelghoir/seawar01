import type { Metadata } from "next";
import type { ReactNode } from "react";
import { createSeoMetadata } from "../lib/seo";

export const metadata: Metadata = createSeoMetadata({
  title: "Sea Battle Shop and Promo Codes",
  description:
    "Redeem Sea Battle promo codes and unlock boosters, bombs, Battle Pass rewards, points items, and game rewards on Base.",
  path: "/shop",
  keywords: ["Sea Battle promo codes", "Base game rewards", "Battle Pass rewards"],
});

export default function ShopLayout({ children }: { children: ReactNode }) {
  return children;
}
