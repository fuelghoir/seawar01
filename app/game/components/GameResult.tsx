"use client";

import { ReactNode } from "react";
import styles from "./game-ui.module.css";

interface GameResultProps {
  didWin: boolean;
  mode: "bot" | "friend" | "wager";
  myHits: number;
  enemyHits: number;
  prizeUsdc?: string | null;
  onPrimary?: () => void;
  primaryLabel?: string;
  primaryDisabled?: boolean;
  onSecondary?: () => void;
  secondaryLabel?: string;
  secondaryVariant?: "default" | "claim";
  children?: ReactNode;
  message?: string;
}

const MODE_LABEL = {
  bot: "VS AI BOT",
  friend: "VS FRIEND",
  wager: "USDC WAGER",
};

function alphaColor(color: string, hexAlpha: string, alpha: number) {
  if (color === "var(--accent)") return `rgba(var(--accent-rgb), ${alpha})`;
  if (color === "var(--accent-2)") return `rgba(var(--accent-2-rgb), ${alpha})`;
  return `${color}${hexAlpha}`;
}

export function GameResult({
  didWin,
  mode,
  myHits,
  enemyHits,
  prizeUsdc,
  onPrimary,
  primaryLabel = "← Main Menu",
  primaryDisabled = false,
  onSecondary,
  secondaryLabel,
  secondaryVariant = "default",
  children,
  message,
}: GameResultProps) {
  const accent = didWin ? "var(--accent)" : "#ef4444";
  const accentBright = didWin ? "var(--accent-bright)" : "#ff7777";

  return (
    <div className={styles.result}>
      <div className={styles.lobbyGrid} aria-hidden="true" />

      {didWin && (
        <>
          <div
            className={styles.resultRing}
            style={{ borderColor: alphaColor(accent, "33", 0.2), width: 200, height: 200 }}
          />
          <div
            className={styles.resultRing}
            style={{ borderColor: alphaColor(accent, "22", 0.13), width: 360, height: 360 }}
          />
          <div
            className={styles.resultRing}
            style={{ borderColor: alphaColor(accent, "11", 0.07), width: 540, height: 540 }}
          />
        </>
      )}

      <div className={styles.resultContent}>
        <div className={styles.resultIcon} aria-hidden="true">
          {didWin ? "🏆" : "💀"}
        </div>

        <div
          className={styles.resultBig}
          style={{
            color: accent,
            animation: didWin
              ? "victoryGlow 2s ease-in-out infinite"
              : "defeatGlow 2s ease-in-out infinite",
          }}
        >
          {didWin ? "VICTORY" : "DEFEAT"}
        </div>

        <div className={styles.resultMode}>{MODE_LABEL[mode]}</div>

        <div className={styles.resultStats}>
          <div className={styles.resultStat}>
            <div
              className={styles.resultStatValue}
              style={{ color: accent }}
            >
              {myHits}
            </div>
            <div className={styles.resultStatKey}>YOUR HITS</div>
          </div>
          <div className={styles.resultStat}>
            <div className={styles.resultStatValue} style={{ color: "#ef4444" }}>
              {enemyHits}
            </div>
            <div className={styles.resultStatKey}>ENEMY HITS</div>
          </div>
          {prizeUsdc && (
            <div className={styles.resultStat}>
              <div
                className={styles.resultStatValue}
                style={{ color: "var(--accent-2)" }}
              >
                {prizeUsdc}
              </div>
              <div className={styles.resultStatKey}>USDC</div>
            </div>
          )}
        </div>

        {message && <div className={styles.resultMessage}>{message}</div>}

        {children && <div className={styles.resultExtras}>{children}</div>}

        <div className={styles.resultActions}>
          {onSecondary && secondaryLabel && (
            <button
              className={`${styles.resultPrimary} ${
                secondaryVariant === "claim" ? styles.resultClaimButton : ""
              }`}
              style={
                secondaryVariant === "claim"
                  ? undefined
                  : {
                      background: `linear-gradient(90deg, ${accent}, ${accentBright})`,
                      boxShadow: `0 0 24px ${alphaColor(accent, "77", 0.47)}`,
                    }
              }
              onClick={onSecondary}
              type="button"
            >
              {secondaryLabel}
            </button>
          )}
          {onPrimary && (
            <button
              className={styles.resultSecondary}
              onClick={onPrimary}
              type="button"
              disabled={primaryDisabled}
            >
              {primaryLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
