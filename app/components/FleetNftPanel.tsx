"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useAccount,
  useConfig,
  useReadContracts,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { readContract } from "@wagmi/core";
import { base } from "wagmi/chains";
import { DROP_CLAIM_CONTRACT_ADDRESS } from "../contracts/dropClaimAbi";
import {
  FLEET_NFT_CONTRACT_ADDRESS,
  fleetPassAbi,
} from "../contracts/fleetPassAbi";
import { erc20Abi, USDC_ADDRESS } from "../contracts/seaBattleAbi";
import { BUILDER_CODE_SUFFIX } from "../providers";
import { useSettings } from "../lib/settings";
import styles from "./FleetNftPanel.module.css";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

type FleetState = {
  tokenId: number;
  tier: number;
  level: number;
  pointsPerHour: number;
  claimablePoints: number;
  nextPrice: number;
  maxed: boolean;
};

const EMPTY_STATE: FleetState = {
  tokenId: 0,
  tier: 0,
  level: 0,
  pointsPerHour: 0,
  claimablePoints: 0,
  nextPrice: 500_000,
  maxed: false,
};

function cacheKey(wallet: string) {
  return `seabattle_fleet_nft_${wallet.toLowerCase()}`;
}

function readCached(wallet?: string): FleetState {
  if (!wallet || typeof window === "undefined") return EMPTY_STATE;
  try {
    return { ...EMPTY_STATE, ...JSON.parse(localStorage.getItem(cacheKey(wallet)) || "{}") };
  } catch {
    return EMPTY_STATE;
  }
}

function parseFleetState(value: unknown): FleetState | null {
  if (!Array.isArray(value)) return null;
  return {
    tokenId: Number(value[0] ?? 0),
    tier: Number(value[1] ?? 0),
    level: Number(value[2] ?? 0),
    pointsPerHour: Number(value[3] ?? 0),
    claimablePoints: Number(value[4] ?? 0),
    nextPrice: Number(value[5] ?? 0),
    maxed: Boolean(value[6]),
  };
}

function formatUsdc(amount: bigint | number) {
  return `${(Number(amount) / 1_000_000).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })} USDC`;
}

