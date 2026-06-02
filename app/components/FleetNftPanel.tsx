"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useAccount,
  useConfig,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import {
  readContract,
  waitForTransactionReceipt as waitForReceipt,
} from "@wagmi/core";
import { base } from "wagmi/chains";
import { decodeEventLog, maxUint256 } from "viem";
import {
  FLEET_NFT_CONTRACT_ADDRESS,
  fleetPassAbi,
} from "../contracts/fleetPassAbi";
import { erc20Abi, USDC_ADDRESS } from "../contracts/seaBattleAbi";
import {
  EMPTY_FLEET_STATE,
  fleetNextPrice,
  fleetPointRate,
  formatUsdc,
  parseFleetState,
  type FleetState,
  ZERO_ADDRESS,
} from "../lib/fleetNft";
import { BUILDER_CODE_SUFFIX } from "../providers";
import { useSettings } from "../lib/settings";
import styles from "./FleetNftPanel.module.css";

function cacheKey(wallet: string) {
  return `seabattle_fleet_nft_${wallet.toLowerCase()}`;
}

function readCached(wallet?: string): FleetState {
  if (!wallet || typeof window === "undefined") return EMPTY_FLEET_STATE;
  try {
    return {
      ...EMPTY_FLEET_STATE,
      ...JSON.parse(localStorage.getItem(cacheKey(wallet)) || "{}"),
    };
  } catch {
    return EMPTY_FLEET_STATE;
  }
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function optimisticFleetFromReceipt(
  logs: readonly { data: `0x${string}`; topics: readonly `0x${string}`[] }[],
  previous: FleetState
): FleetState | null {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: fleetPassAbi,
        data: log.data,
        topics: [...log.topics] as [] | [`0x${string}`, ...`0x${string}`[]],
      });
      if (decoded.eventName !== "FleetMinted" && decoded.eventName !== "FleetEvolved") {
        continue;
      }

      const tokenId = Number(decoded.args.tokenId);
      const tier = Number(decoded.args.tier);
      const level = Number(decoded.args.level);
      return {
        tokenId,
        tier,
        level,
        pointsPerHour: fleetPointRate(tier, level),
        claimablePoints: previous.claimablePoints,
        nextPrice: fleetNextPrice(tier, level),
        maxed: tier === 3 && level === 3,
      };
    } catch {
      // Ignore unrelated USDC transfer logs.
    }
  }
  return null;
}

