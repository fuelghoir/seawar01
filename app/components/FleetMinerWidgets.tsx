"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { base } from "wagmi/chains";
import { useReadContract } from "wagmi";
import { DROP_CLAIM_CONTRACT_ADDRESS } from "../contracts/dropClaimAbi";
import {
  FLEET_NFT_CONTRACT_ADDRESS,
  fleetPassAbi,
} from "../contracts/fleetPassAbi";
import { erc20Abi, USDC_ADDRESS } from "../contracts/seaBattleAbi";
import {
  EMPTY_FLEET_STATE,
  formatUsdc,
  parseFleetState,
  ZERO_ADDRESS,
} from "../lib/fleetNft";
import { useSettings } from "../lib/settings";
import { USDC_SEASON_REWARDS_ENABLED } from "../lib/featureFlags";
import styles from "./FleetMinerWidgets.module.css";

function useFleetMinerState(address?: `0x${string}`) {
  const { data, isLoading } = useReadContract({
    address: FLEET_NFT_CONTRACT_ADDRESS,
    abi: fleetPassAbi,
    functionName: "fleetStateOf",
    args: [address || ZERO_ADDRESS],
    chainId: base.id,
    query: {
      enabled: !!address && FLEET_NFT_CONTRACT_ADDRESS !== ZERO_ADDRESS,
      refetchInterval: 10_000,
    },
  });

  return {
    fleet: parseFleetState(data) ?? EMPTY_FLEET_STATE,
    loaded: !address || (!isLoading && data !== undefined),
  };
}

