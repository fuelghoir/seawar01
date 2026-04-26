"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { getLeaderboard, LeaderboardEntry } from "../lib/offchainGame";
import { WalletName } from "../components/WalletName";
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
            <p className={styles.helpTitle}>How points work</p>
            <ul className={styles.helpList}>
              <li><strong>+50 pts</strong> — for winning a game</li>
              <li><strong>+1 pt</strong> — for each hit on enemy ship</li>
              <li><strong>+5 pts</strong> — daily check-in (base reward)</li>
              <li><strong>Streak bonus</strong> — every 5 consecutive days, reward increases by +5</li>
            </ul>
            <p className={styles.helpNote}>Check-in resets daily at 00:00 UTC.</p>
          </div>
        )}

        <div className={styles.subtitle}>Top players by points</div>

        {loading ? (
          <div className={styles.loadingWrap}>
            <div className={styles.spinner} />
          </div>
        ) : entries.length === 0 ? (
          <p className={styles.empty}>No players yet. Be the first!</p>
        ) : (
          <div className={styles.table}>
            <div className={styles.tableHeader}>
              <span className={styles.colRank}>#</span>
              <span className={styles.colWallet}>Player</span>
              <span className={styles.colStat}>Wins</span>
              <span className={styles.colStat}>Streak</span>
              <span className={styles.colPoints}>Points</span>
            </div>

            {entries.map((entry, i) => {
              const isMe = entry.wallet === myAddr;

              return (
                <div
                  key={entry.wallet}
                  className={`${styles.row} ${isMe ? styles.rowMe : ""} ${i < 3 ? styles.rowTop : ""}`}
                >
                  <span className={`${styles.colRank} ${i === 0 ? styles.gold : i === 1 ? styles.silver : i === 2 ? styles.bronze : ""}`}>
                    {i + 1}
                  </span>
                  <span className={styles.colWallet}>
                    <WalletName address={entry.wallet} />
                    {isMe && <span className={styles.youBadge}>you</span>}
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
