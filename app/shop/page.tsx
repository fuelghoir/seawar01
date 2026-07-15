"use client";

import { useState, useEffect, useRef, useCallback, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
  useSendCalls,
  useCallsStatus,
  useCapabilities,
  useConfig,
} from "wagmi";
import {
  getPublicClient,
  waitForTransactionReceipt as waitForReceipt,
} from "@wagmi/core";
import { base } from "wagmi/chains";
import { encodeFunctionData, parseAbiItem } from "viem";
import {
  seaBattleAbi,
  captainSbtAbi,
  erc20Abi,
  CAPTAIN_SBT_CONTRACT_ADDRESS,
  SEABATTLE_CONTRACT_ADDRESS,
  SHOP_TREASURY_ADDRESS,
  USDC_ADDRESS,
} from "../contracts/seaBattleAbi";
import { BUILDER_CODE_SUFFIX } from "../providers";
import {
  LIMITED_SBT_MAX_SUPPLY,
  LIMITED_SBT_REQUIRED_WINS,
  LIMITED_SBT_WEEKLY_POINTS,
  claimLimitedSbtWeeklyPoints,
  getLimitedSbtState,
  type LimitedSbtState,
} from "../lib/limitedSbt";
import {
  getCheckinStatus,
  dailyCheckin,
  getBombsUsedCount,
  CheckinStatus,
} from "../lib/offchainGame";
import {
  SHOP_ITEMS,
  SEASON_LEVELS,
  type InventoryMap,
  type SeasonState,
  type ShopItemSlug,
  SEASON_MAX_LEVEL,
  QUEST_REROLL_USDC_PRICE,
  MAX_SHOP_PURCHASE_QUANTITY,
  activateDoublePoints,
  buyPointItem,
  claimSeasonLevels,
  grantPaidQuestReroll,
  getActiveDoublePoints,
  getInventory,
  getSeasonState,
  hasQuestRerollPointPurchaseThisWeek,
  pointPurchaseSentinelAddress,
  rewardLabel,
  seasonClaimSentinelAddress,
  shopItemText,
  normalizeShopPurchaseQuantity,
  validatePointItemPurchase,
  validateSeasonLevelClaims,
} from "../lib/season";
import { SettingsPanel } from "../components/SettingsPanel";
import FleetNftPanel from "../components/FleetNftPanel";
import { SeasonPoolCard } from "../components/FleetMinerWidgets";
import { ItemArt, type ItemArtKind } from "../components/ItemArt";
import {
  CheckIcon,
  ChevronRightIcon,
  CoinIcon,
  ShopIcon,
  ShieldIcon,
  StarIcon,
  TrophyIcon,
} from "../components/Icons";
import { useSettings, TR } from "../lib/settings";
import { notifyPlayerDataRefresh, PLAYER_DATA_REFRESH_EVENT } from "../lib/playerDataEvents";
import {
  SEASON_UI_ENABLED,
  USDC_SEASON_REWARDS_ENABLED,
} from "../lib/featureFlags";
import {
  clearWalletRequest,
  markWalletRequestStarted,
} from "../lib/walletRequestRecovery";
import styles from "./page.module.css";

const PAYMASTER_URL = process.env.NEXT_PUBLIC_PAYMASTER_URL;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const BOMB_PRICE = BigInt(2_000_000); // 2 USDC
const EMPTY_INVENTORY: InventoryMap = {
  double_points_1h: 0,
  quest_reroll: 0,
  streak_freeze: 0,
  radar_scan: 0,
  torpedo: 0,
};

function pendingPaidQrKey(wallet: string) {
  return `sbt_pending_paid_qr_${wallet.toLowerCase()}`;
}

function pendingPaidQrQtyKey(wallet: string) {
  return `sbt_pending_paid_qr_qty_${wallet.toLowerCase()}`;
}

function formatUsdcMicro(amountMicro: number) {
  return `${(amountMicro / 1_000_000).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })} USDC`;
}

type ShopTier = "legendary" | "epic" | "rare" | "locked";

const ITEM_META: Record<
  ShopItemSlug,
  { code: string; tier: ShopTier; accent: string }
> = {
  double_points_1h: {
    code: "2X",
    tier: "legendary",
    accent: "#ffc850",
  },
  quest_reroll: {
    code: "QR",
    tier: "rare",
    accent: "#00dcb4",
  },
  streak_freeze: {
    code: "SF",
    tier: "epic",
    accent: "#7dd3fc",
  },
  radar_scan: {
    code: "RD",
    tier: "rare",
    accent: "#4ade80",
  },
  torpedo: {
    code: "TP",
    tier: "epic",
    accent: "#fb7185",
  },
};