export function SeasonPoolCard({
  variant = "default",
  address,
  showEstimate = false,
  clickable = true,
}: {
  variant?: "default" | "wide" | "sidebar";
  address?: `0x${string}`;
  showEstimate?: boolean;
  clickable?: boolean;
}) {
  const { lang } = useSettings();
  const ru = lang === "ru";
  const [estimate, setEstimate] = useState<{
    walletPoints: number;
    walletTransactions: number;
    eligible: boolean;
    minPoints: number;
    minTransactions: number;
    totalPoints: number;
    rank: number | null;
  } | null>(null);
  const { data: vaultBalance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [DROP_CLAIM_CONTRACT_ADDRESS],
    chainId: base.id,
    query: {
      enabled: DROP_CLAIM_CONTRACT_ADDRESS !== ZERO_ADDRESS,
      refetchInterval: 20_000,
    },
  });

  useEffect(() => {
    if (!showEstimate || !address) {
      setEstimate(null);
      return;
    }

    let cancelled = false;
    fetch(`/api/season-reward-estimate?wallet=${encodeURIComponent(address)}`, {
      cache: "no-store",
    })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || data?.error) return;
        setEstimate({
          walletPoints: Number(data.walletPoints ?? 0),
          walletTransactions: Number(data.walletTransactions ?? 0),
          eligible: Boolean(data.eligible),
          minPoints: Number(data.minPoints ?? 3000),
          minTransactions: Number(data.minTransactions ?? 10),
          totalPoints: Number(data.totalPoints ?? 0),
          rank: data.rank == null ? null : Number(data.rank),
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [address, showEstimate]);

  const estimatedReward =
    vaultBalance !== undefined && estimate?.eligible && estimate.totalPoints
      ? (vaultBalance * BigInt(Math.max(0, estimate.walletPoints))) /
        BigInt(Math.max(1, estimate.totalPoints))
      : null;
  const sharePct =
    estimate?.eligible && estimate.totalPoints && estimate.walletPoints > 0
      ? Math.max(0.01, (estimate.walletPoints / estimate.totalPoints) * 100)
      : 0;
  const className = `${styles.poolCard} ${clickable ? styles.poolCardLink : ""} ${
    variant === "wide" ? styles.poolCardWide : ""
  } ${variant === "sidebar" ? styles.poolCardSidebar : ""}`;

  const content = (
    <>
      <div className={styles.poolTop}>
        <span>{ru ? "СЕЗОННЫЙ ПУЛ" : "SEASON REWARD POOL"}</span>
        <b>S1</b>
      </div>
      <div className={styles.poolAmount}>
        <small>{ru ? "ТЕКУЩИЙ ПУЛ" : "CURRENT POOL"}</small>
        <strong>{vaultBalance === undefined ? "-- USDC" : formatUsdc(vaultBalance)}</strong>
      </div>
      {showEstimate && (
        <div className={styles.poolEstimate}>
          <span>{ru ? "ТВОЯ ПРИМЕРНАЯ НАГРАДА" : "YOUR EST. REWARD"}</span>
          <b>
            {!estimate
              ? "-- USDC"
              : !estimate.eligible
                ? ru ? "ПОКА НЕ ELIGIBLE" : "NOT ELIGIBLE YET"
                : estimatedReward === null
                  ? "-- USDC"
                  : `≈ ${formatUsdc(estimatedReward)}`}
          </b>
          <small>
            {estimate
              ? estimate.eligible
                ? `${estimate.walletPoints.toLocaleString()} pts · ${estimate.walletTransactions}/${
                    estimate.minTransactions
                  } tx · ${sharePct > 0 ? `~${sharePct.toFixed(2)}%` : "0%"}${
                    estimate.rank ? ` · #${estimate.rank}` : ""
                  }`
                : ru
                  ? `Нужно ${estimate.minPoints.toLocaleString()} pts и ${
                      estimate.minTransactions
                    } tx · сейчас ${estimate.walletPoints.toLocaleString()} pts / ${
                      estimate.walletTransactions
                    } tx`
                  : `Need ${estimate.minPoints.toLocaleString()} pts and ${
                      estimate.minTransactions
                    } tx · now ${estimate.walletPoints.toLocaleString()} pts / ${
                      estimate.walletTransactions
                    } tx`
              : ru
                ? "Считаем долю..."
                : "Calculating share..."}
          </small>
        </div>
      )}
      <div className={styles.poolMeta}>
        <span>{ru ? "80% чистой выручки в пул" : "80% net revenue to pool"}</span>
        <span>{ru ? "18.07.2026 · 00:00 UTC" : "Jul 18, 2026 · 00:00 UTC"}</span>
      </div>
      {clickable && (
        <em className={styles.poolCta}>{ru ? "Открыть сезон →" : "Open season →"}</em>
      )}
    </>
  );

  if (clickable) {
    return (
      <Link href="/season" className={className} aria-label={ru ? "Открыть награды сезона" : "Open season rewards"}>
        {content}
      </Link>
    );
  }

  return (
    <section className={className}>
      {content}
    </section>
  );
}

export function SeasonRewardsIntro({
  open,
  onClose,
  onOpenProfile,
}: {
  open: boolean;
  onClose: () => void;
  onOpenProfile: () => void;
}) {
  const { lang } = useSettings();
  const ru = lang === "ru";

  if (!open) return null;

  const openProfile = () => {
    onClose();
    onOpenProfile();
  };

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <section className={`${styles.modal} ${styles.seasonModal}`} onClick={(event) => event.stopPropagation()}>
        <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Close">×</button>
        <span className={styles.modalKicker}>{ru ? "СЕЗОННЫЙ USDC ДРОП" : "USDC REWARD SEASON"}</span>
        <h2>{ru ? "БИТВА ЗА ПУЛ НАГРАД" : "BATTLE FOR THE REWARD POOL"}</h2>
        <p>
          {ru
            ? "Играй, набирай очки и попади в снапшот. После окончания сезона claim появится в профиле."
            : "Play, earn points, and enter the snapshot. After the season ends, your claim appears in Profile."}
        </p>
        <SeasonPoolCard variant="wide" />
        <div className={styles.modalStats}>
          <span><b>80%</b>{ru ? " В ПУЛ" : " TO POOL"}</span>
          <span><b>18.07</b>00:00 UTC</span>
        </div>
        <button type="button" className={styles.modalAction} onClick={openProfile}>
          {ru ? "ОТКРЫТЬ ПРОФИЛЬ" : "OPEN PROFILE"}
        </button>
        <button type="button" className={styles.modalLater} onClick={onClose}>
          {ru ? "ПРОДОЛЖИТЬ" : "CONTINUE"}
        </button>
      </section>
    </div>
  );
}

export function FleetMinerSummary({
  address,
  onOpen,
}: {
  address?: `0x${string}`;
  onOpen: () => void;
}) {
  const { lang } = useSettings();
  const ru = lang === "ru";
  const { fleet } = useFleetMinerState(address);
  const owned = fleet.tokenId > 0;
  const visualTier = Math.max(1, fleet.tier || 1);

  return (
    <div className={styles.summaryStack}>
      <section className={styles.minerCard}>
        <div className={styles.minerGlow} aria-hidden="true" />
        <Image
          className={styles.minerShip}
          src={`/nft/fleet-tier-${visualTier}.png`}
          width={280}
          height={196}
          alt=""
        />
        <div className={styles.minerCopy}>
          <span>{ru ? "NFT МАЙНЕР" : "NFT POINT MINER"}</span>
          <h2>{owned ? `T${fleet.tier} · LVL ${fleet.level}` : ru ? "ДОБЫВАЙ POINTS" : "MINE POINTS"}</h2>
          <p>
            {owned
              ? `${fleet.pointsPerHour} PTS/H · ${fleet.claimablePoints.toLocaleString()} ${ru ? "ГОТОВО" : "READY"}`
              : ru ? "Корабль добывает +50 points каждый час." : "Your ship mines +50 points every hour."}
          </p>
        </div>
        <button type="button" onClick={onOpen}>
          {owned
            ? ru ? "УЛУЧШИТЬ МАЙНЕР" : "UPGRADE MINER"
            : ru ? "КУПИТЬ · 0.5 USDC" : "BUY · 0.5 USDC"}
        </button>
      </section>
      {USDC_SEASON_REWARDS_ENABLED && (
        <SeasonPoolCard address={address} showEstimate={!!address} />
      )}
    </div>
  );
}

export function FleetMinerPromo({
  address,
  blocked = false,
  onOpen,
}: {
  address?: `0x${string}`;
  blocked?: boolean;
  onOpen: () => void;
}) {
  const { lang } = useSettings();
  const ru = lang === "ru";
  const { fleet, loaded } = useFleetMinerState(address);
  const [open, setOpen] = useState(false);
  const storageKey = useMemo(
    () => address ? `seabattle_fleet_miner_intro_${address.toLowerCase()}` : "",
    [address]
  );

  useEffect(() => {
    if (!address || !loaded || blocked || fleet.tokenId > 0 || !storageKey) {
      setOpen(false);
      return;
    }
    if (sessionStorage.getItem(storageKey) === "1") return;
    const timer = window.setTimeout(() => setOpen(true), 500);
    return () => window.clearTimeout(timer);
  }, [address, blocked, fleet.tokenId, loaded, storageKey]);

  const dismiss = () => {
    if (storageKey) sessionStorage.setItem(storageKey, "1");
    setOpen(false);
  };

  const openShop = () => {
    dismiss();
    onOpen();
  };

  if (!open) return null;

  return (
    <div className={styles.modalBackdrop} onClick={dismiss}>
      <section className={styles.modal} onClick={(event) => event.stopPropagation()}>
        <button type="button" className={styles.modalClose} onClick={dismiss} aria-label="Close">×</button>
        <span className={styles.modalKicker}>{ru ? "ПАССИВНАЯ ДОБЫЧА" : "PASSIVE POINT MINING"}</span>
        <Image
          className={styles.modalShip}
          src="/nft/fleet-tier-1.png"
          width={420}
          height={294}
          alt=""
          priority
        />
        <h2>{ru ? "ЗАПУСТИ NFT МАЙНЕР" : "DEPLOY YOUR NFT MINER"}</h2>
        <p>
          {ru
            ? "Корабль приходит прямо в кошелек и добывает по 50 points в час. Улучшай его, чтобы ускорять добычу."
            : "The ship arrives in your wallet and mines 50 points per hour. Evolve it to increase the rate."}
        </p>
        <div className={styles.modalStats}>
          <span><b>50</b> PTS/H</span>
          <span><b>0.5</b> USDC</span>
        </div>
        <button type="button" className={styles.modalAction} onClick={openShop}>
          {ru ? "ПОЛУЧИТЬ МАЙНЕР" : "GET THE MINER"}
        </button>
        <button type="button" className={styles.modalLater} onClick={dismiss}>
          {ru ? "ПОЗЖЕ" : "MAYBE LATER"}
        </button>
      </section>
    </div>
  );
}
