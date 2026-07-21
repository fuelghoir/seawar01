"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useAccount, useConnect, useSignMessage } from "wagmi";
import { useSettings } from "../lib/settings";
import styles from "./page.module.css";

type Submission = {
  id: number;
  wallet: string;
  url: string;
  status: string;
  admin_note?: string | null;
  created_at: string;
};

type Creator = {
  wallet: string;
  submissions: number;
  pendingSubmissions: number;
  rewards: number;
  referrals: number;
  activeReferrals: number;
  referralGames: number;
  referralWins: number;
  referralPoints: number;
  referralTxs: number;
  points: number;
  wins: number;
  games: number;
  txs: number;
};

type Reward = {
  id: number;
  wallet: string;
  reward_kind: string;
  points?: number | null;
  item_slug?: string | null;
  quantity?: number | null;
  amount_raw?: string | null;
  reward_label?: string | null;
  status: string;
  created_at: string;
};

type DropCampaign = {
  id: string;
  title: string;
  token_address: string;
  token_symbol: string;
  decimals: number;
  total_amount_raw: string;
  total_points: number;
  contract_address?: string | null;
  signer_address?: string | null;
  status: string;
  allocations?: number;
  claimed?: number;
  allocatedRaw?: string;
};

type Tab = "submissions" | "creators" | "drops" | "promos" | "easter_egg" | "season";
type RewardMode = "game" | "token";
type TokenKind = "usdc" | "base" | "token";

type GeneratedPromo = {
  id: string;
  title: string;
  points: number;
  itemSlug: string | null;
  itemLabel: string;
  quantity: number;
  expiresAt: string | null;
  code: string;
  link: string;
  shopLink: string;
  baseAppLink: string;
};

type ClaimInfo = {
  wallet: string;
  usd_won: boolean;
  points: number;
  last_claimed_at: string;
  total_claims?: number;
  usd_eligible?: boolean;
};

type TokenInfo = {
  address: string;
  symbol: string;
  decimals: number;
  balance?: string;
  formattedBalance?: string;
};

const ITEM_OPTIONS = [
  { slug: "", label: "Без предмета" },
  { slug: "double_points_1h", label: "Двойные очки 1ч" },
  { slug: "quest_reroll", label: "Реролл квеста" },
  { slug: "streak_freeze", label: "Защита серии" },
  { slug: "radar_scan", label: "Радар" },
  { slug: "torpedo", label: "Торпеда" },
];