export default function ShopPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const wagmiConfig = useConfig();
  const { lang } = useSettings();
  const tr = TR[lang];
  const tierLabel = (tier: ShopTier) =>
    ({
      legendary: tr.tier_legendary,
      epic: tr.tier_epic,
      rare: tr.tier_rare,
      locked: tr.tier_locked,
    })[tier];

  // ─── Bomb inventory ───
  const { data: bombsOwned, refetch: refetchBombs } = useReadContract({
    address: SEABATTLE_CONTRACT_ADDRESS,
    abi: seaBattleAbi,
    functionName: "playerBombs",
    args: [address || ZERO_ADDR],
    query: { enabled: !!address },
  });

  const [bombsUsed, setBombsUsed] = useState<number>(0);
  const refreshUsed = async () => {
    if (!address) return;
    try {
      const n = await getBombsUsedCount(address);
      setBombsUsed(n);
    } catch {
      // ignore
    }
  };
  useEffect(() => {
    refreshUsed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  const owned = Number(bombsOwned ?? BigInt(0));
  const available = Math.max(0, owned - bombsUsed);
  const captainSbtDeployed = CAPTAIN_SBT_CONTRACT_ADDRESS !== ZERO_ADDR;
  const { data: captainSbtReads, refetch: refetchCaptainSbtReads } = useReadContracts({
    contracts: [
      {
        address: CAPTAIN_SBT_CONTRACT_ADDRESS,
        abi: captainSbtAbi,
        functionName: "balanceOf",
        args: [address || ZERO_ADDR],
      },
      {
        address: CAPTAIN_SBT_CONTRACT_ADDRESS,
        abi: captainSbtAbi,
        functionName: "tokenOfOwner",
        args: [address || ZERO_ADDR],
      },
      {
        address: CAPTAIN_SBT_CONTRACT_ADDRESS,
        abi: captainSbtAbi,
        functionName: "totalSupply",
      },
      {
        address: CAPTAIN_SBT_CONTRACT_ADDRESS,
        abi: captainSbtAbi,
        functionName: "nonces",
        args: [address || ZERO_ADDR],
      },
    ],
    query: { enabled: !!address && captainSbtDeployed },
  });
  const captainSbtBalance = captainSbtReads?.[0]?.result;
  const captainSbtTokenId = captainSbtReads?.[1]?.result;
  const captainSbtTotalSupply = captainSbtReads?.[2]?.result;
  const captainSbtNonce = captainSbtReads?.[3]?.result;

  // Season shop inventory
  const [inventory, setInventory] = useState<InventoryMap | null>(null);
  const [season, setSeason] = useState<SeasonState | null>(null);
  const [seasonRewardsOpen, setSeasonRewardsOpen] = useState(false);
  const [activeBoosterUntil, setActiveBoosterUntil] = useState<string | null>(null);
  const [questRerollPointUsed, setQuestRerollPointUsed] = useState(false);
  const [limitedSbt, setLimitedSbt] = useState<LimitedSbtState | null>(null);
  const [sbtBusy, setSbtBusy] = useState<"claim" | "weekly" | null>(null);
  const [sbtMsg, setSbtMsg] = useState("");
  const [shopMsg, setShopMsg] = useState("");
  const [shopBusy, setShopBusy] = useState<string | null>(null);
  const [promoCode, setPromoCode] = useState("");
  const [promoBusy, setPromoBusy] = useState(false);
  const [promoMsg, setPromoMsg] = useState("");
  const [itemPurchaseQuantities, setItemPurchaseQuantities] = useState<
    Partial<Record<ShopItemSlug, number>>
  >({});
  const [claimingSeasonLevels, setClaimingSeasonLevels] = useState<number[]>([]);
  const [showMobileBack, setShowMobileBack] = useState(false);
  const [bombQuantity, setBombQuantity] = useState(1);
  const [bombBoughtQty, setBombBoughtQty] = useState(0);

  const addOptimisticInventory = useCallback((slug: ShopItemSlug, quantity: number) => {
    setInventory((current) => ({
      ...EMPTY_INVENTORY,
      ...current,
      [slug]: (current?.[slug] ?? 0) + quantity,
    }));
  }, []);

  const applyOptimisticSeasonClaim = useCallback((levels: number[]) => {
    const claimed = new Set(levels);
    setSeason((current) => current ? {
      ...current,
      claimedLevels: Array.from(new Set([...current.claimedLevels, ...levels])).sort((a, b) => a - b),
      levels: current.levels.map((level) => claimed.has(level.level)
        ? { ...level, claimed: true, claimable: false }
        : level),
    } : current);
    for (const level of SEASON_LEVELS) {
      if (!claimed.has(level.level) || level.reward.kind !== "item") continue;
      addOptimisticInventory(level.reward.slug, level.reward.quantity);
    }
  }, [addOptimisticInventory]);

  const refreshSeasonShop = useCallback(async () => {
    if (!address) return;
    const results = await Promise.allSettled([
      getInventory(address).then(setInventory),
      ...(SEASON_UI_ENABLED ? [getSeasonState(address).then(setSeason)] : []),
      getActiveDoublePoints(address).then(setActiveBoosterUntil),
      hasQuestRerollPointPurchaseThisWeek(address).then(setQuestRerollPointUsed),
      getLimitedSbtState(address).then(setLimitedSbt),
    ]);
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") {
      setShopMsg(failed.reason instanceof Error ? failed.reason.message : tr.shop_items_load_failed);
    }
  }, [address, tr.shop_items_load_failed]);

  useEffect(() => {
    if (address) refreshSeasonShop();
  }, [address, refreshSeasonShop]);

  useEffect(() => {
    window.addEventListener(PLAYER_DATA_REFRESH_EVENT, refreshSeasonShop);
    return () => window.removeEventListener(PLAYER_DATA_REFRESH_EVENT, refreshSeasonShop);
  }, [refreshSeasonShop]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const value = params.get("code") || params.get("promo");
    if (value) setPromoCode(value);
  }, []);

  useEffect(() => {
    const updateMobileBack = () => {
      const isMobile = window.matchMedia("(max-width: 720px)").matches;
      setShowMobileBack(isMobile && window.scrollY > 220);
    };

    updateMobileBack();
    window.addEventListener("scroll", updateMobileBack, { passive: true });
    window.addEventListener("resize", updateMobileBack);
    return () => {
      window.removeEventListener("scroll", updateMobileBack);
      window.removeEventListener("resize", updateMobileBack);
    };
  }, []);

  const getItemPurchaseQty = (slug: ShopItemSlug, allowMany = true) => {
    const qty = normalizeShopPurchaseQuantity(itemPurchaseQuantities[slug] ?? 1);
    return allowMany ? qty : 1;
  };

  const setItemPurchaseQty = (slug: ShopItemSlug, quantity: number) => {
    setItemPurchaseQuantities((current) => ({
      ...current,
      [slug]: normalizeShopPurchaseQuantity(quantity),
    }));
  };

  const pointPurchaseSlugRef = useRef<ShopItemSlug | null>(null);
  const pointPurchaseQtyRef = useRef(1);
  const pointPurchaseHandledRef = useRef(false);
  const [pointPurchaseFallbackMined, setPointPurchaseFallbackMined] = useState(false);
  const {
    data: pointPurchaseTxHash,
    writeContract: writePointPurchaseTx,
    isPending: pointPurchasePending,
    error: pointPurchaseError,
    reset: resetPointPurchaseTx,
  } = useWriteContract();
  const { data: pointPurchaseReceipt } = useWaitForTransactionReceipt({
    hash: pointPurchaseTxHash,
  });
  const pointPurchaseMined =
    pointPurchaseReceipt?.status === "success" || pointPurchaseFallbackMined;

  const handleBuyPointItem = async (slug: ShopItemSlug, quantity = 1) => {
    if (!address || shopBusy) return;
    const qty = slug === "quest_reroll" ? 1 : normalizeShopPurchaseQuantity(quantity);
    setShopBusy(slug);
    setShopMsg("");
    setPointPurchaseFallbackMined(false);
    pointPurchaseSlugRef.current = null;
    pointPurchaseQtyRef.current = qty;
    pointPurchaseHandledRef.current = false;
    resetPointPurchaseTx();

    try {
      await validatePointItemPurchase(address, slug, qty);
      pointPurchaseSlugRef.current = slug;
      writePointPurchaseTx({
        address: SEABATTLE_CONTRACT_ADDRESS,
        abi: seaBattleAbi,
        functionName: "recordSoloResult",
        args: [pointPurchaseSentinelAddress(slug), true],
        chainId: base.id,
        dataSuffix: BUILDER_CODE_SUFFIX,
      });
    } catch (err) {
      setShopMsg(err instanceof Error ? err.message : tr.shop_purchase_failed);
      pointPurchaseSlugRef.current = null;
      pointPurchaseQtyRef.current = 1;
      setShopBusy(null);
    }
  };

  const handleActivateDouble = async () => {
    if (!address || shopBusy) return;
    setShopBusy("activate_double");
    setShopMsg("");
    try {
      const activeUntil = await activateDoublePoints(address);
      setActiveBoosterUntil(activeUntil);
      setShopMsg(tr.shop_double_activated);
      notifyPlayerDataRefresh();
      await refreshSeasonShop();
    } catch (err) {
      setShopMsg(err instanceof Error ? err.message : tr.shop_activation_failed);
    } finally {
      setShopBusy(null);
    }
  };

  const handleRedeemPromo = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!address) {
      setPromoMsg(lang === "ru" ? "Подключи кошелек" : "Connect wallet");
      return;
    }
    const code = promoCode.trim();
    if (!code || promoBusy) return;

    setPromoBusy(true);
    setPromoMsg("");
    try {
      const res = await fetch("/api/promos/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: address, code }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Could not redeem promo");

      const itemSlug = data?.reward?.itemSlug as ShopItemSlug | null | undefined;
      const quantity = Number(data?.reward?.quantity ?? 0);
      if (itemSlug && quantity > 0) addOptimisticInventory(itemSlug, quantity);

      setPromoMsg(data?.message || (lang === "ru" ? "Промокод активирован" : "Promo redeemed"));
      setPromoCode("");
      notifyPlayerDataRefresh();
      await refreshSeasonShop();
    } catch (err) {
      setPromoMsg(err instanceof Error ? err.message : "Could not redeem promo");
    } finally {
      setPromoBusy(false);
    }
  };

  const activeBoosterLabel = activeBoosterUntil
    ? new Date(activeBoosterUntil).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  // ─── Buy bomb tx flow (approve → buyBomb) ───
  useEffect(() => {
    setPointPurchaseFallbackMined(false);
    if (!pointPurchaseTxHash) return;
    let cancelled = false;
    waitForReceipt(wagmiConfig, { hash: pointPurchaseTxHash })
      .then((receipt) => {
        if (!cancelled && receipt.status === "success") setPointPurchaseFallbackMined(true);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [pointPurchaseTxHash, wagmiConfig]);

  useEffect(() => {
    if (
      !pointPurchaseMined ||
      pointPurchaseHandledRef.current ||
      !address ||
      !pointPurchaseSlugRef.current
    ) return;

    const slug = pointPurchaseSlugRef.current;
    const qty = pointPurchaseQtyRef.current;
    pointPurchaseHandledRef.current = true;
    addOptimisticInventory(slug, qty);

    buyPointItem(address, slug, qty)
      .then(async () => {
        if (slug === "quest_reroll") setQuestRerollPointUsed(true);
        setShopMsg(tr.shop_item_added);
        notifyPlayerDataRefresh();
        await refreshSeasonShop();
      })
      .catch((err) => {
        pointPurchaseHandledRef.current = false;
        setShopMsg(err instanceof Error ? err.message : tr.shop_purchase_failed);
      })
      .finally(() => {
        pointPurchaseSlugRef.current = null;
        pointPurchaseQtyRef.current = 1;
        setShopBusy(null);
      });
  }, [
    address,
    addOptimisticInventory,
    pointPurchaseMined,
    refreshSeasonShop,
    tr.shop_item_added,
    tr.shop_purchase_failed,
  ]);

  useEffect(() => {
    if (
      !pointPurchaseReceipt ||
      pointPurchaseReceipt.status !== "reverted" ||
      !pointPurchaseSlugRef.current
    ) return;

    setShopMsg(tr.shop_purchase_failed);
    pointPurchaseSlugRef.current = null;
    pointPurchaseQtyRef.current = 1;
    pointPurchaseHandledRef.current = false;
    setShopBusy(null);
  }, [pointPurchaseReceipt, tr.shop_purchase_failed]);

  useEffect(() => {
    if (!pointPurchaseError || !pointPurchaseSlugRef.current) return;
    const raw = pointPurchaseError.message || tr.shop_purchase_failed;
    const short = raw.includes("User rejected") || raw.includes("user rejected")
      ? tr.tx_rejected
      : raw.slice(0, 100);
    setShopMsg(short);
    pointPurchaseSlugRef.current = null;
    pointPurchaseQtyRef.current = 1;
    pointPurchaseHandledRef.current = false;
    setShopBusy(null);
  }, [pointPurchaseError, tr.shop_purchase_failed, tr.tx_rejected]);

  const [buying, setBuying] = useState(false);
  const [buyMsg, setBuyMsg] = useState("");
  const buyingRef = useRef(false);
  const buySubmittedRef = useRef(false);
  const bombTargetQtyRef = useRef(1);
  const [approveFallbackMined, setApproveFallbackMined] = useState(false);
  const [buyFallbackMined, setBuyFallbackMined] = useState(false);

  const {
    data: approveTxHash,
    writeContract: writeApprove,
    isPending: approvePending,
    error: approveError,
    reset: resetApprove,
  } = useWriteContract();
  const { data: approveReceipt } = useWaitForTransactionReceipt({
    hash: approveTxHash,
  });
  const approveMined = approveReceipt?.status === "success" || approveFallbackMined;

  const {
    data: buyTxHash,
    writeContract: writeBuy,
    isPending: buyPending,
    error: buyError,
    reset: resetBuy,
  } = useWriteContract();
  const { data: buyReceipt } = useWaitForTransactionReceipt({
    hash: buyTxHash,
  });
  const buyMined = buyReceipt?.status === "success" || buyFallbackMined;

  const submitBombPurchase = useCallback(() => {
    buySubmittedRef.current = true;
    writeBuy({
      address: SEABATTLE_CONTRACT_ADDRESS,
      abi: seaBattleAbi,
      functionName: "buyBomb",
      chainId: base.id,
      dataSuffix: BUILDER_CODE_SUFFIX,
    });
  }, [writeBuy]);

  useEffect(() => {
    setApproveFallbackMined(false);
    if (!approveTxHash) return;
    let cancelled = false;
    waitForReceipt(wagmiConfig, { hash: approveTxHash })
      .then((receipt) => {
        if (!cancelled && receipt.status === "success") setApproveFallbackMined(true);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [approveTxHash, wagmiConfig]);

  useEffect(() => {
    setBuyFallbackMined(false);
    if (!buyTxHash) return;
    let cancelled = false;
    waitForReceipt(wagmiConfig, { hash: buyTxHash })
      .then((receipt) => {
        if (!cancelled && receipt.status === "success") setBuyFallbackMined(true);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [buyTxHash, wagmiConfig]);

  useEffect(() => {
    if (!approveMined || !buyingRef.current || buySubmittedRef.current) return;
    submitBombPurchase();
  }, [approveMined, submitBombPurchase]);

  useEffect(() => {
    if (!approveReceipt || approveReceipt.status !== "reverted" || !buyingRef.current) return;
    setBuyMsg(tr.shop_purchase_failed);
    setBuying(false);
    buyingRef.current = false;
    buySubmittedRef.current = false;
  }, [approveReceipt, tr.shop_purchase_failed]);

  useEffect(() => {
    if (!buyMined || !buyingRef.current) return;
    const nextBought = Math.min(bombTargetQtyRef.current, bombBoughtQty + 1);
    setBombBoughtQty(nextBought);
    refetchBombs();

    if (nextBought < bombTargetQtyRef.current) {
      buySubmittedRef.current = false;
      resetBuy();
      setBuyFallbackMined(false);
      window.setTimeout(submitBombPurchase, 0);
      return;
    }

    setBuyMsg(
      bombTargetQtyRef.current > 1
        ? `${tr.shop_item_added} x${bombTargetQtyRef.current}`
        : tr.shop_item_added
    );
    setBuying(false);
    buyingRef.current = false;
    buySubmittedRef.current = false;
  }, [
    bombBoughtQty,
    buyMined,
    refetchBombs,
    resetBuy,
    submitBombPurchase,
    tr.shop_item_added,
  ]);

  useEffect(() => {
    if (!buyReceipt || buyReceipt.status !== "reverted" || !buyingRef.current) return;
    setBuyMsg(tr.shop_purchase_failed);
    setBuying(false);
    buyingRef.current = false;
    buySubmittedRef.current = false;
  }, [buyReceipt, tr.shop_purchase_failed]);

  useEffect(() => {
    const err = approveError || buyError;
    if (!err || !buying) return;
    const raw = err.message || "Failed";
    const short = raw.includes("User rejected") || raw.includes("user rejected")
      ? tr.tx_rejected
      : raw.slice(0, 80);
    setBuyMsg(short);
    setBuying(false);
    buyingRef.current = false;
    buySubmittedRef.current = false;
  }, [approveError, buyError, buying, tr.tx_rejected]);

  const handleBuy = () => {
    if (!address || buying) return;
    if (SEABATTLE_CONTRACT_ADDRESS === ZERO_ADDR) {
      setBuyMsg(tr.contract_not_deployed);
      return;
    }
    const qty = normalizeShopPurchaseQuantity(bombQuantity);
    setBombQuantity(qty);
    setBombBoughtQty(0);
    bombTargetQtyRef.current = qty;
    setBuying(true);
    buyingRef.current = true;
    buySubmittedRef.current = false;
    setBuyMsg("");
    resetApprove();
    resetBuy();
    setApproveFallbackMined(false);
    setBuyFallbackMined(false);
    writeApprove({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: "approve",
      args: [SEABATTLE_CONTRACT_ADDRESS, BOMB_PRICE * BigInt(qty)],
      chainId: base.id,
    });
  };

  // ─── Daily check-in ───
  // Paid Quest Reroll repeat purchase (after weekly points purchase)
  const paidQuestRerollRef = useRef(false);
  const paidQuestRerollQtyRef = useRef(1);
  const paidQuestRerollHandledRef = useRef(false);
  const [paidQuestRerollFallbackMined, setPaidQuestRerollFallbackMined] = useState(false);
  const {
    data: paidQuestRerollTxHash,
    writeContract: writePaidQuestReroll,
    isPending: paidQuestRerollPending,
    error: paidQuestRerollError,
    reset: resetPaidQuestReroll,
  } = useWriteContract();
  const { data: paidQuestRerollReceipt } = useWaitForTransactionReceipt({
    hash: paidQuestRerollTxHash,
  });
  const paidQuestRerollMined =
    paidQuestRerollReceipt?.status === "success" || paidQuestRerollFallbackMined;

  const finishPaidQuestRerollGrant = useCallback(async (
    txHash: `0x${string}`,
    quantity = paidQuestRerollQtyRef.current
  ) => {
    if (!address) return;
    const qty = normalizeShopPurchaseQuantity(quantity);
    await grantPaidQuestReroll(address, txHash, qty);
    if (typeof window !== "undefined") {
      localStorage.removeItem(pendingPaidQrKey(address));
      localStorage.removeItem(pendingPaidQrQtyKey(address));
    }
    addOptimisticInventory("quest_reroll", qty);
    notifyPlayerDataRefresh();
    setShopMsg(tr.shop_item_added);
    await refreshSeasonShop();
    clearWalletRequest();
  }, [address, addOptimisticInventory, refreshSeasonShop, tr.shop_item_added]);

  const findLatestPaidQuestRerollTx = useCallback(async (
    quantity = paidQuestRerollQtyRef.current
  ): Promise<`0x${string}` | null> => {
    if (!address) return null;
    const expectedAmount = BigInt(
      QUEST_REROLL_USDC_PRICE * normalizeShopPurchaseQuantity(quantity)
    );
    const client = getPublicClient(wagmiConfig, { chainId: base.id });
    if (!client) return null;
    const latest = await client.getBlockNumber();
    const scanBlocks = BigInt(20_000);
    const fromBlock = latest > scanBlocks ? latest - scanBlocks : BigInt(0);
    const transferEvent = parseAbiItem(
      "event Transfer(address indexed from, address indexed to, uint256 value)"
    );
    const logs = await client.getLogs({
      address: USDC_ADDRESS,
      event: transferEvent,
      args: {
        from: address,
        to: SHOP_TREASURY_ADDRESS,
      },
      fromBlock,
      toBlock: "latest",
    });
    const match = [...logs]
      .reverse()
      .find((log) => log.args.value === expectedAmount);
    return match?.transactionHash ?? null;
  }, [address, wagmiConfig]);

  useEffect(() => {
    setPaidQuestRerollFallbackMined(false);
    if (!paidQuestRerollTxHash) return;
    let cancelled = false;
    waitForReceipt(wagmiConfig, { hash: paidQuestRerollTxHash })
      .then((receipt) => {
        if (!cancelled && receipt.status === "success") setPaidQuestRerollFallbackMined(true);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [paidQuestRerollTxHash, wagmiConfig]);

  useEffect(() => {
    if (!address || !paidQuestRerollTxHash) return;
    if (typeof window !== "undefined") {
      localStorage.setItem(pendingPaidQrKey(address), paidQuestRerollTxHash);
      localStorage.setItem(
        pendingPaidQrQtyKey(address),
        String(normalizeShopPurchaseQuantity(paidQuestRerollQtyRef.current))
      );
    }
  }, [address, paidQuestRerollTxHash]);

  useEffect(() => {
    if (
      !paidQuestRerollMined ||
      !paidQuestRerollRef.current ||
      paidQuestRerollHandledRef.current ||
      !address ||
      !paidQuestRerollTxHash
    ) return;
    paidQuestRerollRef.current = false;
    paidQuestRerollHandledRef.current = true;
    finishPaidQuestRerollGrant(paidQuestRerollTxHash, paidQuestRerollQtyRef.current)
      .catch((err) => {
        setShopMsg(err instanceof Error ? err.message : tr.shop_purchase_failed);
      })
      .finally(() => {
        clearWalletRequest();
        setShopBusy(null);
      });
  }, [
    paidQuestRerollMined,
    paidQuestRerollTxHash,
    address,
    finishPaidQuestRerollGrant,
    tr.shop_purchase_failed,
  ]);

  useEffect(() => {
    if (!address || shopBusy) return;
    const storedHash =
      typeof window !== "undefined"
        ? localStorage.getItem(pendingPaidQrKey(address))
        : null;
    if (!storedHash?.startsWith("0x")) return;
    const storedQty = normalizeShopPurchaseQuantity(
      Number(localStorage.getItem(pendingPaidQrQtyKey(address)) ?? 1)
    );
    let cancelled = false;
    setShopBusy("quest_reroll_usdc");
    waitForReceipt(wagmiConfig, { hash: storedHash as `0x${string}` })
      .then(async (receipt) => {
        if (cancelled) return;
        if (receipt.status !== "success") {
          localStorage.removeItem(pendingPaidQrKey(address));
          localStorage.removeItem(pendingPaidQrQtyKey(address));
          return;
        }
        await finishPaidQuestRerollGrant(storedHash as `0x${string}`, storedQty);
      })
      .catch((err) => {
        if (!cancelled) setShopMsg(err instanceof Error ? err.message : tr.shop_purchase_failed);
      })
      .finally(() => {
        if (!cancelled) setShopBusy(null);
      });
    return () => { cancelled = true; };
  }, [address, finishPaidQuestRerollGrant, shopBusy, tr.shop_purchase_failed, wagmiConfig]);

  useEffect(() => {
    if (!address || shopBusy !== "quest_reroll_usdc" || paidQuestRerollHandledRef.current) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      findLatestPaidQuestRerollTx()
        .then(async (hash) => {
          if (cancelled || !hash || paidQuestRerollHandledRef.current) return;
          paidQuestRerollRef.current = false;
          paidQuestRerollHandledRef.current = true;
          try {
            await finishPaidQuestRerollGrant(hash, paidQuestRerollQtyRef.current);
          } catch (err) {
            paidQuestRerollHandledRef.current = false;
            if (!cancelled) {
              setShopMsg(err instanceof Error ? err.message : tr.shop_purchase_failed);
            }
          } finally {
            if (!cancelled) setShopBusy(null);
          }
        })
        .catch(() => {});
    }, 15_000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    address,
    findLatestPaidQuestRerollTx,
    finishPaidQuestRerollGrant,
    shopBusy,
    tr.shop_purchase_failed,
  ]);

  useEffect(() => {
    if (!address || shopBusy || !questRerollPointUsed) return;
    const checkedKey = `sbt_qr_recover_checked_${address.toLowerCase()}`;
    if (typeof window !== "undefined" && sessionStorage.getItem(checkedKey) === "1") return;
    if (typeof window !== "undefined") sessionStorage.setItem(checkedKey, "1");
    let cancelled = false;
    findLatestPaidQuestRerollTx()
      .then(async (hash) => {
        if (cancelled || !hash) return;
        await finishPaidQuestRerollGrant(hash, paidQuestRerollQtyRef.current);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [
    address,
    findLatestPaidQuestRerollTx,
    finishPaidQuestRerollGrant,
    questRerollPointUsed,
    shopBusy,
  ]);

  useEffect(() => {
    if (!paidQuestRerollReceipt || paidQuestRerollReceipt.status !== "reverted" || shopBusy !== "quest_reroll_usdc") return;
    setShopMsg(tr.shop_purchase_failed);
    paidQuestRerollRef.current = false;
    paidQuestRerollQtyRef.current = 1;
    paidQuestRerollHandledRef.current = false;
    clearWalletRequest();
    setShopBusy(null);
  }, [paidQuestRerollReceipt, shopBusy, tr.shop_purchase_failed]);

  useEffect(() => {
    if (!paidQuestRerollError || shopBusy !== "quest_reroll_usdc") return;
    const raw = paidQuestRerollError.message || tr.shop_purchase_failed;
    const short = raw.includes("User rejected") || raw.includes("user rejected")
      ? tr.tx_rejected
      : raw.slice(0, 100);
    setShopMsg(short);
    paidQuestRerollRef.current = false;
    paidQuestRerollQtyRef.current = 1;
    paidQuestRerollHandledRef.current = false;
    clearWalletRequest();
    setShopBusy(null);
  }, [paidQuestRerollError, shopBusy, tr.shop_purchase_failed, tr.tx_rejected]);

  const handleBuyQuestRerollUsdc = (quantity = 1) => {
    if (!address || shopBusy) return;
    const qty = normalizeShopPurchaseQuantity(quantity);
    setShopBusy("quest_reroll_usdc");
    setShopMsg("");
    paidQuestRerollRef.current = true;
    paidQuestRerollQtyRef.current = qty;
    paidQuestRerollHandledRef.current = false;
    setPaidQuestRerollFallbackMined(false);
    resetPaidQuestReroll();
    markWalletRequestStarted("paid-quest-reroll");
    try {
      writePaidQuestReroll({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "transfer",
        args: [SHOP_TREASURY_ADDRESS, BigInt(QUEST_REROLL_USDC_PRICE * qty)],
        chainId: base.id,
      });
    } catch (err) {
      clearWalletRequest();
      setShopBusy(null);
      setShopMsg(err instanceof Error ? err.message : tr.shop_purchase_failed);
    }
  };

  const [checkin, setCheckin] = useState<CheckinStatus | null>(null);
  const [checkinMsg, setCheckinMsg] = useState("");
  const [checkinLoading, setCheckinLoading] = useState(false);
  const [checkinTxFallbackMined, setCheckinTxFallbackMined] = useState(false);
  const [checkinCallsFallbackSuccess, setCheckinCallsFallbackSuccess] = useState(false);
  const checkinRecorded = useRef(false);

  const { data: capabilities } = useCapabilities({ chainId: base.id });
  const paymasterSupported =
    !!PAYMASTER_URL && !!capabilities?.paymasterService?.supported;

  const {
    sendCalls: sendCheckinCalls,
    data: checkinCallsData,
    isPending: checkinCallsPending,
  } = useSendCalls();
  const { data: checkinCallsStatus } = useCallsStatus({
    id: checkinCallsData?.id ?? "",
    query: {
      enabled: !!checkinCallsData?.id,
      refetchInterval: ({ state }) =>
        state.data?.status === "success" ? false : 1500,
    },
  });
  const checkinCallsSuccess = checkinCallsStatus?.status === "success";

  const {
    data: checkinTxHash,
    writeContract: writeCheckin,
    isPending: checkinTxPending,
  } = useWriteContract();
  const { data: checkinTxReceipt } = useWaitForTransactionReceipt({
    hash: checkinTxHash,
  });

  useEffect(() => {
    setCheckinTxFallbackMined(false);
    if (!checkinTxHash) return;
    let cancelled = false;
    waitForReceipt(wagmiConfig, { hash: checkinTxHash })
      .then((receipt) => {
        if (!cancelled && receipt.status === "success") setCheckinTxFallbackMined(true);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [checkinTxHash, wagmiConfig]);

  useEffect(() => {
    setCheckinCallsFallbackSuccess(false);
    if (!checkinCallsData?.id || !checkinLoading) return;
    const timer = window.setTimeout(() => setCheckinCallsFallbackSuccess(true), 12_000);
    return () => window.clearTimeout(timer);
  }, [checkinCallsData?.id, checkinLoading]);

  const checkinTxSuccess = checkinTxReceipt?.status === "success" || checkinTxFallbackMined;
  const checkinSuccess = checkinTxSuccess || checkinCallsSuccess || checkinCallsFallbackSuccess;
  const checkinPending = checkinTxPending || checkinCallsPending;

  // Season rewards are unlocked with a lightweight on-chain claim proof.
  const seasonClaimLevelsRef = useRef<number[]>([]);
  const seasonClaimHandledRef = useRef(false);
  const [seasonClaimFallbackMined, setSeasonClaimFallbackMined] = useState(false);
  const {
    data: seasonClaimTxHash,
    writeContract: writeSeasonClaimTx,
    isPending: seasonClaimTxPending,
    error: seasonClaimTxError,
    reset: resetSeasonClaimTx,
  } = useWriteContract();
  const { data: seasonClaimTxReceipt } = useWaitForTransactionReceipt({
    hash: seasonClaimTxHash,
  });

  const {
    sendCalls: sendSeasonClaimCalls,
    data: seasonClaimCallsData,
    isPending: seasonClaimCallsPending,
  } = useSendCalls();
  const { data: seasonClaimCallsStatus } = useCallsStatus({
    id: seasonClaimCallsData?.id ?? "",
    query: {
      enabled: !!seasonClaimCallsData?.id,
      refetchInterval: ({ state }) =>
        state.data?.status === "success" ? false : 1500,
    },
  });
  const seasonClaimCallsSuccess = seasonClaimCallsStatus?.status === "success";
  const seasonClaimTxSuccess =
    seasonClaimTxReceipt?.status === "success" || seasonClaimFallbackMined;
  const seasonClaimOnchainSuccess = seasonClaimTxSuccess || seasonClaimCallsSuccess;
  const seasonClaimPending = seasonClaimTxPending || seasonClaimCallsPending;
  const {
    data: captainSbtMintHash,
    writeContract: writeCaptainSbtMint,
    isPending: captainSbtMintPending,
    error: captainSbtMintError,
    reset: resetCaptainSbtMint,
  } = useWriteContract();
  const { data: captainSbtMintReceipt } = useWaitForTransactionReceipt({
    hash: captainSbtMintHash,
  });

  useEffect(() => {
    setSeasonClaimFallbackMined(false);
    if (!seasonClaimTxHash) return;
    let cancelled = false;
    waitForReceipt(wagmiConfig, { hash: seasonClaimTxHash })
      .then((receipt) => {
        if (!cancelled && receipt.status === "success") setSeasonClaimFallbackMined(true);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [seasonClaimTxHash, wagmiConfig]);

  useEffect(() => {
    if (address) getCheckinStatus(address).then(setCheckin).catch(() => {});
  }, [address]);

  useEffect(() => {
    if (!checkinSuccess || !address || checkinRecorded.current) return;
    checkinRecorded.current = true;
    setCheckin((current) => current ? { ...current, canCheckin: false } : current);
    dailyCheckin(address)
      .then((res) => {
        setCheckinMsg(
          `+${res.points} ${tr.shop_pts}! ${tr.streak}: ${res.streak}d${res.usedFreeze ? ` (${tr.streak_freeze_used})` : ""}`
        );
        notifyPlayerDataRefresh();
        getCheckinStatus(address).then(setCheckin).catch(() => {});
        refreshSeasonShop();
      })
      .catch(() => setCheckinMsg(tr.checkin_already_done))
      .finally(() => setCheckinLoading(false));
  }, [
    checkinSuccess,
    address,
    refreshSeasonShop,
    tr.checkin_already_done,
    tr.shop_pts,
    tr.streak,
    tr.streak_freeze_used,
  ]);

  useEffect(() => {
    if (!seasonClaimOnchainSuccess || seasonClaimHandledRef.current || !address) return;
    const levels = seasonClaimLevelsRef.current;
    if (levels.length === 0) return;
    seasonClaimHandledRef.current = true;
    seasonClaimLevelsRef.current = [];
    applyOptimisticSeasonClaim(levels);

    claimSeasonLevels(address, levels)
      .then(async (rewards) => {
        const rewardSummary = rewards.slice(0, 3).map((reward) => rewardLabel(reward, lang)).join(", ");
        const rewardTail = rewards.length > 3 ? ` +${rewards.length - 3}` : "";
        const label = rewards.length > 1
          ? lang === "ru"
            ? "Награды Battle Pass получены"
            : "Battle Pass rewards claimed"
          : tr.shop_reward_claimed;
        setShopMsg(`${label}: ${rewardSummary}${rewardTail}`);
        notifyPlayerDataRefresh();
        await refreshSeasonShop();
      })
      .catch((err) => {
        setShopMsg(err instanceof Error ? err.message : tr.shop_claim_failed);
      })
      .finally(() => setClaimingSeasonLevels([]));
  }, [
    seasonClaimOnchainSuccess,
    address,
    applyOptimisticSeasonClaim,
    lang,
    refreshSeasonShop,
    tr.shop_claim_failed,
    tr.shop_reward_claimed,
  ]);

  useEffect(() => {
    if (!seasonClaimTxError || claimingSeasonLevels.length === 0) return;
    const raw = seasonClaimTxError.message || tr.shop_claim_failed;
    const short = raw.includes("User rejected") || raw.includes("user rejected")
      ? tr.tx_rejected
      : raw.slice(0, 100);
    setShopMsg(short);
    setClaimingSeasonLevels([]);
    seasonClaimLevelsRef.current = [];
    seasonClaimHandledRef.current = true;
  }, [seasonClaimTxError, claimingSeasonLevels.length, tr.shop_claim_failed, tr.tx_rejected]);

  const handleClaimSeasonLevels = async (levels: number[]) => {
    const claimLevels = Array.from(new Set(levels)).sort((a, b) => a - b);
    if (!address || claimingSeasonLevels.length > 0 || seasonClaimPending) return;
    if (claimLevels.length === 0) {
      setShopMsg(lang === "ru" ? "Нет готовых наград" : "No rewards ready");
      return;
    }
    if (SEABATTLE_CONTRACT_ADDRESS === ZERO_ADDR) {
      setShopMsg(tr.contract_not_deployed);
      return;
    }

    setClaimingSeasonLevels(claimLevels);
    setShopMsg("");
    setSeasonClaimFallbackMined(false);
    resetSeasonClaimTx();

    try {
      await validateSeasonLevelClaims(address, claimLevels);
    } catch (err) {
      setShopMsg(err instanceof Error ? err.message : tr.shop_claim_failed);
      setClaimingSeasonLevels([]);
      seasonClaimLevelsRef.current = [];
      seasonClaimHandledRef.current = true;
      return;
    }

    seasonClaimLevelsRef.current = claimLevels;
    seasonClaimHandledRef.current = false;
    const sentinel = seasonClaimSentinelAddress(claimLevels[claimLevels.length - 1]);

    if (paymasterSupported && PAYMASTER_URL) {
      sendSeasonClaimCalls({
        calls: [{
          to: SEABATTLE_CONTRACT_ADDRESS,
          data: encodeFunctionData({
            abi: seaBattleAbi,
            functionName: "recordSoloResult",
            args: [sentinel, true],
          }),
          dataSuffix: BUILDER_CODE_SUFFIX,
        }],
        capabilities: { paymasterService: { url: PAYMASTER_URL } },
      });
      return;
    }

    writeSeasonClaimTx({
      address: SEABATTLE_CONTRACT_ADDRESS,
      abi: seaBattleAbi,
      functionName: "recordSoloResult",
      args: [sentinel, true],
      chainId: base.id,
      dataSuffix: BUILDER_CODE_SUFFIX,
    });
  };

  const handleClaimSeasonLevel = (level: number) => {
    handleClaimSeasonLevels([level]);
  };

  useEffect(() => {
    if (captainSbtMintReceipt?.status !== "success" || sbtBusy !== "claim") return;
    setSbtMsg(lang === "ru" ? "SBT заминчен on-chain" : "SBT minted on-chain");
    Promise.all([
      refreshSeasonShop(),
      refetchCaptainSbtReads(),
    ]).catch(() => {});
    setSbtBusy(null);
  }, [
    captainSbtMintReceipt,
    lang,
    refetchCaptainSbtReads,
    refreshSeasonShop,
    sbtBusy,
  ]);

  useEffect(() => {
    if (!captainSbtMintError || sbtBusy !== "claim") return;
    const raw = captainSbtMintError.message || tr.shop_claim_failed;
    const short = raw.includes("User rejected") || raw.includes("user rejected")
      ? tr.tx_rejected
      : raw.slice(0, 120);
    setSbtMsg(short);
    setSbtBusy(null);
  }, [captainSbtMintError, sbtBusy, tr.shop_claim_failed, tr.tx_rejected]);

  const handleClaimLimitedSbt = async () => {
    if (!address || sbtBusy) return;
    if (!captainSbtDeployed) {
      setSbtMsg(lang === "ru" ? "SBT контракт ещё не задеплоен" : "SBT contract is not deployed");
      return;
    }
    setSbtBusy("claim");
    setSbtMsg("");
    resetCaptainSbtMint();
    try {
      const res = await fetch("/api/captain-sbt/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: address,
          nonce: (captainSbtNonce ?? BigInt(0)).toString(),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || tr.shop_claim_failed);
      writeCaptainSbtMint({
        address: CAPTAIN_SBT_CONTRACT_ADDRESS,
        abi: captainSbtAbi,
        functionName: "mint",
        args: [BigInt(data.deadline), data.signature as `0x${string}`],
        chainId: base.id,
        dataSuffix: BUILDER_CODE_SUFFIX,
      });
    } catch (err) {
      setSbtMsg(err instanceof Error ? err.message : tr.shop_claim_failed);
      setSbtBusy(null);
    }
  };

  const handleClaimLimitedSbtWeekly = async () => {
    if (!address || sbtBusy) return;
    setSbtBusy("weekly");
    setSbtMsg("");
    try {
      const { points } = await claimLimitedSbtWeeklyPoints(address);
      setSbtMsg(
        points > 0
          ? `+${points.toLocaleString()} ${tr.shop_pts}`
          : lang === "ru"
            ? "Награда недели уже получена"
            : "Weekly reward already claimed"
      );
      notifyPlayerDataRefresh();
      await refreshSeasonShop();
    } catch (err) {
      setSbtMsg(err instanceof Error ? err.message : tr.shop_claim_failed);
    } finally {
      setSbtBusy(null);
    }
  };

  const handleCheckin = () => {
    if (!address || !checkin?.canCheckin) return;
    if (SEABATTLE_CONTRACT_ADDRESS === ZERO_ADDR) {
      setCheckinMsg(tr.contract_not_deployed);
      return;
    }
    setCheckinLoading(true);
    setCheckinMsg("");
    checkinRecorded.current = false;

    if (paymasterSupported && PAYMASTER_URL) {
      sendCheckinCalls({
        calls: [
          {
            to: SEABATTLE_CONTRACT_ADDRESS,
            data: encodeFunctionData({
              abi: seaBattleAbi,
              functionName: "checkin",
            }),
            dataSuffix: BUILDER_CODE_SUFFIX,
          },
        ],
        capabilities: { paymasterService: { url: PAYMASTER_URL } },
      });
      return;
    }

    writeCheckin({
      address: SEABATTLE_CONTRACT_ADDRESS,
      abi: seaBattleAbi,
      functionName: "checkin",
      chainId: base.id,
      dataSuffix: BUILDER_CODE_SUFFIX,
    });
  };

  const buyBtnLabel = buying
    ? approvePending
      ? tr.shop_bomb_approve
      : buyPending
        ? tr.shop_bomb_pending
        : bombTargetQtyRef.current > 1
          ? `${tr.shop_bomb_buying} ${bombBoughtQty}/${bombTargetQtyRef.current}`
          : tr.shop_bomb_buying
    : tr.shop_bomb_buy;
  const currentSeasonLevel = Math.min(season?.level ?? 0, SEASON_MAX_LEVEL);
  const currentSeasonXp = season?.xp ?? 0;
  const nextSeasonXp = season?.nextLevelXp ?? null;
  const seasonLevels = season?.levels ?? [];
  const claimableSeasonLevelNumbers = seasonLevels
    .filter((level) => level.claimable)
    .map((level) => level.level);
  const readySeasonRewards = claimableSeasonLevelNumbers.length;
  const claimedSeasonRewards = seasonLevels.filter((level) => level.claimed).length;
  const claimingLevel = claimingSeasonLevels.length === 1 ? claimingSeasonLevels[0] : null;
  const seasonClaimBusy = claimingSeasonLevels.length > 0 || seasonClaimPending;
  const seasonClaimAllLabel = lang === "ru" ? "Получить все" : "Claim all";
  const sbtWins = limitedSbt?.wins ?? 0;
  const sbtWinsLeft = Math.max(0, LIMITED_SBT_REQUIRED_WINS - sbtWins);
  const sbtProgressPct = Math.min(100, (sbtWins / LIMITED_SBT_REQUIRED_WINS) * 100);
  const onchainSbtBalance = Number(captainSbtBalance ?? BigInt(0));
  const onchainSbtTokenId = onchainSbtBalance > 0 ? Number(captainSbtTokenId ?? BigInt(0)) : null;
  const onchainSbtSupply = Number(captainSbtTotalSupply ?? BigInt(0));
  const sbtTokenId = captainSbtDeployed ? onchainSbtTokenId : limitedSbt?.tokenId ?? null;
  const sbtClaimedSupply = captainSbtDeployed ? onchainSbtSupply : limitedSbt?.claimedSupply ?? 0;
  const sbtRemaining = Math.max(0, LIMITED_SBT_MAX_SUPPLY - sbtClaimedSupply);
  const canClaimSbt =
    !sbtTokenId &&
    sbtWins >= LIMITED_SBT_REQUIRED_WINS &&
    sbtRemaining > 0 &&
    (captainSbtDeployed || !!limitedSbt?.canClaim);
  const canClaimSbtWeekly = !!sbtTokenId && !limitedSbt?.weeklyClaimed;
  const sbtCopy = lang === "ru"
    ? {
        title: "Captain SBT",
        desc: "20 soulbound-пропусков для капитанов со 100 победами. Держатель забирает 10,000 pts раз в неделю.",
        wins: "Победы",
        winsLeft: "Осталось побед",
        supply: "SBT осталось",
        weekly: "Награда недели",
        owned: "Твой SBT",
        claim: "Получить SBT",
        claimWeekly: "Забрать 10k pts",
        weeklyDone: "Получено на этой неделе",
        locked: "Нужно 100 побед",
        soldOut: "Все 20 разобрали",
        notDeployed: "SBT контракт не задеплоен",
        setup: "SBT готовится",
      }
    : {
        title: "Captain SBT",
        desc: "20 soulbound passes for captains with 100 wins. Holders can claim 10,000 pts once per week.",
        wins: "Wins",
        winsLeft: "Wins left",
        supply: "SBT left",
        weekly: "Weekly reward",
        owned: "Your SBT",
        claim: "Claim SBT",
        claimWeekly: "Claim 10k pts",
        weeklyDone: "Claimed this week",
        locked: "Need 100 wins",
        soldOut: "All 20 claimed",
        notDeployed: "SBT contract not deployed",
        setup: "SBT setup pending",
      };
  const seasonRewardsTitle = lang === "ru" ? "Награды Battle Pass" : "Battle Pass rewards";
  const seasonRewardsToggleLabel = seasonRewardsOpen
    ? lang === "ru"
      ? "Свернуть"
      : "Collapse"
    : lang === "ru"
      ? "Раскрыть"
      : "Expand";
  const seasonRewardsSummary = `${claimedSeasonRewards}/${SEASON_MAX_LEVEL} ${tr.shop_claimed}${
    readySeasonRewards > 0 ? ` · ${readySeasonRewards} ${tr.quests_ready}` : ""
  }`;
  const seasonXpToNext = nextSeasonXp
    ? Math.max(0, nextSeasonXp - currentSeasonXp)
    : 0;
  const seasonProgressPct = nextSeasonXp
    ? Math.min(100, (currentSeasonXp / nextSeasonXp) * 100)
    : currentSeasonLevel >= SEASON_MAX_LEVEL
      ? 100
      : 0;
  const nextSeasonLevel = Math.min(currentSeasonLevel + 1, SEASON_MAX_LEVEL);
  const firstClaimableSeasonRewardIndex = seasonLevels.findIndex((level) => level.claimable);
  const firstOpenSeasonRewardIndex = seasonLevels.findIndex((level) => !level.claimed);
  const seasonRewardStartIndex =
    firstClaimableSeasonRewardIndex >= 0
      ? firstClaimableSeasonRewardIndex
      : firstOpenSeasonRewardIndex >= 0
        ? firstOpenSeasonRewardIndex
        : Math.max(0, seasonLevels.length - 1);
  const visibleSeasonLevels = seasonRewardsOpen
    ? seasonLevels
    : seasonLevels.slice(seasonRewardStartIndex, seasonRewardStartIndex + 5);

  return (
    <div className={styles.container}>
      <SettingsPanel />
      <header className={styles.header}>
        <button className={styles.back} onClick={() => router.push("/")} type="button">
          ← {tr.back}
        </button>
        <div className={styles.titleBlock}>
          <span className={styles.eyebrow}>{tr.shop_eyebrow}</span>
          <h1 className={styles.title}>{tr.shop_title}</h1>
          <p className={styles.subtitle}>{tr.shop_page_subtitle}</p>
        </div>
      </header>

      <main className={styles.main}>
        {!isConnected && (
          <p className={styles.empty}>{tr.shop_connect_hint}</p>
        )}

            <section className={styles.commandStrip} aria-label={tr.shop_status_label}>
              <div>
                <span>{tr.shop_boost}</span>
                <b>{activeBoosterLabel ? `${tr.shop_boost_until} ${activeBoosterLabel}` : tr.shop_boost_inactive}</b>
              </div>
              {SEASON_UI_ENABLED && (
                <>
                  <div>
                    <span>{tr.shop_season}</span>
                    <b>{tr.shop_level} {currentSeasonLevel}</b>
                  </div>
                  <div>
                    <span>{tr.shop_xp}</span>
                    <b>{currentSeasonXp.toLocaleString()}</b>
                  </div>
                  <div>
                    <span>{lang === "ru" ? "Очки сезона" : "Season points"}</span>
                    <b>{(season?.points ?? 0).toLocaleString()}</b>
                  </div>
                </>
              )}
              <div>
                <span>{tr.shop_bombs}</span>
                <b>{available}</b>
              </div>
            </section>

            <FleetNftPanel />
            {USDC_SEASON_REWARDS_ENABLED && <SeasonPoolCard variant="wide" />}

            <section className={`${styles.card} ${styles.featuredCard}`}>
              <div className={styles.cardTop}>
                <span className={styles.cardIcon} aria-hidden="true">
                  <ShopIcon size={24} />
                </span>
                <div className={styles.cardInfo}>
                  <h2 className={styles.cardTitle}>{tr.shop_featured}</h2>
                  <p className={styles.cardDesc}>{tr.shop_featured_desc}</p>
                </div>
                {activeBoosterLabel && (
                  <span className={styles.price}>{tr.shop_boost_until} {activeBoosterLabel}</span>
                )}
              </div>

              <div className={styles.featuredGrid}>
                {SHOP_ITEMS.filter((item) => item.featured).map((item) => {
                  const ownedQty = inventory?.[item.slug] ?? 0;
                  const isDouble = item.slug === "double_points_1h";
                  const isHero = isDouble;
                  const canActivateDouble = isDouble && ownedQty > 0;
                  const useUsdcPrice = item.slug === "quest_reroll" && questRerollPointUsed;
                  const allowMany = item.slug !== "quest_reroll" || useUsdcPrice;
                  const purchaseQty = getItemPurchaseQty(item.slug, allowMany);
                  const buyBusy =
                    shopBusy === item.slug ||
                    (useUsdcPrice && shopBusy === "quest_reroll_usdc");
                  const activateBusy = isDouble && shopBusy === "activate_double";

                  const meta = ITEM_META[item.slug];
                  const copy = shopItemText(item, lang);

                  const tierClass =
                    meta.tier === "legendary"
                      ? styles.tierLegendary
                      : meta.tier === "epic"
                        ? styles.tierEpic
                        : meta.tier === "rare"
                          ? styles.tierRare
                          : styles.tierLocked;
                  const label = !item.enabled
                    ? copy.status
                    : useUsdcPrice
                        ? formatUsdcMicro(QUEST_REROLL_USDC_PRICE * purchaseQty)
                        : `${((item.pricePoints ?? 0) * purchaseQty).toLocaleString()} ${tr.shop_pts}`;

                  return (
                    <article
                      key={item.slug}
                      data-shop-item={item.slug}
                      className={`${styles.featuredItem} ${
                        isHero ? styles.featuredItemHero : ""
                      } ${tierClass} ${!item.enabled ? styles.featuredLocked : ""}`}
                      style={{
                        ["--shop-accent" as string]: meta.accent,
                      }}
                    >
                      <span className={styles.itemKicker}>
                        {tierLabel(meta.tier)}
                      </span>

                      <div className={styles.itemTopline}>
                        <span className={styles.itemArtStage}>
                          <ItemArt
                            kind={item.slug}
                            size={isHero ? "hero" : "showcase"}
                            className={styles.itemArt}
                          />
                        </span>
                      </div>

                      <div className={styles.itemBody}>
                        <h3>{copy.name}</h3>
                        <p>{copy.desc}</p>
                      </div>

                      <div
                        className={`${styles.itemFooter} ${
                          canActivateDouble ? styles.itemFooterStacked : ""
                        }`}
                      >
                        <span className={styles.itemQty}>
                          <StarIcon size={12} />
                          {tr.shop_owned} {ownedQty}
                        </span>

                        <div className={styles.itemActions}>
                          {item.enabled && allowMany && (
                            <label className={styles.quantityControl}>
                              <span>{lang === "ru" ? "К-во" : "Qty"}</span>
                              <input
                                type="number"
                                min={1}
                                max={MAX_SHOP_PURCHASE_QUANTITY}
                                value={purchaseQty}
                                onChange={(event) =>
                                  setItemPurchaseQty(item.slug, Number(event.target.value))
                                }
                                disabled={shopBusy !== null}
                                aria-label={`${copy.name} quantity`}
                              />
                            </label>
                          )}
                          <button
                            className={`${styles.btn} ${styles.btnCompact} ${styles.shopBuyButton}`}
                            onClick={() =>
                              useUsdcPrice
                                ? handleBuyQuestRerollUsdc(purchaseQty)
                                : handleBuyPointItem(item.slug, purchaseQty)
                            }
                            disabled={
                              !isConnected ||
                              !item.enabled ||
                              shopBusy !== null ||
                              paidQuestRerollPending ||
                              pointPurchasePending
                            }
                            type="button"
                          >
                            {item.enabled && <CoinIcon size={13} />}
                            <span>{buyBusy ? tr.shop_working : label}</span>
                          </button>

                          {canActivateDouble && (
                            <button
                              className={`${styles.btn} ${styles.btnCompact} ${styles.shopBuyButton} ${styles.activateButton}`}
                              onClick={handleActivateDouble}
                              disabled={!isConnected || shopBusy !== null}
                              type="button"
                            >
                              <StarIcon size={13} />
                              <span>{activateBusy ? tr.shop_working : tr.shop_activate}</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
              {shopMsg && <p className={styles.msg}>{shopMsg}</p>}
            </section>

            {SEASON_UI_ENABLED && <section className={`${styles.card} ${styles.seasonCard}`}>
              <div className={styles.cardTop}>
                <span className={styles.cardIcon} aria-hidden="true">
                  <TrophyIcon size={24} />
                </span>
                <div className={styles.cardInfo}>
                  <h2 className={styles.cardTitle}>{tr.shop_season} {season?.seasonKey ?? "S1"}</h2>
                  <p className={styles.cardDesc}>{tr.shop_season_desc}</p>
                </div>
                <span className={styles.price}>{tr.shop_level} {currentSeasonLevel}/{SEASON_MAX_LEVEL}</span>
              </div>

              <div className={styles.seasonProgress}>
                <div className={styles.seasonProgressTop}>
                  <span>
                    {nextSeasonXp
                      ? `${currentSeasonXp.toLocaleString()} / ${nextSeasonXp.toLocaleString()} ${tr.shop_xp}`
                      : `${currentSeasonXp.toLocaleString()} ${tr.shop_xp}`}
                  </span>
                  <span>
                    {nextSeasonXp
                      ? `${seasonXpToNext.toLocaleString()} ${tr.shop_xp_to_level} ${nextSeasonLevel}`
                      : tr.shop_complete}
                  </span>
                </div>
                <div className={styles.seasonBar}>
                  <span
                    style={{ width: `${seasonProgressPct}%` }}
                  />
                </div>
              </div>

              <div className={styles.seasonRewardsHeader}>
                <div className={styles.seasonRewardsInfo}>
                  <span className={styles.seasonRewardsLabel}>{seasonRewardsTitle}</span>
                  <strong>{seasonRewardsSummary}</strong>
                </div>
                {readySeasonRewards > 0 && (
                  <button
                    className={`${styles.seasonRewardsToggle} ${styles.seasonClaimAll}`}
                    type="button"
                    onClick={() => handleClaimSeasonLevels(claimableSeasonLevelNumbers)}
                    disabled={!isConnected || seasonClaimBusy}
                  >
                    <TrophyIcon size={14} />
                    <span>
                      {claimingSeasonLevels.length > 1
                        ? seasonClaimPending
                          ? tr.shop_bomb_pending
                          : tr.shop_claiming
                        : seasonClaimAllLabel}
                    </span>
                  </button>
                )}
              </div>

              <div
                className={`${styles.seasonLevels} ${
                  seasonRewardsOpen ? "" : styles.seasonLevelsPreview
                }`}
                id="season-rewards-list"
              >
                  {visibleSeasonLevels.map((level, previewIndex) => {
                    const rewardKind: ItemArtKind =
                      level.reward.kind === "item" ? level.reward.slug : "points";
                    const futureOffset = Math.max(0, level.level - nextSeasonLevel);
                    const previewNext = !seasonRewardsOpen && previewIndex > 0;
                    const previewCurrent = !seasonRewardsOpen && previewIndex === 0;
                    const blur = previewNext
                      ? Math.min(3, 0.8 + previewIndex * 0.38)
                      : Math.min(3.4, futureOffset * 0.16);
                    const opacity = previewNext
                      ? Math.max(0.48, 0.74 - previewIndex * 0.06)
                      : Math.max(0.45, 1 - futureOffset * 0.025);
                    return (
                      <div
                        key={level.level}
                        className={`${styles.seasonLevel} ${
                          level.claimed
                            ? styles.seasonLevelClaimed
                            : level.claimable
                            ? styles.seasonLevelReady
                            : ""
                        } ${previewCurrent ? styles.seasonLevelPreviewCurrent : ""} ${
                          previewNext ? styles.seasonLevelPreviewNext : ""
                        }`}
                        style={{
                          ["--season-level-blur" as string]: `${blur}px`,
                          ["--season-level-opacity" as string]: `${opacity}`,
                        }}
                      >
                        <div className={styles.seasonLevelMeta}>
                          <b>{tr.shop_level} {level.level}</b>
                          <span>{level.xpRequired.toLocaleString()} {tr.shop_xp}</span>
                        </div>
                        <div className={styles.seasonLevelReward}>
                          <span className={styles.seasonLevelArtShell}>
                            <ItemArt kind={rewardKind} size="small" className={styles.seasonLevelArt} />
                          </span>
                          <p>{rewardLabel(level.reward, lang)}</p>
                        </div>
                        {level.claimed ? (
                          <span className={styles.levelStatus}>
                            <CheckIcon size={13} />
                            {tr.shop_claimed}
                          </span>
                        ) : level.claimable ? (
                          previewNext ? (
                            <span className={styles.levelStatus}>{tr.quests_ready}</span>
                          ) : (
                            <button
                              className={`${styles.btn} ${styles.btnCompact}`}
                              onClick={() => handleClaimSeasonLevel(level.level)}
                              disabled={!isConnected || seasonClaimBusy}
                              type="button"
                            >
                              <TrophyIcon size={13} />
                              <span>
                                {claimingLevel === level.level
                                  ? seasonClaimPending
                                    ? tr.shop_bomb_pending
                                    : tr.shop_claiming
                                  : tr.claim}
                              </span>
                            </button>
                          )
                        ) : (
                          <span className={styles.levelStatus}>{tr.shop_locked}</span>
                        )}
                      </div>
                    );
                  })}
              </div>

              {seasonLevels.length > 0 && (
                <div className={styles.seasonRewardsFooter}>
                  <button
                    className={styles.seasonRewardsToggle}
                    type="button"
                    onClick={() => setSeasonRewardsOpen((open) => !open)}
                    disabled={!season}
                    aria-expanded={seasonRewardsOpen}
                    aria-controls="season-rewards-list"
                  >
                    <span>{seasonRewardsToggleLabel}</span>
                    <ChevronRightIcon
                      size={15}
                      className={
                        seasonRewardsOpen
                          ? styles.seasonRewardsToggleIconOpen
                          : styles.seasonRewardsToggleIcon
                      }
                    />
                  </button>
                </div>
              )}
            </section>}

            <section className={`${styles.card} ${styles.sbtCard}`} id="captain-sbt">
              <div className={styles.cardTop}>
                <span className={styles.cardIcon} aria-hidden="true">
                  <TrophyIcon size={24} />
                </span>
                <div className={styles.cardInfo}>
                  <h2 className={styles.cardTitle}>{sbtCopy.title}</h2>
                  <p className={styles.cardDesc}>{sbtCopy.desc}</p>
                </div>
                <span className={styles.price}>
                  {sbtRemaining}/{LIMITED_SBT_MAX_SUPPLY}
                </span>
              </div>

              <div className={styles.seasonProgress}>
                <div className={styles.seasonProgressTop}>
                  <span>{sbtCopy.wins}: {sbtWins.toLocaleString()}/{LIMITED_SBT_REQUIRED_WINS}</span>
                  <span>{sbtCopy.winsLeft}: {sbtWinsLeft.toLocaleString()}</span>
                </div>
                <div className={styles.seasonBar}>
                  <span style={{ width: `${sbtProgressPct}%` }} />
                </div>
              </div>

              <div className={styles.sbtStats}>
                <div>
                  <span>{sbtCopy.owned}</span>
                  <b>{sbtTokenId ? `#${sbtTokenId}` : "—"}</b>
                </div>
                <div>
                  <span>{sbtCopy.weekly}</span>
                  <b>{limitedSbt?.weeklyClaimed ? sbtCopy.weeklyDone : `+${LIMITED_SBT_WEEKLY_POINTS.toLocaleString()} ${tr.shop_pts}`}</b>
                </div>
                <div>
                  <span>{tr.shop_claimed}</span>
                  <b>{sbtClaimedSupply}/{LIMITED_SBT_MAX_SUPPLY}</b>
                </div>
              </div>

              <div className={styles.cardAction}>
                <span className={styles.streak}>
                  {sbtTokenId
                    ? `${sbtCopy.owned}: #${sbtTokenId}`
                    : sbtRemaining <= 0
                      ? sbtCopy.soldOut
                      : sbtWins >= LIMITED_SBT_REQUIRED_WINS
                        ? `${sbtRemaining} / ${LIMITED_SBT_MAX_SUPPLY}`
                        : sbtCopy.locked}
                </span>
                {sbtTokenId ? (
                  <button
                    className={`${styles.btn} ${styles.btnPrimary}`}
                    onClick={handleClaimLimitedSbtWeekly}
                    disabled={!isConnected || sbtBusy !== null || !canClaimSbtWeekly}
                    type="button"
                  >
                    {sbtBusy === "weekly"
                      ? tr.shop_working
                      : canClaimSbtWeekly
                        ? sbtCopy.claimWeekly
                        : sbtCopy.weeklyDone}
                  </button>
                ) : (
                  <button
                    className={`${styles.btn} ${styles.btnBuy}`}
                    onClick={handleClaimLimitedSbt}
                    disabled={
                      !isConnected ||
                      sbtBusy !== null ||
                      captainSbtMintPending ||
                      !canClaimSbt ||
                      !captainSbtDeployed
                    }
                    type="button"
                  >
                    {sbtBusy === "claim" || captainSbtMintPending
                      ? tr.shop_working
                      : !captainSbtDeployed
                        ? sbtCopy.notDeployed
                        : !limitedSbt
                        ? sbtCopy.setup
                        : sbtRemaining <= 0
                          ? sbtCopy.soldOut
                          : canClaimSbt
                            ? sbtCopy.claim
                            : sbtCopy.locked}
                  </button>
                )}
              </div>
              {sbtMsg && <p className={styles.msg}>{sbtMsg}</p>}
            </section>

            <section className={`${styles.card} ${styles.inventoryCard}`}>
              <div className={styles.cardTop}>
                <span className={styles.cardIcon} aria-hidden="true">
                  <ShieldIcon size={24} />
                </span>
                <div className={styles.cardInfo}>
                  <h2 className={styles.cardTitle}>{tr.shop_inventory}</h2>
                  <p className={styles.cardDesc}>{tr.shop_inventory_desc}</p>
                </div>
              </div>

              <div className={styles.itemList}>
                {SHOP_ITEMS.filter((item) => item.enabled).map((item) => {
                  const copy = shopItemText(item, lang);
                  return (
                    <div key={item.slug} className={styles.itemRow}>
                      <div className={styles.itemRowInfo}>
                        <ItemArt kind={item.slug} size="small" className={styles.inventoryItemArt} />
                        <div className={styles.itemRowText}>
                          <b>{copy.name}</b>
                          <span>{copy.status}</span>
                        </div>
                      </div>
                      <strong>{inventory?.[item.slug] ?? 0}</strong>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* ───── Daily check-in card ───── */}
            <section className={`${styles.card} ${styles.utilityCard}`}>
              <div className={styles.cardTop}>
                <span className={styles.cardIcon} aria-hidden="true">
                  <CheckIcon size={24} />
                </span>
                <div className={styles.cardInfo}>
                  <h2 className={styles.cardTitle}>{tr.shop_checkin_title}</h2>
                  <p className={styles.cardDesc}>{tr.shop_checkin_desc}</p>
                </div>
              </div>

              {checkin && (
                <div className={styles.cardAction}>
                  <span className={styles.streak}>
                    {tr.streak}: <b>{checkin.streak}d</b>
                  </span>
                  {!checkin.canCheckin ? (
                    <div className={styles.checkinStamp}>
                      <CheckIcon size={14} />
                      <span>{tr.shop_checkin_done}</span>
                    </div>
                  ) : (
                    <button
                      className={`${styles.btn} ${styles.btnPrimary}`}
                      onClick={handleCheckin}
                      disabled={!checkin.canCheckin || checkinLoading || checkinPending}
                    >
                      {checkinPending
                        ? tr.shop_bomb_pending
                        : checkinLoading
                          ? tr.quest_processing
                          : paymasterSupported
                            ? `+${checkin.nextReward} ${tr.shop_pts} · ${tr.checkin_free}`
                            : `+${checkin.nextReward} ${tr.shop_pts}`}
                    </button>
                  )}
                </div>
              )}
              {checkinMsg && <p className={styles.msg}>{checkinMsg}</p>}
            </section>

            {/* ───── Bomb 3×3 inventory card ───── */}
            <section className={`${styles.card} ${styles.bombCard}`}>
              <div className={styles.cardTop}>
                <span className={styles.cardIcon} aria-hidden="true">
                  <ItemArt kind="bomb_3x3" size="small" />
                </span>
                <div className={styles.cardInfo}>
                  <h2 className={styles.cardTitle}>{tr.shop_bomb_title}</h2>
                  <p className={styles.cardDesc}>{tr.shop_bomb_desc}</p>
                </div>
                <span className={styles.price}>
                  {formatUsdcMicro(2_000_000 * normalizeShopPurchaseQuantity(bombQuantity))}
                </span>
              </div>

              <div className={styles.inventoryRow}>
                <div className={styles.inventoryInfo}>
                  <span className={styles.inventoryLabel}>{tr.shop_bomb_inventory}</span>
                  <span className={styles.inventoryValue}>
                    {available}
                    <span className={styles.inventoryUnit}>
                      {" "}{available === 1 ? tr.bomb_unit_one : tr.bomb_unit_many}
                    </span>
                  </span>
                </div>
                <div className={styles.bombStepper}>
                  <button 
                    className={styles.stepperBtn} 
                    type="button"
                    onClick={() => setBombQuantity(Math.max(1, normalizeShopPurchaseQuantity(bombQuantity - 1)))}
                    disabled={buying || bombQuantity <= 1}
                    aria-label="Decrease quantity"
                  >-</button>
                  <span className={styles.stepperValue}>
                    {lang === "ru" ? "К-ВО:" : "QTY:"} <b>{bombQuantity}</b>
                  </span>
                  <button 
                    className={styles.stepperBtn} 
                    type="button"
                    onClick={() => setBombQuantity(Math.min(MAX_SHOP_PURCHASE_QUANTITY, normalizeShopPurchaseQuantity(bombQuantity + 1)))}
                    disabled={buying || bombQuantity >= MAX_SHOP_PURCHASE_QUANTITY}
                    aria-label="Increase quantity"
                  >+</button>
                </div>
                <button
                  className={`${styles.btn} ${styles.btnBuy}`}
                  onClick={handleBuy}
                  disabled={!isConnected || buying}
                >
                  {buyBtnLabel}
                </button>
              </div>
              {buyMsg && <p className={styles.msg}>{buyMsg}</p>}
            </section>

            <section className={`${styles.card} ${styles.promoCard}`}>
              <div className={styles.cardTop}>
                <span className={styles.cardIcon} aria-hidden="true">
                  <CoinIcon size={24} />
                </span>
                <div className={styles.cardInfo}>
                  <h2 className={styles.cardTitle}>{lang === "ru" ? "Промокод" : "Promo code"}</h2>
                  <p className={styles.cardDesc}>
                    {lang === "ru" ? "Бонусы и предметы для экипажа" : "Crew bonuses and items"}
                  </p>
                </div>
              </div>

              <form className={styles.unifiedPromoForm} onSubmit={handleRedeemPromo}>
                <input
                  value={promoCode}
                  onChange={(event) => setPromoCode(event.target.value)}
                  placeholder={lang === "ru" ? "Введите код..." : "Enter code..."}
                  aria-label={lang === "ru" ? "Промокод" : "Promo code"}
                  autoComplete="off"
                />
                <button
                  className={styles.unifiedPromoBtn}
                  disabled={!isConnected || promoBusy || !promoCode.trim()}
                  type="submit"
                >
                  {promoBusy ? (lang === "ru" ? "Проверка..." : "Checking...") : lang === "ru" ? "Забрать" : "Redeem"}
                </button>
              </form>
              {promoMsg && <p className={styles.msg}>{promoMsg}</p>}
            </section>
      </main>
      <button
        className={`${styles.mobileBackToMenu} ${
          showMobileBack ? styles.mobileBackToMenuVisible : ""
        }`}
        onClick={() => router.push("/")}
        type="button"
        aria-label={tr.main_menu}
      >
        <span aria-hidden="true">←</span>
        <span>{tr.main_menu}</span>
      </button>
    </div>
  );
}
