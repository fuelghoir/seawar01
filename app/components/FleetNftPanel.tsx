"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useAccount,
  useCallsStatus,
  useCapabilities,
  useConfig,
  useReadContract,
  useSendCalls,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import {
  readContract,
  waitForTransactionReceipt as waitForReceipt,
} from "@wagmi/core";
import { base } from "wagmi/chains";
import { decodeEventLog, encodeFunctionData } from "viem";
import {
  FLEET_NFT_CONTRACT_ADDRESS,
  fleetPassAbi,
} from "../contracts/fleetPassAbi";
import { erc20Abi, USDC_ADDRESS } from "../contracts/seaBattleAbi";
import {
  EMPTY_FLEET_STATE,
  fleetNextPrice,
  fleetPointRate,
  fleetMaxUpgradeCost,
  formatUsdc,
  parseFleetState,
  type FleetState,
  ZERO_ADDRESS,
  MAX_MINER_SLOTS,
  canUnlockNextSlot,
  getTotalClaimablePoints,
} from "../lib/fleetNft";
import { BUILDER_CODE_SUFFIX } from "../providers";
import { useSettings } from "../lib/settings";
import { notifyPlayerDataRefresh } from "../lib/playerDataEvents";
import { useTransactionWarmup } from "../lib/useTransactionWarmup";
import { isBaseAppUserAgent } from "../lib/baseApp";
import styles from "./FleetNftPanel.module.css";

const PAYMASTER_URL = process.env.NEXT_PUBLIC_PAYMASTER_URL;
const FLEET_EVOLUTION = [
  {
    tier: 1,
    name: { en: "CORVETTE", ru: "КОРВЕТ" },
    levels: [
      { level: 1, rate: 50, price: 500_000 },
      { level: 2, rate: 75, price: 300_000 },
      { level: 3, rate: 100, price: 300_000 },
    ],
  },
  {
    tier: 2,
    name: { en: "DESTROYER", ru: "ЭСМИНЕЦ" },
    levels: [
      { level: 1, rate: 200, price: 3_000_000 },
      { level: 2, rate: 250, price: 2_000_000 },
      { level: 3, rate: 300, price: 2_000_000 },
    ],
  },
  {
    tier: 3,
    name: { en: "FLAGSHIP", ru: "ФЛАГМАН" },
    levels: [
      { level: 1, rate: 400, price: 10_000_000 },
      { level: 2, rate: 450, price: 5_000_000 },
      { level: 3, rate: 500, price: 5_000_000 },
    ],
  },
] as const;

function cacheKey(wallet: string) {
  return `seabattle_fleet_nft_${wallet.toLowerCase()}`;
}

function slotsCacheKey(wallet: string) {
  return `seabattle_fleet_slots_${wallet.toLowerCase()}`;
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

function readSlotsCached(wallet?: string): FleetState[] {
  if (!wallet || typeof window === "undefined") return [EMPTY_FLEET_STATE];
  try {
    const raw = localStorage.getItem(slotsCacheKey(wallet));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const slot0 = parsed[0] || EMPTY_FLEET_STATE;
        const sanitized = parsed.map((slot: FleetState, idx: number) => {
          if (idx === 0) return slot;
          if (slot0.tokenId > 0 && slot.tokenId === slot0.tokenId) {
            return EMPTY_FLEET_STATE;
          }
          return slot;
        });
        return sanitized;
      }
    }
    const single = readCached(wallet);
    return [single];
  } catch {
    return [EMPTY_FLEET_STATE];
  }
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchWithRetry(input: RequestInfo | URL, init?: RequestInit) {
  let response: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      response = await fetch(input, init);
      if (response.ok || (response.status !== 409 && response.status < 500)) return response;
    } catch (error) {
      if (attempt === 2) throw error;
    }
    await wait(500);
  }
  return response!;
}

