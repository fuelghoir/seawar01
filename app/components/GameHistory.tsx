"use client";

import { useState, useEffect } from "react";
import { getPlayerGameHistory, GameHistoryEntry } from "../lib/offchainGame";
import styles from "./GameHistory.module.css";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en", { month: "short", day: "numeric" });
}

function modeLabel(mode: string): string {
  if (mode === "wager") return "Wager";
  if (mode === "bot" || mode === "solo") return "Bot";
  return "PvP";
}

export default function GameHistory({ address }: { address: string }) {
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState<GameHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!expanded || !address) return;
    setLoading(true);
    getPlayerGameHistory(address)
      .then(setHistory)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [expanded, address]);

  const wins = history.filter(g => g.result === "win").length;
  const losses = history.length - wins;

  return (
    <div className={styles.section}>
      <button className={styles.header} onClick={() => setExpanded(v => !v)} type="button">
        <div className={styles.headerLeft}>
          <span className={styles.label}>Recent Games</span>
          {history.length > 0 && (
            <span className={styles.summary}>{wins}W · {losses}L</span>
          )}
        </div>
        <span className={styles.chevron}>{expanded ? "▾" : "▸"}</span>
      </button>

      {expanded && (
        <div className={styles.body}>
          {loading ? (
            <p className={styles.loading}>Loading...</p>
          ) : history.length === 0 ? (
            <p className={styles.empty}>No finished games yet.</p>
          ) : (
            history.map(g => (
              <div
                key={g.id}
                className={`${styles.row} ${g.result === "win" ? styles.rowWin : styles.rowLoss}`}
              >
                <div className={styles.rowLeft}>
                  <span className={`${styles.badge} ${g.result === "win" ? styles.badgeWin : styles.badgeLoss}`}>
                    {g.result === "win" ? "WIN" : "LOSS"}
                  </span>
                  <span className={styles.mode}>{modeLabel(g.mode)}</span>
                  {g.wager > 0 && (
                    <span className={styles.wager}>{g.wager / 1_000_000} USDC</span>
                  )}
                </div>
                <div className={styles.rowRight}>
                  <span className={styles.opponent}>
                    {g.opponent
                      ? `${g.opponent.slice(0, 6)}…${g.opponent.slice(-4)}`
                      : "Bot"}
                  </span>
                  <span className={styles.date}>{formatDate(g.date)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
