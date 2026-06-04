"use client";

import { Suspense, useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useAccount,
  useCallsStatus,
  useCapabilities,
  useSendCalls,
  useWriteContract,
  useWaitForTransactionReceipt,
  useSwitchChain,
  useConfig,
} from "wagmi";
import {
  readContract,
  simulateContract,
  waitForTransactionReceipt as waitForReceipt,
} from "@wagmi/core";
import { base } from "wagmi/chains";
import { decodeEventLog, encodeFunctionData } from "viem";
import {
  seaBattleAbi,
  erc20Abi,
  SEABATTLE_CONTRACT_ADDRESS,
  USDC_ADDRESS,
} from "../contracts/seaBattleAbi";
import {
  AnchorIcon,
  ChevronRightIcon,
  DollarIcon,
  SwordIcon,
  UsersIcon,
} from "../components/Icons";
import { BUILDER_CODE_SUFFIX } from "../providers";
import {
  createOffchainGame,
  joinOffchainGame,
  getAvailableGames,
  getGameOnchainId,
  getGameJoinInfo,
  getUnclaimedWins,
  markPrizeClaimed,
  autoCloseStaleGames,
  getRefundableGames,
  getActiveWagerGames,
  markGameCancelled,
  ActiveWagerGame,
  UnclaimedWin,
  RefundableGame,
} from "../lib/offchainGame";
import { WalletName } from "../components/WalletName";
import PushPrompt from "../components/PushPrompt";
import { SettingsPanel } from "../components/SettingsPanel";
import { useSettings, TR } from "../lib/settings";
import baseStyles from "../page.module.css";
import localStyles from "./page.module.css";

const styles = { ...baseStyles, ...localStyles };

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const CONTRACT_NOT_SET = SEABATTLE_CONTRACT_ADDRESS === ZERO_ADDR;
const PAYMASTER_URL = process.env.NEXT_PUBLIC_PAYMASTER_URL;

function formatRevert(msg: string, lang: string = "en"): string {
  const ru = lang === "ru";
  const lower = msg.toLowerCase();
  if (lower.includes("user rejected") || lower.includes("user denied"))
    return ru ? "Транзакция отклонена. Попробуй ещё раз." : "Transaction rejected. Try again.";
  if (lower.includes("transfer amount exceeds balance"))
    return ru
      ? "Призовой пул пуст — похоже, соперник не внёс ставку. Напиши админу или скрой через ×."
      : "Prize pool is empty — opponent likely didn't stake. Contact admin or hide with ×.";
  if (lower.includes("429") || lower.includes("rate limit"))
    return ru ? "RPC временно ограничен. Повтори через несколько секунд." : "RPC rate-limited. Retry in a few seconds.";
  const reasonMatch = msg.match(/reason:\s*(.+?)(?:\n|$)/i);
  if (reasonMatch) return reasonMatch[1].trim();
  const revertMatch = msg.match(/revert(?:ed)?(?: with reason string)?\s*['"]?([^'"\n]+?)['"]?(?:\n|$)/i);
  if (revertMatch) return revertMatch[1].trim();
  return msg.slice(0, 140);
}

type GameMode = "bot" | "friend" | "wager";

const WAGER_OPTIONS = [
  { label: "1 USDC", value: 1_000_000 },
  { label: "5 USDC", value: 5_000_000 },
  { label: "10 USDC", value: 10_000_000 },
];
const MIN_WAGER_USDC = 0.1;
const MAX_WAGER_USDC = 10_000;

function customWagerMicro(value: string) {
  const amount = Number(value.replace(",", "."));
  if (!Number.isFinite(amount) || amount < MIN_WAGER_USDC || amount > MAX_WAGER_USDC) return null;
  return Math.round(amount * 1_000_000);
}

function formatWager(amountMicro: number) {
  return `${(amountMicro / 1_000_000).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })} USDC`;
}

function dismissedRefundsKey(wallet: string) {
  return `seabattle_dismissed_refunds_${wallet.toLowerCase()}`;
}

type DisplayRefundableGame = RefundableGame & {
  refundKind: "unjoined" | "joined";
};

const PLAY_COPY = {
  en: {
    botKicker: "Solo drill",
    friendKicker: "Friend room",
    wagerKicker: "Wager ops",
    createKicker: "Create battle",
    joinKicker: "Join battle",
    lockWager: "Lock stake and deploy",
    openRoom: "Open a room",
    free: "FREE",
    entry: "Entry",
    stake: "Stake",
    network: "Network",
    prizePool: "Prize",
    publicHint: "Visible in open rooms",
    privateHint: "Only captains with ID can join",
    walletKicker: "Wallet required",
    walletHint: "Connect your wallet on the main screen, then return to deploy your fleet.",
    approveUsdc: "Approve USDC...",
    sendUsdc: "Send USDC",
    confirmWallet: "Confirm in wallet...",
    confirming: "Confirming...",
    creating: "Creating...",
    finalizing: "Finalizing...",
    checking: "Checking...",
    refunding: "Refunding...",
    confirmFirst: "Confirm 1/2...",
    confirmSecond: "Confirm 2/2...",
    claiming: "Claiming...",
    gameLabel: "Game",
    hideRecord: "Hide this record",
    hideClaimedRecord: "Hide this record (if already claimed)",
    contractWarning: "Contract not deployed yet. Set NEXT_PUBLIC_SEABATTLE_CONTRACT_ADDRESS in .env",
    wagerAmount: "Wager amount",
    customWager: "Custom stake",
    customWagerHint: "From 0.1 to 10,000 USDC",
    invalidWager: "Enter a stake from 0.1 to 10,000 USDC",
    validGameId: "Enter a valid game ID",
    offchainCreateFailed: "Failed to create offchain game",
    onchainIdMissing: "Onchain game ID not found",
    gameNotFound: "Game not found",
    notWagerGame: "This is not a wager game",
    ownGame: "Cannot join your own game",
    gameHasPlayer: "Game already has another player",
    gameFinished: "Game already finished onchain",
    readGameFailed: "Failed to read game state",
    cannotFinalize: "Cannot finalize: ",
    cannotClaim: "Cannot claim: ",
    alreadyClaimedOnchain: "Already claimed onchain. Use × to hide this record.",
    activeWagers: "Your active wager battles",
    reconnect: "Reconnect",
    waitingOpponent: "Waiting for opponent",
    placingShips: "Fleet placement",
    battleActive: "Battle active",
    joinedRefund: "Timed-out battle",
  },
  ru: {
    botKicker: "Тренировка соло",
    friendKicker: "Комната друга",
    wagerKicker: "Бой со ставкой",
    createKicker: "Создать бой",
    joinKicker: "Войти в бой",
    lockWager: "Зафиксировать ставку",
    openRoom: "Открыть комнату",
    free: "БЕСПЛАТНО",
    entry: "Вход",
    stake: "Ставка",
    network: "Сеть",
    prizePool: "Приз",
    publicHint: "Видно в открытых комнатах",
    privateHint: "Вход только по ID",
    walletKicker: "Нужен кошелёк",
    walletHint: "Подключи кошелёк на главном экране, затем возвращайся развернуть флот.",
    approveUsdc: "Одобряем USDC...",
    sendUsdc: "Отправить USDC",
    confirmWallet: "Подтверди в кошельке...",
    confirming: "Подтверждаем...",
    creating: "Создаём...",
    finalizing: "Финализируем...",
    checking: "Проверяем...",
    refunding: "Возвращаем...",
    confirmFirst: "Подтверди 1/2...",
    confirmSecond: "Подтверди 2/2...",
    claiming: "Получаем...",
    gameLabel: "Игра",
    hideRecord: "Скрыть запись",
    hideClaimedRecord: "Скрыть запись (если уже получено)",
    contractWarning: "Контракт ещё не задеплоен. Укажи NEXT_PUBLIC_SEABATTLE_CONTRACT_ADDRESS в .env",
    wagerAmount: "Размер ставки",
    customWager: "Своя ставка",
    customWagerHint: "От 0.1 до 10 000 USDC",
    invalidWager: "Введи ставку от 0.1 до 10 000 USDC",
    validGameId: "Введи корректный ID игры",
    offchainCreateFailed: "Не удалось создать offchain-игру",
    onchainIdMissing: "Onchain ID игры не найден",
    gameNotFound: "Игра не найдена",
    notWagerGame: "Это не игра со ставкой",
    ownGame: "Нельзя войти в свою игру",
    gameHasPlayer: "В игре уже есть другой игрок",
    gameFinished: "Игра уже завершена onchain",
    readGameFailed: "Не удалось прочитать состояние игры",
    cannotFinalize: "Не удалось финализировать: ",
    cannotClaim: "Не удалось получить: ",
    alreadyClaimedOnchain: "Уже получено onchain. Нажми ×, чтобы скрыть запись.",
    activeWagers: "Твои активные бои со ставкой",
    reconnect: "Вернуться",
    waitingOpponent: "Ждём соперника",
    placingShips: "Расстановка флота",
    battleActive: "Бой идёт",
    joinedRefund: "Бой просрочен",
  },
};