function _optimisticFleetFromReceipt(
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
  const txWarmReady = useTransactionWarmup(isConnected, address);
  const deployed = FLEET_NFT_CONTRACT_ADDRESS !== ZERO_ADDRESS;

  const [activeSlotIndex, setActiveSlotIndex] = useState<number>(0);
  const [minerSlots, setMinerSlots] = useState<FleetState[]>(() => readSlotsCached(address));
  const [isInfoModalOpen, setIsInfoModalOpen] = useState<boolean>(false);

  const fleet = minerSlots[activeSlotIndex] || EMPTY_FLEET_STATE;

  const [isBaseApp, setIsBaseApp] = useState(false);
  const [message, setMessage] = useState("");
  const [purchaseAction, setPurchaseAction] = useState<"buy" | "upgrade" | "max" | "buyWithDiscount" | "upgradeWithDiscount" | "maxWithDiscount" | "migrate" | null>(null);
  const [discountSignature, setDiscountSignature] = useState<string | null>(null);
  const [approveFallbackMined, setApproveFallbackMined] = useState(false);
  const [purchaseFallbackMined, setPurchaseFallbackMined] = useState(false);
  const [claimFallbackMined, setClaimFallbackMined] = useState(false);
  const purchaseSubmittedRef = useRef(false);
  const purchaseHandledRef = useRef(false);
  const previousTokenRef = useRef(0);
  const claimHandledRef = useRef(false);
  const lastCreditedClaimHashRef = useRef<string | null>(null);
  const staleProtectionUntilRef = useRef(0);
  const autoMaxPendingRef = useRef(false);

  const [isLegacyMiner, setIsLegacyMiner] = useState(false);

  const commitFleet = useCallback((next: FleetState, targetSlotIndex = 0) => {
    setMinerSlots((current) => {
      const updated = [...current];
      while (updated.length <= targetSlotIndex) {
        updated.push(EMPTY_FLEET_STATE);
      }
      if (
        Date.now() < staleProtectionUntilRef.current &&
        updated[targetSlotIndex]?.tokenId > 0 &&
        next.tokenId !== updated[targetSlotIndex]?.tokenId
      ) {
        return current;
      }
      updated[targetSlotIndex] = next;

      // Sanitize: ensure slot 1..N do not duplicate slot 0's tokenId
      const slot0TokenId = updated[0]?.tokenId || 0;
      for (let i = 1; i < updated.length; i++) {
        if (slot0TokenId > 0 && updated[i]?.tokenId === slot0TokenId) {
          updated[i] = EMPTY_FLEET_STATE;
        }
      }

      if (address) {
        localStorage.setItem(slotsCacheKey(address), JSON.stringify(updated));
      }
      return updated;
    });
    if (address && targetSlotIndex === 0) {
      localStorage.setItem(cacheKey(address), JSON.stringify(next));
    }
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

  const { data: legacyFleetRead } = useReadContract({
    address: "0xe8ea934c519917832bff6fb82e96c95463497053",
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
      const nextV2 = parseFleetState(await readContract(wagmiConfig, {
        address: FLEET_NFT_CONTRACT_ADDRESS,
        abi: fleetPassAbi,
        functionName: "fleetStateOf",
        args: [address],
        chainId: base.id,
      }));
      if (nextV2 && nextV2.tokenId > 0) {
        commitFleet(nextV2, 0);
        setIsLegacyMiner(false);
        return nextV2;
      }
      const nextV1 = parseFleetState(await readContract(wagmiConfig, {
        address: "0xe8ea934c519917832bff6fb82e96c95463497053",
        abi: fleetPassAbi,
        functionName: "fleetStateOf",
        args: [address],
        chainId: base.id,
      }));
      if (nextV1 && nextV1.tokenId > 0) {
        commitFleet(nextV1, 0);
        setIsLegacyMiner(true);
        return nextV1;
      }
      if (nextV2) {
        commitFleet(nextV2, 0);
        setIsLegacyMiner(false);
        return nextV2;
      }
      return null;
    } catch {
      return null;
    }
  }, [address, commitFleet, deployed, wagmiConfig]);

  useEffect(() => {
    const cachedSlots = readSlotsCached(address);
    setMinerSlots(cachedSlots);
    if (typeof window !== "undefined") setIsBaseApp(isBaseAppUserAgent(navigator.userAgent));
  }, [address]);

  useEffect(() => {
    const nextV2 = parseFleetState(fleetRead);
    const nextV1 = parseFleetState(legacyFleetRead);

    if (nextV2 && nextV2.tokenId > 0) {
      commitFleet(nextV2, 0);
      setIsLegacyMiner(false);
    } else if (nextV1 && nextV1.tokenId > 0) {
      commitFleet(nextV1, 0);
      setIsLegacyMiner(true);
    } else if (nextV2) {
      commitFleet(nextV2, 0);
      setIsLegacyMiner(false);
    }
  }, [commitFleet, fleetRead, legacyFleetRead]);

  const owned = fleet.tokenId > 0;
  const visualTier = Math.max(1, fleet.tier || 1);
  const visualLevel = Math.max(1, fleet.level || 1);

  const totalClaimableAllSlots = useMemo(() => getTotalClaimablePoints(minerSlots), [minerSlots]);
  const ownedMinersCount = useMemo(
    () => minerSlots.filter((s) => s.tokenId > 0 || s.tier > 0).length,
    [minerSlots]
  );

  const nextUpgradePrice = useMemo(() => {
    const fallback = fleetNextPrice(fleet.tier || 1, fleet.level || 1);
    return fleet.nextPrice > 0 ? fleet.nextPrice : fallback;
  }, [fleet.tier, fleet.level, fleet.nextPrice]);

  const maxUpgradeCost = useMemo(() => {
    const tier = owned ? fleet.tier : 1;
    const level = owned ? fleet.level : 1;
    const baseCost = fleetMaxUpgradeCost(tier, level);
    const initialMintCost = owned ? 0 : 500_000;
    const totalCost = baseCost + initialMintCost;
    return isBaseApp ? totalCost / 2 : totalCost;
  }, [fleet.tier, fleet.level, owned, isBaseApp]);

  const actionPrice = owned
    ? (isBaseApp ? nextUpgradePrice / 2 : nextUpgradePrice)
    : (isBaseApp ? 250_000 : 500_000);

  const actionLabel = !deployed
    ? ru ? "СКОРО" : "SOON"
    : owned
      ? isLegacyMiner
        ? ru ? "БЕСПЛАТНЫЙ ПЕРЕНОС В V2" : "FREE MIGRATE TO V2"
        : fleet.maxed
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
    isPending: claimTxPending,
    reset: resetClaim,
  } = useWriteContract();
  const { data: claimReceipt } = useWaitForTransactionReceipt({ hash: claimHash });
  const { data: capabilities } = useCapabilities({ chainId: base.id });
  const paymasterSupported =
    !!PAYMASTER_URL && !!capabilities?.paymasterService?.supported;
  const {
    sendCalls: sendClaimCalls,
    data: claimCallsData,
    isPending: claimCallsPending,
  } = useSendCalls();
  const { data: claimCallsStatus } = useCallsStatus({
    id: claimCallsData?.id ?? "",
    query: {
      enabled: !!claimCallsData?.id,
      refetchInterval: ({ state }) =>
        state.data?.status === "success" ? false : 1_000,
    },
  });

  const approveMined = approveReceipt?.status === "success" || approveFallbackMined;
  const purchaseMined = purchaseReceipt?.status === "success" || purchaseFallbackMined;
  const claimCallsSuccess = claimCallsStatus?.status === "success";
  const claimProofHash =
    claimHash ??
    claimCallsStatus?.receipts?.[0]?.transactionHash as `0x${string}` | undefined;
  const claimMined =
    claimReceipt?.status === "success" || claimFallbackMined || claimCallsSuccess;
  const claimPending =
    claimTxPending ||
    claimCallsPending ||
    (!!claimCallsData?.id && !claimCallsSuccess && !claimHandledRef.current);

  const sendPurchase = useCallback((action: "buy" | "upgrade" | "max" | "buyWithDiscount" | "upgradeWithDiscount" | "maxWithDiscount" | "migrate", sig?: string | null) => {
    purchaseSubmittedRef.current = true;
    setMessage(ru ? "Подтверди оплату в кошельке" : "Confirm payment in your wallet");
    
    if (activeSlotIndex > 0) {
      let targetPrice = actionPrice;
      if (action === "max" || action === "maxWithDiscount") {
        targetPrice = maxUpgradeCost;
      }
      const rewardShare = Math.floor((targetPrice * 80) / 100);
      const rewardVaultAddr = "0x39016cE335546b6ab9776a1cC78cf210f84f5a5b" as `0x${string}`;

      writePurchase({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "transfer",
        args: [rewardVaultAddr, BigInt(rewardShare)],
        chainId: base.id,
      });
      return;
    }

    let fnName: "buyFleetNft" | "upgradeFleetNft" | "buyFleetNftWithDiscount" | "upgradeToMaxLevel" | "upgradeFleetNftWithDiscount" | "upgradeToMaxLevelWithDiscount" | "migrateFleetNft" = "buyFleetNft";
    let args: readonly [] | readonly [`0x${string}`] | readonly [number, number, `0x${string}`] = [];
    if (action === "upgrade") fnName = "upgradeFleetNft";
    if (action === "max") fnName = "upgradeToMaxLevel";
    if (action === "buyWithDiscount" && sig) {
      fnName = "buyFleetNftWithDiscount";
      args = [sig as `0x${string}`];
    }
    if (action === "upgradeWithDiscount" && sig) {
      fnName = "upgradeFleetNftWithDiscount";
      args = [sig as `0x${string}`];
    }
    if (action === "maxWithDiscount" && sig) {
      fnName = "upgradeToMaxLevelWithDiscount";
      args = [sig as `0x${string}`];
    }
    if (action === "migrate" && sig) {
      fnName = "migrateFleetNft";
      args = [fleet.tier, fleet.level, sig as `0x${string}`];
    }

    writePurchase({
      address: FLEET_NFT_CONTRACT_ADDRESS,
      abi: fleetPassAbi,
      functionName: fnName,
      args: args as never,
      chainId: base.id,
      dataSuffix: BUILDER_CODE_SUFFIX,
    });
  }, [ru, writePurchase, fleet.tier, fleet.level, activeSlotIndex, actionPrice, maxUpgradeCost]);

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
    setClaimFallbackMined(false);
    if (!claimHash) return;
    let cancelled = false;
    waitForReceipt(wagmiConfig, { hash: claimHash })
      .then((receipt) => {
        if (!cancelled && receipt.status === "success") setClaimFallbackMined(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [claimHash, wagmiConfig]);

  useEffect(() => {
    if (!approveMined || !purchaseAction || purchaseSubmittedRef.current) return;
    sendPurchase(purchaseAction, discountSignature);
  }, [approveMined, purchaseAction, sendPurchase, discountSignature]);

  useEffect(() => {
    if (!purchaseMined || purchaseHandledRef.current) return;
    purchaseHandledRef.current = true;
    staleProtectionUntilRef.current = Date.now() + 15_000;

    if (activeSlotIndex > 0) {
      let nextState: FleetState;
      if (purchaseAction === "max" || purchaseAction === "maxWithDiscount" || autoMaxPendingRef.current) {
        autoMaxPendingRef.current = false;
        nextState = {
          tokenId: activeSlotIndex + 1,
          tier: 3,
          level: 3,
          pointsPerHour: 500,
          claimablePoints: 0,
          nextPrice: 0,
          maxed: true,
        };
      } else if (!owned) {
        nextState = {
          tokenId: activeSlotIndex + 1,
          tier: 1,
          level: 1,
          pointsPerHour: 50,
          claimablePoints: 0,
          nextPrice: 300_000,
          maxed: false,
        };
      } else {
        let nextTier = fleet.tier;
        let nextLevel = fleet.level + 1;
        if (nextLevel > 3) {
          nextTier++;
          nextLevel = 1;
        }
        const maxed = nextTier === 3 && nextLevel === 3;
        nextState = {
          tokenId: activeSlotIndex + 1,
          tier: nextTier,
          level: nextLevel,
          pointsPerHour: fleetPointRate(nextTier, nextLevel),
          claimablePoints: fleet.claimablePoints,
          nextPrice: fleetNextPrice(nextTier, nextLevel),
          maxed,
        };
      }

      commitFleet(nextState, activeSlotIndex);
      setPurchaseAction(null);
      setMessage(ru ? `Майнер #${activeSlotIndex + 1} активирован!` : `Miner #${activeSlotIndex + 1} activated!`);
      return;
    }

    if (autoMaxPendingRef.current) {
      autoMaxPendingRef.current = false;
      setMessage(ru ? "Улучшаем до MAX уровня..." : "Upgrading to MAX level...");
      const maxAction = isBaseApp ? "maxWithDiscount" : "max";
      purchaseHandledRef.current = false;
      purchaseSubmittedRef.current = false;
      setPurchaseAction(maxAction);

      if (maxAction === "maxWithDiscount") {
        fetch(`/api/fleet-nft/discount-sig?wallet=${address}&action=${maxAction}`)
          .then((res) => res.json())
          .then((data) => {
            if (data?.signature) sendPurchase(maxAction, data.signature);
            else sendPurchase(maxAction);
          })
          .catch(() => sendPurchase(maxAction));
      } else {
        sendPurchase(maxAction);
      }
      return;
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
  }, [commitFleet, fleet, purchaseMined, purchaseReceipt, refetch, refreshFleet, ru, activeSlotIndex, address, isBaseApp, sendPurchase, owned, purchaseAction]);

  useEffect(() => {
    if (approveReceipt?.status !== "reverted" && purchaseReceipt?.status !== "reverted") return;
    setPurchaseAction(null);
    autoMaxPendingRef.current = false;
    setMessage(ru ? "Транзакция отклонена" : "Transaction reverted");
  }, [approveReceipt, purchaseReceipt, ru]);

  useEffect(() => {
    const error = approveError || purchaseError;
    if (!error || !purchaseAction) return;
    const rejected = /user rejected|rejected the request/i.test(error.message);
    setPurchaseAction(null);
    autoMaxPendingRef.current = false;
    setMessage(rejected
      ? ru ? "Отклонено в кошельке" : "Rejected in wallet"
      : ru ? "Не удалось отправить транзакцию" : "Could not send transaction");
  }, [approveError, purchaseAction, purchaseError, ru]);

  useEffect(() => {
    if (!claimMined || !address || claimHandledRef.current) return;
    if (claimProofHash && lastCreditedClaimHashRef.current === claimProofHash) return;

    claimHandledRef.current = true;
    if (claimProofHash) {
      lastCreditedClaimHashRef.current = claimProofHash;
    }

    setMinerSlots((current) => {
      const updated = current.map((s) => ({ ...s, claimablePoints: 0 }));
      if (address) {
        localStorage.setItem(slotsCacheKey(address), JSON.stringify(updated));
      }
      return updated;
    });
    setMessage(ru ? "Зачисляем пойнты..." : "Crediting points...");
    fetchWithRetry("/api/fleet-nft/claim-points", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet: address, txHash: claimProofHash }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || "Point claim failed");
        notifyPlayerDataRefresh();
        setMessage(`+${Number(data?.points ?? 0).toLocaleString()} ${ru ? "ПОЙНТОВ" : "POINTS"}`);
      })
      .catch((err) => setMessage(err instanceof Error ? err.message : "Point claim failed"))
      .finally(() => {
        void refreshFleet();
        void refetch();
      });
  }, [address, claimMined, claimProofHash, refetch, refreshFleet, ru]);

  const startPurchase = async (actionOverride?: "max") => {
    if (!txWarmReady || !address || !deployed || fleet.maxed || purchaseAction) return;
    
    let action: "buy" | "upgrade" | "max" | "buyWithDiscount" | "upgradeWithDiscount" | "maxWithDiscount" | "migrate" = actionOverride ?? (owned ? (isLegacyMiner ? "migrate" : "upgrade") : "buy");
    if (actionOverride === "max" && !owned) {
      autoMaxPendingRef.current = true;
      action = "buy";
    }
    if (isBaseApp && action !== "migrate") {
      if (action === "buy") action = "buyWithDiscount";
      if (action === "upgrade") action = "upgradeWithDiscount";
      if (action === "max") action = "maxWithDiscount";
    }

    let requiredPrice = actionPrice;
    if (actionOverride === "max") {
      requiredPrice = maxUpgradeCost;
    }

    setMessage("");
    setPurchaseAction(action);
    previousTokenRef.current = fleet.tokenId;
    purchaseSubmittedRef.current = false;
    purchaseHandledRef.current = false;
    setDiscountSignature(null);
    resetApprove();
    resetPurchase();

    let sig: string | null = null;
    if (action === "buyWithDiscount" || action === "upgradeWithDiscount" || action === "maxWithDiscount") {
      setMessage(ru ? "Получаем скидку..." : "Getting discount...");
      try {
        const res = await fetch(`/api/fleet-nft/discount-sig?wallet=${address}&action=${action}`);
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.signature) throw new Error("Signature failed");
        sig = data.signature;
        setDiscountSignature(sig);
      } catch {
        setPurchaseAction(null);
        setMessage(ru ? "Не удалось получить скидку" : "Could not get discount signature");
        return;
      }
    } else if (action === "migrate") {
      setMessage(ru ? "Подготовка миграции..." : "Preparing migration...");
      try {
        const res = await fetch(`/api/fleet-nft/migrate-sig?wallet=${address}`);
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.signature) throw new Error("Migration failed");
        sig = data.signature;
        setDiscountSignature(sig);
      } catch {
        setPurchaseAction(null);
        setMessage(ru ? "Ошибка подготовки" : "Could not prepare migration");
        return;
      }
    }

    if (action === "migrate") {
      sendPurchase(action, sig);
      return;
    }

    const allowance = await readContract(wagmiConfig, {
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: "allowance",
      args: [address, FLEET_NFT_CONTRACT_ADDRESS],
      chainId: base.id,
    }).catch(() => BigInt(0));

    if (allowance >= BigInt(requiredPrice)) {
      sendPurchase(action, sig);
      return;
    }

    setMessage(ru ? "Одобри USDC только на эту покупку" : "Approve USDC for this purchase only");
    writeApprove({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: "approve",
      args: [FLEET_NFT_CONTRACT_ADDRESS, BigInt(requiredPrice)],
      chainId: base.id,
    });
  };

  const claimPoints = () => {
    if (!txWarmReady || !address || !deployed || totalClaimableAllSlots <= 0 || claimPending) return;
    setMessage("");
    claimHandledRef.current = false;
    resetClaim();

    const targetContract = isLegacyMiner ? "0xe8ea934c519917832bff6fb82e96c95463497053" : FLEET_NFT_CONTRACT_ADDRESS;

    if (paymasterSupported && PAYMASTER_URL) {
      sendClaimCalls({
        calls: [{
          to: targetContract,
          data: encodeFunctionData({
            abi: fleetPassAbi,
            functionName: "claimPassivePoints",
          }),
          dataSuffix: BUILDER_CODE_SUFFIX,
        }],
        capabilities: { paymasterService: { url: PAYMASTER_URL } },
      });
      return;
    }

    writeClaim({
      address: targetContract,
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
  const currentEvolutionIndex = owned
    ? (fleet.tier - 1) * 3 + (fleet.level - 1)
    : -1;
  const busy = purchaseAction !== null || approvePending || purchasePending;

  const renderEvolutionMap = () => (
    <section className={styles.evolution}>
      <div className={styles.evolutionHead}>
        <div>
          <span>{ru ? "КАРТА ЭВОЛЮЦИИ" : "EVOLUTION MAP"}</span>
          <h3>{ru ? "3 КОРАБЛЯ · 9 УРОВНЕЙ ДОБЫЧИ" : "3 SHIPS · 9 MINING LEVELS"}</h3>
        </div>
        <p>
          {ru
            ? "Каждый апгрейд сжигает старый NFT и сразу отправляет новый корабль в кошелек."
            : "Each upgrade burns the old NFT and sends the evolved ship straight to your wallet."}
        </p>
      </div>

      <div className={styles.evolutionGrid}>
        {FLEET_EVOLUTION.map((ship, shipIndex) => {
          const activeShip = owned && fleet.tier === ship.tier;
          return (
            <article
              className={`${styles.evolutionShip} ${activeShip ? styles.evolutionShipActive : ""}`}
              key={ship.tier}
            >
              <div className={styles.evolutionShipTop}>
                <div>
                  <span>{ru ? `КОРАБЛЬ 0${ship.tier}` : `SHIP 0${ship.tier}`}</span>
                  <b>{ru ? ship.name.ru : ship.name.en}</b>
                </div>
                <strong>T{ship.tier}</strong>
              </div>
              <div className={styles.evolutionArt}>
                <span aria-hidden="true" />
                <Image
                  src={`/nft/fleet-tier-${ship.tier}.png`}
                  alt=""
                  width={260}
                  height={182}
                />
              </div>
              <div className={styles.evolutionLevels}>
                {ship.levels.map((level, levelIndex) => {
                  const evolutionIndex = shipIndex * 3 + levelIndex;
                  const current = evolutionIndex === currentEvolutionIndex;
                  const completed = evolutionIndex < currentEvolutionIndex;
                  const next = evolutionIndex === currentEvolutionIndex + 1;
                  return (
                    <div
                      className={`${styles.evolutionLevel} ${
                        current
                          ? styles.evolutionLevelCurrent
                          : completed
                            ? styles.evolutionLevelDone
                            : next
                              ? styles.evolutionLevelNext
                              : ""
                      }`}
                      key={level.level}
                    >
                      <span>LVL {level.level}</span>
                      <b>{level.rate} <small>PTS/H</small></b>
                      <em>{formatUsdc(level.price)}</em>
                    </div>
                  );
                })}
              </div>
              {shipIndex < FLEET_EVOLUTION.length - 1 && (
                <span className={styles.evolutionArrow} aria-hidden="true">›</span>
              )}
            </article>
          );
        })}
      </div>

      <div className={styles.evolutionLegend}>
        <span><i className={styles.legendCurrent} />{ru ? "ТЕКУЩИЙ" : "CURRENT"}</span>
        <span><i className={styles.legendNext} />{ru ? "СЛЕДУЮЩИЙ" : "NEXT"}</span>
        <span><i className={styles.legendLocked} />{ru ? "БУДУЩИЕ" : "FUTURE"}</span>
      </div>
    </section>
  );

  return (
    <>
      {/* ─── Main Fleet NFT Card (Always Visible on Page) ─── */}
      <section className={`${styles.panel} ${styles[`tier${visualTier}`]}`} id="fleet-nft">
        <div className={styles.backdrop} aria-hidden="true" />
        
        {/* ─── Navigation Header Controls ─── */}
        <div className={styles.slotNavHeader}>
          <button
            type="button"
            className={styles.slotNavBtn}
            onClick={() => setActiveSlotIndex((prev) => Math.max(0, prev - 1))}
            disabled={activeSlotIndex === 0}
            aria-label="Previous Miner"
          >
            ‹ {ru ? "ПРЕДЫДУЩИЙ" : "PREV"}
          </button>
          <span className={styles.slotNavTitle}>
            {ru ? `МАЙНЕР #${activeSlotIndex + 1} ИЗ 10` : `MINER #${activeSlotIndex + 1} OF 10`}
          </span>
          <button
            type="button"
            className={styles.slotNavBtn}
            onClick={() => setActiveSlotIndex((prev) => Math.min(MAX_MINER_SLOTS - 1, prev + 1))}
            disabled={!canUnlockNextSlot(minerSlots, activeSlotIndex + 1)}
            aria-label="Next Miner"
          >
            {ru ? "СЛЕДУЮЩИЙ" : "NEXT"} ›
          </button>
        </div>

        {/* ─── Multi-Miner Slot Selector Tabs ─── */}
        <div className={styles.slotTabsContainer}>
          {Array.from({ length: MAX_MINER_SLOTS }).map((_, slotIdx) => {
            const slotState = minerSlots[slotIdx] || EMPTY_FLEET_STATE;
            const unlocked = canUnlockNextSlot(minerSlots, slotIdx);
            const isCurrent = slotIdx === activeSlotIndex;
            const isSlotOwned = slotState.tokenId > 0 || slotState.tier > 0;
            const isMaxed = Boolean(slotState.maxed || (slotState.tier === 3 && slotState.level === 3));

            return (
              <button
                key={slotIdx}
                type="button"
                className={`${styles.slotTab} ${isCurrent ? styles.slotTabActive : ""} ${
                  isMaxed ? styles.slotTabMaxed : ""
                } ${!unlocked ? styles.slotTabLocked : ""}`}
                onClick={() => {
                  if (unlocked) setActiveSlotIndex(slotIdx);
                }}
                disabled={!unlocked}
                title={
                  !unlocked
                    ? ru
                      ? `Вкачай Майнер #${slotIdx} до MAX уровня!`
                      : `Max out Miner #${slotIdx} first!`
                    : undefined
                }
              >
                <span>{ru ? `МАЙНЕР #${slotIdx + 1}` : `MINER #${slotIdx + 1}`}</span>
                {isMaxed && <span className={styles.slotBadge}>★ MAX</span>}
                {!isMaxed && isSlotOwned && <small>T{slotState.tier}L{slotState.level}</small>}
                {!unlocked && <small>🔒</small>}
              </button>
            );
          })}
        </div>

        <div className={styles.artStage}>
          <button
            type="button"
            className={`${styles.artStageArrow} ${styles.artStageArrowLeft}`}
            onClick={() => setActiveSlotIndex((prev) => Math.max(0, prev - 1))}
            disabled={activeSlotIndex === 0}
            aria-label="Previous Miner"
          >
            ‹
          </button>
          <span className={styles.orbit} aria-hidden="true" />
          <Image
            className={styles.ship}
            src={`/nft/fleet-tier-${visualTier}.png`}
            alt=""
            width={600}
            height={420}
            priority={false}
          />
          <button
            type="button"
            className={`${styles.artStageArrow} ${styles.artStageArrowRight}`}
            onClick={() => setActiveSlotIndex((prev) => Math.min(MAX_MINER_SLOTS - 1, prev + 1))}
            disabled={!canUnlockNextSlot(minerSlots, activeSlotIndex + 1)}
            aria-label="Next Miner"
          >
            ›
          </button>
          <div className={styles.stars} aria-label={`${visualLevel}/3`}>
            {stars.map((active, index) => <span className={active ? styles.starActive : ""} key={index}>★</span>)}
          </div>
        </div>

        <div className={styles.content}>
          <div className={styles.heading}>
            <div>
              <span>{ru ? "ЭВОЛЮЦИОННЫЙ NFT МАЙНЕР" : "EVOLVING NFT MINER"}</span>
              <h2>
                {owned
                  ? ru
                    ? `FLEET PASS (СЛОТ #${activeSlotIndex + 1})`
                    : `FLEET PASS (SLOT #${activeSlotIndex + 1})`
                  : ru
                    ? `СОБЕРИ СВОЙ ФЛОТ (СЛОТ #${activeSlotIndex + 1})`
                    : `BUILD YOUR FLEET (SLOT #${activeSlotIndex + 1})`}
              </h2>
            </div>
            <b>{owned ? `T${fleet.tier} · LVL ${fleet.level}` : "T1 · LVL 1"}</b>
          </div>

          <p className={styles.description}>
            {ru
              ? "NFT приходит в кошелек и добывает пойнты каждый час. После максимальной прокачки одного майнера откроется слот для следующего!"
              : "The NFT arrives in your wallet and mines points every hour. Maxing out a miner unlocks the next miner slot!"}
          </p>

          <div className={styles.stats}>
            <div><span>{ru ? "СКОРОСТЬ" : "RATE"}</span><b>{owned ? fleet.pointsPerHour : 50} PTS/H</b></div>
            <div>
              <span>{ru ? "НАКОПЛЕНО" : "READY"}</span>
              <b>
                {totalClaimableAllSlots.toLocaleString()} PTS
                {ownedMinersCount > 1 ? " (FULL)" : ""}
              </b>
            </div>
            <div><span>{ru ? "СЛЕДУЮЩИЙ LVL" : "NEXT LEVEL"}</span><b>{fleet.maxed ? "MAX" : formatUsdc(actionPrice)}</b></div>
          </div>

          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={() => startPurchase()} disabled={!isConnected || !txWarmReady || !deployed || fleet.maxed || busy}>
              {!txWarmReady ? "SYNCING..." : busy ? ru ? "ПОДТВЕРЖДАЕМ..." : "CONFIRMING..." : actionLabel}
            </button>
            {!fleet.maxed && !isLegacyMiner && (
              <button type="button" className={styles.secondary} onClick={() => startPurchase("max")} disabled={!isConnected || !txWarmReady || !deployed || busy}>
                {owned
                  ? (ru ? "МАКСИМУМ ЗА" : "MAX FOR")
                  : (ru ? "КУПИТЬ MAX ЗА" : "BUY MAX FOR")} {formatUsdc(maxUpgradeCost)}
              </button>
            )}
            <button
              type="button"
              className={styles.secondary}
              onClick={claimPoints}
              disabled={!isConnected || !txWarmReady || !deployed || totalClaimableAllSlots <= 0 || claimPending}
            >
              {!txWarmReady
                ? "SYNCING..."
                : claimPending
                  ? (ru ? "КЛЕЙМИМ..." : "CLAIMING...")
                  : (ru
                      ? (ownedMinersCount > 1 ? "ЗАБРАТЬ ВСЕ (FULL)" : "ЗАБРАТЬ POINTS")
                      : (ownedMinersCount > 1 ? "CLAIM ALL (FULL)" : "CLAIM POINTS"))}
            </button>
          </div>
          {!isBaseApp && deployed && (
            <div style={{ marginTop: '16px', padding: '12px', background: 'rgba(0, 82, 255, 0.1)', border: '1px solid #0052ff', borderRadius: '8px', textAlign: 'center' }}>
              <p style={{ margin: 0, fontSize: '12px', color: '#fff' }}>
                {ru ? "Перейди в Base App, чтобы покупать и улучшать со скидкой 50%!" : "Switch to Base App to buy and upgrade with 50% discount!"}
              </p>
              <a href="https://base.app/app/seabattle.top" target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: '8px', color: '#66e9ff', fontSize: '13px', textDecoration: 'none', fontWeight: 'bold' }}>
                {ru ? "Открыть в Base App →" : "Open in Base App →"}
              </a>
            </div>
          )}
          {message && <p className={styles.message}>{message}</p>}
        </div>

        {/* ─── Glowing Info Button Integrated Inside Card Footer ─── */}
        <div className={styles.panelCardFooter}>
          <button
            type="button"
            className={styles.glowingInfoBtn}
            onClick={() => setIsInfoModalOpen(true)}
          >
            <span>✨</span>
            <span>{ru ? "ИНФО И КАРТА ЭВОЛЮЦИИ КОРАБЛЕЙ" : "INFO & SHIPS EVOLUTION MAP"}</span>
          </button>
        </div>
      </section>

      {/* ─── Info & Evolution Map Modal ─── */}
      {isInfoModalOpen && (
        <div
          className={styles.infoModalBackdrop}
          onClick={() => setIsInfoModalOpen(false)}
        >
          <div
            className={styles.infoModalContent}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.infoModalHeader}>
              <h2 className={styles.infoModalTitle}>
                {ru ? "🛸 КАРТА ЭВОЛЮЦИИ И ЦЕНЫ КОРАБЛЕЙ" : "🛸 SHIPS EVOLUTION MAP & PRICES"}
              </h2>
              <button
                type="button"
                className={styles.infoModalClose}
                onClick={() => setIsInfoModalOpen(false)}
                aria-label="Close"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            {renderEvolutionMap()}
          </div>
        </div>
      )}
    </>
  );
}
