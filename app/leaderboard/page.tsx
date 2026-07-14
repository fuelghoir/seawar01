"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { getLeaderboard, LEADERBOARD_PAGE_SIZE, LeaderboardEntry } from "../lib/offchainGame";
import {
  getSeasonLeaderboard,
  SEASON_LEADERBOARD_PAGE_SIZE,
  SeasonLeaderboardEntry,
} from "../lib/season";
import { WalletName } from "../components/WalletName";
import { SettingsPanel } from "../components/SettingsPanel";
import { FleetMinerSummary } from "../components/FleetMinerWidgets";
import { useSettings, TR } from "../lib/settings";
import styles from "./page.module.css";

type PageItem = number | "gap";
type LeaderboardTab = "alltime" | "season";

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

  const [tab, setTab] = useState<LeaderboardTab>("alltime");

  // All-time state
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  // Season state
  const [seasonEntries, setSeasonEntries] = useState<SeasonLeaderboardEntry[]>([]);
  const [seasonPage, setSeasonPage] = useState(1);
  const [seasonTotal, setSeasonTotal] = useState(0);
  const [seasonTotalPages, setSeasonTotalPages] = useState(1);
  const [seasonLoading, setSeasonLoading] = useState(true);

  const [showHelp, setShowHelp] = useState(false);

  // All-time data
  useEffect(() => {
    if (tab !== "alltime") return;
    let active = true;
    setLoading(true);
    getLeaderboard(page)
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
    return () => { active = false; };
  }, [page, tab]);

  // Season data
  useEffect(() => {
    if (tab !== "season") return;
    let active = true;
    setSeasonLoading(true);
    getSeasonLeaderboard(seasonPage)
      .then((result) => {
        if (!active) return;
        if (seasonPage > result.totalPages && result.total > 0) {
          setSeasonPage(result.totalPages);
          return;
        }
        setSeasonEntries(result.entries);
        setSeasonTotal(result.total);
        setSeasonTotalPages(result.totalPages);
      })
      .finally(() => {
        if (active) setSeasonLoading(false);
      });
    return () => { active = false; };
  }, [seasonPage, tab]);

  const myAddr = address?.toLowerCase();

  // Active tab values
  const activePage = tab === "alltime" ? page : seasonPage;
  const activeTotal = tab === "alltime" ? total : seasonTotal;
  const activeTotalPages = tab === "alltime" ? totalPages : seasonTotalPages;
  const activeLoading = tab === "alltime" ? loading : seasonLoading;
  const activePageSize = tab === "alltime" ? LEADERBOARD_PAGE_SIZE : SEASON_LEADERBOARD_PAGE_SIZE;
  const setActivePage = tab === "alltime" ? setPage : setSeasonPage;

  const pageItems = getPageItems(activePage, activeTotalPages);
  const firstRank = (activePage - 1) * activePageSize + 1;
  const lastRank = firstRank + (tab === "alltime" ? entries.length : seasonEntries.length) - 1;
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

        {/* ── Tab switcher ── */}
        <div className={styles.tabBar}>
          <button
            className={`${styles.tabBtn} ${tab === "alltime" ? styles.tabActive : ""}`}
            onClick={() => setTab("alltime")}
            type="button"
          >
            {tr.lb_tab_alltime}
          </button>
          <button
            className={`${styles.tabBtn} ${tab === "season" ? styles.tabActive : ""}`}
            onClick={() => setTab("season")}
            type="button"
          >
            {tr.lb_tab_season}
          </button>
        </div>

        <div className={styles.subtitle}>
          {tab === "alltime" ? tr.lb_subtitle : tr.lb_season_subtitle}
        </div>

        <div className={styles.mobileSeasonIntel}>
          <FleetMinerSummary
            address={address}
            onOpen={() => router.push("/shop#fleet-nft")}
          />
        </div>

        {activeLoading ? (
          <div className={styles.loadingWrap}>
            <div className={styles.spinner} />
          </div>
        ) : (tab === "alltime" ? entries.length : seasonEntries.length) === 0 ? (
          <p className={styles.empty}>{tr.lb_empty}</p>
        ) : (
          <>
            <div className={styles.table}>
              <div className={styles.tableHeader}>
                <span className={styles.colRank}>#</span>
                <span className={styles.colWallet}>{tr.lb_player}</span>
                {tab === "alltime" ? (
                  <>
                    <span className={styles.colStat}>{tr.wins}</span>
                    <span className={styles.colStat}>{tr.streak}</span>
                    <span className={styles.colPoints}>{tr.lb_points}</span>
                  </>
                ) : (
                  <>
                    <span className={styles.colStat}>{tr.lb_col_level}</span>
                    <span className={styles.colPoints}>{tr.lb_col_xp}</span>
                  </>
                )}
              </div>

              {tab === "alltime"
                ? entries.map((entry, i) => {
                    const rank = (activePage - 1) * activePageSize + i + 1;
                    const isMe = entry.wallet === myAddr;
                    return (
                      <div
                        key={entry.wallet}
                        className={`${styles.row} ${isMe ? styles.rowMe : ""} ${rank <= 3 ? styles.rowTop : ""}`}
                        style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
                      >
                        <span className={`${styles.colRank} ${rank === 1 ? styles.gold : rank === 2 ? styles.silver : rank === 3 ? styles.bronze : ""}`}>
                          {rank}
                        </span>
                        <span className={styles.colWallet}>
                          <WalletName address={entry.wallet} className={styles.walletText} />
                          {isMe && <span className={styles.youBadge}>{tr.you_label}</span>}
                        </span>
                        <span className={styles.colStat}>{entry.wins}</span>
                        <span className={styles.colStat}>{entry.checkin_streak}d</span>
                        <span className={styles.colPoints}>{entry.points}</span>
                      </div>
                    );
                  })
                : seasonEntries.map((entry, i) => {
                    const rank = (activePage - 1) * activePageSize + i + 1;
                    const isMe = entry.wallet === myAddr;
                    return (
                      <div
                        key={entry.wallet}
                        className={`${styles.row} ${isMe ? styles.rowMe : ""} ${rank <= 3 ? styles.rowTop : ""}`}
                        style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
                      >
                        <span className={`${styles.colRank} ${rank === 1 ? styles.gold : rank === 2 ? styles.silver : rank === 3 ? styles.bronze : ""}`}>
                          {rank}
                        </span>
                        <span className={styles.colWallet}>
                          <WalletName address={entry.wallet} className={styles.walletText} />
                          {isMe && <span className={styles.youBadge}>{tr.you_label}</span>}
                        </span>
                        <span className={styles.colStat}>Lv.{entry.level}</span>
                        <span className={styles.colPoints}>{entry.xp.toLocaleString()}</span>
                      </div>
                    );
                  })}
            </div>

            {activeTotalPages > 1 && (
              <div className={styles.pagination} aria-label="Leaderboard pages">
                <button
                  className={styles.pageNavBtn}
                  onClick={() => setActivePage((p) => Math.max(1, p - 1))}
                  disabled={activeLoading || activePage <= 1}
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
                        className={`${styles.pageNum} ${item === activePage ? styles.pageNumActive : ""}`}
                        onClick={() => setActivePage(item)}
                        disabled={activeLoading || item === activePage}
                        aria-label={`${pageLabel} ${item}`}
                        aria-current={item === activePage ? "page" : undefined}
                      >
                        {item}
                      </button>
                    )
                  )}
                </div>

                <button
                  className={styles.pageNavBtn}
                  onClick={() => setActivePage((p) => Math.min(activeTotalPages, p + 1))}
                  disabled={activeLoading || activePage >= activeTotalPages}
                  aria-label={nextLabel}
                >
                  ›
                </button>

                <span className={styles.pageSummary}>
                  {pageLabel} {activePage} / {activeTotalPages} · {firstRank}-{lastRank} / {activeTotal}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
