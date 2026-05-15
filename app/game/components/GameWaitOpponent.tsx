"use client";

import styles from "./game-ui.module.css";

interface GameWaitOpponentProps {
  accent?: string;
  message?: string;
}

function alphaColor(color: string, hexAlpha: string, alpha: number) {
  if (color === "var(--accent)") return `rgba(var(--accent-rgb), ${alpha})`;
  if (color === "var(--accent-2)") return `rgba(var(--accent-2-rgb), ${alpha})`;
  return `${color}${hexAlpha}`;
}

export function GameWaitOpponent({
  accent = "var(--accent)",
  message = "Waiting for opponent to place their ships…",
}: GameWaitOpponentProps) {
  return (
    <div className={styles.waitOpp}>
      <div className={styles.lobbyGrid} aria-hidden="true" />
      <div className={styles.waitContent}>
        <div className={styles.waitIcon} aria-hidden="true">
          ⚓
        </div>
        <div className={styles.waitTitle} style={{ color: accent }}>
          SHIPS DEPLOYED
        </div>
        <p className={styles.waitText}>{message}</p>
        <div className={styles.lobbyConnecting}>
          <span
            className={styles.lobbySpinner}
            style={{
              borderColor: alphaColor(accent, "66", 0.4),
              borderTopColor: "transparent",
            }}
          />
          <span style={{ color: alphaColor(accent, "aa", 0.66) }}>SCANNING…</span>
        </div>
      </div>
    </div>
  );
}
