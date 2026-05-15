"use client";

import { useState, useEffect } from "react";
import { getPlayerGameHistory, GameHistoryEntry } from "../lib/offchainGame";
import { WalletName } from "./WalletName";
import { useSettings, TR } from "../lib/settings";
import styles from "./GameHistory.module.css";

function formatDate(iso: string, lang: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(lang === "ru" ? "ru" : "en", { month: "short", day: "numeric" });
}

function modeLabel(mode: string, lang: string): string {
  const tr = TR[lang === "ru" ? "ru" : "en"];
  if (mode === "wager") return tr.wager_upper;
  if (mode === "bot" || mode === "solo") return tr.bot_upper;
  return tr.pvp;
}

interface GameHistoryProps {
  address: string;
  hideHeader?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
}

export default function GameHistory({
  address,
  hideHeader = false,
  expanded: controlledExpanded,
  onToggleExpand,
}: GameHistoryProps) {
  const { lang } = useSettings();
  const tr = TR[lang];

  const [internalExpanded, setInternalExpanded] = useState(false);
  const expanded = controlledExpanded ?? internalExpanded;
  const toggle = () => {
    if (onToggleExpand) onToggleExpand();
    else setInternalExpanded(v => !v);
  };

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
      {!hideHeader && (
        <button className={styles.header} onClick={toggle} type="button">
          <div className={styles.headerLeft}>
            <span className={styles.label}>{tr.recent_games}</span>
            {history.length > 0 && (
              <span className={styles.summary}>{wins}W · {losses}L</span>
            )}
          </div>
          <span className={styles.chevron}>{expanded ? "▾" : "▸"}</span>
        </button>
      )}

      {expanded && (
        <div className={styles.body}>
          {loading ? (
            <p className={styles.loading}>{tr.hist_loading}</p>
          ) : history.length === 0 ? (
            <p className={styles.empty}>{tr.hist_empty}</p>
          ) : (
            history.map(g => (
              <div
                key={g.id}
                className={`${styles.row} ${g.result === "win" ? styles.rowWin : styles.rowLoss}`}
              >
                <div className={styles.rowLeft}>
                  <span className={`${styles.badge} ${g.result === "win" ? styles.badgeWin : styles.badgeLoss}`}>
                    {g.result === "win" ? tr.win_short.toUpperCase() : tr.loss_short.toUpperCase()}
                  </span>
                  <span className={styles.mode}>{modeLabel(g.mode, lang)}</span>
                  {g.wager > 0 && (
                    <span className={styles.wager}>{g.wager / 1_000_000} USDC</span>
                  )}
                </div>
                <div className={styles.rowRight}>
                  {g.opponent
                    ? <WalletName address={g.opponent} className={styles.opponent} />
                    : <span className={styles.opponent}>{tr.bot_upper}</span>
                  }
                  <span className={styles.date}>{formatDate(g.date, lang)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
