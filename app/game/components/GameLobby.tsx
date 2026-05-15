"use client";

import { useState } from "react";
import styles from "./game-ui.module.css";

interface GameLobbyProps {
  mode: "friend" | "wager";
  gameId: string;
  wagerAmount?: number;
  onCancel?: () => void;
}

const MODE_ACCENT = {
  friend: { color: "#3b82f6", icon: "👥", label: "FRIEND MATCH" },
  wager: { color: "#a855f7", icon: "💰", label: "USDC WAGER" },
};

export function GameLobby({
  mode,
  gameId,
  wagerAmount,
  onCancel,
}: GameLobbyProps) {
  const info = MODE_ACCENT[mode];
  const [copied, setCopied] = useState<"id" | "link" | null>(null);

  const shareLink =
    typeof window !== "undefined"
      ? `${window.location.origin}/?join=${gameId}`
      : `/?join=${gameId}`;

  const copy = async (text: string, type: "id" | "link") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(type);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      // ignore
    }
  };

  return (
    <div className={styles.lobby}>
      <div className={styles.lobbyScanLine} aria-hidden="true" />
      <div className={styles.lobbyGrid} aria-hidden="true" />

      <div className={styles.lobbyContent}>
        <div
          className={styles.lobbyBadge}
          style={{
            color: info.color,
            background: `${info.color}18`,
            borderColor: `${info.color}55`,
            boxShadow: `0 0 24px ${info.color}33`,
          }}
        >
          <span className={styles.lobbyBadgeIcon}>{info.icon}</span>
          {info.label}
        </div>

        <div
          className={styles.lobbyShip}
          style={{ filter: `drop-shadow(0 0 30px ${info.color})` }}
          aria-hidden="true"
        >
          🚢
        </div>

        <div className={styles.lobbyKicker}>WAITING FOR OPPONENT</div>
        <div className={styles.lobbyTitle} style={{ color: info.color }}>
          GAME ID
        </div>

        <button
          className={styles.lobbyIdBox}
          onClick={() => copy(gameId, "id")}
          style={{
            borderColor: `${info.color}55`,
            background: `${info.color}10`,
          }}
          type="button"
          title="Click to copy"
        >
          <span className={styles.lobbyId} style={{ color: info.color }}>
            #{gameId}
          </span>
          <span className={styles.copyHint}>
            {copied === "id" ? "COPIED ✓" : "TAP TO COPY"}
          </span>
        </button>

        <button
          className={styles.lobbyShareBtn}
          style={{
            background: `linear-gradient(90deg, ${info.color}, ${info.color}bb)`,
            boxShadow: `0 0 24px ${info.color}66`,
          }}
          onClick={() => copy(shareLink, "link")}
          type="button"
        >
          {copied === "link" ? "✓ LINK COPIED" : "📋 COPY INVITE LINK"}
        </button>

        {wagerAmount != null && wagerAmount > 0 && (
          <div className={styles.lobbyWager}>
            <span className={styles.lobbyWagerLabel}>WAGER LOCKED</span>
            <span
              className={styles.lobbyWagerValue}
              style={{ color: info.color }}
            >
              {(wagerAmount / 1_000_000).toFixed(2)} USDC
            </span>
            <span className={styles.lobbyWagerSub}>
              Winner takes 90% of pool
            </span>
          </div>
        )}

        <div className={styles.lobbyConnecting}>
          <span
            className={styles.lobbySpinner}
            style={{
              borderColor: `${info.color}66`,
              borderTopColor: "transparent",
            }}
          />
          <span style={{ color: `${info.color}aa` }}>CONNECTING…</span>
        </div>

        {onCancel && (
          <button
            className={styles.lobbyCancel}
            onClick={onCancel}
            type="button"
          >
            ← CANCEL & BACK TO MENU
          </button>
        )}
      </div>
    </div>
  );
}