export default function PlayPage() {
  return (
    <Suspense fallback={<div className={styles.container} />}>
      <PlayPageInner />
    </Suspense>
  );
}

function PlayPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialMode = (() => {
    const m = searchParams.get("mode");
    return m === "friend" || m === "wager" || m === "bot" ? m : "bot";
  })();
  const { address, isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const { lang } = useSettings();
  const tr = TR[lang];
  const playCopy = PLAY_COPY[lang === "ru" ? "ru" : "en"];
  const wagmiConfig = useConfig();
  const { data: capabilities } = useCapabilities({ chainId: base.id });
  const paymasterSupported =
    !!PAYMASTER_URL && !!capabilities?.paymasterService?.supported;

  const [joinGameId, setJoinGameId] = useState("");
  const [error, setError] = useState("");
  const [action, setAction] = useState<"create" | "join" | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const mode = initialMode;
  const [offchainLoading, setOffchainLoading] = useState(false);
  const [offchainGames, setOffchainGames] = useState<{ id: number; player1: string; game_mode: string; wager_amount: number }[]>([]);
  const [wagerAmount, setWagerAmount] = useState(WAGER_OPTIONS[0].value);
  const [customWager, setCustomWager] = useState("1");
  const [unclaimedWins, setUnclaimedWins] = useState<UnclaimedWin[]>([]);
  const [claimingId, setClaimingId] = useState<number | null>(null);
  const [claimStep, setClaimStep] = useState<"idle" | "recording" | "claiming">("idle");
  const [claimErr, setClaimErr] = useState("");
  const [refundableGames, setRefundableGames] = useState<DisplayRefundableGame[]>([]);
  const [activeWagerGames, setActiveWagerGames] = useState<ActiveWagerGame[]>([]);
  const [dismissedRefundIds, setDismissedRefundIds] = useState<Set<number>>(() => new Set());
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [cancelErr, setCancelErr] = useState("");

  // Auto-switch chain
  useEffect(() => {
    if (isConnected && chainId && chainId !== base.id) {
      switchChain({ chainId: base.id });
    }
  }, [isConnected, chainId, switchChain]);

  // Onchain write (wager)
  const {
    data: txHash,
    isPending,
    writeContract,
    error: writeError,
    reset: resetWagerWrite,
  } = useWriteContract();
  const { isLoading: isConfirming, data: receipt } =
    useWaitForTransactionReceipt({ hash: txHash });
  const [wagerReceiptFallback, setWagerReceiptFallback] = useState<typeof receipt | null>(null);
  const wagerReceipt = receipt ?? wagerReceiptFallback;
  const {
    sendCalls: sendWagerCalls,
    isPending: wagerCallsPending,
    error: wagerCallsError,
  } = useSendCalls();

  // USDC approve for wager
  const {
    data: approveTxHash,
    isPending: approvePending,
    writeContract: writeApprove,
    error: approveError,
    reset: resetApprove,
  } = useWriteContract();
  const { data: approveReceipt } = useWaitForTransactionReceipt({
    hash: approveTxHash,
  });
  const [approveFallbackMined, setApproveFallbackMined] = useState(false);
  const approveSuccess = approveReceipt?.status === "success" || approveFallbackMined;

  useEffect(() => {
    setWagerReceiptFallback(null);
    if (!txHash) return;
    let cancelled = false;
    waitForReceipt(wagmiConfig, { hash: txHash })
      .then((nextReceipt) => {
        if (!cancelled) setWagerReceiptFallback(nextReceipt as typeof receipt);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [txHash, wagmiConfig]);

  useEffect(() => {
    setApproveFallbackMined(false);
    if (!approveTxHash) return;
    let cancelled = false;
    waitForReceipt(wagmiConfig, { hash: approveTxHash })
      .then((nextReceipt) => {
        if (!cancelled && nextReceipt.status === "success") setApproveFallbackMined(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [approveTxHash, wagmiConfig]);

  // Claim prize
  const {
    data: claimTxHash,
    writeContract: writeClaim,
    isPending: claimPending,
    error: claimWriteError,
    reset: resetClaim,
  } = useWriteContract();
  const { data: claimReceipt } = useWaitForTransactionReceipt({
    hash: claimTxHash,
  });
  const {
    sendCalls: sendClaimCalls,
    data: claimCallsData,
    isPending: claimCallsPending,
    error: claimCallsError,
  } = useSendCalls();
  const { data: claimCallsStatus } = useCallsStatus({
    id: claimCallsData?.id ?? "",
    query: {
      enabled: !!claimCallsData?.id,
      refetchInterval: ({ state }) =>
        state.data?.status === "success" ? false : 1_000,
    },
  });
  const claimCallsBaselineRef = useRef<string | null>(null);
  const sponsoredClaimConfirmed =
    !!claimCallsData?.id &&
    claimCallsData.id !== claimCallsBaselineRef.current &&
    claimCallsStatus?.status === "success";
  const claimConfirmed =
    claimReceipt?.status === "success" || sponsoredClaimConfirmed;

  // Record result
  const {
    data: recordTxHash,
    writeContract: writeRecord,
    isPending: recordPending,
    error: recordWriteError,
    reset: resetRecord,
  } = useWriteContract();
  const { data: recordReceipt } = useWaitForTransactionReceipt({
    hash: recordTxHash,
  });
  const recordConfirmed = recordReceipt?.status === "success";

  // Cancel wager
  const {
    data: cancelTxHash,
    writeContract: writeCancel,
    isPending: cancelPending,
    error: cancelWriteError,
    reset: resetCancel,
  } = useWriteContract();
  const { data: cancelReceipt } = useWaitForTransactionReceipt({
    hash: cancelTxHash,
  });
  const {
    sendCalls: sendCancelCalls,
    data: cancelCallsData,
    isPending: cancelCallsPending,
    error: cancelCallsError,
  } = useSendCalls();
  const { data: cancelCallsStatus } = useCallsStatus({
    id: cancelCallsData?.id ?? "",
    query: {
      enabled: !!cancelCallsData?.id,
      refetchInterval: ({ state }) =>
        state.data?.status === "success" ? false : 1_000,
    },
  });
  const cancelCallsBaselineRef = useRef<string | null>(null);
  const sponsoredCancelConfirmed =
    !!cancelCallsData?.id &&
    cancelCallsData.id !== cancelCallsBaselineRef.current &&
    cancelCallsStatus?.status === "success";
  const cancelConfirmed =
    cancelReceipt?.status === "success" || sponsoredCancelConfirmed;

  // Pending action routing
  const wagerActionRef = useRef<{
    action: "create" | "join";
    amount: number;
    joinId?: string;
    sponsorApprove?: boolean;
  } | null>(null);
  const wagerWriteSubmittedRef = useRef(false);
  const wagerExpectedOnchainIdRef = useRef<bigint | null>(null);
  const wagerCompletionStartedRef = useRef(false);
  const [wagerRecoveryNonce, setWagerRecoveryNonce] = useState(0);
  const [wagerSecondStepReady, setWagerSecondStepReady] = useState(false);

  const pendingAction = useRef<{
    action: "create" | "join";
    mode: GameMode;
    joinId?: string;
    wager?: number;
  } | null>(null);

  const finishWagerAction = useCallback(async (
    pa: {
      action: "create" | "join";
      mode: GameMode;
      joinId?: string;
      wager?: number;
    },
    onchainId?: bigint
  ) => {
    if (wagerCompletionStartedRef.current) return;
    wagerCompletionStartedRef.current = true;
    pendingAction.current = null;
    wagerActionRef.current = null;
    wagerWriteSubmittedRef.current = false;
    setWagerSecondStepReady(false);

    if (pa.action === "create") {
      const finalOnchainId = onchainId ?? wagerExpectedOnchainIdRef.current;
      if (finalOnchainId == null) {
        wagerCompletionStartedRef.current = false;
        setError(playCopy.onchainIdMissing);
        return;
      }

      try {
        const offId = await createOffchainGame(address!, isPrivate, {
          game_mode: "wager",
          onchain_game_id: Number(finalOnchainId),
          wager_amount: pa.wager,
        });
        router.push(`/game?id=${offId}&mode=wager&oid=${finalOnchainId.toString()}`);
      } catch {
        setError(playCopy.offchainCreateFailed);
      }
      return;
    }

    const gid = Number(pa.joinId);
    joinOffchainGame(gid, address!)
      .catch(() => {})
      .finally(() => {
        const finalOnchainId = onchainId ?? wagerExpectedOnchainIdRef.current;
        if (finalOnchainId != null) {
          router.push(`/game?id=${pa.joinId}&mode=wager&oid=${finalOnchainId.toString()}`);
          return;
        }
        getGameOnchainId(gid).then((oid) => {
          router.push(`/game?id=${pa.joinId}&mode=wager&oid=${oid || pa.joinId}`);
        });
      });
  }, [
    address,
    isPrivate,
    playCopy.offchainCreateFailed,
    playCopy.onchainIdMissing,
    router,
  ]);

  useEffect(() => {
    if (!approveTxHash || !address || approveSuccess) return;
    let cancelled = false;

    const checkAllowance = async () => {
      const pendingWager = wagerActionRef.current;
      if (!pendingWager) return;

      try {
        const allowance = await readContract(wagmiConfig, {
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, SEABATTLE_CONTRACT_ADDRESS],
          chainId: base.id,
        });
        if (!cancelled && allowance >= BigInt(pendingWager.amount)) {
          setApproveFallbackMined(true);
        }
      } catch {
        // Mobile wallet receipt polling can lag; keep polling allowance quietly.
      }
    };

    checkAllowance();
    const interval = window.setInterval(checkAllowance, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [approveTxHash, address, approveSuccess, wagmiConfig]);

  useEffect(() => {
    const txError = writeError || wagerCallsError;
    if (txError) {
      const msg = txError.message || "Transaction failed";
      const reasonMatch = msg.match(/reason:\s*(.+?)(?:\n|$)/);
      setError(reasonMatch ? reasonMatch[1] : msg.slice(0, 150));
      if (pendingAction.current?.mode === "wager") {
        pendingAction.current = null;
        wagerWriteSubmittedRef.current = false;
        wagerExpectedOnchainIdRef.current = null;
        wagerCompletionStartedRef.current = false;
        setWagerSecondStepReady(!!wagerActionRef.current && approveSuccess);
      }
    }
  }, [writeError, wagerCallsError, approveSuccess]);

  useEffect(() => {
    if (
      !wagerReceipt ||
      wagerReceipt.status !== "success" ||
      !pendingAction.current ||
      wagerCompletionStartedRef.current
    ) return;
    const pa = pendingAction.current;

    if (pa.mode === "wager") {
      if (pa.action === "create") {
        for (const log of wagerReceipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: seaBattleAbi,
              data: log.data,
              topics: log.topics,
            });
            if (decoded.eventName === "GameCreated") {
              const onchainId = (decoded.args as { gameId: bigint }).gameId;
              finishWagerAction(pa, onchainId);
              return;
            }
          } catch { /* not our event */ }
        }
        if (wagerExpectedOnchainIdRef.current != null) {
          finishWagerAction(pa, wagerExpectedOnchainIdRef.current);
        }
      } else if (pa.action === "join") {
        finishWagerAction(pa, wagerExpectedOnchainIdRef.current ?? undefined);
      }
      return;
    }
  }, [wagerReceipt, finishWagerAction]);

  useEffect(() => {
    if (!wagerReceipt || wagerReceipt.status !== "reverted" || pendingAction.current?.mode !== "wager") return;
    pendingAction.current = null;
    wagerWriteSubmittedRef.current = false;
    wagerExpectedOnchainIdRef.current = null;
    wagerCompletionStartedRef.current = false;
    setWagerSecondStepReady(!!wagerActionRef.current && approveSuccess);
    setError("Transaction reverted");
  }, [wagerReceipt, approveSuccess]);

  useEffect(() => {
    if (!address || !wagerWriteSubmittedRef.current || wagerCompletionStartedRef.current) return;
    let cancelled = false;
    const me = address.toLowerCase();

    const checkOnchainWagerState = async () => {
      const pa = pendingAction.current;
      if (!pa || pa.mode !== "wager" || wagerCompletionStartedRef.current) return;

      try {
        if (pa.action === "create") {
          const expectedId = wagerExpectedOnchainIdRef.current;
          if (expectedId == null) return;

          const onchainGame = await readContract(wagmiConfig, {
            address: SEABATTLE_CONTRACT_ADDRESS,
            abi: seaBattleAbi,
            functionName: "getGame",
            args: [expectedId],
            chainId: base.id,
          }) as readonly [
            `0x${string}`, `0x${string}`, number, bigint, boolean, `0x${string}`, boolean
          ];
          const [player1, , gameType, wagerAmountOnchain] = onchainGame;

          if (
            !cancelled &&
            gameType === 2 &&
            player1.toLowerCase() === me &&
            wagerAmountOnchain === BigInt(pa.wager ?? 0)
          ) {
            finishWagerAction(pa, expectedId);
          }
          return;
        }

        const expectedId =
          wagerExpectedOnchainIdRef.current ??
          (pa.joinId ? BigInt(await getGameOnchainId(Number(pa.joinId)) || 0) : BigInt(0));
        if (expectedId === BigInt(0)) return;

        const onchainGame = await readContract(wagmiConfig, {
          address: SEABATTLE_CONTRACT_ADDRESS,
          abi: seaBattleAbi,
          functionName: "getGame",
          args: [expectedId],
          chainId: base.id,
        }) as readonly [
          `0x${string}`, `0x${string}`, number, bigint, boolean, `0x${string}`, boolean
        ];
        const player2 = onchainGame[1];

        if (!cancelled && player2.toLowerCase() === me) {
          finishWagerAction(pa, expectedId);
        }
      } catch {
        // Keep polling; mobile wallet receipt delivery can lag behind chain state.
      }
    };

    checkOnchainWagerState();
    const interval = window.setInterval(checkOnchainWagerState, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [address, finishWagerAction, wagerRecoveryNonce, wagmiConfig]);

  const submitWagerWrite = useCallback(async () => {
    const wa = wagerActionRef.current;
    if (!wa || wagerWriteSubmittedRef.current) return;

    setError("");
    setWagerSecondStepReady(false);
    wagerWriteSubmittedRef.current = true;
    wagerCompletionStartedRef.current = false;
    wagerExpectedOnchainIdRef.current = null;
    resetWagerWrite();
    setWagerReceiptFallback(null);

    try {
      if (wa.action === "create") {
        try {
          wagerExpectedOnchainIdRef.current = await readContract(wagmiConfig, {
            address: SEABATTLE_CONTRACT_ADDRESS,
            abi: seaBattleAbi,
            functionName: "nextGameId",
            chainId: base.id,
          }) as bigint;
        } catch {
          // Receipt handling can still finish the flow if this read is unavailable.
        }
        pendingAction.current = { action: "create", mode: "wager", wager: wa.amount };
        setWagerRecoveryNonce((nonce) => nonce + 1);
        if (paymasterSupported && PAYMASTER_URL) {
          const calls = [];
          if (wa.sponsorApprove) {
            calls.push({
              to: USDC_ADDRESS,
              data: encodeFunctionData({
                abi: erc20Abi,
                functionName: "approve",
                args: [SEABATTLE_CONTRACT_ADDRESS, BigInt(wa.amount)],
              }),
            });
          }
          calls.push({
            to: SEABATTLE_CONTRACT_ADDRESS,
            data: encodeFunctionData({
              abi: seaBattleAbi,
              functionName: "createWagerGame",
              args: [BigInt(wa.amount)],
            }),
          });
          sendWagerCalls({
            calls,
            capabilities: { paymasterService: { url: PAYMASTER_URL } },
          });
        } else {
          writeContract({
            address: SEABATTLE_CONTRACT_ADDRESS,
            abi: seaBattleAbi,
            functionName: "createWagerGame",
            args: [BigInt(wa.amount)],
            chainId: base.id,
            dataSuffix: BUILDER_CODE_SUFFIX,
          });
        }
        return;
      }

      const oid = await getGameOnchainId(Number(wa.joinId!));
      if (!oid) {
        pendingAction.current = null;
        wagerWriteSubmittedRef.current = false;
        wagerExpectedOnchainIdRef.current = null;
        wagerCompletionStartedRef.current = false;
        setWagerSecondStepReady(true);
        setError(playCopy.onchainIdMissing);
        return;
      }

      wagerExpectedOnchainIdRef.current = BigInt(oid);
      pendingAction.current = { action: "join", mode: "wager", joinId: wa.joinId };
      setWagerRecoveryNonce((nonce) => nonce + 1);
      if (paymasterSupported && PAYMASTER_URL) {
        const calls = [];
        if (wa.sponsorApprove) {
          calls.push({
            to: USDC_ADDRESS,
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: "approve",
              args: [SEABATTLE_CONTRACT_ADDRESS, BigInt(wa.amount)],
            }),
          });
        }
        calls.push({
          to: SEABATTLE_CONTRACT_ADDRESS,
          data: encodeFunctionData({
            abi: seaBattleAbi,
            functionName: "joinWagerGame",
            args: [BigInt(oid)],
          }),
        });
        sendWagerCalls({
          calls,
          capabilities: { paymasterService: { url: PAYMASTER_URL } },
        });
      } else {
        writeContract({
          address: SEABATTLE_CONTRACT_ADDRESS,
          abi: seaBattleAbi,
          functionName: "joinWagerGame",
          args: [BigInt(oid)],
          chainId: base.id,
          dataSuffix: BUILDER_CODE_SUFFIX,
        });
      }
    } catch (e: unknown) {
      pendingAction.current = null;
      wagerWriteSubmittedRef.current = false;
      wagerExpectedOnchainIdRef.current = null;
      wagerCompletionStartedRef.current = false;
      setWagerSecondStepReady(true);
      setError((e as Error).message?.slice(0, 150) || "Transaction failed");
    }
  }, [
    paymasterSupported,
    playCopy.onchainIdMissing,
    resetWagerWrite,
    sendWagerCalls,
    wagmiConfig,
    writeContract,
  ]);

  useEffect(() => {
    if (!approveSuccess || !wagerActionRef.current || wagerWriteSubmittedRef.current) return;
    setWagerSecondStepReady(true);
  }, [approveSuccess]);

  useEffect(() => {
    if (!approveError || !wagerActionRef.current) return;
    setError(formatRevert(approveError.message || "Approval failed", lang));
    wagerActionRef.current = null;
    wagerWriteSubmittedRef.current = false;
    setWagerSecondStepReady(false);
  }, [approveError, lang]);

  useEffect(() => {
    if (!approveReceipt || approveReceipt.status !== "reverted" || !wagerActionRef.current) return;
    setError("Approval failed");
    wagerActionRef.current = null;
    wagerWriteSubmittedRef.current = false;
    setWagerSecondStepReady(false);
  }, [approveReceipt]);

  // Unclaimed wins
  const loadUnclaimedWins = useCallback(async () => {
    if (!address) return;
    const wins = await getUnclaimedWins(address);
    setUnclaimedWins(wins);
  }, [address]);

  const hideUnclaimedWin = useCallback(async (gameId: number) => {
    setUnclaimedWins((wins) => wins.filter((w) => w.id !== gameId));
    await markPrizeClaimed(gameId).catch(() => {});
  }, []);

  useEffect(() => {
    if (address) loadUnclaimedWins();
  }, [address, loadUnclaimedWins]);

  // Refundable games
  useEffect(() => {
    if (!address || typeof window === "undefined") {
      setDismissedRefundIds(new Set());
      return;
    }
    try {
      const raw = localStorage.getItem(dismissedRefundsKey(address));
      const ids = raw ? JSON.parse(raw) : [];
      setDismissedRefundIds(
        new Set(Array.isArray(ids) ? ids.filter((id) => Number.isFinite(id)) : [])
      );
    } catch {
      setDismissedRefundIds(new Set());
    }
  }, [address]);

  const rememberDismissedRefund = useCallback((gameId: number) => {
    setDismissedRefundIds((prev) => {
      const next = new Set(prev);
      next.add(gameId);
      if (address && typeof window !== "undefined") {
        localStorage.setItem(dismissedRefundsKey(address), JSON.stringify([...next]));
      }
      return next;
    });
    setRefundableGames((games) => games.filter((g) => g.id !== gameId));
  }, [address]);

  const cancellingRefundKindRef = useRef<DisplayRefundableGame["refundKind"] | null>(null);

  const loadWagerRooms = useCallback(async () => {
    if (!address || mode !== "wager") {
      setRefundableGames([]);
      setActiveWagerGames([]);
      return;
    }
    const [unjoined, active] = await Promise.all([
      getRefundableGames(address),
      getActiveWagerGames(address),
    ]);
    const me = address.toLowerCase();
    const joinedRefunds: DisplayRefundableGame[] = [];
    const resumable: ActiveWagerGame[] = [];

    await Promise.all(active.map(async (game) => {
      if (!game.player2 || game.onchain_game_id === null) {
        resumable.push(game);
        return;
      }

      try {
        const refundState = await readContract(wagmiConfig, {
          address: SEABATTLE_CONTRACT_ADDRESS,
          abi: seaBattleAbi,
          functionName: "getWagerRefundState",
          args: [BigInt(game.onchain_game_id)],
          chainId: base.id,
        }) as readonly [bigint, bigint, boolean, boolean, boolean];
        const [, joinedAt, refundClaimedP1, refundClaimedP2, cancelled] = refundState;
        const mineClaimed =
          game.player1.toLowerCase() === me ? refundClaimedP1 : refundClaimedP2;
        const refundReady =
          joinedAt > BigInt(0) &&
          Date.now() >= Number(joinedAt + BigInt(15 * 60)) * 1000;

        if (refundClaimedP1 && refundClaimedP2) {
          markGameCancelled(game.id).catch(() => {});
          return;
        }
        if (refundReady && !mineClaimed) {
          joinedRefunds.push({ ...game, refundKind: "joined" });
        }
        if (!cancelled) {
          resumable.push(game);
        }
      } catch {
        // V6 rooms do not expose timeout state. Keep reconnect available.
        resumable.push(game);
      }
    }));

    setActiveWagerGames(resumable);
    setRefundableGames([
      ...unjoined.map((game) => ({ ...game, refundKind: "unjoined" as const })),
      ...joinedRefunds,
    ]);
  }, [address, mode, wagmiConfig]);

  useEffect(() => {
    autoCloseStaleGames().catch(() => {});
    loadWagerRooms();
    const interval = window.setInterval(loadWagerRooms, 10000);
    return () => window.clearInterval(interval);
  }, [loadWagerRooms]);

  useEffect(() => {
    if (cancelConfirmed && cancellingId !== null) {
      rememberDismissedRefund(cancellingId);
      if (cancellingRefundKindRef.current === "unjoined") {
        markGameCancelled(cancellingId).catch(() => {});
      }
      setCancellingId(null);
      setCancelErr("");
      cancellingRefundKindRef.current = null;
      resetCancel();
      loadWagerRooms();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelConfirmed, cancellingId]);

  useEffect(() => {
    const refundError = cancelWriteError || cancelCallsError;
    if (refundError && cancellingId !== null) {
      const msg = refundError.message || "Refund failed";
      setCancelErr(formatRevert(msg, lang));
      setCancellingId(null);
      cancellingRefundKindRef.current = null;
    }
  }, [cancelWriteError, cancelCallsError, cancellingId, lang]);

  const handleRefund = useCallback((g: DisplayRefundableGame) => {
    if (g.onchain_game_id === null) return;
    setCancelErr("");
    resetCancel();
    setCancellingId(g.id);
    cancellingRefundKindRef.current = g.refundKind;
    cancelCallsBaselineRef.current = cancelCallsData?.id ?? null;
    if (paymasterSupported && PAYMASTER_URL) {
      const data = g.refundKind === "joined"
        ? encodeFunctionData({
            abi: seaBattleAbi,
            functionName: "claimStaleWagerRefund",
            args: [BigInt(g.onchain_game_id)],
          })
        : encodeFunctionData({
            abi: seaBattleAbi,
            functionName: "cancelWagerGame",
            args: [BigInt(g.onchain_game_id)],
          });
      sendCancelCalls({
        calls: [{ to: SEABATTLE_CONTRACT_ADDRESS, data }],
        capabilities: { paymasterService: { url: PAYMASTER_URL } },
      });
      return;
    }
    writeCancel({
      address: SEABATTLE_CONTRACT_ADDRESS,
      abi: seaBattleAbi,
      functionName: g.refundKind === "joined" ? "claimStaleWagerRefund" : "cancelWagerGame",
      args: [BigInt(g.onchain_game_id)],
      chainId: base.id,
      dataSuffix: BUILDER_CODE_SUFFIX,
    });
  }, [
    cancelCallsData?.id,
    paymasterSupported,
    resetCancel,
    sendCancelCalls,
    writeCancel,
  ]);

  const handleDismissRefund = useCallback(async (gameId: number) => {
    rememberDismissedRefund(gameId);
  }, [rememberDismissedRefund]);

  const handleReconnectWager = useCallback((game: ActiveWagerGame) => {
    if (game.onchain_game_id === null) return;
    router.push(`/game?id=${game.id}&mode=wager&oid=${game.onchain_game_id}`);
  }, [router]);

  const claimingOidRef = useRef<number | null>(null);

  useEffect(() => {
    if (recordConfirmed && claimStep === "recording" && claimingOidRef.current !== null) {
      setClaimStep("claiming");
      writeClaim({
        address: SEABATTLE_CONTRACT_ADDRESS,
        abi: seaBattleAbi,
        functionName: "claimPrize",
        args: [BigInt(claimingOidRef.current)],
        chainId: base.id,
        dataSuffix: BUILDER_CODE_SUFFIX,
      });
    }
  }, [recordConfirmed, claimStep, writeClaim]);

  useEffect(() => {
    if (claimConfirmed && claimingId !== null) {
      const claimedGameId = claimingId;
      hideUnclaimedWin(claimedGameId).then(loadUnclaimedWins).catch(() => {});
      setClaimingId(null);
      claimingOidRef.current = null;
      setClaimStep("idle");
      setClaimErr("");
      resetClaim();
      resetRecord();
    }
  }, [
    claimConfirmed,
    claimingId,
    hideUnclaimedWin,
    loadUnclaimedWins,
    resetClaim,
    resetRecord,
  ]);

  useEffect(() => {
    const prizeError = claimWriteError || claimCallsError;
    if (prizeError && claimingId !== null) {
      const msg = prizeError.message || tr.shop_claim_failed;
      setClaimErr(formatRevert(msg, lang));
      setClaimingId(null);
      claimingOidRef.current = null;
      setClaimStep("idle");
    }
  }, [claimWriteError, claimCallsError, claimingId, lang, tr.shop_claim_failed]);

  useEffect(() => {
    if (recordWriteError && claimingId !== null) {
      const msg = recordWriteError.message || playCopy.cannotFinalize;
      setClaimErr(formatRevert(msg, lang));
      setClaimingId(null);
      claimingOidRef.current = null;
      setClaimStep("idle");
    }
  }, [recordWriteError, claimingId, lang, playCopy.cannotFinalize]);

  const handleClaimWin = async (win: UnclaimedWin) => {
    if (!win.onchain_game_id || !address || claimPending || claimCallsPending || recordPending) return;
    setClaimErr("");
    resetClaim();
    resetRecord();
    setClaimingId(win.id);
    claimingOidRef.current = win.onchain_game_id;

    try {
      const info = await readContract(wagmiConfig, {
        address: SEABATTLE_CONTRACT_ADDRESS,
        abi: seaBattleAbi,
        functionName: "getGame",
        args: [BigInt(win.onchain_game_id)],
        chainId: base.id,
      });
      const [, , , wagerAmountOnchain, finished, onchainWinner] = info as readonly [
        `0x${string}`,
        `0x${string}`,
        number,
        bigint,
        boolean,
        `0x${string}`,
        boolean
      ];

      const required = (wagerAmountOnchain * BigInt(18)) / BigInt(10);
      const balance = await readContract(wagmiConfig, {
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [SEABATTLE_CONTRACT_ADDRESS],
        chainId: base.id,
      }) as bigint;
      if (balance < required) {
        await hideUnclaimedWin(win.id);
        setClaimErr("");
        setClaimingId(null);
        claimingOidRef.current = null;
        setClaimStep("idle");
        return;
      }

      if (!finished) {
        try {
          await simulateContract(wagmiConfig, {
            address: SEABATTLE_CONTRACT_ADDRESS,
            abi: seaBattleAbi,
            functionName: "recordResult",
            args: [BigInt(win.onchain_game_id), address as `0x${string}`],
            chainId: base.id,
            account: address as `0x${string}`,
          });
        } catch (simErr: unknown) {
          setClaimErr(playCopy.cannotFinalize + formatRevert((simErr as Error).message || "", lang));
          setClaimingId(null);
          claimingOidRef.current = null;
          setClaimStep("idle");
          return;
        }
        if (paymasterSupported && PAYMASTER_URL) {
          claimCallsBaselineRef.current = claimCallsData?.id ?? null;
          setClaimStep("claiming");
          sendClaimCalls({
            calls: [
              {
                to: SEABATTLE_CONTRACT_ADDRESS,
                data: encodeFunctionData({
                  abi: seaBattleAbi,
                  functionName: "recordResult",
                  args: [BigInt(win.onchain_game_id), address as `0x${string}`],
                }),
              },
              {
                to: SEABATTLE_CONTRACT_ADDRESS,
                data: encodeFunctionData({
                  abi: seaBattleAbi,
                  functionName: "claimPrize",
                  args: [BigInt(win.onchain_game_id)],
                }),
              },
            ],
            capabilities: { paymasterService: { url: PAYMASTER_URL } },
          });
          return;
        }

        setClaimStep("recording");
        writeRecord({
          address: SEABATTLE_CONTRACT_ADDRESS,
          abi: seaBattleAbi,
          functionName: "recordResult",
          args: [BigInt(win.onchain_game_id), address as `0x${string}`],
          chainId: base.id,
          dataSuffix: BUILDER_CODE_SUFFIX,
        });
        return;
      }

      if (onchainWinner.toLowerCase() !== address.toLowerCase()) {
        await hideUnclaimedWin(win.id);
        setClaimErr("");
        setClaimingId(null);
        claimingOidRef.current = null;
        setClaimStep("idle");
        return;
      }

      try {
        await simulateContract(wagmiConfig, {
          address: SEABATTLE_CONTRACT_ADDRESS,
          abi: seaBattleAbi,
          functionName: "claimPrize",
          args: [BigInt(win.onchain_game_id)],
          chainId: base.id,
          account: address as `0x${string}`,
        });
      } catch (simErr: unknown) {
        const reason = formatRevert((simErr as Error).message || "", lang);
        if (/already|claimed/i.test(reason)) {
          await hideUnclaimedWin(win.id);
          setClaimErr("");
        } else {
          setClaimErr(playCopy.cannotClaim + reason);
        }
        setClaimingId(null);
        claimingOidRef.current = null;
        setClaimStep("idle");
        return;
      }

      setClaimStep("claiming");
      if (paymasterSupported && PAYMASTER_URL) {
        claimCallsBaselineRef.current = claimCallsData?.id ?? null;
        sendClaimCalls({
          calls: [{
            to: SEABATTLE_CONTRACT_ADDRESS,
            data: encodeFunctionData({
              abi: seaBattleAbi,
              functionName: "claimPrize",
              args: [BigInt(win.onchain_game_id)],
            }),
          }],
          capabilities: { paymasterService: { url: PAYMASTER_URL } },
        });
        return;
      }
      writeClaim({
        address: SEABATTLE_CONTRACT_ADDRESS,
        abi: seaBattleAbi,
        functionName: "claimPrize",
        args: [BigInt(win.onchain_game_id)],
        chainId: base.id,
        dataSuffix: BUILDER_CODE_SUFFIX,
      });
    } catch (e: unknown) {
      setClaimErr((e as Error).message?.slice(0, 140) || playCopy.readGameFailed);
      setClaimingId(null);
      claimingOidRef.current = null;
      setClaimStep("idle");
    }
  };

  const handleDismissWin = async (winId: number) => {
    await hideUnclaimedWin(winId);
    loadUnclaimedWins();
  };

  // Open games list
  const loadOffchainGames = useCallback(async () => {
    if (mode === "bot") { setOffchainGames([]); return; }
    const games = await getAvailableGames(address, mode);
    setOffchainGames(games);
  }, [address, mode]);

  useEffect(() => {
    if (mode === "bot") return;
    loadOffchainGames();
    const interval = setInterval(loadOffchainGames, 5000);
    return () => clearInterval(interval);
  }, [mode, loadOffchainGames]);

  const prepareWagerAllowance = useCallback(async (amount: number) => {
    if (!address) return false;
    const allowance = await readContract(wagmiConfig, {
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: "allowance",
      args: [address, SEABATTLE_CONTRACT_ADDRESS],
      chainId: base.id,
    }).catch(() => BigInt(0));

    if (allowance >= BigInt(amount)) {
      setApproveFallbackMined(true);
      return true;
    }

    if (paymasterSupported && PAYMASTER_URL && wagerActionRef.current) {
      wagerActionRef.current = {
        ...wagerActionRef.current,
        sponsorApprove: true,
      };
      setApproveFallbackMined(true);
      return true;
    }

    writeApprove({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: "approve",
      args: [SEABATTLE_CONTRACT_ADDRESS, BigInt(amount)],
      chainId: base.id,
      dataSuffix: BUILDER_CODE_SUFFIX,
    });
    return false;
  }, [address, paymasterSupported, wagmiConfig, writeApprove]);

  // Handlers
  const handleCreate = async () => {
    setError("");
    setAction("create");
    wagerWriteSubmittedRef.current = false;

    if (mode === "bot") {
      router.push(`/game?id=0&mode=bot`);
      return;
    }

    if (mode === "friend") {
      if (!address) return;
      setOffchainLoading(true);
      try {
        const gameId = await createOffchainGame(address, isPrivate);
        router.push(`/game?id=${gameId}&mode=friend`);
      } catch (e: unknown) {
        setError((e as Error).message);
      } finally {
        setOffchainLoading(false);
      }
      return;
    }

    if (mode === "wager") {
      if (CONTRACT_NOT_SET) { setError(tr.contract_not_deployed); return; }
      const selectedAmount = customWagerMicro(customWager);
      if (selectedAmount === null) {
        setError(playCopy.invalidWager);
        return;
      }
      setWagerAmount(selectedAmount);
      if (wagerSecondStepReady && wagerActionRef.current?.action === "create") {
        submitWagerWrite();
        return;
      }
      wagerActionRef.current = { action: "create", amount: selectedAmount };
      wagerExpectedOnchainIdRef.current = null;
      wagerCompletionStartedRef.current = false;
      resetApprove();
      resetWagerWrite();
      setApproveFallbackMined(false);
      setWagerSecondStepReady(false);
      pendingAction.current = null;
      if (await prepareWagerAllowance(selectedAmount)) {
        submitWagerWrite();
      }
      return;
    }
  };

  const handleJoin = async (id?: string) => {
    const gid = id || joinGameId;
    if (!gid || isNaN(Number(gid))) { setError(playCopy.validGameId); return; }
    if (!address) return;
    setError("");
    setAction("join");
    setJoinGameId(gid);

    if (mode === "friend") {
      setOffchainLoading(true);
      try {
        await joinOffchainGame(Number(gid), address);
        router.push(`/game?id=${gid}&mode=friend`);
      } catch (e: unknown) {
        setError((e as Error).message);
      } finally {
        setOffchainLoading(false);
      }
      return;
    }

    if (mode === "wager") {
      if (CONTRACT_NOT_SET) { setError(tr.contract_not_deployed); return; }
      if (
        wagerSecondStepReady &&
        wagerActionRef.current?.action === "join" &&
        wagerActionRef.current.joinId === gid
      ) {
        submitWagerWrite();
        return;
      }
      setOffchainLoading(true);
      try {
        const info = await getGameJoinInfo(Number(gid));
        if (!info) { setError(playCopy.gameNotFound); setOffchainLoading(false); return; }
        if (info.game_mode !== "wager" || !info.wager_amount || !info.onchain_game_id) {
          setError(playCopy.notWagerGame); setOffchainLoading(false); return;
        }
        if (info.player1.toLowerCase() === address.toLowerCase()) {
          setError(playCopy.ownGame); setOffchainLoading(false); return;
        }
        if (info.player2 && info.player2.toLowerCase() !== address.toLowerCase()) {
          setError(playCopy.gameHasPlayer); setOffchainLoading(false); return;
        }

        const onchainGame = await readContract(wagmiConfig, {
          address: SEABATTLE_CONTRACT_ADDRESS,
          abi: seaBattleAbi,
          functionName: "getGame",
          args: [BigInt(info.onchain_game_id)],
          chainId: base.id,
        }) as readonly [
          `0x${string}`, `0x${string}`, number, bigint, boolean, `0x${string}`, boolean
        ];
        const onchainP1 = onchainGame[0];
        const onchainP2 = onchainGame[1];
        const onchainFinished = onchainGame[4];
        if (onchainP1.toLowerCase() === address.toLowerCase()) {
          setError(playCopy.ownGame); setOffchainLoading(false); return;
        }
        if (onchainFinished) {
          setError(playCopy.gameFinished); setOffchainLoading(false); return;
        }
        const alreadyJoinedOnchain =
          onchainP2 !== ZERO_ADDR &&
          onchainP2.toLowerCase() === address.toLowerCase();

        const actualAmount = info.wager_amount;
        setOffchainLoading(false);

        if (alreadyJoinedOnchain) {
          try { await joinOffchainGame(Number(gid), address); } catch {}
          router.push(`/game?id=${gid}&mode=wager&oid=${info.onchain_game_id}`);
          return;
        }

        wagerActionRef.current = { action: "join", amount: actualAmount, joinId: gid };
        wagerWriteSubmittedRef.current = false;
        wagerExpectedOnchainIdRef.current = null;
        wagerCompletionStartedRef.current = false;
        resetApprove();
        resetWagerWrite();
        setApproveFallbackMined(false);
        setWagerSecondStepReady(false);
        pendingAction.current = null;
        if (await prepareWagerAllowance(actualAmount)) {
          submitWagerWrite();
        }
      } catch (e: unknown) {
        setError((e as Error).message);
        setOffchainLoading(false);
      }
      return;
    }
  };

  const approveConfirming =
    mode === "wager" && !!approveTxHash && !approveSuccess && !!wagerActionRef.current;
  const wagerConfirming = isConfirming && !wagerReceipt;
  const wagerWriteSubmitting =
    mode === "wager" &&
    wagerWriteSubmittedRef.current &&
    !txHash &&
    !writeError &&
    !wagerCallsError;
  const createSecondStepReady =
    mode === "wager" &&
    action === "create" &&
    wagerSecondStepReady &&
    wagerActionRef.current?.action === "create";
  const joinSecondStepReady =
    mode === "wager" &&
    action === "join" &&
    wagerSecondStepReady &&
    wagerActionRef.current?.action === "join" &&
    wagerActionRef.current.joinId === joinGameId;

  const loading =
    mode === "bot" || mode === "friend"
      ? offchainLoading
      : isPending ||
        wagerCallsPending ||
        wagerConfirming ||
        approvePending ||
        approveConfirming ||
        wagerWriteSubmitting ||
        offchainLoading;

  const modeSubtitle: Record<GameMode, string> = {
    bot: tr.subtitle_bot,
    friend: tr.subtitle_friend,
    wager: tr.subtitle_wager,
  };
  const ModeIcon = mode === "wager" ? DollarIcon : mode === "friend" ? UsersIcon : SwordIcon;
  const modeLabel =
    mode === "wager"
      ? tr.home_play_wager
      : mode === "friend"
        ? tr.home_play_friend
        : tr.play_bot;
  const modeKicker =
    mode === "wager"
      ? playCopy.wagerKicker
      : mode === "friend"
        ? playCopy.friendKicker
        : playCopy.botKicker;
  const modeClass = mode === "wager" ? styles.wagerMode : styles.friendMode;
  const selectedWager = WAGER_OPTIONS.find((opt) => opt.value === wagerAmount);
  const selectedWagerLabel = selectedWager?.label ?? formatWager(wagerAmount);
  const createButtonLabel =
    createSecondStepReady
      ? playCopy.sendUsdc
      : loading && action === "create"
      ? approvePending
        ? playCopy.approveUsdc
        : approveConfirming
          ? playCopy.confirming
          : isPending || wagerWriteSubmitting
          ? playCopy.confirmWallet
          : wagerConfirming
            ? playCopy.confirming
            : playCopy.creating
      : mode === "bot"
        ? tr.play_bot
        : tr.create_game;
  const joinButtonLabel =
    joinSecondStepReady
      ? playCopy.sendUsdc
      : loading && action === "join"
        ? approvePending
          ? playCopy.approveUsdc
          : approveConfirming
            ? playCopy.confirming
            : isPending || wagerWriteSubmitting
              ? playCopy.confirmWallet
              : wagerConfirming
                ? playCopy.confirming
                : tr.joining
        : tr.join;
  const visibleRefundableGames =
    mode === "wager"
      ? refundableGames.filter(
          (g) =>
            !dismissedRefundIds.has(g.id) &&
            g.onchain_game_id !== null &&
            g.wager_amount > 0
        )
      : [];

  return (
    <div className={`${styles.container} ${modeClass}`}>
      <SettingsPanel />

      <header className={styles.header}>
        <button className={styles.back} onClick={() => router.push("/")} type="button">
          {tr.back}
        </button>
        <h1 className={styles.title}>{modeLabel}</h1>
        <p className={styles.subtitle}>{modeSubtitle[mode]}</p>
      </header>

      <main className={styles.main}>
        {!isConnected ? (
          <section className={styles.playPanel}>
            <div className={styles.panelHeader}>
              <span className={styles.panelKicker}>{playCopy.walletKicker}</span>
              <h2>{tr.connect}</h2>
            </div>
            <p className={styles.empty}>{playCopy.walletHint}</p>
          </section>
        ) : (
          <>
            <section className={styles.modeHero}>
              <div className={styles.modeOrb} aria-hidden="true">
                <ModeIcon size={30} />
              </div>
              <div className={styles.modeHeroCopy}>
                <span>{modeKicker}</span>
                <h2>{modeLabel}</h2>
                <p>{modeSubtitle[mode]}</p>
              </div>
              <div className={styles.modeTelemetry}>
                <div>
                  <b>{mode === "wager" ? selectedWagerLabel : playCopy.free}</b>
                  <small>{mode === "wager" ? playCopy.stake : playCopy.entry}</small>
                </div>
                <div>
                  <b>BASE</b>
                  <small>{playCopy.network}</small>
                </div>
              </div>
            </section>

            <section className={styles.playPanel}>
              <div className={styles.panelHeader}>
                <span className={styles.panelKicker}>{playCopy.createKicker}</span>
                <h2>{mode === "wager" ? playCopy.lockWager : playCopy.openRoom}</h2>
              </div>

              {mode === "wager" && CONTRACT_NOT_SET && (
                <div className={styles.contractWarning}>
                  {playCopy.contractWarning}
                </div>
              )}

              {mode === "wager" && (
                <div className={styles.wagerSelector} aria-label={playCopy.wagerAmount}>
                  {WAGER_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      className={`${styles.wagerOption} ${wagerAmount === opt.value ? styles.wagerActive : ""}`}
                      onClick={() => {
                        setWagerAmount(opt.value);
                        setCustomWager(String(opt.value / 1_000_000));
                      }}
                      disabled={loading || createSecondStepReady}
                      type="button"
                    >
                      <span>{opt.label}</span>
                      <small>{playCopy.prizePool} {(opt.value * 2 * 0.9 / 1_000_000).toFixed(1)}</small>
                    </button>
                  ))}
                </div>
              )}

              {mode === "wager" && (
                <label className={styles.customWager}>
                  <span>
                    <b>{playCopy.customWager}</b>
                    <small>{playCopy.customWagerHint}</small>
                  </span>
                  <span className={styles.customWagerInput}>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={customWager}
                      onChange={(event) => {
                        const next = event.target.value;
                        setCustomWager(next);
                        const amount = customWagerMicro(next);
                        if (amount !== null) setWagerAmount(amount);
                      }}
                      disabled={loading || createSecondStepReady}
                      aria-label={playCopy.customWager}
                    />
                    <b>USDC</b>
                  </span>
                  <strong>{playCopy.prizePool} {(wagerAmount * 2 * 0.9 / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>
                </label>
              )}

              {mode !== "bot" && (
                <label className={`${styles.privateToggle} ${isPrivate ? styles.toggleActive : ""}`}>
                  <span className={styles.toggleText}>
                    <b>{tr.private_game}</b>
                    <small>{isPrivate ? playCopy.privateHint : playCopy.publicHint}</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={isPrivate}
                    onChange={(e) => setIsPrivate(e.target.checked)}
                  />
                  <span className={`${styles.toggleSwitch} ${isPrivate ? styles.toggleOn : ""}`} />
                </label>
              )}

              <button
                className={styles.primaryButton}
                onClick={handleCreate}
                disabled={loading || (mode === "wager" && CONTRACT_NOT_SET)}
                type="button"
              >
                <SwordIcon size={18} />
                <span>{createButtonLabel}</span>
                <ChevronRightIcon size={16} />
              </button>
            </section>

            {mode !== "bot" && (
              <section className={`${styles.playPanel} ${styles.joinPanel}`}>
                <div className={styles.panelHeader}>
                  <span className={styles.panelKicker}>{playCopy.joinKicker}</span>
                  <h2>{tr.join_by_id}</h2>
                </div>
                <div className={styles.joinSection}>
                  <div className={styles.inputWrap}>
                    <AnchorIcon size={17} />
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder={tr.game_id}
                      value={joinGameId}
                      onChange={(e) => setJoinGameId(e.target.value)}
                      className={styles.input}
                    />
                  </div>
                  <button
                    className={styles.secondaryButton}
                    onClick={() => handleJoin()}
                    disabled={loading || !joinGameId || (mode === "wager" && CONTRACT_NOT_SET)}
                    type="button"
                  >
                    {joinButtonLabel}
                  </button>
                </div>
              </section>
            )}

            {error && <p className={styles.error}>{error}</p>}

            {mode === "wager" && activeWagerGames.length > 0 && (
              <div className={`${styles.gameList} ${styles.activeWagerList}`}>
                <h3 className={styles.gameListTitle}>
                  {playCopy.activeWagers} ({activeWagerGames.length})
                </h3>
                {activeWagerGames.map((game) => {
                  const status =
                    game.state === 0
                      ? playCopy.waitingOpponent
                      : game.state === 1
                        ? playCopy.placingShips
                        : playCopy.battleActive;
                  return (
                    <div key={game.id} className={styles.gameItem}>
                      <div className={styles.gameItemInfo}>
                        <span className={styles.gameItemId}>#{game.id}</span>
                        <span className={styles.activeWagerStatus}>{status}</span>
                        <span className={styles.gameItemWager}>
                          {game.wager_amount / 1_000_000} USDC
                        </span>
                      </div>
                      <button
                        className={styles.gameItemJoin}
                        onClick={() => handleReconnectWager(game)}
                        type="button"
                      >
                        {playCopy.reconnect}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {mode !== "bot" && offchainGames.length > 0 && (
              <div className={styles.gameList}>
                <h3 className={styles.gameListTitle}>
                  {tr.open_games} ({offchainGames.length})
                </h3>
                {offchainGames.map((g) => {
                  const gameJoinSecondStepReady =
                    mode === "wager" &&
                    action === "join" &&
                    wagerSecondStepReady &&
                    wagerActionRef.current?.action === "join" &&
                    wagerActionRef.current.joinId === g.id.toString();
                  return (
                    <div key={g.id} className={styles.gameItem}>
                      <div className={styles.gameItemInfo}>
                        <span className={styles.gameItemId}>#{g.id}</span>
                        <WalletName address={g.player1} className={styles.gameItemPlayer} />
                        {g.wager_amount > 0 && (
                          <span className={styles.gameItemWager}>
                            {g.wager_amount / 1_000_000} USDC
                          </span>
                        )}
                        {g.game_mode !== "free" && g.wager_amount === 0 && (
                          <span className={styles.gameItemMode}>{g.game_mode}</span>
                        )}
                      </div>
                      <button
                        className={styles.gameItemJoin}
                        onClick={() => handleJoin(g.id.toString())}
                        disabled={loading}
                      >
                        {gameJoinSecondStepReady ? playCopy.sendUsdc : tr.join}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {mode !== "bot" && offchainGames.length === 0 && (
              <p className={styles.noGames}>{tr.no_open_games}</p>
            )}

            {unclaimedWins.length > 0 && (
              <div className={styles.unclaimedSection}>
                <h3 className={styles.unclaimedTitle}>
                  {tr.unclaimed} ({unclaimedWins.length})
                </h3>
                {unclaimedWins.map((w) => {
                  const isActive = claimingId === w.id;
                  const amount = (w.wager_amount * 2 * 0.9) / 1_000_000;
                  const btnLabel = !isActive
                    ? tr.claim
                    : claimStep === "recording"
                      ? recordPending
                        ? playCopy.confirmFirst
                        : playCopy.finalizing
                      : claimStep === "claiming"
                        ? claimPending || claimCallsPending
                          ? playCopy.confirmSecond
                          : playCopy.claiming
                        : playCopy.checking;
                  return (
                    <div key={w.id} className={styles.unclaimedItem}>
                      <div className={styles.unclaimedInfo}>
                        <span className={styles.unclaimedGameId}>{playCopy.gameLabel} #{w.id}</span>
                        <span className={styles.unclaimedAmount}>
                          {amount.toFixed(2)} USDC
                        </span>
                      </div>
                      <div className={styles.unclaimedActions}>
                        <button
                          className={styles.unclaimedClaimBtn}
                          onClick={() => handleClaimWin(w)}
                          disabled={
                            !w.onchain_game_id ||
                            claimPending ||
                            claimCallsPending ||
                            recordPending ||
                            claimingId !== null
                          }
                        >
                          {btnLabel}
                        </button>
                        <button
                          className={styles.unclaimedDismissBtn}
                          onClick={() => handleDismissWin(w.id)}
                          disabled={isActive}
                          title={playCopy.hideClaimedRecord}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  );
                })}
                {claimErr && <p className={styles.unclaimedError}>{claimErr}</p>}
              </div>
            )}

            {visibleRefundableGames.length > 0 && (
              <div className={`${styles.unclaimedSection} ${styles.refundSection}`}>
                <h3 className={`${styles.unclaimedTitle} ${styles.refundTitle}`}>
                  {tr.refundable} ({visibleRefundableGames.length})
                </h3>
                {visibleRefundableGames.map((g) => {
                  const isActive = cancellingId === g.id;
                  const amount = g.wager_amount / 1_000_000;
                  const btnLabel = !isActive
                    ? tr.refund
                    : cancelPending || cancelCallsPending
                      ? playCopy.confirmWallet
                      : playCopy.refunding;
                  return (
                    <div key={g.id} className={styles.unclaimedItem}>
                      <div className={styles.unclaimedInfo}>
                        <span className={styles.unclaimedGameId}>{playCopy.gameLabel} #{g.id}</span>
                        {g.refundKind === "joined" && (
                          <span className={styles.refundReason}>{playCopy.joinedRefund}</span>
                        )}
                        <span className={styles.unclaimedAmount}>
                          {amount.toFixed(2)} USDC
                        </span>
                      </div>
                      <div className={styles.unclaimedActions}>
                        <button
                          className={`${styles.unclaimedClaimBtn} ${styles.refundBtn}`}
                          onClick={() => handleRefund(g)}
                          disabled={
                            g.onchain_game_id === null ||
                            cancelPending ||
                            cancelCallsPending ||
                            cancellingId !== null
                          }
                        >
                          {btnLabel}
                        </button>
                        <button
                          className={styles.unclaimedDismissBtn}
                          onClick={() => handleDismissRefund(g.id)}
                          disabled={isActive}
                          title={playCopy.hideRecord}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  );
                })}
                {cancelErr && <p className={styles.unclaimedError}>{cancelErr}</p>}
              </div>
            )}

            {address && <PushPrompt address={address} />}
          </>
        )}
      </main>
    </div>
  );
}
