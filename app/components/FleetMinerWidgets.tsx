"use client";

import Image from "next/image";
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
import { SEASON_UI_ENABLED } from "../lib/featureFlags";
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
}: {
  variant?: "default" | "wide";
}) {
  const { lang } = useSettings();
  const ru = lang === "ru";
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

  return (
    <section className={`${styles.poolCard} ${variant === "wide" ? styles.poolCardWide : ""}`}>
      <div className={styles.poolTop}>
        <span>{ru ? "СЕЗОННЫЙ ПУЛ" : "SEASON REWARD POOL"}</span>
        <b>S1</b>
      </div>
      <strong>{vaultBalance === undefined ? "-- USDC" : formatUsdc(vaultBalance)}</strong>
      <p>
        {ru
          ? "80% чистого заработка попадает в пул наград."
          : "80% of net revenue flows into player rewards."}
      </p>
      <small>{ru ? "КОНЕЦ: 01.07.2026 · 00:00 UTC" : "ENDS: 01.07.2026 · 00:00 UTC"}</small>
    </section>
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
      {SEASON_UI_ENABLED && <SeasonPoolCard />}
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