export default function FleetNftPanel() {
  const { address, isConnected } = useAccount();
  const wagmiConfig = useConfig();
  const { lang } = useSettings();
  const ru = lang === "ru";
  const deployed = FLEET_NFT_CONTRACT_ADDRESS !== ZERO_ADDRESS;
  const [fleet, setFleet] = useState<FleetState>(() => readCached(address));
  const [message, setMessage] = useState("");
  const [purchaseAction, setPurchaseAction] = useState<"buy" | "upgrade" | null>(null);
  const [approveFallbackMined, setApproveFallbackMined] = useState(false);
  const [purchaseFallbackMined, setPurchaseFallbackMined] = useState(false);
  const purchaseSubmittedRef = useRef(false);
  const purchaseHandledRef = useRef(false);
  const previousTokenRef = useRef(0);
  const claimHandledRef = useRef(false);
  const staleProtectionUntilRef = useRef(0);

  const commitFleet = useCallback((next: FleetState) => {
    setFleet((current) => {
      if (
        Date.now() < staleProtectionUntilRef.current &&
        current.tokenId > 0 &&
        next.tokenId !== current.tokenId
      ) {
        return current;
      }
      return next;
    });
    if (address) localStorage.setItem(cacheKey(address), JSON.stringify(next));
  }, [address]);

  const { data: fleetRead, refetch } = useReadContract({
    address: FLEET_NFT_CONTRACT_ADDRESS,
    abi: fleetPassAbi,
    functionName: "fleetStateOf",
    args: [address || ZERO_ADDRESS],
    chainId: base.id,
    query: {
      enabled: deployed && !!address,
      refetchInterval: 10_000,
    },
  });

  const refreshFleet = useCallback(async () => {
    if (!address || !deployed) return null;
    try {
      const next = parseFleetState(await readContract(wagmiConfig, {
        address: FLEET_NFT_CONTRACT_ADDRESS,
        abi: fleetPassAbi,
        functionName: "fleetStateOf",
        args: [address],
        chainId: base.id,
      }));
      if (next) commitFleet(next);
      return next;
    } catch {
      return null;
    }
  }, [address, commitFleet, deployed, wagmiConfig]);

  useEffect(() => {
    setFleet(readCached(address));
  }, [address]);

  useEffect(() => {
    const next = parseFleetState(fleetRead);
    if (next) commitFleet(next);
  }, [commitFleet, fleetRead]);

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
    error: approveError,
    reset: resetApprove,
  } = useWriteContract();
  const { data: approveReceipt } = useWaitForTransactionReceipt({ hash: approveHash });
  const {
    data: purchaseHash,
    writeContract: writePurchase,
    isPending: purchasePending,
    error: purchaseError,
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

  const approveMined = approveReceipt?.status === "success" || approveFallbackMined;
  const purchaseMined = purchaseReceipt?.status === "success" || purchaseFallbackMined;

  const sendPurchase = useCallback((action: "buy" | "upgrade") => {
    purchaseSubmittedRef.current = true;
    setMessage(ru ? "Подтверди минт NFT в кошельке" : "Confirm NFT mint in your wallet");
    writePurchase({
      address: FLEET_NFT_CONTRACT_ADDRESS,
      abi: fleetPassAbi,
      functionName: action === "buy" ? "buyFleetNft" : "upgradeFleetNft",
      chainId: base.id,
      dataSuffix: BUILDER_CODE_SUFFIX,
    });
  }, [ru, writePurchase]);

  useEffect(() => {
    setApproveFallbackMined(false);
    if (!approveHash) return;
    let cancelled = false;
    waitForReceipt(wagmiConfig, { hash: approveHash })
      .then((receipt) => {
        if (!cancelled && receipt.status === "success") setApproveFallbackMined(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [approveHash, wagmiConfig]);

  useEffect(() => {
    setPurchaseFallbackMined(false);
    if (!purchaseHash) return;
    let cancelled = false;
    waitForReceipt(wagmiConfig, { hash: purchaseHash })
      .then((receipt) => {
        if (!cancelled && receipt.status === "success") setPurchaseFallbackMined(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [purchaseHash, wagmiConfig]);

  useEffect(() => {
    if (!approveMined || !purchaseAction || purchaseSubmittedRef.current) return;
    sendPurchase(purchaseAction);
  }, [approveMined, purchaseAction, sendPurchase]);

  useEffect(() => {
    if (!purchaseMined || purchaseHandledRef.current) return;
    purchaseHandledRef.current = true;
    staleProtectionUntilRef.current = Date.now() + 15_000;

    if (purchaseReceipt?.logs) {
      const optimistic = optimisticFleetFromReceipt(purchaseReceipt.logs, fleet);
      if (optimistic) commitFleet(optimistic);
    }

    setPurchaseAction(null);
    setMessage(ru ? "Майнер обновлен в кошельке" : "Miner updated in your wallet");

    void (async () => {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const next = await refreshFleet();
        if (next && next.tokenId > 0 && next.tokenId !== previousTokenRef.current) break;
        await wait(700);
      }
      await refetch();
    })();
  }, [commitFleet, fleet, purchaseMined, purchaseReceipt, refetch, refreshFleet, ru]);

  useEffect(() => {
    if (approveReceipt?.status !== "reverted" && purchaseReceipt?.status !== "reverted") return;
    setPurchaseAction(null);
    setMessage(ru ? "Транзакция отклонена" : "Transaction reverted");
  }, [approveReceipt, purchaseReceipt, ru]);

  useEffect(() => {
    const error = approveError || purchaseError;
    if (!error || !purchaseAction) return;
    const rejected = /user rejected|rejected the request/i.test(error.message);
    setPurchaseAction(null);
    setMessage(rejected
      ? ru ? "Отклонено в кошельке" : "Rejected in wallet"
      : ru ? "Не удалось отправить транзакцию" : "Could not send transaction");
  }, [approveError, purchaseAction, purchaseError, ru]);

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
      .finally(() => {
        void refreshFleet();
        void refetch();
      });
  }, [address, claimHash, claimReceipt, refetch, refreshFleet, ru]);

  const startPurchase = async () => {
    if (!address || !deployed || fleet.maxed || purchaseAction) return;
    const action = owned ? "upgrade" : "buy";
    setMessage("");
    setPurchaseAction(action);
    previousTokenRef.current = fleet.tokenId;
    purchaseSubmittedRef.current = false;
    purchaseHandledRef.current = false;
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

    setMessage(ru ? "Одобри USDC один раз для быстрых улучшений" : "Approve USDC once for fast upgrades");
    writeApprove({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: "approve",
      args: [FLEET_NFT_CONTRACT_ADDRESS, maxUint256],
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

  const stars = useMemo(
    () => Array.from({ length: 3 }, (_, index) => index < visualLevel),
    [visualLevel]
  );
  const busy = purchaseAction !== null || approvePending || purchasePending;

  return (
    <section className={`${styles.panel} ${styles[`tier${visualTier}`]}`} id="fleet-nft">
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
            <span>{ru ? "ЭВОЛЮЦИОННЫЙ NFT МАЙНЕР" : "EVOLVING NFT MINER"}</span>
            <h2>{owned ? `FLEET PASS #${fleet.tokenId}` : ru ? "СОБЕРИ СВОЙ ФЛОТ" : "BUILD YOUR FLEET"}</h2>
          </div>
          <b>{owned ? `T${fleet.tier} · LVL ${fleet.level}` : "T1 · LVL 1"}</b>
        </div>

        <p className={styles.description}>
          {ru
            ? "NFT приходит в кошелек и добывает пойнты каждый час. При улучшении старый корабль сжигается, а новая версия минтится автоматически."
            : "The NFT arrives in your wallet and mines points every hour. Upgrades burn the old ship and mint its evolved form automatically."}
        </p>

        <div className={styles.stats}>
          <div><span>{ru ? "СКОРОСТЬ" : "RATE"}</span><b>{owned ? fleet.pointsPerHour : 50} PTS/H</b></div>
          <div><span>{ru ? "НАКОПЛЕНО" : "READY"}</span><b>{fleet.claimablePoints.toLocaleString()} PTS</b></div>
          <div><span>{ru ? "СЛЕДУЮЩИЙ LVL" : "NEXT LEVEL"}</span><b>{fleet.maxed ? "MAX" : formatUsdc(actionPrice)}</b></div>
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
