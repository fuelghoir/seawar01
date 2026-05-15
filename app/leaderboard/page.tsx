"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { getLeaderboard, LeaderboardEntry } from "../lib/offchainGame";
import { WalletName } from "../components/WalletName";
import { SettingsPanel } from "../components/SettingsPanel";
import { useSettings, TR } from "../lib/settings";
import styles from "./page.module.css";

export default function LeaderboardPage() {
  const router = useRouter();
  const { address } = useAccount();
  const { lang } = useSettings();
  const tr = TR[lang];

  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    getLeaderboard()
      .then(setEntries)
      .finally(() => setLoading(false));
  }, []);

  const myAddr = address?.toLowerCase();

  return (
    <div className={styles.container}>
      <SettingsPanel />
      <div className={styles.content}>
        <div className={styles.header}>
          <button className={styles.backBtn} onClick={() => router.push("/")}>
            ← {tr.back}
          </button>
          <h1 className={styles.title}>{tr.leaderboard}</h1>
          <button
            className={styles.helpBtn}
            onClick={() => setShowHelp(!showHelp)}
            aria-label="How points work"
          >
            ?
          </button>
        </div>

        {showHelp && (
          <div className={styles.helpBox}>
            <p className={styles.helpTitle}>{tr.lb_help_title}</p>
            <ul className={styles.helpList}>
              <li><strong>+50 pts</strong> — {tr.lb_help_win}</li>
              <li><strong>+1 pt</strong> — {tr.lb_help_hit}</li>
              <li><strong>+5 pts</strong> — {tr.lb_help_checkin}</li>
              <li><strong>{tr.lb_help_streak_label}</strong> — {tr.lb_help_streak}</li>
            </ul>
            <p className={styles.helpNote}>{tr.lb_help_note}</p>
          </div>
        )}

        <div className={styles.subtitle}>{tr.lb_subtitle}</div>

        {loading ? (
          <div className={styles.loadingWrap}>
            <div className={styles.spinner} />
          </div>
        ) : entries.length === 0 ? (
          <p className={styles.empty}>{tr.lb_empty}</p>
        ) : (
          <div className={styles.table}>
            <div className={styles.tableHeader}>
              <span className={styles.colRank}>#</span>
              <span className={styles.colWallet}>{tr.lb_player}</span>
              <span className={styles.colStat}>{tr.wins}</span>
              <span className={styles.colStat}>{tr.streak}</span>
              <span className={styles.colPoints}>{tr.lb_points}</span>
            </div>

            {entries.map((entry, i) => {
              const isMe = entry.wallet === myAddr;

              return (
                <div
                  key={entry.wallet}
                  className={`${styles.row} ${isMe ? styles.rowMe : ""} ${i < 3 ? styles.rowTop : ""}`}
                  style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
                >
                  <span className={`${styles.colRank} ${i === 0 ? styles.gold : i === 1 ? styles.silver : i === 2 ? styles.bronze : ""}`}>
                    {i + 1}
                  </span>
                  <span className={styles.colWallet}>
                    <WalletName address={entry.wallet} className={styles.walletText} />
                    {isMe && <span className={styles.youBadge}>{tr.you_label}</span>}
                  </span>
                  <span className={styles.colStat}>
                    {entry.wins}
                  </span>
                  <span className={styles.colStat}>
                    {entry.checkin_streak}d
                  </span>
                  <span className={styles.colPoints}>{entry.points}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
