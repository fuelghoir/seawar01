import type { Metadata } from "next";
import type { ReactNode } from "react";
import { createSeoMetadata } from "../lib/seo";
import styles from "./page.module.css";

export const metadata: Metadata = createSeoMetadata({
  title: "Sea Battle Match",
  description: "Sea Battle live match screen.",
  path: "/game",
  noIndex: true,
});

export default function GameLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.container} style={{ minHeight: "100vh" }}>
      {children}
    </div>
  );
}

