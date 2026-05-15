"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  useAccount,
  useReadContract,
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
  erc20Abi,
  SEABATTLE_CONTRACT_ADDRESS,
  SHOP_TREASURY_ADDRESS,
  USDC_ADDRESS,
} from "../contracts/seaBattleAbi";
import { BUILDER_CODE_SUFFIX } from "../providers";
import {
  getCheckinStatus,
  dailyCheckin,
  getBombsUsedCount,
  CheckinStatus,
} from "../lib/offchainGame";
import {
  SHOP_ITEMS,
  type InventoryMap,
  type SeasonState,
  type ShopItemSlug,
  SEASON_MAX_LEVEL,
  QUEST_REROLL_USDC_PRICE,
  activateDoublePoints,
  buyPointItem,
  claimSeasonLevel,
  grantPaidQuestReroll,
  getActiveDoublePoints,
  getInventory,
  getSeasonState,
  hasQuestRerollPointPurchaseThisWeek,
  pointPurchaseSentinelAddress,
  rewardLabel,
  seasonClaimSentinelAddress,
  shopItemText,
  validatePointItemPurchase,
  validateSeasonLevelClaim,
} from "../lib/season";
import { SettingsPanel } from "../components/SettingsPanel";
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
import styles from "./page.module.css";

const PAYMASTER_URL = process.env.NEXT_PUBLIC_PAYMASTER_URL;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const BOMB_PRICE = BigInt(2_000_000); // 2 USDC

