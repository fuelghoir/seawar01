"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useConnect, useSwitchChain } from "wagmi";
import { base } from "wagmi/chains";
import { useMiniApp } from "./providers/MiniAppProvider";
import {
  getPlayerProfile,
  getCheckinStatus,
  getPlayerGameHistory,
  PlayerProfile,
  CheckinStatus,
  GameHistoryEntry,
} from "./lib/offchainGame";
import {
  getSeasonState,
  rewardLabel,
  SEASON_LEVELS,
  SEASON_MAX_LEVEL,
  SHOP_ITEMS,
  shopItemText,
  type SeasonState,
  type ShopItemSlug,
} from "./lib/season";
import {
  LIMITED_SBT_MAX_SUPPLY,
  LIMITED_SBT_REQUIRED_WINS,
  LIMITED_SBT_WEEKLY_POINTS,
} from "./lib/limitedSbt";
import { ItemArt, type ItemArtKind } from "./components/ItemArt";
import {
  extractReferralRefFromCurrentUrl,
  extractReferralRefFromMiniAppContext,
  normalizeReferralRef,
  recordReferral,
} from "./lib/referrals";
import { QuestHub } from "./components/QuestHub";
import ReferralPanel from "./components/ReferralPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { WelcomeCheckin } from "./components/WelcomeCheckin";
import { AppHeader } from "./components/AppHeader";
import { HeroBattleGrid } from "./components/HeroBattleGrid";
import { PlayModal } from "./components/PlayModal";
import { HomeCard } from "./components/HomeCard";
import {
  CheckIcon,
  ShieldIcon,
  UserIcon,
  UsersIcon,
  TrophyIcon,
  SwordIcon,
  ShopIcon,
  TelegramIcon,
  YoutubeIcon,
  ChevronRightIcon,
  AnchorIcon,
} from "./components/Icons";
import { useSettings, TR } from "./lib/settings";
import styles from "./home.module.css";

const TG_URL = "https://t.me/+xWV1zyGwNOM1ZTFi";
const YT_URL = "https://www.youtube.com/@hermcrypto0x";
const REFERRAL_STORAGE_KEY = "sea-battle-referrer";
const BOOT_MIN_MS = 950;
const BOOT_MAX_MS = 3600;

type HomeClientProps = {
  initialIsNarrowScreen: boolean;
};