export default function FleetNftPanel() {
  const { address, isConnected } = useAccount();
  const wagmiConfig = useConfig();
  const { lang } = useSettings();
  const ru = lang === "ru";
  const deployed = FLEET_NFT_CONTRACT_ADDRESS !== ZERO_ADDR;
  const [fleet, setFleet] = useState<FleetState>(() => readCached(address));
  const [message, setMessage] = useState("");
  const [purchaseAction, setPurchaseAction] = useState<"buy" | "upgrade" | null>(null);
  const claimHandledRef = useRef(false);

  const { data: reads, refetch } = useReadContracts({
    contracts: [
      {
        address: FLEET_NFT_CONTRACT_ADDRESS,
        abi: fleetPassAbi,
        functionName: "fleetStateOf",
        args: [address || ZERO_ADDR],
        chainId: base.id,
      },
      {
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [DROP_CLAIM_CONTRACT_ADDRESS],
        chainId: base.id,
      },
    ],
    query: {
      enabled: DROP_CLAIM_CONTRACT_ADDRESS !== ZERO_ADDR,
      refetchInterval: 60_000,
    },
  });

  useEffect(() => {
    setFleet(readCached(address));
  }, [address]);

  useEffect(() => {
    const next = parseFleetState(reads?.[0]?.result);
    if (!next || !address) return;
    setFleet(next);
    localStorage.setItem(cacheKey(address), JSON.stringify(next));
  }, [address, reads]);

  const vaultBalance = reads?.[1]?.result as bigint | undefined;
  const owned = fleet.tokenId > 0;
  const visualTier = Math.max(1, fleet.tier || 1);
  const visualLevel = Math.max(1, fleet.level || 1);
  const actionPrice = owned ? fleet.nextPrice : 500_000;
  const actionLabel = !deployed
    ? ru ? "СКОРО" : "SOON"
    : owned
      ? fleet.maxed
        ? ru ? "МАКСИМУМ" : "MAXED"
        : `${ru ? "УЛУЧШИТЬ" : "UPGRADE"} · ${formatUsdc(actionPrice)}`
      : `${ru ? "КУПИТЬ NFT" : "BUY NFT"} · ${formatUsdc(actionPrice)}`;

  const {
    data: approveHash,
    writeContract: writeApprove,
    isPending: approvePending,
    reset: resetApprove,
  } = useWriteContract();
  const { data: approveReceipt } = useWaitForTransactionReceipt({ hash: approveHash });
  const {
    data: purchaseHash,
    writeContract: writePurchase,
    isPending: purchasePending,
    reset: resetPurchase,
  } = useWriteContract();
  const { data: purchaseReceipt } = useWaitForTransactionReceipt({ hash: purchaseHash });
  const {
    data: claimHash,
    writeContract: writeClaim,
    isPending: claimPending,
    reset: resetClaim,
  } = useWriteContract();
  const { data: claimReceipt } = useWaitForTransactionReceipt({ hash: claimHash });

  const sendPurchase = (action: "buy" | "upgrade") => {
    writePurchase({
      address: FLEET_NFT_CONTRACT_ADDRESS,
      abi: fleetPassAbi,
      functionName: action === "buy" ? "buyFleetNft" : "upgradeFleetNft",
      chainId: base.id,
      dataSuffix: BUILDER_CODE_SUFFIX,
    });
  };

  useEffect(() => {
    if (approveReceipt?.status !== "success" || !purchaseAction) return;
    sendPurchase(purchaseAction);
    // The purchase action is intentionally captured after the approval receipt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approveReceipt, purchaseAction]);

  useEffect(() => {
    if (purchaseReceipt?.status !== "success") return;
    setPurchaseAction(null);
    setMessage(ru ? "Флот обновлен в кошельке" : "Fleet updated in your wallet");
    refetch();
  }, [purchaseReceipt, refetch, ru]);

  useEffect(() => {
    if (claimReceipt?.status !== "success" || !claimHash || !address || claimHandledRef.current) return;
    claimHandledRef.current = true;
    fetch("/api/fleet-nft/claim-points", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet: address, txHash: claimHash }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || "Point claim failed");
        setMessage(`+${Number(data?.points ?? 0).toLocaleString()} ${ru ? "ПОЙНТОВ" : "POINTS"}`);
      })
      .catch((err) => setMessage(err instanceof Error ? err.message : "Point claim failed"))
      .finally(() => refetch());
  }, [address, claimHash, claimReceipt, refetch, ru]);

  const startPurchase = async () => {
    if (!address || !deployed || fleet.maxed || approvePending || purchasePending) return;
    const action = owned ? "upgrade" : "buy";
    setMessage("");
    setPurchaseAction(action);
    resetApprove();
    resetPurchase();

    const allowance = await readContract(wagmiConfig, {
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: "allowance",
      args: [address, FLEET_NFT_CONTRACT_ADDRESS],
      chainId: base.id,
    }).catch(() => BigInt(0));

    if (allowance >= BigInt(actionPrice)) {
      sendPurchase(action);
      return;
    }

    writeApprove({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: "approve",
      args: [FLEET_NFT_CONTRACT_ADDRESS, BigInt(actionPrice)],
      chainId: base.id,
      dataSuffix: BUILDER_CODE_SUFFIX,
    });
  };

  const claimPoints = () => {
    if (!address || !deployed || fleet.claimablePoints <= 0 || claimPending) return;
    setMessage("");
    claimHandledRef.current = false;
    resetClaim();
    writeClaim({
      address: FLEET_NFT_CONTRACT_ADDRESS,
      abi: fleetPassAbi,
      functionName: "claimPassivePoints",
      chainId: base.id,
      dataSuffix: BUILDER_CODE_SUFFIX,
    });
  };

  const stars = useMemo(() => Array.from({ length: 3 }, (_, index) => index < visualLevel), [visualLevel]);
  const busy = approvePending || purchasePending || (!!approveHash && !purchaseHash && !!purchaseAction);

  return (
    <section className={`${styles.panel} ${styles[`tier${visualTier}`]}`}>
      <div className={styles.backdrop} aria-hidden="true" />
      <div className={styles.artStage}>
        <span className={styles.orbit} aria-hidden="true" />
        <Image
          className={styles.ship}
          src={`/nft/fleet-tier-${visualTier}.png`}
          alt=""
          width={600}
          height={420}
          priority={false}
        />
        <div className={styles.stars} aria-label={`${visualLevel}/3`}>
          {stars.map((active, index) => <span className={active ? styles.starActive : ""} key={index}>★</span>)}
        </div>
      </div>

      <div className={styles.content}>
        <div className={styles.heading}>
          <div>
            <span>{ru ? "ЭВОЛЮЦИОННЫЙ NFT ФЛОТ" : "EVOLVING NFT FLEET"}</span>
            <h2>{owned ? `FLEET PASS #${fleet.tokenId}` : ru ? "СОБЕРИ СВОЙ ФЛОТ" : "BUILD YOUR FLEET"}</h2>
          </div>
          <b>{owned ? `T${fleet.tier} · LVL ${fleet.level}` : "T1 · LVL 1"}</b>
        </div>

        <p className={styles.description}>
          {ru
            ? "NFT приходит в кошелек. При улучшении старый корабль сжигается, новый минтится автоматически."
            : "The NFT arrives in your wallet. Upgrades burn the old ship and mint its evolved form automatically."}
        </p>

        <div className={styles.stats}>
          <div><span>{ru ? "СКОРОСТЬ" : "RATE"}</span><b>{owned ? fleet.pointsPerHour : 50} PTS/H</b></div>
          <div><span>{ru ? "НАКОПЛЕНО" : "READY"}</span><b>{fleet.claimablePoints.toLocaleString()} PTS</b></div>
          <div><span>{ru ? "ПУЛ НАГРАД" : "REWARD VAULT"}</span><b>{vaultBalance === undefined ? "-- USDC" : formatUsdc(vaultBalance)}</b></div>
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={startPurchase} disabled={!isConnected || !deployed || fleet.maxed || busy}>
            {busy ? ru ? "ПОДТВЕРЖДАЕМ..." : "CONFIRMING..." : actionLabel}
          </button>
          <button type="button" className={styles.secondary} onClick={claimPoints} disabled={!isConnected || !deployed || fleet.claimablePoints <= 0 || claimPending}>
            {claimPending ? ru ? "КЛЕЙМИМ..." : "CLAIMING..." : ru ? "ЗАБРАТЬ POINTS" : "CLAIM POINTS"}
          </button>
        </div>
        {message && <p className={styles.message}>{message}</p>}
      </div>
    </section>
  );
}