function pendingPaidQrKey(wallet: string) {
  return `sbt_pending_paid_qr_${wallet.toLowerCase()}`;
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

  // Season shop inventory
  const [inventory, setInventory] = useState<InventoryMap | null>(null);
  const [season, setSeason] = useState<SeasonState | null>(null);
  const [seasonRewardsOpen, setSeasonRewardsOpen] = useState(false);
  const [activeBoosterUntil, setActiveBoosterUntil] = useState<string | null>(null);
  const [questRerollPointUsed, setQuestRerollPointUsed] = useState(false);
  const [shopMsg, setShopMsg] = useState("");
  const [shopBusy, setShopBusy] = useState<string | null>(null);
  const [claimingLevel, setClaimingLevel] = useState<number | null>(null);

  const refreshSeasonShop = useCallback(async () => {
    if (!address) return;
    try {
      const [nextInventory, nextSeason, nextBooster, nextQuestRerollPointUsed] = await Promise.all([
        getInventory(address),
        getSeasonState(address),
        getActiveDoublePoints(address),
        hasQuestRerollPointPurchaseThisWeek(address).catch(() => false),
      ]);
      setInventory(nextInventory);
      setSeason(nextSeason);
      setActiveBoosterUntil(nextBooster);
      setQuestRerollPointUsed(nextQuestRerollPointUsed);
    } catch (err) {
      setShopMsg(err instanceof Error ? err.message : tr.shop_items_load_failed);
    }
  }, [address, tr.shop_items_load_failed]);

  useEffect(() => {
    if (address) refreshSeasonShop();
  }, [address, refreshSeasonShop]);

  const pointPurchaseSlugRef = useRef<ShopItemSlug | null>(null);
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

  const handleBuyPointItem = async (slug: ShopItemSlug) => {
    if (!address || shopBusy) return;
    setShopBusy(slug);
    setShopMsg("");
    setPointPurchaseFallbackMined(false);
    pointPurchaseSlugRef.current = null;
    pointPurchaseHandledRef.current = false;
    resetPointPurchaseTx();

    try {
      await validatePointItemPurchase(address, slug);
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
      await refreshSeasonShop();
    } catch (err) {
      setShopMsg(err instanceof Error ? err.message : tr.shop_activation_failed);
    } finally {
      setShopBusy(null);
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
    pointPurchaseHandledRef.current = true;

    buyPointItem(address, slug)
      .then(async () => {
        if (slug === "quest_reroll") setQuestRerollPointUsed(true);
        setShopMsg(tr.shop_item_added);
        await refreshSeasonShop();
      })
      .catch((err) => {
        pointPurchaseHandledRef.current = false;
        setShopMsg(err instanceof Error ? err.message : tr.shop_purchase_failed);
      })
      .finally(() => {
        pointPurchaseSlugRef.current = null;
        setShopBusy(null);
      });
  }, [
    address,
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
    pointPurchaseHandledRef.current = false;
    setShopBusy(null);
  }, [pointPurchaseError, tr.shop_purchase_failed, tr.tx_rejected]);

  const [buying, setBuying] = useState(false);
  const [buyMsg, setBuyMsg] = useState("");
  const buyingRef = useRef(false);
  const buySubmittedRef = useRef(false);
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
    buySubmittedRef.current = true;
    writeBuy({
      address: SEABATTLE_CONTRACT_ADDRESS,
      abi: seaBattleAbi,
      functionName: "buyBomb",
      chainId: base.id,
      dataSuffix: BUILDER_CODE_SUFFIX,
    });
  }, [approveMined, writeBuy]);

  useEffect(() => {
    if (!approveReceipt || approveReceipt.status !== "reverted" || !buyingRef.current) return;
    setBuyMsg(tr.shop_purchase_failed);
    setBuying(false);
    buyingRef.current = false;
    buySubmittedRef.current = false;
  }, [approveReceipt, tr.shop_purchase_failed]);

  useEffect(() => {
    if (!buyMined || !buyingRef.current) return;
    setBuyMsg(tr.shop_item_added);
    setBuying(false);
    buyingRef.current = false;
    buySubmittedRef.current = false;
    refetchBombs();
  }, [buyMined, refetchBombs, tr.shop_item_added]);

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
      args: [SEABATTLE_CONTRACT_ADDRESS, BOMB_PRICE],
      chainId: base.id,
      dataSuffix: BUILDER_CODE_SUFFIX,
    });
  };

  // ─── Daily check-in ───
  // Paid Quest Reroll repeat purchase (after weekly points purchase)
  const paidQuestRerollRef = useRef(false);
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

  const finishPaidQuestRerollGrant = useCallback(async (txHash: `0x${string}`) => {
    if (!address) return;
    await grantPaidQuestReroll(address, txHash);
    if (typeof window !== "undefined") {
      localStorage.removeItem(pendingPaidQrKey(address));
    }
    setShopMsg(tr.shop_item_added);
    await refreshSeasonShop();
  }, [address, refreshSeasonShop, tr.shop_item_added]);

  const findLatestPaidQuestRerollTx = useCallback(async (): Promise<`0x${string}` | null> => {
    if (!address) return null;
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
      .find((log) => log.args.value === BigInt(QUEST_REROLL_USDC_PRICE));
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
    finishPaidQuestRerollGrant(paidQuestRerollTxHash)
      .catch((err) => {
        setShopMsg(err instanceof Error ? err.message : tr.shop_purchase_failed);
      })
      .finally(() => setShopBusy(null));
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
    let cancelled = false;
    setShopBusy("quest_reroll_usdc");
    waitForReceipt(wagmiConfig, { hash: storedHash as `0x${string}` })
      .then(async (receipt) => {
        if (cancelled) return;
        if (receipt.status !== "success") {
          localStorage.removeItem(pendingPaidQrKey(address));
          return;
        }
        await finishPaidQuestRerollGrant(storedHash as `0x${string}`);
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
            await finishPaidQuestRerollGrant(hash);
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
        await finishPaidQuestRerollGrant(hash);
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
    paidQuestRerollHandledRef.current = false;
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
    paidQuestRerollHandledRef.current = false;
    setShopBusy(null);
  }, [paidQuestRerollError, shopBusy, tr.shop_purchase_failed, tr.tx_rejected]);

  const handleBuyQuestRerollUsdc = () => {
    if (!address || shopBusy) return;
    setShopBusy("quest_reroll_usdc");
    setShopMsg("");
    paidQuestRerollRef.current = true;
    paidQuestRerollHandledRef.current = false;
    setPaidQuestRerollFallbackMined(false);
    resetPaidQuestReroll();
    writePaidQuestReroll({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: "transfer",
      args: [SHOP_TREASURY_ADDRESS, BigInt(QUEST_REROLL_USDC_PRICE)],
      chainId: base.id,
      dataSuffix: BUILDER_CODE_SUFFIX,
    });
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
  const seasonClaimLevelRef = useRef<number | null>(null);
  const seasonClaimHandledRef = useRef(false);
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
  const seasonClaimTxSuccess = seasonClaimTxReceipt?.status === "success";
  const seasonClaimOnchainSuccess = seasonClaimTxSuccess || seasonClaimCallsSuccess;
  const seasonClaimPending = seasonClaimTxPending || seasonClaimCallsPending;

  useEffect(() => {
    if (address) getCheckinStatus(address).then(setCheckin).catch(() => {});
  }, [address]);

  useEffect(() => {
    if (!checkinSuccess || !address || checkinRecorded.current) return;
    checkinRecorded.current = true;
    dailyCheckin(address)
      .then((res) => {
        setCheckinMsg(
          `+${res.points} ${tr.shop_pts}! ${tr.streak}: ${res.streak}d${res.usedFreeze ? ` (${tr.streak_freeze_used})` : ""}`
        );
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
    const level = seasonClaimLevelRef.current;
    if (level === null) return;
    seasonClaimHandledRef.current = true;
    seasonClaimLevelRef.current = null;

    claimSeasonLevel(address, level)
      .then(async (reward) => {
        setShopMsg(`${tr.shop_reward_claimed}: ${rewardLabel(reward, lang)}`);
        await refreshSeasonShop();
      })
      .catch((err) => {
        setShopMsg(err instanceof Error ? err.message : tr.shop_claim_failed);
      })
      .finally(() => setClaimingLevel(null));
  }, [
    seasonClaimOnchainSuccess,
    address,
    lang,
    refreshSeasonShop,
    tr.shop_claim_failed,
    tr.shop_reward_claimed,
  ]);

  useEffect(() => {
    if (!seasonClaimTxError || claimingLevel === null) return;
    const raw = seasonClaimTxError.message || tr.shop_claim_failed;
    const short = raw.includes("User rejected") || raw.includes("user rejected")
      ? tr.tx_rejected
      : raw.slice(0, 100);
    setShopMsg(short);
    setClaimingLevel(null);
    seasonClaimLevelRef.current = null;
    seasonClaimHandledRef.current = true;
  }, [seasonClaimTxError, claimingLevel, tr.shop_claim_failed, tr.tx_rejected]);

  const handleClaimSeasonLevel = async (level: number) => {
    if (!address || claimingLevel !== null || seasonClaimPending) return;
    if (SEABATTLE_CONTRACT_ADDRESS === ZERO_ADDR) {
      setShopMsg(tr.contract_not_deployed);
      return;
    }

    setClaimingLevel(level);
    setShopMsg("");
    resetSeasonClaimTx();

    try {
      await validateSeasonLevelClaim(address, level);
    } catch (err) {
      setShopMsg(err instanceof Error ? err.message : tr.shop_claim_failed);
      setClaimingLevel(null);
      seasonClaimLevelRef.current = null;
      seasonClaimHandledRef.current = true;
      return;
    }

    seasonClaimLevelRef.current = level;
    seasonClaimHandledRef.current = false;
    const sentinel = seasonClaimSentinelAddress(level);

    if (paymasterSupported && PAYMASTER_URL) {
      sendSeasonClaimCalls({
        calls: [{
          to: SEABATTLE_CONTRACT_ADDRESS,
          data: encodeFunctionData({
            abi: seaBattleAbi,
            functionName: "recordSoloResult",
            args: [sentinel, true],
          }),
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
        : tr.shop_bomb_buying
    : tr.shop_bomb_buy;
  const currentSeasonLevel = Math.min(season?.level ?? 0, SEASON_MAX_LEVEL);
  const currentSeasonXp = season?.xp ?? 0;
  const nextSeasonXp = season?.nextLevelXp ?? null;
  const seasonLevels = season?.levels ?? [];
  const readySeasonRewards = seasonLevels.filter((level) => level.claimable).length;
  const claimedSeasonRewards = seasonLevels.filter((level) => level.claimed).length;
  const seasonRewardsTitle = lang === "ru" ? "Награды сезона" : "Season rewards";
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
              <div>
                <span>{tr.shop_season}</span>
                <b>{tr.shop_level} {currentSeasonLevel}</b>
              </div>
              <div>
                <span>{tr.shop_xp}</span>
                <b>{currentSeasonXp.toLocaleString()}</b>
              </div>
              <div>
                <span>{tr.shop_bombs}</span>
                <b>{available}</b>
              </div>
            </section>

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
                  const qty = inventory?.[item.slug] ?? 0;
                  const isDouble = item.slug === "double_points_1h";
                  const isHero = isDouble;
                  const canActivateDouble = isDouble && qty > 0;
                  const useUsdcPrice = item.slug === "quest_reroll" && questRerollPointUsed;
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
                        ? "0.3 USDC"
                        : `${item.pricePoints?.toLocaleString()} ${tr.shop_pts}`;

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
                          {tr.shop_owned} {qty}
                        </span>

                        <div className={styles.itemActions}>
                          <button
                            className={`${styles.btn} ${styles.btnCompact} ${styles.shopBuyButton}`}
                            onClick={() =>
                              useUsdcPrice
                                ? handleBuyQuestRerollUsdc()
                                : handleBuyPointItem(item.slug)
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

            <section className={`${styles.card} ${styles.seasonCard}`}>
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
                              disabled={!isConnected || claimingLevel !== null || seasonClaimPending}
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
                  <button
                    className={`${styles.btn} ${styles.btnPrimary}`}
                    onClick={handleCheckin}
                    disabled={!checkin.canCheckin || checkinLoading || checkinPending}
                  >
                    {checkinPending
                      ? tr.shop_bomb_pending
                      : checkinLoading
                        ? tr.quest_processing
                        : !checkin.canCheckin
                          ? tr.shop_checkin_done
                          : paymasterSupported
                            ? `+${checkin.nextReward} ${tr.shop_pts} · ${tr.checkin_free}`
                            : `+${checkin.nextReward} ${tr.shop_pts}`}
                  </button>
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
                <span className={styles.price}>{tr.shop_bomb_price}</span>
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
      </main>
    </div>
  );
}
