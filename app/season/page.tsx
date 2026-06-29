"use client";

import { waitForTransactionReceipt as waitForReceipt } from "@wagmi/core";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { encodeFunctionData } from "viem";
import {
  useAccount,
  useCallsStatus,
  useCapabilities,
  useConfig,
  useConnect,
  useSendCalls,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { base } from "wagmi/chains";
import { DropClaimPanel } from "../components/DropClaimPanel";
import { SeasonPoolCard } from "../components/FleetMinerWidgets";
import { CheckIcon, ChevronRightIcon, TrophyIcon } from "../components/Icons";
import { ItemArt, type ItemArtKind } from "../components/ItemArt";
import { SettingsPanel } from "../components/SettingsPanel";
import { seaBattleAbi, SEABATTLE_CONTRACT_ADDRESS } from "../contracts/seaBattleAbi";
import { USDC_SEASON_REWARDS_ENABLED } from "../lib/featureFlags";
import { notifyPlayerDataRefresh } from "../lib/playerDataEvents";
import {
  claimSeasonLevels,
  getSeasonState,
  rewardLabel,
  SEASON_LEVELS,
  SEASON_MAX_LEVEL,
  seasonClaimSentinelAddress,
  type SeasonState,
  validateSeasonLevelClaims,
} from "../lib/season";
import { TR, useSettings } from "../lib/settings";
import { BUILDER_CODE_SUFFIX } from "../providers";
import styles from "./page.module.css";

const PAYMASTER_URL = process.env.NEXT_PUBLIC_PAYMASTER_URL;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const SEASON_DROP_AT = Date.UTC(2026, 6, 18, 0, 0, 0);

export default function SeasonPage() {
  const { lang } = useSettings();
  const ru = lang === "ru";
  const tr = TR[lang];
  const wagmiConfig = useConfig();
  const { address, isConnected } = useAccount();
  const {
    connectors,
    connect,
    status: connectStatus,
  } = useConnect();
  const [connectingConnectorId, setConnectingConnectorId] = useState<string | null>(null);
  const [season, setSeason] = useState<SeasonState | null>(null);
  const [seasonLoading, setSeasonLoading] = useState(false);
  const [seasonError, setSeasonError] = useState("");
  const [seasonMsg, setSeasonMsg] = useState("");
  const [claimingSeasonLevels, setClaimingSeasonLevels] = useState<number[]>([]);
  const [seasonClaimFallbackMined, setSeasonClaimFallbackMined] = useState(false);
  const seasonClaimLevelsRef = useRef<number[]>([]);
  const seasonClaimHandledRef = useRef(false);
  const countdown = useCountdown(SEASON_DROP_AT);

  const orderedConnectors = useMemo(() => {
    const baseConnectors = connectors.filter(isBaseAccountConnector);
    const otherConnectors = connectors.filter((connector) => !isBaseAccountConnector(connector));
    return [...baseConnectors, ...otherConnectors];
  }, [connectors]);

  useEffect(() => {
    if (connectStatus !== "pending") setConnectingConnectorId(null);
  }, [connectStatus]);

  const { data: capabilities } = useCapabilities({ chainId: base.id });
  const paymasterSupported =
    !!PAYMASTER_URL && !!capabilities?.paymasterService?.supported;

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

  const refreshSeason = useCallback(async () => {
    if (!address) {
      setSeason(null);
      setSeasonError("");
      return;
    }

    setSeasonLoading(true);
    setSeasonError("");
    try {
      setSeason(await getSeasonState(address));
    } catch (err) {
      setSeasonError(err instanceof Error ? err.message : ru ? "Не удалось загрузить сезон" : "Could not load season");
    } finally {
      setSeasonLoading(false);
    }
  }, [address, ru]);

  useEffect(() => {
    refreshSeason();
  }, [refreshSeason]);

  useEffect(() => {
    setSeasonClaimFallbackMined(false);
    if (!seasonClaimTxHash) return;
    let cancelled = false;
    waitForReceipt(wagmiConfig, { hash: seasonClaimTxHash })
      .then((receipt) => {
        if (!cancelled && receipt.status === "success") setSeasonClaimFallbackMined(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [seasonClaimTxHash, wagmiConfig]);

  const applyOptimisticSeasonClaim = useCallback((levels: number[]) => {
    setSeason((current) => {
      if (!current) return current;
      const nextClaimed = Array.from(new Set([...current.claimedLevels, ...levels])).sort((a, b) => a - b);
      return {
        ...current,
        claimedLevels: nextClaimed,
        levels: current.levels.map((level) =>
          levels.includes(level.level)
            ? { ...level, claimed: true, claimable: false }
            : level
        ),
      };
    });
  }, []);

  const seasonClaimCallsSuccess = seasonClaimCallsStatus?.status === "success";
  const seasonClaimTxSuccess =
    seasonClaimTxReceipt?.status === "success" || seasonClaimFallbackMined;
  const seasonClaimOnchainSuccess = seasonClaimTxSuccess || seasonClaimCallsSuccess;
  const seasonClaimPending = seasonClaimTxPending || seasonClaimCallsPending;

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
        setSeasonMsg(
          rewards.length > 1
            ? `${ru ? "Награды получены" : "Rewards claimed"}: ${rewardSummary}${rewardTail}`
            : `${tr.shop_reward_claimed}: ${rewardSummary}`
        );
        notifyPlayerDataRefresh();
        await refreshSeason();
      })
      .catch((err) => {
        setSeasonMsg(err instanceof Error ? err.message : tr.shop_claim_failed);
      })
      .finally(() => setClaimingSeasonLevels([]));
  }, [
    address,
    applyOptimisticSeasonClaim,
    lang,
    refreshSeason,
    ru,
    seasonClaimOnchainSuccess,
    tr.shop_claim_failed,
    tr.shop_reward_claimed,
  ]);

  useEffect(() => {
    if (!seasonClaimTxError || claimingSeasonLevels.length === 0) return;
    const raw = seasonClaimTxError.message || tr.shop_claim_failed;
    const short = raw.includes("User rejected") || raw.includes("user rejected")
      ? tr.tx_rejected
      : raw.slice(0, 120);
    setSeasonMsg(short);
    setClaimingSeasonLevels([]);
    seasonClaimLevelsRef.current = [];
    seasonClaimHandledRef.current = true;
  }, [seasonClaimTxError, claimingSeasonLevels.length, tr.shop_claim_failed, tr.tx_rejected]);

  const handleClaimSeasonLevels = async (levels: number[]) => {
    const claimLevels = Array.from(new Set(levels)).sort((a, b) => a - b);
    if (!address || claimingSeasonLevels.length > 0 || seasonClaimPending) return;
    if (claimLevels.length === 0) {
      setSeasonMsg(ru ? "Нет готовых наград" : "No rewards ready");
      return;
    }
    if (SEABATTLE_CONTRACT_ADDRESS === ZERO_ADDR) {
      setSeasonMsg(tr.contract_not_deployed);
      return;
    }

    setClaimingSeasonLevels(claimLevels);
    setSeasonMsg("");
    setSeasonClaimFallbackMined(false);
    resetSeasonClaimTx();

    try {
      await validateSeasonLevelClaims(address, claimLevels);
    } catch (err) {
      setSeasonMsg(err instanceof Error ? err.message : tr.shop_claim_failed);
      setClaimingSeasonLevels([]);
      seasonClaimLevelsRef.current = [];
      seasonClaimHandledRef.current = true;
      return;
    }

    seasonClaimLevelsRef.current = claimLevels;
    seasonClaimHandledRef.current = false;
    const sentinel = seasonClaimSentinelAddress(claimLevels[claimLevels.length - 1]);

    try {
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
    } catch (err) {
      setSeasonMsg(err instanceof Error ? err.message : tr.shop_claim_failed);
      setClaimingSeasonLevels([]);
      seasonClaimLevelsRef.current = [];
      seasonClaimHandledRef.current = true;
    }
  };

  const previewLevels = useMemo(
    () =>
      SEASON_LEVELS.map((level) => ({
        ...level,
        claimed: false,
        claimable: false,
      })),
    []
  );
  const seasonLevels = season?.levels ?? previewLevels;
  const currentSeasonLevel = Math.min(season?.level ?? 0, SEASON_MAX_LEVEL);
  const currentSeasonXp = season?.xp ?? 0;
  const nextSeasonXp = season?.nextLevelXp ?? null;
  const nextSeasonLevel = Math.min(currentSeasonLevel + 1, SEASON_MAX_LEVEL);
  const seasonXpToNext = nextSeasonXp ? Math.max(0, nextSeasonXp - currentSeasonXp) : 0;
  const seasonProgressPct = nextSeasonXp
    ? Math.min(100, (currentSeasonXp / nextSeasonXp) * 100)
    : currentSeasonLevel >= SEASON_MAX_LEVEL
      ? 100
      : 0;
  const claimableSeasonLevelNumbers = seasonLevels
    .filter((level) => level.claimable)
    .map((level) => level.level);
  const readySeasonRewards = claimableSeasonLevelNumbers.length;
  const claimedSeasonRewards = seasonLevels.filter((level) => level.claimed).length;
  const claimingLevel = claimingSeasonLevels.length === 1 ? claimingSeasonLevels[0] : null;
  const seasonClaimBusy = claimingSeasonLevels.length > 0 || seasonClaimPending;
  const dropReady = countdown.remainingMs <= 0;
  const connectPending = connectStatus === "pending";

  const claimAllLabel = seasonClaimBusy
    ? seasonClaimPending
      ? tr.shop_bomb_pending
      : tr.shop_claiming
    : ru
      ? "Получить все"
      : "Claim all";
  const dropButtonLabel = dropReady
    ? ru
      ? "Клейм USDC дропа открыт"
      : "USDC claim is open"
    : ru
      ? `Клейм через ${countdown.label}`
      : `Claim opens in ${countdown.label}`;

  return (
    <main className={styles.container}>
      <SettingsPanel />
      <header className={styles.header}>
        <Link className={styles.back} href="/">
          <ChevronRightIcon className={styles.backIcon} size={15} />
          <span>{tr.back}</span>
        </Link>
        <div className={styles.titleBlock}>
          <span>{ru ? "Сезон S1" : "Season S1"}</span>
          <h1>{ru ? "Награды сезона" : "Season Rewards"}</h1>
          <p>
            {ru
              ? "Пул USDC, таймер до дропа и Battle Pass награды в одном месте."
              : "USDC pool, drop countdown, and Battle Pass claims in one place."}
          </p>
        </div>
      </header>

      <section className={styles.heroGrid}>
        <div className={styles.poolSlot}>
          <SeasonPoolCard
            variant="wide"
            address={address}
            showEstimate={!!address}
            clickable={false}
          />
        </div>

        {USDC_SEASON_REWARDS_ENABLED && (
          dropReady && address ? (
            <DropClaimPanel address={address} />
          ) : (
            <section className={styles.dropGate}>
              <div className={styles.dropHead}>
                <span>{ru ? "USDC дроп" : "USDC drop"}</span>
                <b>Jul 18, 2026 · 00:00 UTC</b>
              </div>
              <button className={styles.dropButton} type="button" disabled={!dropReady}>
                <TrophyIcon size={16} />
                <span>{dropButtonLabel}</span>
              </button>
              <p>
                {dropReady
                  ? ru
                    ? "Подключи кошелек, чтобы проверить claim."
                    : "Connect a wallet to check your claim."
                  : ru
                    ? "После снапшота здесь появится claim USDC для подходящих кошельков."
                    : "After the snapshot, eligible wallets will claim USDC here."}
              </p>
            </section>
          )
        )}
      </section>

      {!isConnected && (
        <section className={styles.connectPanel}>
          <div>
            <span>{ru ? "Кошелек" : "Wallet"}</span>
            <b>{ru ? "Подключи, чтобы клеймить" : "Connect to claim"}</b>
          </div>
          <div className={styles.connectorList}>
            {orderedConnectors.map((connector) => {
              const pending = connectPending && connectingConnectorId === connector.id;
              return (
                <button
                  key={connector.id}
                  type="button"
                  onClick={() => {
                    setConnectingConnectorId(connector.id);
                    connect({ connector });
                  }}
                  disabled={connectPending}
                >
                  <span>{connector.name}</span>
                  <small>{pending ? (ru ? "Открываем..." : "Opening...") : isBaseAccountConnector(connector) ? "Base" : "Wallet"}</small>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section className={styles.rewards}>
        <div className={styles.rewardsTop}>
          <div>
            <span>{ru ? "Battle Pass" : "Battle Pass"}</span>
            <h2>{ru ? "Награды за уровни" : "Level rewards"}</h2>
          </div>
          <div className={styles.levelPill}>
            {tr.shop_level} {currentSeasonLevel}/{SEASON_MAX_LEVEL}
          </div>
        </div>

        <div className={styles.progressPanel}>
          <div className={styles.progressTop}>
            <span>
              {nextSeasonXp
                ? `${currentSeasonXp.toLocaleString()} / ${nextSeasonXp.toLocaleString()} ${tr.shop_xp}`
                : `${currentSeasonXp.toLocaleString()} ${tr.shop_xp}`}
            </span>
            <span>
              {nextSeasonXp
                ? `${seasonXpToNext.toLocaleString()} ${tr.shop_xp_to_level} ${nextSeasonLevel}`
                : ru ? "Сезон закрыт" : "Season complete"}
            </span>
          </div>
          <div className={styles.progressBar}>
            <span style={{ width: `${seasonProgressPct}%` }} />
          </div>
        </div>

        <div className={styles.claimStrip}>
          <div>
            <span>{ru ? "Статус наград" : "Reward status"}</span>
            <strong>
              {claimedSeasonRewards}/{SEASON_MAX_LEVEL} {tr.shop_claimed}
              {readySeasonRewards > 0 ? ` · ${readySeasonRewards} ${tr.quests_ready}` : ""}
            </strong>
          </div>
          <button
            className={styles.claimAll}
            type="button"
            onClick={() => handleClaimSeasonLevels(claimableSeasonLevelNumbers)}
            disabled={!isConnected || readySeasonRewards === 0 || seasonClaimBusy}
          >
            <TrophyIcon size={15} />
            <span>{claimAllLabel}</span>
          </button>
        </div>

        {seasonLoading && <p className={styles.status}>{ru ? "Загружаем сезон..." : "Loading season..."}</p>}
        {seasonError && <p className={`${styles.status} ${styles.error}`}>{seasonError}</p>}
        {seasonMsg && <p className={styles.status}>{seasonMsg}</p>}

        <div className={styles.levels}>
          {seasonLevels.map((level) => {
            const rewardKind: ItemArtKind =
              level.reward.kind === "item" ? level.reward.slug : "points";
            const active = claimingLevel === level.level;
            return (
              <article
                key={level.level}
                className={`${styles.level} ${
                  level.claimed ? styles.claimed : level.claimable ? styles.ready : ""
                }`}
              >
                <div className={styles.levelMeta}>
                  <b>{tr.shop_level} {level.level}</b>
                  <span>{level.xpRequired.toLocaleString()} {tr.shop_xp}</span>
                </div>
                <div className={styles.levelReward}>
                  <span className={styles.artShell}>
                    <ItemArt kind={rewardKind} size="small" className={styles.rewardArt} />
                  </span>
                  <p>{rewardLabel(level.reward, lang)}</p>
                </div>
                {level.claimed ? (
                  <span className={styles.levelStatus}>
                    <CheckIcon size={13} />
                    {tr.shop_claimed}
                  </span>
                ) : level.claimable ? (
                  <button
                    className={styles.levelClaim}
                    type="button"
                    onClick={() => handleClaimSeasonLevels([level.level])}
                    disabled={!isConnected || seasonClaimBusy}
                  >
                    <TrophyIcon size={13} />
                    <span>
                      {active
                        ? seasonClaimPending
                          ? tr.shop_bomb_pending
                          : tr.shop_claiming
                        : tr.claim}
                    </span>
                  </button>
                ) : (
                  <span className={styles.levelStatus}>{ru ? "Закрыто" : "Locked"}</span>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}

function useCountdown(targetMs: number) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return useMemo(() => {
    const remainingMs = Math.max(0, targetMs - now);
    const totalSeconds = Math.floor(remainingMs / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const label = days > 0
      ? `${days}d ${hours}h ${minutes}m`
      : `${hours}h ${minutes}m ${seconds}s`;
    return { remainingMs, label };
  }, [now, targetMs]);
}

function isBaseAccountConnector(connector: { id: string; name: string }) {
  const id = connector.id.toLowerCase();
  const name = connector.name.toLowerCase();
  return id.includes("base") || name.includes("base account");
}