export default function Home({ initialIsNarrowScreen }: HomeClientProps) {
  const router = useRouter();
  const { context, isInMiniApp, isReady } = useMiniApp();
  const { address, isConnected, chainId, status: accountStatus } = useAccount();
  const {
    connect,
    connectors,
    status: connectStatus,
    error: connectError,
  } = useConnect();
  const { switchChain } = useSwitchChain();
  const { lang } = useSettings();
  const tr = TR[lang];

  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [checkin, setCheckin] = useState<CheckinStatus | null>(null);
  const [history, setHistory] = useState<GameHistoryEntry[]>([]);
  const [season, setSeason] = useState<SeasonState | null>(null);
  const [homeDataReady, setHomeDataReady] = useState(false);
  const [bootMinDone, setBootMinDone] = useState(false);
  const [bootMaxDone, setBootMaxDone] = useState(false);
  const [autoConnectGraceDone, setAutoConnectGraceDone] = useState(false);
  const [incomingRef, setIncomingRef] = useState<string | null>(null);
  const [showPlay, setShowPlay] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [isNarrowScreen, setIsNarrowScreen] = useState(initialIsNarrowScreen);
  const [connectingConnectorId, setConnectingConnectorId] = useState<string | null>(null);
  const [openSection, setOpenSection] = useState<
    "quests" | "profile" | "history" | "referrals" | null
  >(null);
  const autoConnected = useRef(false);
  const recordedReferralKey = useRef<string | null>(null);

  const toggleSection = (s: NonNullable<typeof openSection>) =>
    setOpenSection((prev) => (prev === s ? null : s));

  // Capture referral params from the browser URL and Mini App launch context.
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  useEffect(() => {
    const urlRef = extractReferralRefFromCurrentUrl();
    const contextRef = extractReferralRefFromMiniAppContext(context);
    const storedRef = safeGetReferralRef();
    const ref = urlRef ?? contextRef ?? storedRef;

    if (!ref) return;
    setIncomingRef((current) => (current === ref ? current : ref));
    safeSetReferralRef(ref);
  }, [context]);

  useEffect(() => {
    if (!address || !incomingRef) return;

    const referee = address.toLowerCase();
    const recordKey = `${incomingRef}:${referee}`;
    if (incomingRef === referee) {
      safeClearReferralRef(incomingRef);
      return;
    }
    if (recordedReferralKey.current === recordKey) return;

    recordedReferralKey.current = recordKey;
    recordReferral(incomingRef, referee)
      .then(() => safeClearReferralRef(incomingRef))
      .catch(() => {
        recordedReferralKey.current = null;
      });
  }, [address, incomingRef]);

  useEffect(() => {
    const minTimer = window.setTimeout(() => setBootMinDone(true), BOOT_MIN_MS);
    const maxTimer = window.setTimeout(() => setBootMaxDone(true), BOOT_MAX_MS);
    return () => {
      window.clearTimeout(minTimer);
      window.clearTimeout(maxTimer);
    };
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 720px)");
    const sync = () => setIsNarrowScreen(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!isReady || isConnected || autoConnected.current) return;
    if (!isInMiniApp) return;
    if (connectors.length === 0) return;
    autoConnected.current = true;
    connect({ connector: connectors[0] });
  }, [isReady, isInMiniApp, isConnected, connectors, connect]);

  useEffect(() => {
    if (!isReady) {
      setAutoConnectGraceDone(false);
      return;
    }

    if (!isInMiniApp || isConnected || connectors.length === 0) {
      setAutoConnectGraceDone(true);
      return;
    }

    setAutoConnectGraceDone(false);
    const timer = window.setTimeout(() => setAutoConnectGraceDone(true), 1600);
    return () => window.clearTimeout(timer);
  }, [isReady, isInMiniApp, isConnected, connectors.length]);

  useEffect(() => {
    if (connectStatus !== "pending") setConnectingConnectorId(null);
  }, [connectStatus]);

  useEffect(() => {
    if (isConnected && chainId && chainId !== base.id) {
      switchChain({ chainId: base.id });
    }
  }, [isConnected, chainId, switchChain]);

  const loadProfile = useCallback(async () => {
    if (!address) return;
    try {
      const p = await getPlayerProfile(address);
      setProfile(p);
    } catch {
      setProfile(createEmptyProfile(address));
    }
  }, [address]);

  useEffect(() => {
    let cancelled = false;

    if (!address) {
      setProfile(null);
      setCheckin(null);
      setHistory([]);
      setSeason(null);
      setHomeDataReady(true);
      return;
    }

    setHomeDataReady(false);
    setProfile(null);
    setCheckin(null);
    setHistory([]);
    setSeason(null);

    Promise.allSettled([
      getPlayerProfile(address),
      getCheckinStatus(address),
      getPlayerGameHistory(address),
      getSeasonState(address),
    ]).then(([profileResult, checkinResult, historyResult, seasonResult]) => {
      if (cancelled) return;

      setProfile(
        profileResult.status === "fulfilled"
          ? profileResult.value
          : createEmptyProfile(address)
      );
      setCheckin(checkinResult.status === "fulfilled" ? checkinResult.value : null);
      setHistory(
        historyResult.status === "fulfilled"
          ? historyResult.value.slice(0, 4)
          : []
      );
      setSeason(seasonResult.status === "fulfilled" ? seasonResult.value : null);
      setHomeDataReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [address]);

  useEffect(() => {
    if (isConnected && address) setShowWelcome(true);
  }, [isConnected, address]);

  const displayName = context?.user?.displayName || "Captain";
  const isMobileHome = isInMiniApp || isNarrowScreen;
  const profileView = useMemo(
    () => profile ?? createEmptyProfile(address ?? ""),
    [profile, address]
  );
  const sbtWinsLeft = Math.max(0, LIMITED_SBT_REQUIRED_WINS - profileView.totalWins);
  const sbtProgressPct = Math.min(100, (profileView.totalWins / LIMITED_SBT_REQUIRED_WINS) * 100);
  const openCaptainSbt = useCallback(() => {
    router.push("/shop#captain-sbt");
  }, [router]);
  const pcWalletConnectors = useMemo(() => {
    const baseConnectors = connectors.filter(isBaseAccountConnector);
    const otherConnectors = connectors.filter((connector) => !isBaseAccountConnector(connector));
    return [...baseConnectors, ...otherConnectors];
  }, [connectors]);
  const walletCopy = WALLET_COPY[lang === "ru" ? "ru" : "en"];
  const connectWallet = useCallback(
    (connector: (typeof connectors)[number]) => {
      setConnectingConnectorId(connector.id);
      connect({ connector });
    },
    [connect]
  );
  const accountBootSettled =
    accountStatus !== "connecting" && accountStatus !== "reconnecting";
  const walletBootSettled =
    !isInMiniApp ||
    isConnected ||
    connectors.length === 0 ||
    (autoConnectGraceDone && connectStatus !== "pending");
  const miniAppBootSettled = isReady || bootMaxDone;
  const bootReady =
    miniAppBootSettled &&
    (bootMaxDone ||
      (accountBootSettled && walletBootSettled && (!address || homeDataReady)));

  if (!bootMinDone || !bootReady) {
    return <InitialLoader />;
  }

  // ───────── PC welcome (not connected) ─────────
  if (!isMobileHome && miniAppBootSettled && !isInMiniApp && !isConnected) {
    return (
      <div className={styles.welcomeContainer}>
        <SettingsPanel />
        <div className={styles.welcomeCard}>
          <div className={styles.welcomeBadge}>SEA BATTLE ON-CHAIN</div>
          <h1 className={styles.welcomeTitle}>SEA BATTLE</h1>
          <p className={styles.welcomeSub}>{tr.home_pc_hint}</p>
          <div className={styles.walletOptions}>
            {pcWalletConnectors.length === 0 ? (
              <button className={styles.welcomeBtn} disabled type="button">
                <SwordIcon size={18} />
                {walletCopy.noWallet}
              </button>
            ) : (
              pcWalletConnectors.map((connector) => {
                const isBase = isBaseAccountConnector(connector);
                const isPending =
                  connectStatus === "pending" &&
                  connectingConnectorId === connector.id;

                return (
                  <button
                    key={connector.id}
                    className={`${styles.walletOption} ${
                      isBase ? styles.walletOptionPrimary : ""
                    }`}
                    onClick={() => connectWallet(connector)}
                    disabled={connectStatus === "pending"}
                    type="button"
                  >
                    <span className={styles.walletOptionIcon}>
                      {isBase ? <ShieldIcon size={20} /> : <UserIcon size={20} />}
                    </span>
                    <span className={styles.walletOptionText}>
                      <b>{isBase ? "Base Account" : connector.name}</b>
                      <small>{isBase ? walletCopy.baseSub : walletCopy.browserSub}</small>
                    </span>
                    <span className={styles.walletOptionBadge}>
                      {isPending
                        ? walletCopy.connecting
                        : isBase
                          ? walletCopy.recommended
                          : walletCopy.connect}
                    </span>
                  </button>
                );
              })
            )}
          </div>
          {connectError && (
            <p className={styles.connectError}>{connectError.message}</p>
          )}
          <p className={styles.welcomeFeatures}>{tr.home_pc_features}</p>
        </div>
      </div>
    );
  }

  // ───────── Connected ─────────
  return (
    <div className={`${styles.app} ${isMobileHome ? styles.mobileApp : ""}`}>
      <SettingsPanel />
      <AppHeader points={address ? profileView.points : undefined} address={address ?? null} />

      <PlayModal open={showPlay} onClose={() => setShowPlay(false)} />

      {showWelcome && address && (
        <WelcomeCheckin
          address={address}
          onClose={() => {
            setShowWelcome(false);
            getCheckinStatus(address).then(setCheckin).catch(() => {});
          }}
          onCheckedIn={loadProfile}
        />
      )}

      {isMobileHome ? (
        <main className={styles.mobileShell}>
          <div className={styles.mobileTopStats}>
            <div className={`${styles.mobileTopStat} ${styles.mobileTopStatPnl}`}>
              <span>{tr.mobile_pnl}</span>
              <b>
                {profileView.earningsUsdc >= 0 ? "+" : ""}
                {profileView.earningsUsdc.toFixed(2)} USDC
              </b>
            </div>
            <div className={styles.mobileTopStat}>
              <span>{tr.mobile_wins}</span>
              <b>{profileView.totalWins}</b>
            </div>
            <div className={styles.mobileTopStat}>
              <span>{tr.mobile_recent}</span>
              <b>{history.length}</b>
            </div>
          </div>

          {openSection === "quests" ? (
            address && (
              <section className={`${styles.mobilePanel} ${styles.mobileTabPanel}`}>
                <SectionHeader label={tr.home_quests} accent="#3b82f6" />
                <QuestHub
                  address={address}
                  isInMiniApp={isInMiniApp}
                  onPointsChanged={loadProfile}
                />
              </section>
            )
          ) : (
            <>
          <section className={styles.mobileBattlePanel}>
            <div className={styles.mobileBattleHeader}>
              <span>{tr.mobile_your_fleet}</span>
              <span>{tr.mobile_enemy_grid}</span>
            </div>
            <HeroBattleGrid compact />
            <div className={styles.mobileBattleFooter}>
              {tr.mobile_scanning.toUpperCase()}
            </div>
          </section>

          <button
            className={`${styles.playNow} ${styles.mobilePlayNow}`}
            onClick={() => setShowPlay(true)}
            type="button"
          >
            <span className={styles.playNowInner}>
              <SwordIcon size={20} />
              {tr.home_play.toUpperCase()}
            </span>
            <span className={styles.playNowShimmer} aria-hidden="true" />
          </button>

          <SecretSbtCard
            wins={profileView.totalWins}
            winsLeft={sbtWinsLeft}
            progressPct={sbtProgressPct}
            lang={lang}
            onOpen={openCaptainSbt}
          />

          <SeasonRoadmap
            season={season}
            compact
            onOpen={() => router.push("/shop")}
          />

          {openSection === "profile" && (
            <section className={styles.mobilePanel}>
              <SectionHeader label={tr.home_profile_title} accent="#a855f7" />
              <div className={styles.mobileStatsGrid}>
                <div className={styles.mobileStatBox}>
                  <span>{profileView.totalWins}</span>
                  <b>{tr.mobile_wins.toUpperCase()}</b>
                </div>
                <div className={styles.mobileStatBox}>
                  <span>
                    {Math.max(0, profileView.onchainGames - profileView.onchainWins)}
                  </span>
                  <b>{tr.loss.toUpperCase()}</b>
                </div>
                <div className={styles.mobileStatBox}>
                  <span>{profileView.checkinStreak}</span>
                  <b>{tr.streak.toUpperCase()}</b>
                </div>
                <div className={styles.mobileStatBox}>
                  <span>{profileView.totalShots}</span>
                  <b>{tr.shots.toUpperCase()}</b>
                </div>
              </div>
              {address && (
                <div className={styles.mobileReferralBlock}>
                  <SectionHeader label={tr.home_referrals_title} accent="#f59e0b" />
                  <ReferralPanel
                    address={address}
                    refParam={incomingRef}
                    hideHeader
                    expanded
                  />
                </div>
              )}
            </section>
          )}

          <section className={styles.recentSection}>
            <SectionHeader label={tr.recent_games} accent="#3b82f6" />
            {history.length === 0 ? (
              <div className={styles.empty}>{tr.hist_empty}</div>
            ) : (
              history.slice(0, 3).map((g) => (
                <MobileRecentRow key={g.id} game={g} lang={lang} />
              ))
            )}
          </section>

          <div className={styles.mobileSocialRow}>
            <a
              href={TG_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={`${styles.mobileSocial} ${styles.mobileSocialTG}`}
            >
              <TelegramIcon size={14} />
              TELEGRAM
            </a>
            <a
              href={YT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={`${styles.mobileSocial} ${styles.mobileSocialYT}`}
            >
              <YoutubeIcon size={14} />
              YOUTUBE
            </a>
          </div>
            </>
          )}

          <nav className={styles.mobileNav} aria-label="Mobile navigation">
            <button
              className={`${styles.mobileNavItem} ${!openSection ? styles.mobileNavActive : ""}`}
              onClick={() => setOpenSection(null)}
              type="button"
            >
              <AnchorIcon size={18} />
              <span>{tr.mobile_home.toUpperCase()}</span>
            </button>
            <button
              className={`${styles.mobileNavItem} ${openSection === "quests" ? styles.mobileNavActive : ""}`}
              onClick={() => toggleSection("quests")}
              type="button"
            >
              <ShieldIcon size={18} />
              <span>{tr.mobile_quests.toUpperCase()}</span>
            </button>
            <button
              className={`${styles.mobileNavItem} ${openSection === "profile" ? styles.mobileNavActive : ""}`}
              onClick={() => toggleSection("profile")}
              type="button"
            >
              <UserIcon size={18} />
              <span>{tr.mobile_profile.toUpperCase()}</span>
            </button>
            <button
              className={styles.mobileNavItem}
              onClick={() => router.push("/shop")}
              type="button"
            >
              <ShopIcon size={18} />
              <span>{tr.mobile_shop.toUpperCase()}</span>
            </button>
            <button
              className={styles.mobileNavItem}
              onClick={() => router.push("/leaderboard")}
              type="button"
            >
              <TrophyIcon size={18} />
              <span>{tr.mobile_top.toUpperCase()}</span>
            </button>
          </nav>
        </main>
      ) : (
      <main className={styles.layout}>
        {/* ───── LEFT COLUMN ───── */}
        <aside className={styles.leftCol}>
          <HomeCard
            Icon={CheckIcon}
            title={tr.home_checkin_title}
            subtitle={
              checkin
                ? checkin.canCheckin
                  ? `${tr.streak}: ${checkin.streak}d · +${checkin.nextReward} ${tr.shop_pts}`
                  : tr.home_checkin_done
                : tr.home_checkin_sub
            }
            badge={checkin?.canCheckin ? `+${checkin.nextReward} PTS` : undefined}
            accent="#00dcb4"
            active={!!checkin && !checkin.canCheckin}
            onClick={() => setShowWelcome(true)}
          >
            <CheckinDots streak={checkin?.streak ?? 0} />
          </HomeCard>

          <HomeCard
            Icon={ShieldIcon}
            title={tr.home_quests}
            subtitle={tr.home_quests_sub}
            accent="#3b82f6"
            active={openSection === "quests"}
            onClick={() => toggleSection("quests")}
          />
          {address && openSection === "quests" && (
            <div className={styles.expandedPanel}>
              <QuestHub
                address={address}
                isInMiniApp={isInMiniApp}
                onPointsChanged={loadProfile}
              />
            </div>
          )}

          <HomeCard
            Icon={UserIcon}
            title={tr.home_profile_title}
            subtitle={`${displayName} - ${profileView.totalWins}W ${Math.max(0, profileView.onchainGames - profileView.onchainWins)}L`}
            badge={`${profileView.points}`}
            accent="#a855f7"
            active={openSection === "profile"}
            onClick={() => toggleSection("profile")}
          >
            <div className={styles.profileStats}>
              {[
                { val: profileView.totalWins, key: tr.mobile_wins.toUpperCase(), color: "#00dcb4" },
                {
                  val: Math.max(0, profileView.onchainGames - profileView.onchainWins),
                  key: tr.loss.toUpperCase(),
                  color: "#ef4444",
                },
                { val: profileView.checkinStreak, key: tr.streak.toUpperCase(), color: "#f59e0b" },
              ].map((s) => (
                <div key={s.key} className={styles.profileStatBox}>
                  <div
                    className={styles.profileStatValue}
                    style={{ color: s.color }}
                  >
                    {s.val}
                  </div>
                  <div className={styles.profileStatKey}>{s.key}</div>
                </div>
              ))}
            </div>
          </HomeCard>
          {openSection === "profile" && (
            <div className={styles.expandedPanel}>
              <div className={styles.profileFull}>
                <div className={styles.profileFullRow}>
                  <span>{tr.onchain_winrate}</span>
                  <b>
                    {profileView.onchainGames > 0
                      ? `${Math.round(profileView.onchainWinRate * 100)}% (${profileView.onchainWins}/${profileView.onchainGames})`
                      : "—"}
                  </b>
                </div>
                <div className={styles.profileFullRow}>
                  <span>{tr.net_pnl}</span>
                  <b
                    style={{
                      color: profileView.earningsUsdc >= 0 ? "#00dcb4" : "#ef4444",
                    }}
                  >
                    {profileView.earningsUsdc >= 0 ? "+" : ""}
                    {profileView.earningsUsdc.toFixed(2)} USDC
                  </b>
                </div>
                <div className={styles.profileFullRow}>
                  <span>{tr.shots}</span>
                  <b>{profileView.totalShots}</b>
                </div>
                <div className={styles.profileFullRow}>
                  <span>{tr.checkins}</span>
                  <b>{profileView.totalCheckins}</b>
                </div>
              </div>
            </div>
          )}

          <SecretSbtCard
            wins={profileView.totalWins}
            winsLeft={sbtWinsLeft}
            progressPct={sbtProgressPct}
            lang={lang}
            onOpen={openCaptainSbt}
          />

          <HomeCard
            Icon={UsersIcon}
            title={tr.home_referrals_title}
            subtitle={tr.referrals_sub}
            accent="#f59e0b"
            active={openSection === "referrals"}
            onClick={() => toggleSection("referrals")}
          />
          {address && openSection === "referrals" && (
            <div className={styles.expandedPanel}>
              <ReferralPanel
                address={address}
                refParam={incomingRef}
                hideHeader
                expanded
              />
            </div>
          )}

          <HomeCard
            Icon={TrophyIcon}
            title={tr.home_leaderboard}
            subtitle={tr.home_leaderboard_sub}
            accent="#fbbf24"
            onClick={() => router.push("/leaderboard")}
          />
        </aside>

        {/* ───── CENTER COLUMN ───── */}
        <section className={styles.centerCol}>
          <HeroBattleGrid />

          <button
            className={styles.playNow}
            onClick={() => setShowPlay(true)}
            type="button"
          >
            <span className={styles.playNowInner}>
              <SwordIcon size={22} />
              {tr.home_play.toUpperCase()}
            </span>
            <span className={styles.playNowShimmer} aria-hidden="true" />
          </button>

          <div className={styles.recentSection}>
            <SectionHeader label={tr.recent_games} accent="#3b82f6" />
            {history.length === 0 ? (
              <div className={styles.empty}>{tr.hist_empty}</div>
            ) : (
              history.map((g) => (
                <RecentRow key={g.id} game={g} lang={lang} />
              ))
            )}
          </div>
        </section>

        {/* ───── RIGHT COLUMN ───── */}
        <aside className={styles.rightCol}>
          <div className={styles.shopHeader}>
            <button
              className={styles.shopTab}
              onClick={() => router.push("/shop")}
              type="button"
            >
              <ShopIcon size={16} />
              {tr.home_shop.toUpperCase()}
              <ChevronRightIcon size={14} />
            </button>
          </div>

          <div className={styles.shopBody}>
            <ShopPreview
              season={season}
              onOpen={() => router.push("/shop")}
            />
          </div>

          <div className={styles.socialRow}>
            <a
              href={TG_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={`${styles.socialBig} ${styles.socialTG}`}
            >
              <span className={styles.socialBigIcon}>
                <TelegramIcon size={48} />
              </span>
              <span className={styles.socialBigLabel}>TELEGRAM</span>
              <span className={styles.socialBigSub}>{tr.social_join}</span>
            </a>
            <a
              href={YT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={`${styles.socialBig} ${styles.socialYT}`}
            >
              <span className={styles.socialBigIcon}>
                <YoutubeIcon size={48} />
              </span>
              <span className={styles.socialBigLabel}>YOUTUBE</span>
              <span className={styles.socialBigSub}>{tr.social_watch}</span>
            </a>
          </div>

          <div className={styles.versionFooter}>SEA BATTLE ON-CHAIN · v2.0</div>
        </aside>
      </main>
      )}

      {/* Mobile bottom Play Now FAB (PC layout already has the big button) */}
    </div>
  );
}

/* ─── helpers ─── */

function isBaseAccountConnector(connector: { id: string; name: string }) {
  const id = connector.id.toLowerCase();
  const name = connector.name.toLowerCase();
  return id.includes("base") || name.includes("base account");
}

const WALLET_COPY = {
  en: {
    baseSub: "Smart wallet for Base games",
    browserSub: "Use an installed browser wallet",
    recommended: "Best",
    connect: "Connect",
    connecting: "Opening",
    noWallet: "No wallet found",
  },
  ru: {
    baseSub: "Смарт-кошелек для игр на Base",
    browserSub: "Через установленный кошелек браузера",
    recommended: "Лучше",
    connect: "Подключить",
    connecting: "Открываем",
    noWallet: "Кошелек не найден",
  },
};

const bootFallback: Record<string, CSSProperties> = {
  screen: {
    minHeight: "100dvh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    color: "#eaf4ff",
    background:
      "radial-gradient(circle at 50% 0%, rgba(0, 212, 255, 0.16), transparent 48%), linear-gradient(180deg, var(--bg-abyss, #020814), var(--bg-primary, #0a1628))",
    fontFamily: "var(--font-rajdhani), Rajdhani, system-ui, sans-serif",
  },
  panel: {
    width: "min(420px, 100%)",
    overflow: "hidden",
    border: "1px solid rgba(var(--accent-rgb, 0, 212, 255), 0.34)",
    borderRadius: 8,
    padding: "30px 22px 24px",
    background:
      "linear-gradient(rgba(var(--accent-rgb, 0, 212, 255), 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(var(--accent-rgb, 0, 212, 255), 0.05) 1px, transparent 1px), linear-gradient(160deg, rgba(var(--bg-secondary-rgb, 15, 36, 64), 0.78), rgba(var(--bg-abyss-rgb, 2, 8, 20), 0.96))",
    backgroundSize: "22px 22px, 22px 22px, auto",
    boxShadow: "0 0 36px rgba(var(--accent-rgb, 0, 212, 255), 0.2), 0 20px 54px rgba(0, 0, 0, 0.52)",
  },
  radar: {
    position: "relative",
    width: 150,
    aspectRatio: "1",
    margin: "0 auto 22px",
    borderRadius: "50%",
    border: "1px solid rgba(var(--accent-rgb, 0, 212, 255), 0.34)",
    background:
      "radial-gradient(circle, rgba(var(--accent-rgb, 0, 212, 255), 0.18) 0 2px, transparent 3px), repeating-radial-gradient(circle, transparent 0 24px, rgba(var(--accent-rgb, 0, 212, 255), 0.16) 25px, transparent 26px)",
    boxShadow: "inset 0 0 24px rgba(var(--accent-rgb, 0, 212, 255), 0.16), 0 0 30px rgba(var(--accent-rgb, 0, 212, 255), 0.22)",
  },
  core: {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: 58,
    height: 58,
    transform: "translate(-50%, -50%)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "50%",
    color: "var(--bg-abyss, #020814)",
    background: "linear-gradient(135deg, var(--accent-bright, #4dffd4), var(--accent, #00d4ff))",
    boxShadow: "0 0 22px rgba(var(--accent-rgb, 0, 212, 255), 0.55)",
  },
  copy: {
    textAlign: "center",
  },
  eyebrow: {
    fontFamily: "var(--font-orbitron), Orbitron, monospace",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.28em",
    color: "rgba(var(--accent-rgb, 0, 212, 255), 0.78)",
  },
  title: {
    margin: "9px 0 18px",
    fontFamily: "var(--font-orbitron), Orbitron, monospace",
    fontSize: 28,
    fontWeight: 900,
    letterSpacing: "0.12em",
    color: "#fff",
  },
  progress: {
    width: "100%",
    height: 5,
    overflow: "hidden",
    borderRadius: 999,
    border: "1px solid rgba(var(--accent-rgb, 0, 212, 255), 0.22)",
    background: "rgba(255, 255, 255, 0.06)",
  },
  progressBar: {
    display: "block",
    width: "70%",
    height: "100%",
    borderRadius: "inherit",
    background: "linear-gradient(90deg, var(--accent, #00d4ff), var(--accent-bright, #4dffd4), #a855f7)",
  },
  checks: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 7,
    marginTop: 14,
  },
  check: {
    minWidth: 0,
    overflow: "hidden",
    border: "1px solid rgba(var(--accent-rgb, 0, 212, 255), 0.18)",
    borderRadius: 6,
    padding: "6px 5px",
    background: "rgba(255, 255, 255, 0.035)",
    color: "rgba(255, 255, 255, 0.62)",
    fontFamily: "var(--font-orbitron), Orbitron, monospace",
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textAlign: "center",
    whiteSpace: "nowrap",
  },
};

function InitialLoader() {
  const checks = ["MINIAPP", "WALLET", "PROFILE", "FLEET"];

  return (
    <main
      className={styles.bootScreen}
      style={bootFallback.screen}
      role="status"
      aria-live="polite"
    >
      <div className={styles.bootPanel} style={bootFallback.panel}>
        <div className={styles.bootRadar} style={bootFallback.radar} aria-hidden="true">
          <span className={styles.bootSweep} />
          <span className={styles.bootRing} />
          <span className={styles.bootRing} />
          <span className={styles.bootCore} style={bootFallback.core}>
            <AnchorIcon size={28} />
          </span>
        </div>

        <div className={styles.bootCopy} style={bootFallback.copy}>
          <div className={styles.bootEyebrow} style={bootFallback.eyebrow}>
            SEA BATTLE ON-CHAIN
          </div>
          <h1 className={styles.bootTitle} style={bootFallback.title}>
            SYNCING FLEET
          </h1>
          <div className={styles.bootProgress} style={bootFallback.progress} aria-hidden="true">
            <span style={bootFallback.progressBar} />
          </div>
          <div className={styles.bootChecks} style={bootFallback.checks} aria-hidden="true">
            {checks.map((check) => (
              <span key={check} style={bootFallback.check}>
                {check}
              </span>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}

function createEmptyProfile(wallet: string): PlayerProfile {
  return {
    wallet: wallet.toLowerCase(),
    points: 0,
    totalCheckins: 0,
    checkinStreak: 0,
    totalWins: 0,
    totalShots: 0,
    onchainGames: 0,
    onchainWins: 0,
    onchainWinRate: 0,
    earningsUsdc: 0,
  };
}

function safeGetReferralRef(): string | null {
  try {
    return normalizeReferralRef(window.localStorage.getItem(REFERRAL_STORAGE_KEY));
  } catch {
    return null;
  }
}

function safeSetReferralRef(ref: string) {
  try {
    window.localStorage.setItem(REFERRAL_STORAGE_KEY, ref);
  } catch {
    // ignore
  }
}

function safeClearReferralRef(ref: string) {
  try {
    if (window.localStorage.getItem(REFERRAL_STORAGE_KEY) === ref) {
      window.localStorage.removeItem(REFERRAL_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

function CheckinDots({ streak }: { streak: number }) {
  const days = [0, 1, 2, 3, 4, 5, 6];
  const done = Math.min(7, streak);
  return (
    <div className={styles.checkinDots}>
      {days.map((d) => (
        <span
          key={d}
          className={`${styles.dot} ${d < done ? styles.dotOn : ""}`}
        />
      ))}
    </div>
  );
}

function SectionHeader({ label, accent }: { label: string; accent: string }) {
  return (
    <div className={styles.sectionHeader}>
      <span
        className={styles.sectionBar}
        style={{ background: accent, boxShadow: `0 0 8px ${accent}` }}
      />
      <span className={styles.sectionLabel} style={{ color: accent }}>
        {label}
      </span>
    </div>
  );
}

function SecretSbtCard({
  wins,
  winsLeft,
  progressPct,
  lang,
  onOpen,
}: {
  wins: number;
  winsLeft: number;
  progressPct: number;
  lang: string;
  onOpen: () => void;
}) {
  const ru = lang === "ru";
  const unlocked = winsLeft === 0;
  return (
    <button className={styles.secretSbtCard} onClick={onOpen} type="button">
      <span className={styles.secretSbtScan} aria-hidden="true" />
      <span className={styles.secretSbtIcon} aria-hidden="true">
        ?
      </span>
      <span className={styles.secretSbtBody}>
        <span className={styles.secretSbtTopline}>
          <span className={styles.secretSbtKicker}>SECRET ITEM????</span>
          <span className={styles.secretSbtBadge}>
            {unlocked ? (ru ? "ДОСТУПНО" : "READY") : `${wins}/${LIMITED_SBT_REQUIRED_WINS}`}
          </span>
        </span>
        <span className={styles.secretSbtTitle}>
          {ru ? "Captain SBT" : "Captain SBT"}
        </span>
        <span className={styles.secretSbtDesc}>
          {unlocked
            ? ru
              ? "Минт открыт. Только 20 soulbound-пропусков."
              : "Mint unlocked. Only 20 soulbound passes."
            : ru
              ? `${winsLeft} побед до on-chain SBT · ${LIMITED_SBT_WEEKLY_POINTS.toLocaleString()} pts/нед.`
              : `${winsLeft} wins left · ${LIMITED_SBT_WEEKLY_POINTS.toLocaleString()} pts/week`}
        </span>
        <span className={styles.secretSbtProgress}>
          <span style={{ width: `${progressPct}%` }} />
        </span>
        <span className={styles.secretSbtMeta}>
          <span>{LIMITED_SBT_MAX_SUPPLY} TOTAL</span>
          <span>{ru ? "SOULBOUND" : "SOULBOUND"}</span>
        </span>
      </span>
      <ChevronRightIcon size={16} />
    </button>
  );
}

function RecentRow({ game, lang }: { game: GameHistoryEntry; lang: string }) {
  const tr = TR[lang === "ru" ? "ru" : "en"];
  const win = game.result === "win";
  const accent = win ? "#00dcb4" : "#ef4444";
  const opp = game.opponent
    ? `${game.opponent.slice(0, 6)}…${game.opponent.slice(-4)}`
    : tr.ai_bot.toUpperCase();
  const modeLabel =
    game.mode === "wager"
      ? tr.wager_upper.toUpperCase()
      : game.mode === "bot" || game.mode === "solo"
        ? tr.bot_upper.toUpperCase()
        : tr.pvp.toUpperCase();
  const wagerStr =
    game.wager > 0 ? `${(game.wager / 1_000_000).toFixed(0)} USDC` : null;
  const date = new Date(game.date).toLocaleDateString(
    lang === "ru" ? "ru" : "en",
    { month: "short", day: "numeric" }
  );
  return (
    <div className={styles.recentRow}>
      <span
        className={styles.recentDot}
        style={{ background: accent, boxShadow: `0 0 6px ${accent}` }}
      />
      <span className={styles.recentOpp}>{opp}</span>
      <span className={styles.recentMode}>{modeLabel}</span>
      {wagerStr && <span className={styles.recentWager}>{wagerStr}</span>}
      <span className={styles.recentResult} style={{ color: accent }}>
        {win ? tr.win_short.toUpperCase() : tr.loss_short.toUpperCase()}
      </span>
      <span className={styles.recentDate}>{date}</span>
    </div>
  );
}

function MobileRecentRow({ game, lang }: { game: GameHistoryEntry; lang: string }) {
  const tr = TR[lang === "ru" ? "ru" : "en"];
  const win = game.result === "win";
  const accent = win ? "#00dcb4" : "#ef4444";
  const opp = game.opponent
    ? `${game.opponent.slice(0, 6)}...${game.opponent.slice(-4)}`
    : tr.ai_bot.toUpperCase();
  const date = new Date(game.date).toLocaleDateString(
    lang === "ru" ? "ru" : "en",
    { month: "short", day: "numeric" }
  );

  return (
    <div className={styles.mobileRecentRow}>
      <span
        className={styles.recentDot}
        style={{ background: accent, boxShadow: `0 0 6px ${accent}` }}
      />
      <span className={styles.mobileRecentOpp}>{opp}</span>
      <span className={styles.mobileRecentResult} style={{ color: accent }}>
        {win ? tr.win_short.toUpperCase() : tr.loss_short.toUpperCase()}
      </span>
      <span className={styles.mobileRecentDate}>{date}</span>
    </div>
  );
}

function ShopPreview({
  season,
  onOpen,
}: {
  season: SeasonState | null;
  onOpen: () => void;
}) {
  const { lang } = useSettings();
  const tr = TR[lang];
  const itemMeta: Record<ShopItemSlug, { rarity: string; accent: string }> = {
    double_points_1h: { rarity: tr.tier_legendary.toUpperCase(), accent: "#ffc850" },
    quest_reroll: { rarity: tr.tier_rare.toUpperCase(), accent: "#00dcb4" },
    streak_freeze: { rarity: tr.tier_epic.toUpperCase(), accent: "#7dd3fc" },
    radar_scan: { rarity: tr.tier_rare.toUpperCase(), accent: "#4ade80" },
    torpedo: { rarity: tr.tier_epic.toUpperCase(), accent: "#fb7185" },
  };
  const shopPreviewItems: Array<{
    kind: ItemArtKind;
    name: string;
    desc: string;
    price: string;
    rarity: string;
    accent: string;
  }> = [
    {
      kind: "bomb_3x3",
      name: tr.shop_bomb_title.toUpperCase(),
      desc: tr.shop_bomb_desc,
      price: "2 USDC",
      rarity: tr.tier_premium.toUpperCase(),
      accent: "#00dcb4",
    },
    ...SHOP_ITEMS.filter((item) => item.enabled).map((item) => {
      const copy = shopItemText(item, lang);
      return {
        kind: item.slug,
        name: copy.name.toUpperCase(),
        desc: copy.desc,
        price: `${item.pricePoints?.toLocaleString()} ${tr.shop_pts.toUpperCase()}`,
        rarity: itemMeta[item.slug].rarity,
        accent: itemMeta[item.slug].accent,
      };
    }),
  ];

  return (
    <div className={styles.shopPreview}>
      <SeasonRoadmap season={season} onOpen={onOpen} />

      <SectionHeader label={tr.shop_featured_armory.toUpperCase()} accent="#00dcb4" />
      {shopPreviewItems.map((it, i) => (
        <button
          key={i}
          className={styles.shopItem}
          style={{ ["--accent" as string]: it.accent }}
          onClick={onOpen}
          type="button"
        >
          <ItemArt kind={it.kind} size="small" className={styles.shopItemArt} />
          <span className={styles.shopItemBody}>
            <span className={styles.shopItemRarity}>{it.rarity}</span>
            <span className={styles.shopItemName}>{it.name}</span>
            <span className={styles.shopItemDesc}>{it.desc}</span>
          </span>
          <span className={styles.shopItemPrice}>{it.price}</span>
        </button>
      ))}

      <button className={styles.openShopBtn} onClick={onOpen} type="button">
        {tr.shop_open_shop.toUpperCase()}
      </button>
    </div>
  );
}

function getNearbySeasonLevels(currentLevel: number): number[] {
  const count = 4;
  const maxStart = Math.max(1, SEASON_MAX_LEVEL - count + 1);
  const start = Math.min(Math.max(1, currentLevel + 1), maxStart);
  return Array.from({ length: count }, (_, index) => start + index);
}

function SeasonRoadmap({
  season,
  compact = false,
}: {
  season: SeasonState | null;
  compact?: boolean;
  onOpen?: () => void;
}) {
  const { lang } = useSettings();
  const tr = TR[lang];
  const currentLevel = Math.min(season?.level ?? 0, SEASON_MAX_LEVEL);
  const visibleLevels = getNearbySeasonLevels(currentLevel);
  const selected =
    SEASON_LEVELS.find((level) => level.level === visibleLevels[0]) ??
    SEASON_LEVELS[0];
  const currentXp = season?.xp ?? 0;
  const nextLevelXp = season?.nextLevelXp ?? SEASON_LEVELS[0]?.xpRequired ?? 50;
  const xpToNextLevel = season?.nextLevelXp
    ? Math.max(0, season.nextLevelXp - currentXp)
    : 0;
  const nextLevelNumber = Math.min(currentLevel + 1, SEASON_MAX_LEVEL);
  const progressPct = season?.nextLevelXp
    ? Math.min(100, (currentXp / season.nextLevelXp) * 100)
    : currentLevel >= SEASON_MAX_LEVEL
      ? 100
      : 0;
  const selectedRewardKind: ItemArtKind =
    selected.reward.kind === "item" ? selected.reward.slug : "points";

  return (
    <section className={`${styles.seasonRoadmap} ${compact ? styles.seasonRoadmapCompact : ""}`}>
      <div className={styles.seasonRoadmapHead}>
        <span>
          <span className={styles.seasonKicker}>{tr.season_route.toUpperCase()}</span>
          <b>{tr.shop_level} {currentLevel}/{SEASON_MAX_LEVEL}</b>
        </span>
        <span className={styles.seasonXpPill}>
          {season?.nextLevelXp
            ? `${currentXp.toLocaleString()} / ${nextLevelXp.toLocaleString()} XP`
            : `${currentXp.toLocaleString()} XP`}
        </span>
      </div>

      <div className={styles.seasonProgressLine}>
        <span style={{ width: `${progressPct}%` }} />
      </div>

      <div className={styles.seasonHow}>
        <span><b>+1 XP</b> {tr.season_per_hit}</span>
        <span><b>+50 XP</b> {tr.season_per_win}</span>
        <span><b>+20 XP</b> {tr.season_checkin}</span>
      </div>

      <div className={styles.seasonMilestones}>
        {visibleLevels.map((level, index) => {
          const def = SEASON_LEVELS.find((entry) => entry.level === level)!;
          const reached = currentLevel >= level;
          const rewardKind: ItemArtKind =
            def.reward.kind === "item" ? def.reward.slug : "points";
          return (
            <div
              key={level}
              className={`${styles.seasonMilestone} ${
                reached ? styles.seasonMilestoneReached : ""
              }`}
              style={{
                ["--route-blur" as string]: `${index * 0.65}px`,
                ["--route-opacity" as string]: `${1 - index * 0.1}`,
              }}
            >
              <span className={styles.seasonMilestoneDot}>{level}</span>
              <span className={styles.seasonMilestoneIconShell}>
                <ItemArt kind={rewardKind} size="small" className={styles.seasonMilestoneArt} />
              </span>
              <span className={styles.seasonMilestoneReward}>
                {rewardLabel(def.reward, lang)}
              </span>
            </div>
          );
        })}
      </div>

      <div className={styles.seasonRewardPreview}>
        <span className={styles.seasonRewardLabel}>
          {tr.shop_level} {selected.level} {tr.season_reward}
        </span>
        <span className={styles.seasonRewardMain}>
          <ItemArt kind={selectedRewardKind} size="tiny" className={styles.seasonRewardArt} />
          <b>{rewardLabel(selected.reward, lang)}</b>
        </span>
        <small>
          {season?.nextLevelXp
            ? `${xpToNextLevel.toLocaleString()} ${tr.shop_xp_to_level} ${nextLevelNumber}`
            : tr.season_complete}
        </small>
      </div>
    </section>
  );
}
