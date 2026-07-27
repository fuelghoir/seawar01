"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { getLeaderboard, LEADERBOARD_PAGE_SIZE, LeaderboardEntry } from "../lib/offchainGame";
import { getSeasonState, type SeasonState } from "../lib/season";
import { WalletName } from "../components/WalletName";
import { SettingsPanel } from "../components/SettingsPanel";
import { FleetMinerSummary, SeasonPoolCard } from "../components/FleetMinerWidgets";
import { MobileDock } from "../components/MobileDock";
import { useSettings, TR } from "../lib/settings";
import { isBaseAppUserAgent } from "../lib/baseApp";
import styles from "./page.module.css";

type PageItem = number | "gap";

function LeaderboardPodium({
  entries,
  myAddr,
}: {
  entries: LeaderboardEntry[];
  myAddr?: string;
}) {
  const podium = [entries[1], entries[0], entries[2]].filter(
    (entry): entry is LeaderboardEntry => Boolean(entry)
  );

  return (
    <section className={styles.podium} aria-label="Top three captains">
      {podium.map((entry) => {
        const rank = entries.indexOf(entry) + 1;
        return (
          <article
            key={entry.wallet}
            className={`${styles.podiumItem} ${styles[`podiumRank${rank}`]}`}
          >
            <span className={styles.podiumRank}>#{rank}</span>
            <span className={styles.podiumAvatar}>{rank === 1 ? "01" : `0${rank}`}</span>
            <WalletName address={entry.wallet} className={styles.podiumName} />
            <strong>{entry.points.toLocaleString()}</strong>
            {entry.wallet === myAddr && <small className={styles.podiumYou}>YOU</small>}
          </article>
        );
      })}
    </section>
  );
}

function getPageItems(page: number, totalPages: number): PageItem[] {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const items: PageItem[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);

  if (start > 2) items.push("gap");
  for (let i = start; i <= end; i++) items.push(i);
  if (end < totalPages - 1) items.push("gap");
  items.push(totalPages);

  return items;
}

