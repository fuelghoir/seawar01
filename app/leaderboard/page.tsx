"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { getLeaderboard, LeaderboardEntry } from "../lib/offchainGame";
import styles from "./page.module.css";

export default function LeaderboardPage() {
  const router = useRouter();
  const { address } = useAccount();
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
      <div className={styles.content}>
        <div className={styles.header}>
          <button className={styles.backBtn} onClick={() => router.push("/")}>
            &larr; Back
          </button>
          <h1 className={styles.title}>Leaderboard</h1>
          <button
            className={styles.helpBtn}
            onClick={() => setShowHelp(!showHelp)}
          >
            ?
          </button>
        </div>

        {showHelp && (
          <div className={styles.helpBox}>
            <p className={styles.helpTitle}>How rating works</p>
            <p>Rating = Win Rate (60%) + Accuracy (40%)</p>
            <ul className={styles.helpList}>
              <li><strong>Win Rate</strong> — % of games won out of total played</li>
              <li><strong>Accuracy</strong> — % of shots that hit an enemy ship</li>
              <li><strong>Rating</strong> — combined score from 0 to 100</li>
            </ul>
            <p className={styles.helpNote}>Only onchain games count toward your rating.</p>
          </div>
        )}

        <div className={styles.subtitle}>Onchain players only</div>

        {loading ? (
          <div className={styles.loadingWrap}>
            <div className={styles.spinner} />
          </div>
        ) : entries.length === 0 ? (
          <p className={styles.empty}>No onchain games played yet. Be the first!</p>
        ) : (
          <div className={styles.table}>
            <div className={styles.tableHeader}>
              <span className={styles.colRank}>#</span>
              <span className={styles.colWallet}>Player</span>
              <span className={styles.colStat}>W/L</span>
              <span className={styles.colStat}>Acc</span>
              <span className={styles.colRating}>Rating</span>
            </div>

            {entries.map((entry, i) => {
              const isMe = entry.wallet === myAddr;
              const winRate = entry.games_played > 0
                ? Math.round((entry.wins / entry.games_played) * 100)
                : 0;
              const accuracy = entry.total_shots > 0
                ? Math.round((entry.total_hits / entry.total_shots) * 100)
                : 0;

              return (
                <div
                  key={entry.wallet}
                  className={`${styles.row} ${isMe ? styles.rowMe : ""} ${i < 3 ? styles.rowTop : ""}`}
                >
                  <span className={`${styles.colRank} ${i === 0 ? styles.gold : i === 1 ? styles.silver : i === 2 ? styles.bronze : ""}`}>
                    {i + 1}
                  </span>
                  <span className={styles.colWallet}>
                    {entry.wallet.slice(0, 6)}...{entry.wallet.slice(-4)}
                    {isMe && <span className={styles.youBadge}>you</span>}
                  </span>
                  <span className={styles.colStat}>
                    {entry.wins}/{entry.games_played - entry.wins}
                    <span className={styles.statHint}>{winRate}%</span>
                  </span>
                  <span className={styles.colStat}>
                    {accuracy}%
                  </span>
                  <span className={styles.colRating}>{entry.rating}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