export default function AdminPage() {
  const { lang } = useSettings();
  const isRu = lang === "ru";

  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending: connectPending } = useConnect();
  const { signMessageAsync, isPending: signing } = useSignMessage();
  const [authenticated, setAuthenticated] = useState(false);
  const [adminAddress, setAdminAddress] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("submissions");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [creators, setCreators] = useState<Creator[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [drops, setDrops] = useState<DropCampaign[]>([]);
  const [rejectTarget, setRejectTarget] = useState<Submission | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rewardTarget, setRewardTarget] = useState<{ wallet: string; submissionId?: number } | null>(null);
  const [rewardMode, setRewardMode] = useState<RewardMode>("game");
  const [rewardBusy, setRewardBusy] = useState(false);
  const [gameReward, setGameReward] = useState({
    points: "1000",
    itemSlug: "",
    quantity: "1",
    note: "",
  });
  const [tokenReward, setTokenReward] = useState({
    kind: "usdc" as TokenKind,
    amount: "",
    tokenAddress: "",
    note: "",
  });
  const [dropForm, setDropForm] = useState({
    id: "",
    title: "",
    tokenAddress: "",
    tokenSymbol: "TOKEN",
    decimals: "18",
    totalAmount: "",
    minPoints: "3000",
    minTransactions: "10",
    minCheckins: "0",
    pointsSource: "all_time",
  });

  const [previewResults, setPreviewResults] = useState<{
    summary: {
      totalWallets: number;
      totalPoints: string;
      totalAmount: string;
      decimals: number;
      tokenSymbol: string;
    };
    allocations: Array<{
      wallet: string;
      points: number;
      gamesPlayed: number;
      totalCheckins: number;
      transactions: number;
      amount_formatted: string;
    }>;
  } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [promoForm, setPromoForm] = useState({
    id: "",
    title: "Creator bonus",
    points: "1000",
    itemSlug: "",
    quantity: "1",
    expiresDays: "30",
    note: "",
  });
  const [generatedPromo, setGeneratedPromo] = useState<GeneratedPromo | null>(null);

  // Easter Egg states
  const [easterEggStats, setEasterEggStats] = useState<{
    claims: ClaimInfo[];
    usdWon: boolean;
    usdWinners: string[];
    totalClaimsCount: number;
    maxWinners: number;
    rewardAmountRaw: string;
  }>({
    claims: [],
    usdWon: false,
    usdWinners: [],
    totalClaimsCount: 0,
    maxWinners: 1,
    rewardAmountRaw: "5000000",
  });
  const [manualWallet, setManualWallet] = useState("");
  const [configMaxWinners, setConfigMaxWinners] = useState("1");
  const [configRewardUsd, setConfigRewardUsd] = useState("5");
  const [configBusy, setConfigBusy] = useState(false);

  // Drops tokens state
  const [availableTokens, setAvailableTokens] = useState<TokenInfo[]>([]);
  const [seasonEndDate, setSeasonEndDate] = useState("2026-07-18T00:00");
  const [seasonIsEnded, setSeasonIsEnded] = useState(false);
  const [seasonKey, setSeasonKey] = useState("S1");
  const [virtualPoolUsdc, setVirtualPoolUsdc] = useState("0");
  const [seasonConfigBusy, setSeasonConfigBusy] = useState(false);
  const [customTokenMode, setCustomTokenMode] = useState(false);
  const [customTokenAddress, setCustomTokenAddress] = useState("");
  const [queryingCustomToken, setQueryingCustomToken] = useState(false);

  const pendingSubmissions = useMemo(
    () => submissions.filter((submission) => submission.status === "pending").length,
    [submissions],
  );

  const loadSession = useCallback(async () => {
    const res = await fetch("/api/admin/session");
    const data = await res.json().catch(() => null);
    setAuthenticated(!!data?.authenticated);
    setAdminAddress(data?.address ?? null);
  }, []);

  const loadData = useCallback(async () => {
    if (!authenticated) return;
    setLoading(true);
    setError("");
    try {
      const [creatorRes, dropsRes, easterEggRes, tokensRes, seasonConfigRes] = await Promise.all([
        fetch("/api/admin/creator"),
        fetch("/api/admin/drops"),
        fetch("/api/admin/easter-egg"),
        fetch("/api/admin/drops?action=tokens"),
        fetch("/api/admin/season"),
      ]);
      const creatorData = await creatorRes.json().catch(() => null);
      const dropsData = await dropsRes.json().catch(() => null);
      const easterEggData = await easterEggRes.json().catch(() => null);
      const tokensData = await tokensRes.json().catch(() => null);
      const seasonConfigData = await seasonConfigRes.json().catch(() => null);

      if (!creatorRes.ok) throw new Error(creatorData?.error || (isRu ? "Не удалось загрузить креаторов" : "Failed to load creators"));
      if (!dropsRes.ok) throw new Error(dropsData?.error || (isRu ? "Не удалось загрузить дропы" : "Failed to load drops"));

      setSubmissions(creatorData?.submissions ?? []);
      setCreators(creatorData?.creators ?? []);
      setRewards(creatorData?.rewards ?? []);
      setDrops(dropsData?.campaigns ?? []);

      if (easterEggRes.ok && easterEggData) {
        setEasterEggStats({
          claims: easterEggData.claims ?? [],
          usdWon: !!easterEggData.usdWon,
          usdWinners: easterEggData.usdWinners ?? [],
          totalClaimsCount: easterEggData.totalClaimsCount ?? 0,
          maxWinners: easterEggData.maxWinners ?? 1,
          rewardAmountRaw: easterEggData.rewardAmountRaw ?? "5000000",
        });
        setConfigMaxWinners(String(easterEggData.maxWinners ?? 1));
        setConfigRewardUsd(String(Number(easterEggData.rewardAmountRaw ?? 5000000) / 1000000));
      }

      if (tokensRes.ok && tokensData?.tokens) {
        setAvailableTokens(tokensData.tokens);
        setDropForm((prev) => {
          if (tokensData.tokens.length > 0 && !prev.tokenAddress) {
            const first = tokensData.tokens[0];
            return {
              ...prev,
              tokenAddress: first.address,
              tokenSymbol: first.symbol,
              decimals: String(first.decimals),
            };
          }
          return prev;
        });
      }

      if (seasonConfigRes.ok && seasonConfigData) {
        try {
          const d = new Date(seasonConfigData.endDate);
          const pad = (n: number) => String(n).padStart(2, "0");
          const localVal = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
          setSeasonEndDate(localVal);
        } catch {
          setSeasonEndDate("2026-07-18T00:00");
        }
        setSeasonIsEnded(!!seasonConfigData.isEnded);
        setSeasonKey(seasonConfigData.seasonKey || "S1");
        setVirtualPoolUsdc(String(seasonConfigData.virtualPoolUsdc || 0));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : (isRu ? "Не удалось загрузить админку" : "Failed to load admin panel"));
    } finally {
      setLoading(false);
    }
  }, [authenticated, isRu]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const login = async () => {
    if (!address) return;
    setError("");
    setMessage("");
    try {
      const msgRes = await fetch(`/api/admin/auth?wallet=${encodeURIComponent(address)}`);
      const msgData = await msgRes.json().catch(() => null);
      if (!msgRes.ok) throw new Error(msgData?.error || (isRu ? "Кошелек не в списке админов" : "Wallet not in admin list"));
      const signature = await signMessageAsync({ message: msgData.message });
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: address, message: msgData.message, signature }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || (isRu ? "Не удалось войти" : "Failed to log in"));
      setAuthenticated(true);
      setAdminAddress(data.address);
      setMessage(isRu ? "Вход выполнен" : "Logged in successfully");
    } catch (err) {
      setError(err instanceof Error ? err.message : (isRu ? "Не удалось войти" : "Failed to log in"));
    }
  };

  const updateSubmission = async (id: number, status: string, adminNote = "") => {
    setError("");
    setMessage("");
    const res = await fetch(`/api/admin/creator/submissions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, adminNote }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error || (isRu ? "Не удалось обновить заявку" : "Failed to update submission"));
      return false;
    }
    setMessage(isRu ? "Заявка обновлена" : "Submission updated");
    await loadData();
    return true;
  };

  const rejectSubmission = async () => {
    if (!rejectTarget) return;
    const ok = await updateSubmission(rejectTarget.id, "rejected", rejectReason.trim());
    if (ok) {
      setRejectTarget(null);
      setRejectReason("");
    }
  };

  const postReward = async (payload: Record<string, unknown>) => {
    const res = await fetch("/api/admin/creator/rewards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || (isRu ? "Не удалось выдать награду" : "Failed to award reward"));
  };

  const grantReward = async () => {
    if (!rewardTarget || rewardBusy) return;
    setRewardBusy(true);
    setError("");
    setMessage("");

    try {
      if (rewardMode === "game") {
        const points = Math.max(0, Math.floor(Number(gameReward.points || 0)));
        const quantity = Math.max(0, Math.floor(Number(gameReward.quantity || 0)));
        const itemSlug = gameReward.itemSlug;

        if (points <= 0 && (!itemSlug || quantity <= 0)) {
          throw new Error(isRu ? "Выбери очки или предмет" : "Choose points or item");
        }

        if (points > 0) {
          await postReward({
            wallet: rewardTarget.wallet,
            sourceSubmissionId: rewardTarget.submissionId,
            rewardKind: "points",
            points,
            rewardLabel: `+${points.toLocaleString()} pts`,
            adminNote: gameReward.note,
          });
        }

        if (itemSlug && quantity > 0) {
          const itemName = ITEM_OPTIONS.find((item) => item.slug === itemSlug)?.label ?? itemSlug;
          await postReward({
            wallet: rewardTarget.wallet,
            sourceSubmissionId: rewardTarget.submissionId,
            rewardKind: "item",
            itemSlug,
            quantity,
            rewardLabel: `${quantity}x ${itemName}`,
            adminNote: gameReward.note,
          });
        }
      } else {
        const decimals = tokenReward.kind === "usdc" ? 6 : 18;
        const amountRaw = parseDecimalToRaw(tokenReward.amount, decimals);
        const tokenAddress = tokenReward.kind === "token" ? tokenReward.tokenAddress.trim() : "";
        const symbol = tokenReward.kind === "usdc" ? "USDC" : tokenReward.kind === "base" ? "BASE" : "TOKEN";

        if (amountRaw <= BigInt(0)) throw new Error(isRu ? "Введи сумму токенов" : "Enter token amount");
        if (tokenReward.kind === "token" && !/^0x[a-fA-F0-9]{40}$/.test(tokenAddress)) {
          throw new Error(isRu ? "Введи адрес токена" : "Enter token address");
        }

        await postReward({
          wallet: rewardTarget.wallet,
          sourceSubmissionId: rewardTarget.submissionId,
          rewardKind: tokenReward.kind,
          tokenAddress,
          amountRaw: amountRaw.toString(),
          status: "claimable",
          rewardLabel: `${tokenReward.amount} ${symbol}`,
          adminNote: tokenReward.note,
        });
      }

      setMessage(isRu ? "Награда сохранена" : "Reward saved successfully");
      setRewardTarget(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : (isRu ? "Не удалось выдать награду" : "Failed to award reward"));
    } finally {
      setRewardBusy(false);
    }
  };

  const calculateDropPreview = async () => {
    setError("");
    setMessage("");
    setPreviewResults(null);
    setPreviewBusy(true);
    try {
      const decimals = Math.max(0, Math.min(36, Math.floor(Number(dropForm.decimals || 18))));
      const totalAmountRaw = parseDecimalToRaw(dropForm.totalAmount, decimals).toString();
      const res = await fetch("/api/admin/drops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: dropForm.id,
          title: dropForm.title,
          tokenAddress: dropForm.tokenAddress,
          tokenSymbol: dropForm.tokenSymbol,
          decimals,
          totalAmountRaw,
          minPoints: Number(dropForm.minPoints || 0),
          minTransactions: Number(dropForm.minTransactions || 0),
          minCheckins: Number(dropForm.minCheckins || 0),
          pointsSource: dropForm.pointsSource,
          preview: true,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || (isRu ? "Не удалось рассчитать награды" : "Failed to calculate rewards"));
      }

      setPreviewResults({
        summary: {
          totalWallets: data.drop.allocationsCount,
          totalPoints: data.drop.totalPoints,
          totalAmount: dropForm.totalAmount,
          decimals,
          tokenSymbol: dropForm.tokenSymbol,
        },
        allocations: data.allocations ?? [],
      });
      setMessage(isRu ? "Расчет завершен" : "Calculation completed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error during preview calculation");
    } finally {
      setPreviewBusy(false);
    }
  };

  const createDropSnapshot = async () => {
    setError("");
    setMessage("");
    const decimals = Math.max(0, Math.min(36, Math.floor(Number(dropForm.decimals || 18))));
    const totalAmountRaw = parseDecimalToRaw(dropForm.totalAmount, decimals).toString();
    const res = await fetch("/api/admin/drops", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: dropForm.id,
        title: dropForm.title,
        tokenAddress: dropForm.tokenAddress,
        tokenSymbol: dropForm.tokenSymbol,
        decimals,
        totalAmountRaw,
        minPoints: Number(dropForm.minPoints || 0),
        minTransactions: Number(dropForm.minTransactions || 0),
        minCheckins: Number(dropForm.minCheckins || 0),
        pointsSource: dropForm.pointsSource,
        preview: false,
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error || (isRu ? "Не удалось создать snapshot" : "Failed to create snapshot"));
      return;
    }
    setMessage(isRu ? `Snapshot создан: ${data.drop.allocations} кошельков` : `Snapshot created: ${data.drop.allocations} wallets`);
    setPreviewResults(null);
    loadData();
  };

  const updateDrop = async (id: string, status: string) => {
    setError("");
    setMessage("");
    const res = await fetch(`/api/admin/drops/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error || (isRu ? "Не удалось обновить дроп" : "Failed to update drop"));
      return;
    }
    setMessage(isRu ? "Дроп обновлен" : "Drop updated");
    loadData();
  };

  const createPromo = async () => {
    setError("");
    setMessage("");
    setGeneratedPromo(null);
    try {
      const res = await fetch("/api/admin/promos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: promoForm.id,
          code: promoForm.id,
          title: promoForm.title,
          points: promoForm.points,
          itemSlug: promoForm.itemSlug,
          quantity: promoForm.quantity,
          expiresDays: promoForm.expiresDays,
          note: promoForm.note,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Could not create promo");
      setGeneratedPromo(data.promo);
      setMessage(isRu ? "Промокод/ссылка создана" : "Promo code/link created");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create promo");
    }
  };

  const copyPromoText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(isRu ? `${label} скопировано` : `${label} copied`);
    } catch {
      setError(isRu ? `Не удалось скопировать ${label.toLowerCase()}` : `Could not copy ${label.toLowerCase()}`);
    }
  };

  const onTokenSelectChange = (addr: string) => {
    if (addr === "custom") {
      setCustomTokenMode(true);
      setDropForm((prev) => ({
        ...prev,
        tokenAddress: "",
        tokenSymbol: "TOKEN",
        decimals: "18",
      }));
    } else {
      setCustomTokenMode(false);
      const found = availableTokens.find((t) => t.address.toLowerCase() === addr.toLowerCase());
      if (found) {
        setDropForm((prev) => ({
          ...prev,
          tokenAddress: found.address,
          tokenSymbol: found.symbol,
          decimals: String(found.decimals),
        }));
      }
    }
  };

  const onCustomTokenAddressChange = async (addr: string) => {
    setCustomTokenAddress(addr);
    const cleaned = addr.trim().toLowerCase();
    if (/^0x[a-f0-9]{40}$/.test(cleaned)) {
      setQueryingCustomToken(true);
      setError("");
      try {
        const res = await fetch(`/api/admin/drops?action=tokens&address=${encodeURIComponent(cleaned)}`);
        const data = await res.json().catch(() => null);
        if (res.ok && data) {
          setDropForm((prev) => ({
            ...prev,
            tokenAddress: data.address,
            tokenSymbol: data.symbol,
            decimals: String(data.decimals),
          }));
        } else {
          setError(data?.error || (isRu ? "Не удалось получить метаданные токена" : "Failed to fetch token metadata"));
        }
      } catch {
        setError(isRu ? "Ошибка запроса метаданных токена" : "Error querying token metadata");
      } finally {
        setQueryingCustomToken(false);
      }
    }
  };

  const saveEasterEggConfig = async () => {
    setError("");
    setMessage("");
    setConfigBusy(true);
    try {
      const maxW = Math.max(1, Math.floor(Number(configMaxWinners || 1)));
      const rawReward = (Number(configRewardUsd || 5) * 1000000).toString();

      const res = await fetch("/api/admin/easter-egg", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_config", maxWinners: maxW, rewardAmountRaw: rawReward }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Failed to update configuration");
      setMessage(isRu ? "Настройки успешно сохранены." : "Configuration successfully saved.");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update configuration");
    } finally {
      setConfigBusy(false);
    }
  };

  // Easter Egg Action Handlers
  const resetUsdPrize = async () => {
    if (!confirm(isRu ? "Вы уверены, что хотите сбросить статус главного приза $5 USDC?" : "Are you sure you want to reset the $5 USDC grand prize status?")) return;
    setError("");
    setMessage("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/easter-egg", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset_usd" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Failed to reset USD prize");
      setMessage(isRu ? "Статус главного приза $5 USDC успешно сброшен." : "USD grand prize status successfully reset.");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset USD prize");
    } finally {
      setLoading(false);
    }
  };

  const resetPlayerCooldown = async (wallet: string) => {
    if (!confirm(isRu ? `Вы уверены, что хотите сбросить кулдаун для ${wallet}?` : `Are you sure you want to reset cooldown for ${wallet}?`)) return;
    setError("");
    setMessage("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/easter-egg", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset_cooldown", wallet }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Failed to reset cooldown");
      setMessage(isRu ? `Кулдаун для ${wallet} успешно сброшен.` : `Cooldown successfully reset for ${wallet}.`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset cooldown");
    } finally {
      setLoading(false);
    }
  };

  const manuallyAwardUsd = async (wallet: string) => {
    const targetWallet = wallet.trim().toLowerCase();
    if (!targetWallet) {
      setError(isRu ? "Пожалуйста, введите адрес кошелька." : "Please enter a wallet address.");
      return;
    }
    if (!confirm(isRu ? `Вы уверены, что хотите вручную выдать $5 USDC кошельку ${targetWallet}?` : `Are you sure you want to manually award $5 USDC to ${targetWallet}?`)) return;
    setError("");
    setMessage("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/easter-egg", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "manual_usd", wallet: targetWallet }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Failed to award USD prize");
      setMessage(isRu ? `Главный приз $5 USDC успешно выдан кошельку ${targetWallet}.` : `USDC grand prize manually awarded to ${targetWallet}.`);
      setManualWallet("");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to award USD prize");
    } finally {
      setLoading(false);
    }
  };

  const updateSeasonConfig = async () => {
    setError("");
    setMessage("");
    setSeasonConfigBusy(true);
    try {
      const isoDate = new Date(seasonEndDate).toISOString();
      const res = await fetch("/api/admin/season", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_config",
          endDate: isoDate,
          isEnded: seasonIsEnded,
          seasonKey: seasonKey,
          virtualPoolUsdc: Number(virtualPoolUsdc),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || (isRu ? "Не удалось обновить настройки сезона" : "Failed to update season settings"));
      setMessage(isRu ? "Настройки сезона успешно обновлены." : "Season settings updated successfully.");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : (isRu ? "Не удалось обновить настройки сезона" : "Failed to update season settings"));
    } finally {
      setSeasonConfigBusy(false);
    }
  };

  const tabLabels = {
    submissions: isRu ? "Заявки" : "Submissions",
    creators: isRu ? "Креаторы" : "Creators",
    drops: isRu ? "Дропы" : "Drops",
    promos: isRu ? "Промо" : "Promos",
    easter_egg: isRu ? "Пасхалка" : "Easter Egg",
    season: isRu ? "Сезон" : "Season Settings",
  };

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <span>Sea Battle</span>
        <h1>{isRu ? "Админка" : "Admin Panel"}</h1>
        <p>
          {adminAddress 
            ? (isRu ? `Вход: ${shortWallet(adminAddress)}` : `Logged in: ${shortWallet(adminAddress)}`)
            : (isRu ? "Креаторы, рефералы и дропы" : "Creators, Referrals, and Drops")}
        </p>
      </header>

      {!authenticated ? (
        <section className={styles.loginCard}>
          <h2>{isRu ? "Вход кошельком" : "Wallet Login"}</h2>
          <p>{isRu ? "Подключи админ-кошелек и подпиши сообщение. Газ не нужен." : "Connect your admin wallet and sign the message. No gas required."}</p>
          {!isConnected ? (
            <div className={styles.connectorList}>
              {connectors.map((connector) => (
                <button
                  key={connector.id}
                  onClick={() => connect({ connector })}
                  disabled={connectPending}
                  type="button"
                >
                  {connector.name}
                </button>
              ))}
            </div>
          ) : (
            <button className={styles.primaryBtn} onClick={login} disabled={signing} type="button">
              {signing ? (isRu ? "Подписываем..." : "Signing...") : (isRu ? "Войти в админку" : "Log in to Admin")}
            </button>
          )}
          {error && <p className={styles.error}>{error}</p>}
        </section>
      ) : (
        <>
          <section className={styles.statsGrid}>
            <Stat label={isRu ? "Ждут проверки" : "Pending Check"} value={pendingSubmissions} />
            <Stat label={isRu ? "Креаторы" : "Creators"} value={creators.length} />
            <Stat label={isRu ? "Награды" : "Rewards"} value={rewards.length} />
            <Stat label={isRu ? "Дропы" : "Drops"} value={drops.length} />
          </section>

          <nav className={styles.tabs}>
            {(["submissions", "creators", "drops", "promos", "easter_egg", "season"] as Tab[]).map((entry) => (
              <button
                key={entry}
                className={tab === entry ? styles.activeTab : ""}
                onClick={() => setTab(entry)}
                type="button"
              >
                {tabLabels[entry]}
              </button>
            ))}
          </nav>

          {message && <p className={styles.success}>{message}</p>}
          {error && <p className={styles.error}>{error}</p>}
          {loading && <p className={styles.loading}>{isRu ? "Загрузка..." : "Loading..."}</p>}

          {tab === "submissions" && (
            <section className={styles.panel}>
              <h2>{isRu ? "Работы креаторов" : "Creator Submissions"}</h2>
              <div className={styles.table}>
                {submissions.length === 0 ? (
                  <p style={{ color: 'rgba(255,255,255,0.4)', textAlign: 'center', padding: '20px 0' }}>
                    {isRu ? "Нет заявок на проверку." : "No submissions to check."}
                  </p>
                ) : (
                  submissions.map((submission) => (
                    <article key={submission.id} className={styles.submissionRow}>
                      <div>
                        <b>{shortWallet(submission.wallet)}</b>
                        <a href={submission.url} target="_blank" rel="noreferrer">
                          {submission.url}
                        </a>
                        <small>{new Date(submission.created_at).toLocaleString(isRu ? "ru-RU" : "en-US")}</small>
                        {submission.admin_note && <small>{isRu ? "Причина/заметка: " : "Note/reason: "}{submission.admin_note}</small>}
                      </div>
                      <span className={styles.status}>{statusLabel(submission.status, isRu)}</span>
                      <div className={styles.actions}>
                        <button onClick={() => updateSubmission(submission.id, "approved")} type="button">
                          {isRu ? "Одобрить" : "Approve"}
                        </button>
                        <button
                          onClick={() => {
                            setRejectTarget(submission);
                            setRejectReason(submission.admin_note ?? "");
                          }}
                          type="button"
                        >
                          {isRu ? "Отклонить" : "Reject"}
                        </button>
                        <button
                          onClick={() => {
                            setRewardTarget({ wallet: submission.wallet, submissionId: submission.id });
                            setRewardMode("game");
                          }}
                          type="button"
                        >
                          {isRu ? "Наградить" : "Reward"}
                        </button>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>
          )}

          {tab === "creators" && (
            <section className={styles.panel}>
              <h2>{isRu ? "Статы креаторов" : "Creator Stats"}</h2>
              <div className={styles.gridTable}>
                <b>{isRu ? "Кошелек" : "Wallet"}</b>
                <b>{isRu ? "Рефы" : "Refs"}</b>
                <b>{isRu ? "Активные" : "Active"}</b>
                <b>{isRu ? "Игры рефов" : "Ref Games"}</b>
                <b>{isRu ? "Победы" : "Wins"}</b>
                <b>{isRu ? "Транзы" : "Txs"}</b>
                <b>{isRu ? "Очки" : "Points"}</b>
                <b>{isRu ? "Действие" : "Action"}</b>
                {creators.map((creator) => (
                  <Row key={creator.wallet}>
                    <span>{shortWallet(creator.wallet)}</span>
                    <span>{creator.referrals}</span>
                    <span>{creator.activeReferrals}</span>
                    <span>{creator.referralGames}</span>
                    <span>{creator.referralWins}</span>
                    <span>{creator.referralTxs}</span>
                    <span>{creator.points.toLocaleString()}</span>
                    <button
                      className={styles.inlineBtn}
                      onClick={() => {
                        setRewardTarget({ wallet: creator.wallet });
                        setRewardMode("game");
                      }}
                      type="button"
                    >
                      {isRu ? "Наградить" : "Reward"}
                    </button>
                  </Row>
                ))}
              </div>
            </section>
          )}

          {tab === "drops" && (
            <section className={styles.panel}>
              <h2>{isRu ? "Дроп по лидерборду" : "Leaderboard Drop"}</h2>
              <div className={styles.compactForm}>
                <label>
                  <span>{isRu ? "ID дропа" : "Drop ID"}</span>
                  <input
                    value={dropForm.id}
                    onChange={(e) => {
                      const val = e.target.value;
                      setDropForm((prev) => ({
                        ...prev,
                        id: val,
                        title: prev.title === prev.id || !prev.title ? val : prev.title
                      }));
                    }}
                    placeholder="season-1"
                  />
                </label>
                <label>
                  <span>{isRu ? "Название (необязательно)" : "Title (Optional)"}</span>
                  <input
                    value={dropForm.title}
                    onChange={(e) => setDropForm({ ...dropForm, title: e.target.value })}
                    placeholder={dropForm.id || "Season 1 Drop"}
                  />
                </label>
                <label>
                  <span>{isRu ? "Выбрать токен" : "Select Token"}</span>
                  <select
                    value={customTokenMode ? "custom" : dropForm.tokenAddress}
                    onChange={(e) => onTokenSelectChange(e.target.value)}
                  >
                    {availableTokens.map((t) => (
                      <option key={t.address} value={t.address}>
                        {t.symbol} ({t.formattedBalance} {t.symbol} {isRu ? "на контракте" : "on contract"})
                      </option>
                    ))}
                    <option value="custom">{isRu ? "Свой контракт..." : "Custom Contract..."}</option>
                  </select>
                </label>
                {customTokenMode ? (
                  <label>
                    <span>{isRu ? "Адрес токена" : "Token Contract Address"}</span>
                    <input
                      value={customTokenAddress}
                      onChange={(e) => onCustomTokenAddressChange(e.target.value)}
                      placeholder="0x..."
                    />
                    {queryingCustomToken && <small style={{ color: "var(--accent-bright, #66e9ff)" }}>{isRu ? "Поиск..." : "Querying..."}</small>}
                  </label>
                ) : (
                  <label>
                    <span>{isRu ? "Детали токена" : "Token Details"}</span>
                    <input
                      readOnly
                      disabled
                      value={`${dropForm.tokenSymbol} (decimals: ${dropForm.decimals})`}
                      style={{ opacity: 0.65, cursor: "not-allowed" }}
                    />
                  </label>
                )}
                {customTokenMode && (
                  <>
                    <label>
                      <span>{isRu ? "Тикер токена" : "Token Symbol"}</span>
                      <input
                        value={dropForm.tokenSymbol}
                        onChange={(e) => setDropForm({ ...dropForm, tokenSymbol: e.target.value })}
                        placeholder="TOKEN"
                      />
                    </label>
                    <label>
                      <span>{isRu ? "Десятичные" : "Decimals"}</span>
                      <input
                        value={dropForm.decimals}
                        onChange={(e) => setDropForm({ ...dropForm, decimals: e.target.value })}
                        placeholder="18"
                      />
                    </label>
                  </>
                )}
                <label className={customTokenMode ? "" : styles.fullField}>
                  <span>{isRu ? "Сколько всего раздать" : "Total Amount to Distribute"}</span>
                  <input value={dropForm.totalAmount} onChange={(e) => setDropForm({ ...dropForm, totalAmount: e.target.value })} placeholder="1000000" />
                </label>
                <div style={{ gridColumn: "1 / -1", margin: "15px 0 5px", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "15px" }}>
                  <h4 style={{ margin: 0, fontSize: "14px", color: "var(--accent-bright, #66e9ff)" }}>
                    {isRu ? "Правила отбора участников" : "Participant Eligibility Rules"}
                  </h4>
                </div>
                <label>
                  <span>{isRu ? "Источник очков" : "Points Source"}</span>
                  <select value={dropForm.pointsSource} onChange={(e) => setDropForm({ ...dropForm, pointsSource: e.target.value })}>
                    <option value="all_time">{isRu ? "За все время (Общие поинты)" : "All-time Points"}</option>
                    <option value="season_current">{isRu ? "Текущий сезон (XP)" : "Current Season XP"}</option>
                  </select>
                </label>
                <label>
                  <span>{isRu ? "Мин. Очки/XP" : "Min Points/XP"}</span>
                  <input
                    type="number"
                    value={dropForm.minPoints}
                    onChange={(e) => setDropForm({ ...dropForm, minPoints: e.target.value })}
                    placeholder="3000"
                  />
                </label>
                <label>
                  <span>{isRu ? "Мин. транзакций" : "Min Transactions"}</span>
                  <input
                    type="number"
                    value={dropForm.minTransactions}
                    onChange={(e) => setDropForm({ ...dropForm, minTransactions: e.target.value })}
                    placeholder="10"
                  />
                </label>
                <label>
                  <span>{isRu ? "Мин. чекинов" : "Min Check-ins"}</span>
                  <input
                    type="number"
                    value={dropForm.minCheckins}
                    onChange={(e) => setDropForm({ ...dropForm, minCheckins: e.target.value })}
                    placeholder="0"
                  />
                </label>
              </div>
              
              <div style={{ display: "flex", gap: "10px", margin: "20px 0" }}>
                <button
                  className={styles.secondaryBtn}
                  onClick={calculateDropPreview}
                  disabled={previewBusy}
                  type="button"
                  style={{
                    flex: 1,
                    padding: "10px 16px",
                    background: "rgba(255,255,255,0.08)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    borderRadius: "6px",
                    color: "#fff",
                    fontWeight: 500,
                    cursor: "pointer",
                    transition: "background 0.2s"
                  }}
                >
                  {previewBusy 
                    ? (isRu ? "Расчет..." : "Calculating...") 
                    : (isRu ? "Рассчитать и просмотреть" : "Calculate & Preview")}
                </button>
                <button
                  className={styles.primaryBtn}
                  onClick={createDropSnapshot}
                  disabled={previewBusy}
                  type="button"
                  style={{ flex: 1 }}
                >
                  {isRu ? "Зафиксировать и опубликовать snapshot" : "Confirm & Create Snapshot"}
                </button>
              </div>

              {previewResults && (
                <div style={{ marginTop: "20px", marginBottom: "30px", border: "1px solid rgba(255,255,255,0.1)", padding: "20px", borderRadius: "8px", background: "rgba(0,0,0,0.3)" }}>
                  <h3 style={{ marginTop: 0, fontSize: "16px", color: "var(--accent-bright, #66e9ff)", borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: "10px" }}>
                    {isRu ? "Предварительный просмотр распределения наград" : "Reward Distribution Preview"}
                  </h3>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "25px", marginBottom: "20px", fontSize: "14px" }}>
                    <div>
                      <span style={{ color: "rgba(255,255,255,0.6)" }}>{isRu ? "Всего участников: " : "Eligible Wallets: "}</span>
                      <strong style={{ fontSize: "16px", color: "#fff" }}>{previewResults.summary.totalWallets}</strong>
                    </div>
                    <div>
                      <span style={{ color: "rgba(255,255,255,0.6)" }}>{isRu ? "Всего очков: " : "Total Snapshot Points: "}</span>
                      <strong style={{ fontSize: "16px", color: "#fff" }}>{Number(previewResults.summary.totalPoints).toLocaleString()}</strong>
                    </div>
                    <div>
                      <span style={{ color: "rgba(255,255,255,0.6)" }}>{isRu ? "Всего к распределению: " : "Total Reward Pool: "}</span>
                      <strong style={{ fontSize: "16px", color: "var(--accent, #00dcb4)" }}>{previewResults.summary.totalAmount} {previewResults.summary.tokenSymbol}</strong>
                    </div>
                  </div>
                  <div style={{ maxHeight: "300px", overflowY: "auto", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "6px" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "13px" }}>
                      <thead>
                        <tr style={{ background: "rgba(255,255,255,0.05)", borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
                          <th style={{ padding: "10px", color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>{isRu ? "Кошелек" : "Wallet"}</th>
                          <th style={{ padding: "10px", color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>{isRu ? "Очки" : "Points"}</th>
                          <th style={{ padding: "10px", color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>{isRu ? "Игры" : "Games"}</th>
                          <th style={{ padding: "10px", color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>{isRu ? "Чекины" : "Checkins"}</th>
                          <th style={{ padding: "10px", color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>{isRu ? "Транзакции" : "Txs"}</th>
                          <th style={{ padding: "10px", color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>{isRu ? "Награда" : "Reward"}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewResults.allocations.map((alloc) => (
                          <tr key={alloc.wallet} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                            <td style={{ padding: "10px", fontFamily: "monospace" }}>{alloc.wallet}</td>
                            <td style={{ padding: "10px" }}>{alloc.points.toLocaleString()}</td>
                            <td style={{ padding: "10px" }}>{alloc.gamesPlayed}</td>
                            <td style={{ padding: "10px" }}>{alloc.totalCheckins}</td>
                            <td style={{ padding: "10px" }}>{alloc.transactions}</td>
                            <td style={{ padding: "10px", fontWeight: "bold", color: "var(--accent-bright, #66e9ff)" }}>
                              {alloc.amount_formatted} {previewResults.summary.tokenSymbol}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className={styles.dropList}>
                {drops.map((drop) => (
                  <article key={drop.id} className={styles.dropRow}>
                    <div>
                      <b>{drop.title}</b>
                      <small>{drop.id} / {drop.token_symbol}</small>
                    </div>
                    <span>{statusLabel(drop.status, isRu)}</span>
                    <span>{drop.allocations ?? 0} {isRu ? "кошельков" : "wallets"}</span>
                    <span>{drop.claimed ?? 0} {isRu ? "claimed" : "claimed"}</span>
                    <div className={styles.actions}>
                      <button onClick={() => updateDrop(drop.id, "active")} type="button">
                        {isRu ? "Включить" : "Activate"}
                      </button>
                      <button onClick={() => updateDrop(drop.id, "closed")} type="button">
                        {isRu ? "Закрыть" : "Close"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {tab === "promos" && (
            <section className={styles.panel}>
              <h2>{isRu ? "Промокоды / Ссылки" : "Promo codes / links"}</h2>
              <p className={styles.modalHint}>
                {isRu 
                  ? "Выберите свой код. Один кошелек может использовать один код только один раз." 
                  : "Pick your own code. One wallet can redeem the same code only once."}
              </p>
              <div className={styles.compactForm}>
                <label>
                  <span>{isRu ? "Код" : "Code"}</span>
                  <input
                    value={promoForm.id}
                    onChange={(e) => setPromoForm({ ...promoForm, id: e.target.value })}
                    placeholder="SEA100"
                  />
                </label>
                <label>
                  <span>{isRu ? "Название" : "Title"}</span>
                  <input
                    value={promoForm.title}
                    onChange={(e) => setPromoForm({ ...promoForm, title: e.target.value })}
                    placeholder="Creator bonus"
                  />
                </label>
                <label>
                  <span>{isRu ? "Очки" : "Points"}</span>
                  <input
                    type="number"
                    min={0}
                    value={promoForm.points}
                    onChange={(e) => setPromoForm({ ...promoForm, points: e.target.value })}
                    placeholder="1000"
                  />
                </label>
                <label>
                  <span>{isRu ? "Предмет" : "Item"}</span>
                  <select
                    value={promoForm.itemSlug}
                    onChange={(e) => setPromoForm({ ...promoForm, itemSlug: e.target.value })}
                  >
                    {ITEM_OPTIONS.map((item) => (
                      <option key={item.slug || "none"} value={item.slug}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{isRu ? "Количество" : "Quantity"}</span>
                  <input
                    type="number"
                    min={1}
                    value={promoForm.quantity}
                    onChange={(e) => setPromoForm({ ...promoForm, quantity: e.target.value })}
                    placeholder="1"
                    disabled={!promoForm.itemSlug}
                  />
                </label>
                <label>
                  <span>{isRu ? "Срок действия в днях" : "Expires in days"}</span>
                  <input
                    type="number"
                    min={0}
                    max={365}
                    value={promoForm.expiresDays}
                    onChange={(e) => setPromoForm({ ...promoForm, expiresDays: e.target.value })}
                    placeholder="30"
                  />
                </label>
                <label className={styles.fullField}>
                  <span>{isRu ? "Заметка" : "Note"}</span>
                  <textarea
                    value={promoForm.note}
                    onChange={(e) => setPromoForm({ ...promoForm, note: e.target.value })}
                    placeholder={isRu ? "Необязательная внутренняя заметка" : "Optional internal note"}
                  />
                </label>
              </div>
              <button className={styles.primaryBtn} onClick={createPromo} type="button">
                {isRu ? "Создать промокод/ссылку" : "Create promo code/link"}
              </button>

              {generatedPromo && (
                <div className={styles.promoOutput}>
                  <b>{generatedPromo.title}</b>
                  <small>
                    {generatedPromo.points > 0 ? `+${generatedPromo.points.toLocaleString()} pts` : (isRu ? "Нет очков" : "No points")}
                    {generatedPromo.itemSlug && generatedPromo.quantity > 0
                      ? ` / ${generatedPromo.quantity}x ${generatedPromo.itemLabel || generatedPromo.itemSlug}`
                      : ""}
                    {generatedPromo.expiresAt
                      ? ` / ${isRu ? "истекает" : "expires"} ${new Date(generatedPromo.expiresAt).toLocaleString()}`
                      : ` / ${isRu ? "без срока" : "no expiry"}`}
                  </small>
                  <label>
                    <span>{isRu ? "Код" : "Code"}</span>
                    <textarea
                      readOnly
                      value={generatedPromo.code}
                      onFocus={(e) => e.currentTarget.select()}
                    />
                  </label>
                  <button
                    className={styles.inlineBtn}
                    onClick={() => copyPromoText(generatedPromo.code, isRu ? "Код" : "Code")}
                    type="button"
                  >
                    {isRu ? "Копировать код" : "Copy code"}
                  </button>
                  <label>
                    <span>{isRu ? "Короткая ссылка" : "Short link"}</span>
                    <textarea
                      readOnly
                      value={generatedPromo.link}
                      onFocus={(e) => e.currentTarget.select()}
                    />
                  </label>
                  <button
                    className={styles.inlineBtn}
                    onClick={() => copyPromoText(generatedPromo.link, isRu ? "Ссылку" : "Link")}
                    type="button"
                  >
                    {isRu ? "Копировать ссылку" : "Copy link"}
                  </button>
                  <label>
                    <span>{isRu ? "Ссылка на Base App" : "Base App link"}</span>
                    <textarea
                      readOnly
                      value={generatedPromo.baseAppLink}
                      onFocus={(e) => e.currentTarget.select()}
                    />
                  </label>
                  <button
                    className={styles.inlineBtn}
                    onClick={() => copyPromoText(generatedPromo.baseAppLink, isRu ? "Ссылка на Base App" : "Base App link")}
                    type="button"
                  >
                    {isRu ? "Копировать ссылку на Base App" : "Copy Base App link"}
                  </button>
                </div>
              )}
            </section>
          )}

          {tab === "easter_egg" && (
            <section className={styles.panel}>
              <h2>{isRu ? "Пасхальное яйцо (Easter Egg)" : "Easter Egg Management"}</h2>
              
              <div className={styles.easterEggStatsGrid} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', marginBottom: '20px' }}>
                <div className={styles.stat}>
                  <span>{isRu ? "Статус призов ($ USDC)" : "USDC Prize Status"}</span>
                  <b style={{ color: easterEggStats.usdWon ? '#ff6600' : '#00ff88' }}>
                    {easterEggStats.usdWon 
                      ? (isRu ? "Все выданы" : "Fully Claimed") 
                      : (isRu ? "Доступны" : "Available")}
                  </b>
                  <small style={{ display: 'block', marginTop: '4px', color: 'rgba(255, 255, 255, 0.7)', fontSize: '11px' }}>
                    {isRu ? "Выдано: " : "Awarded: "} {easterEggStats.usdWinners.length} / {easterEggStats.maxWinners} ({Number(easterEggStats.rewardAmountRaw) / 1000000} USDC)
                  </small>
                  {easterEggStats.usdWinners.length > 0 && (
                    <small style={{ display: 'block', marginTop: '6px', color: 'rgba(255, 255, 255, 0.5)', wordBreak: 'break-all' }}>
                      {isRu ? "Победители: " : "Winners: "} {easterEggStats.usdWinners.map(shortWallet).join(", ")}
                    </small>
                  )}
                </div>
                <div className={styles.stat}>
                  <span>{isRu ? "Всего претендентов" : "Total Claimants"}</span>
                  <b>{easterEggStats.totalClaimsCount}</b>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '14px', marginBottom: '24px' }}>
                {/* Configuration form */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '16px', border: '1px solid rgba(var(--accent-rgb), 0.15)', borderRadius: '8px', background: 'rgba(255, 255, 255, 0.02)' }}>
                  <h3 style={{ margin: 0, fontSize: '14px', color: '#ffd978', textTransform: 'uppercase', fontFamily: 'var(--font-orbitron)' }}>
                    {isRu ? "Настройки призов" : "Prize Settings"}
                  </h3>
                  <div className={styles.compactForm} style={{ gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}>{isRu ? "Лимит победителей" : "Winners Limit"}</span>
                      <input
                        type="number"
                        min="1"
                        value={configMaxWinners}
                        onChange={(e) => setConfigMaxWinners(e.target.value)}
                        style={{ minHeight: '34px' }}
                      />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}>{isRu ? "Сумма приза ($ USDC)" : "Prize Amount ($ USDC)"}</span>
                      <input
                        type="number"
                        min="0.1"
                        step="any"
                        value={configRewardUsd}
                        onChange={(e) => setConfigRewardUsd(e.target.value)}
                        style={{ minHeight: '34px' }}
                      />
                    </label>
                  </div>
                  <button
                    className={styles.primaryBtn}
                    onClick={saveEasterEggConfig}
                    disabled={configBusy}
                    style={{ minHeight: '34px', marginTop: '8px', width: '100%' }}
                    type="button"
                  >
                    {configBusy ? (isRu ? "Сохраняем..." : "Saving...") : (isRu ? "Сохранить настройки" : "Save Settings")}
                  </button>
                </div>

                {/* Manual award wallet */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '16px', border: '1px solid rgba(var(--accent-rgb), 0.15)', borderRadius: '8px', background: 'rgba(255, 255, 255, 0.02)' }}>
                  <h3 style={{ margin: 0, fontSize: '14px', color: '#ffd978', textTransform: 'uppercase', fontFamily: 'var(--font-orbitron)' }}>
                    {isRu ? "Выдать главный приз вручную" : "Award Grand Prize Manually"}
                  </h3>
                  <div style={{ display: 'flex', gap: '8px', flexDirection: 'column' }}>
                    <input
                      type="text"
                      value={manualWallet}
                      onChange={(e) => setManualWallet(e.target.value)}
                      placeholder="0x..."
                      style={{ minHeight: '34px' }}
                    />
                    <button
                      className={styles.inlineBtn}
                      onClick={() => manuallyAwardUsd(manualWallet)}
                      style={{ minHeight: '34px', width: '100%' }}
                      type="button"
                    >
                      {isRu ? `Выдать $${configRewardUsd} USDC` : `Award $${configRewardUsd} USDC`}
                    </button>
                  </div>
                </div>

                {/* Reset Actions */}
                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '8px', padding: '16px', border: '1px solid rgba(var(--accent-rgb), 0.15)', borderRadius: '8px', background: 'rgba(255, 255, 255, 0.02)' }}>
                  <h3 style={{ margin: 0, fontSize: '14px', color: '#fca5a5', textTransform: 'uppercase', fontFamily: 'var(--font-orbitron)' }}>
                    {isRu ? "Опасная зона" : "Danger Zone"}
                  </h3>
                  <button
                    className={styles.dangerBtn}
                    onClick={resetUsdPrize}
                    disabled={easterEggStats.usdWinners.length === 0}
                    style={{ minHeight: '38px', width: '100%', whiteSpace: 'nowrap', marginTop: '12px' }}
                    type="button"
                  >
                    {isRu ? "Сбросить всех победителей" : "Reset All Winners"}
                  </button>
                </div>
              </div>

              <h3>{isRu ? "Список претендентов" : "Claimant Log"}</h3>
              <div className={styles.table} style={{ marginTop: '10px' }}>
                {easterEggStats.claims.length === 0 ? (
                  <p style={{ color: 'rgba(255,255,255,0.4)', textAlign: 'center', padding: '20px 0' }}>
                    {isRu ? "Претендентов пока нет." : "No claimants yet."}
                  </p>
                ) : (
                  easterEggStats.claims.map((claim) => (
                    <article key={claim.wallet} className={styles.submissionRow} style={{ gridTemplateColumns: 'minmax(200px, 1.2fr) minmax(100px, 0.8fr) minmax(120px, 1fr) auto' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <b style={{ fontFamily: 'monospace', fontSize: '13px' }}>{claim.wallet}</b>
                        <small style={{ color: 'rgba(255,255,255,0.5)' }}>
                          {isRu ? "Последний клейм: " : "Last Claimed: "}
                          {new Date(claim.last_claimed_at).toLocaleString(isRu ? "ru-RU" : "en-US")}
                        </small>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.6)' }}>
                          {isRu ? "Клеймов всего: " : "Total Claims: "}
                        </span>
                        <b style={{ color: '#ffd978', fontSize: '14px' }}>{claim.total_claims}</b>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        {claim.usd_eligible ? (
                          <span style={{
                            padding: '4px 8px',
                            background: 'rgba(255, 102, 0, 0.15)',
                            border: '1px solid rgba(255, 102, 0, 0.4)',
                            color: '#ff6600',
                            borderRadius: '4px',
                            fontSize: '10px',
                            fontWeight: 'bold',
                            textTransform: 'uppercase'
                          }}>
                            {isRu ? "Главный приз" : "Grand Prize"}
                          </span>
                        ) : (
                          <span style={{
                            padding: '4px 8px',
                            background: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            color: 'rgba(255, 255, 255, 0.4)',
                            borderRadius: '4px',
                            fontSize: '10px',
                            textTransform: 'uppercase'
                          }}>
                            {isRu ? "Обычные очки" : "Points Only"}
                          </span>
                        )}
                      </div>
                      <div className={styles.actions}>
                        <button
                          className={styles.inlineBtn}
                          onClick={() => resetPlayerCooldown(claim.wallet)}
                          style={{ borderColor: 'rgba(var(--accent-rgb), 0.3)', color: 'var(--accent-bright, #66e9ff)', background: 'rgba(var(--accent-rgb), 0.05)' }}
                          type="button"
                        >
                          {isRu ? "Сбросить кулдаун" : "Reset Cooldown"}
                        </button>
                        {!claim.usd_eligible && (
                          <button
                            className={styles.inlineBtn}
                            onClick={() => manuallyAwardUsd(claim.wallet)}
                            type="button"
                          >
                            {isRu ? `Выдать приз $${Number(easterEggStats.rewardAmountRaw) / 1000000}` : `Award $${Number(easterEggStats.rewardAmountRaw) / 1000000} Prize`}
                          </button>
                        )}
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>
          )}

          {tab === "season" && (
            <section className={styles.panel}>
              <h2>{isRu ? "Настройки сезона" : "Season Settings"}</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '400px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span>{isRu ? "Дата окончания сезона (UTC)" : "Season End Date (UTC)"}</span>
                  <input
                    type="datetime-local"
                    value={seasonEndDate}
                    onChange={(e) => setSeasonEndDate(e.target.value)}
                    style={{
                      background: 'rgba(5, 10, 22, 0.82)',
                      border: '1px solid rgba(0, 212, 255, 0.24)',
                      borderRadius: '6px',
                      color: '#fff',
                      padding: '8px 12px',
                      fontFamily: 'inherit'
                    }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span>{isRu ? "Код текущего сезона" : "Current Season Key"}</span>
                  <input
                    type="text"
                    value={seasonKey}
                    onChange={(e) => setSeasonKey(e.target.value)}
                    placeholder="S1"
                    style={{
                      background: 'rgba(5, 10, 22, 0.82)',
                      border: '1px solid rgba(0, 212, 255, 0.24)',
                      borderRadius: '6px',
                      color: '#fff',
                      padding: '8px 12px',
                      fontFamily: 'inherit'
                    }}
                  />
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span>{isRu ? "Начальный виртуальный пул (USDC)" : "Initial Virtual Pool (USDC)"}</span>
                  <input
                    type="number"
                    min={0}
                    value={virtualPoolUsdc}
                    onChange={(e) => setVirtualPoolUsdc(e.target.value)}
                    placeholder="150"
                    style={{
                      background: 'rgba(5, 10, 22, 0.82)',
                      border: '1px solid rgba(0, 212, 255, 0.24)',
                      borderRadius: '6px',
                      color: '#fff',
                      padding: '8px 12px',
                      fontFamily: 'inherit'
                    }}
                  />
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', userSelect: 'none' }}>
                  <input
                    type="checkbox"
                    checked={seasonIsEnded}
                    onChange={(e) => setSeasonIsEnded(e.target.checked)}
                    style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                  />
                  <span>{isRu ? "Сезон завершен (активирует клейм дропа)" : "Season Finished (enables drop claiming)"}</span>
                </label>

                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={updateSeasonConfig}
                  disabled={seasonConfigBusy}
                  style={{ alignSelf: 'flex-start', marginTop: '10px' }}
                >
                  {seasonConfigBusy ? (isRu ? "Сохраняем..." : "Saving...") : (isRu ? "Сохранить настройки" : "Save Settings")}
                </button>
              </div>
            </section>
          )}
        </>
      )}

      {rejectTarget && (
        <Modal title={isRu ? "Причина отказа" : "Reject Reason"} onClose={() => setRejectTarget(null)}>
          <p className={styles.modalHint}>{shortWallet(rejectTarget.wallet)}</p>
          <textarea
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            placeholder={isRu ? "Напиши, почему работа отклонена" : "Explain why the submission is rejected"}
          />
          <div className={styles.modalActions}>
            <button onClick={() => setRejectTarget(null)} type="button">
              {isRu ? "Отмена" : "Cancel"}
            </button>
            <button className={styles.dangerBtn} onClick={rejectSubmission} type="button">
              {isRu ? "Отклонить" : "Reject"}
            </button>
          </div>
        </Modal>
      )}

      {rewardTarget && (
        <Modal title={isRu ? "Выдать награду" : "Award Reward"} onClose={() => setRewardTarget(null)}>
          <p className={styles.modalHint}>{shortWallet(rewardTarget.wallet)}</p>
          <div className={styles.segment}>
            <button
              className={rewardMode === "game" ? styles.segmentActive : ""}
              onClick={() => setRewardMode("game")}
              type="button"
            >
              {isRu ? "Айтемы + поинты" : "Items + Points"}
            </button>
            <button
              className={rewardMode === "token" ? styles.segmentActive : ""}
              onClick={() => setRewardMode("token")}
              type="button"
            >
              {isRu ? "Токены" : "Tokens"}
            </button>
          </div>

          {rewardMode === "game" ? (
            <div className={styles.compactForm}>
              <label>
                <span>{isRu ? "Поинты" : "Points"}</span>
                <input value={gameReward.points} onChange={(e) => setGameReward({ ...gameReward, points: e.target.value })} placeholder="1000" />
              </label>
              <label>
                <span>{isRu ? "Предмет" : "Item"}</span>
                <select value={gameReward.itemSlug} onChange={(e) => setGameReward({ ...gameReward, itemSlug: e.target.value })}>
                  {ITEM_OPTIONS.map((item) => (
                    <option key={item.slug || "none"} value={item.slug}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>{isRu ? "Количество" : "Quantity"}</span>
                <input value={gameReward.quantity} onChange={(e) => setGameReward({ ...gameReward, quantity: e.target.value })} placeholder="1" />
              </label>
              <label className={styles.fullField}>
                <span>{isRu ? "Сообщение пользователю" : "Message to User"}</span>
                <input value={gameReward.note} onChange={(e) => setGameReward({ ...gameReward, note: e.target.value })} placeholder={isRu ? "Например: Спасибо за TikTok ролик!" : "e.g., Thanks for the TikTok video!"} />
              </label>
            </div>
          ) : (
            <div className={styles.compactForm}>
              <label>
                <span>{isRu ? "Что отправить" : "What to send"}</span>
                <select value={tokenReward.kind} onChange={(e) => setTokenReward({ ...tokenReward, kind: e.target.value as TokenKind })}>
                  <option value="usdc">USDC</option>
                  <option value="base">BASE</option>
                  <option value="token">{isRu ? "Другой токен" : "Other Token"}</option>
                </select>
              </label>
              <label>
                <span>{isRu ? "Сумма" : "Amount"}</span>
                <input value={tokenReward.amount} onChange={(e) => setTokenReward({ ...tokenReward, amount: e.target.value })} placeholder="25" />
              </label>
              {tokenReward.kind === "token" && (
                <label className={styles.fullField}>
                  <span>{isRu ? "Адрес токена" : "Token Address"}</span>
                  <input value={tokenReward.tokenAddress} onChange={(e) => setTokenReward({ ...tokenReward, tokenAddress: e.target.value })} placeholder="0x..." />
                </label>
              )}
              <label className={styles.fullField}>
                <span>{isRu ? "Сообщение пользователю" : "Message to User"}</span>
                <input value={tokenReward.note} onChange={(e) => setTokenReward({ ...tokenReward, note: e.target.value })} placeholder={isRu ? "Например: Спасибо за твою работу!" : "e.g., Thanks for your hard work!"} />
              </label>
            </div>
          )}

          <div className={styles.modalActions}>
            <button onClick={() => setRewardTarget(null)} type="button">
              {isRu ? "Отмена" : "Cancel"}
            </button>
            <button className={styles.primaryBtn} onClick={grantReward} disabled={rewardBusy} type="button">
              {rewardBusy ? (isRu ? "Сохраняем..." : "Saving...") : (isRu ? "Выдать" : "Award")}
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className={styles.modalBackdrop}>
      <section className={styles.modal}>
        <header className={styles.modalHeader}>
          <h2>{title}</h2>
          <button onClick={onClose} type="button">Закрыть</button>
        </header>
        {children}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.stat}>
      <span>{label}</span>
      <b>{value.toLocaleString()}</b>
    </div>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function shortWallet(wallet: string) {
  if (!wallet) return "-";
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

function statusLabel(status: string, isRu: boolean) {
  const labelsRu: Record<string, string> = {
    pending: "На проверке",
    approved: "Одобрено",
    rejected: "Отклонено",
    rewarded: "Награждено",
    planned: "Запланировано",
    granted: "Выдано",
    claimable: "Можно клеймить",
    paid: "Оплачено",
    draft: "Черновик",
    active: "Активен",
    closed: "Закрыт",
    cancelled: "Отменен",
  };
  const labelsEn: Record<string, string> = {
    pending: "Pending",
    approved: "Approved",
    rejected: "Rejected",
    rewarded: "Rewarded",
    planned: "Planned",
    granted: "Granted",
    claimable: "Claimable",
    paid: "Paid",
    draft: "Draft",
    active: "Active",
    closed: "Closed",
    cancelled: "Cancelled",
  };
  return (isRu ? labelsRu[status] : labelsEn[status]) ?? status;
}

function parseDecimalToRaw(value: string, decimals: number) {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalized)) return BigInt(0);
  const [whole, fraction = ""] = normalized.split(".");
  const padded = fraction.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole || "0") * (BigInt(10) ** BigInt(decimals)) + BigInt(padded || "0");
}
