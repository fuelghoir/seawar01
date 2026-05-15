"use client";

import Link from "next/link";
import { useSettings, TR } from "../lib/settings";
import styles from "./SocialSidebar.module.css";

export function SocialSidebar() {
  const { lang } = useSettings();
  const tr = TR[lang];

  return (
    <aside className={styles.sidebar} aria-label="Quick links">
      <Link href="/shop" className={`${styles.card} ${styles.shop}`} aria-label={tr.home_shop}>
        <span className={styles.icon} aria-hidden="true">🛒</span>
        <span className={styles.label}>{tr.home_shop}</span>
      </Link>

      <a
        href="https://t.me/+xWV1zyGwNOM1ZTFi"
        target="_blank"
        rel="noopener noreferrer"
        className={`${styles.card} ${styles.tg}`}
        aria-label="Telegram"
      >
        <span className={styles.icon} aria-hidden="true">✈</span>
        <span className={styles.label}>Telegram</span>
      </a>

      <a
        href="https://www.youtube.com/@hermescrypt"
        target="_blank"
        rel="noopener noreferrer"
        className={`${styles.card} ${styles.yt}`}
        aria-label="YouTube"
      >
        <span className={styles.icon} aria-hidden="true">▶</span>
        <span className={styles.label}>YouTube</span>
      </a>
    </aside>
  );
}