export default function LeaderboardPage() {
  const router = useRouter();
  const { address } = useAccount();
  const { lang } = useSettings();
  const tr = TR[lang];

  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [page, setPage] = useState(1);
  const [mode, setMode] = useState<"allTime" | "season">("allTime");
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [season, setSeason] = useState<SeasonState | null>(null);
  const isBaseApp = typeof window !== "undefined" && isBaseAppUserAgent(window.navigator.userAgent);

  useEffect(() => {
    getSeasonState(address || "").then(setSeason).catch(() => {});
  }, [address]);

  useEffect(() => {
    let active = true;

    setLoading(true);
    getLeaderboard(page, LEADERBOARD_PAGE_SIZE, mode)
      .then((result) => {
        if (!active) return;

        if (page > result.totalPages && result.total > 0) {
          setPage(result.totalPages);
          return;
        }

        setEntries(result.entries);
        setTotal(result.total);
        setTotalPages(result.totalPages);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [page, mode]);

  const myAddr = address?.toLowerCase();
  const pageItems = getPageItems(page, totalPages);
  const firstRank = (page - 1) * LEADERBOARD_PAGE_SIZE + 1;
  const lastRank = firstRank + entries.length - 1;
  const pageLabel = lang === "ru" ? "Страница" : "Page";
  const prevLabel = lang === "ru" ? "Предыдущая страница" : "Previous page";
  const nextLabel = lang === "ru" ? "Следующая страница" : "Next page";

  return (
    <div className={styles.container}>
      <SettingsPanel />
      <div className={styles.content}>
        <div className={styles.header}>
          <button className={styles.backBtn} onClick={() => router.push("/")}>
            ← {tr.back}
          </button>
          <h1 className={styles.title}>{tr.leaderboard.toUpperCase()}</h1>
          <button
            className={styles.helpBtn}
            onClick={() => setShowHelp(!showHelp)}
            aria-label="How points work"
          >
            ?
          </button>
        </div>

        <div className={styles.leaderHero}>
          <span>{lang === "ru" ? "\u0420\u0435\u0439\u0442\u0438\u043d\u0433 \u043a\u0430\u043f\u0438\u0442\u0430\u043d\u043e\u0432" : "Captain rankings"}</span>
          <strong>{total.toLocaleString()} {lang === "ru" ? "\u0438\u0433\u0440\u043e\u043a\u043e\u0432" : "players"}</strong>
          <p>{tr.lb_subtitle}</p>
        </div>

        <div className={styles.tabsContainer}>
          <button
            className={`${styles.tabBtn} ${mode === "allTime" ? styles.tabActive : ""}`}
            onClick={() => { setMode("allTime"); setPage(1); }}
          >
            {tr.leaderboard_alltime || "All-Time"}
          </button>
          <button
            className={`${styles.tabBtn} ${mode === "season" ? styles.tabActive : ""}`}
            onClick={() => { setMode("season"); setPage(1); }}
          >
            {season?.isEnded ? (lang === "ru" ? "Скоро Сезон 2" : "Season 2 soon") : (tr.leaderboard_season || "Current Season")}
          </button>
        </div>

        {showHelp && (
          <div className={styles.helpBox}>
            <p className={styles.helpTitle}>{tr.lb_help_title}</p>
            <ul className={styles.helpList}>
              <li><strong>+50 pts</strong> — {tr.lb_help_win}</li>
              <li><strong>+1 pt</strong> — {tr.lb_help_hit}</li>
              <li><strong>{isBaseApp ? "+500 pts" : "+5 pts"}</strong> — {tr.lb_help_checkin}</li>
              <li><strong>{tr.lb_help_streak_label}</strong> — {isBaseApp ? "+50 pts" : "+5 pts"} {tr.lb_help_streak}</li>
            </ul>
            <p className={styles.helpNote}>{tr.lb_help_note}</p>
          </div>
        )}

        {loading ? (
          <div className={styles.loadingWrap}>
            <div className={styles.spinner} />
          </div>
        ) : mode === "season" && season?.isEnded ? (
          <div className={styles.emptyState}>
            <h2 className={styles.emptyTitle} style={{ color: '#ffcc00' }}>{lang === "ru" ? "ОЖИДАНИЕ СЕЗОНА 2" : "WAITING FOR SEASON 2"}</h2>
            <p className={styles.emptyText}>
              {lang === "ru" 
                ? "Таблица лидеров пуста. Готовьтесь, Сезон 2 начнется совсем скоро!"
                : "The leaderboard is empty. Get ready, Season 2 starts very soon!"}
            </p>
          </div>
        ) : entries.length === 0 ? (
          <p className={styles.empty}>{tr.lb_empty}</p>
        ) : (
          <>
            {page === 1 && <LeaderboardPodium entries={entries} myAddr={myAddr} />}
            <div className={styles.table}>
              <div className={`${styles.tableHeader} ${mode === "season" ? styles.tableHeaderSeason : ""}`}>
                <span className={styles.colRank}>#</span>
                <span className={styles.colWallet}>{tr.lb_player}</span>
                {mode !== "season" && <span className={styles.colStat}>{tr.wins}</span>}
                {mode !== "season" && <span className={styles.colStat}>{tr.streak}</span>}
                <span className={styles.colPoints}>{tr.lb_points}</span>
              </div>

              {entries.map((entry, i) => {
                const rank = (page - 1) * LEADERBOARD_PAGE_SIZE + i + 1;
                const isMe = entry.wallet === myAddr;

                return (
                  <div
                    key={entry.wallet}
                    className={`${styles.row} ${mode === "season" ? styles.rowSeason : ""} ${isMe ? styles.rowMe : ""} ${rank <= 3 ? styles.rowTop : ""}`}
                    style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
                  >
                    <span className={`${styles.colRank} ${rank === 1 ? styles.gold : rank === 2 ? styles.silver : rank === 3 ? styles.bronze : ""}`}>
                      {rank}
                    </span>
                    <span className={styles.colWallet}>
                      <span className={styles.walletIdentity}>
                        <WalletName address={entry.wallet} className={styles.walletText} />
                        {mode !== "season" && (
                          <small className={styles.mobileMeta}>
                            {entry.wins}W / {entry.checkin_streak}D
                          </small>
                        )}
                      </span>
                      {isMe && <span className={styles.youBadge}>{tr.you_label}</span>}
                    </span>
                    {mode !== "season" && (
                      <span className={styles.colStat}>
                        {entry.wins}
                      </span>
                    )}
                    {mode !== "season" && (
                      <span className={styles.colStat}>
                        {entry.checkin_streak}d
                      </span>
                    )}
                    <span className={styles.colPoints}>{entry.points}</span>
                  </div>
                );
              })}
            </div>

            {totalPages > 1 && (
              <div className={styles.pagination} aria-label="Leaderboard pages">
                <button
                  className={styles.pageNavBtn}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={loading || page <= 1}
                  aria-label={prevLabel}
                >
                  ‹
                </button>

                <div className={styles.pageNumbers}>
                  {pageItems.map((item, i) =>
                    item === "gap" ? (
                      <span key={`gap-${i}`} className={styles.pageGap}>…</span>
                    ) : (
                      <button
                        key={item}
                        className={`${styles.pageNum} ${item === page ? styles.pageNumActive : ""}`}
                        onClick={() => setPage(item)}
                        disabled={loading || item === page}
                        aria-label={`${pageLabel} ${item}`}
                        aria-current={item === page ? "page" : undefined}
                      >
                        {item}
                      </button>
                    )
                  )}
                </div>

                <button
                  className={styles.pageNavBtn}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={loading || page >= totalPages}
                  aria-label={nextLabel}
                >
                  ›
                </button>

                <span className={styles.pageSummary}>
                  {pageLabel} {page} / {totalPages} · {firstRank}-{lastRank} / {total}
                </span>
              </div>
            )}
          </>
        )}

        <section className={styles.rewardIntel}>
          <div className={styles.rewardIntelHead}>
            <span>{lang === "ru" ? "\u041d\u0430\u0433\u0440\u0430\u0434\u044b \u0441\u0435\u0437\u043e\u043d\u0430" : "Season rewards"}</span>
            <small>{lang === "ru" ? "\u041f\u0443\u043b \u0438 \u043c\u0430\u0439\u043d\u0435\u0440 \u0444\u043b\u043e\u0442\u0430" : "Pool and fleet miner"}</small>
          </div>
          <div className={styles.airdropPoolBlock}>
            <SeasonPoolCard variant="wide" address={address} showEstimate />
          </div>
          <div className={styles.airdropMinerBlock}>
            <FleetMinerSummary
              address={address}
              onOpen={() => router.push("/shop#fleet-nft")}
              hidePoolCard
              variant="mobile"
            />
          </div>
        </section>
      </div>
      <MobileDock active="leaderboard" />
    </div>
  );
}
