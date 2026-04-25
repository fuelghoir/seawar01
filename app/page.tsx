"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useMiniApp } from "./providers/MiniAppProvider";
import { useRouter } from "next/navigation";
import {
  useAccount,
  useConnect,
  useWriteContract,
  useWaitForTransactionReceipt,
  useSwitchChain,
  useSendTransaction,
  useConfig,
} from "wagmi";
import { readContract, simulateContract } from "@wagmi/core";
import { base } from "wagmi/chains";
import { decodeEventLog } from "viem";
import {
  seaBattleAbi,
  erc20Abi,
  SEABATTLE_CONTRACT_ADDRESS,
  USDC_ADDRESS,
} from "./contracts/seaBattleAbi";
import { BUILDER_CODE_SUFFIX } from "./providers";
import {
  createOffchainGame,
  joinOffchainGame,
  getAvailableGames,
  getCheckinStatus,
  dailyCheckin,
  getGameOnchainId,
  getGameJoinInfo,
  getUnclaimedWins,
  markPrizeClaimed,
  autoCloseStaleGames,
  getRefundableGames,
  markGameCancelled,
  getPlayerProfile,
  CheckinStatus,
  UnclaimedWin,
  RefundableGame,
  PlayerProfile,
} from "./lib/offchainGame";
import styles from "./page.module.css";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const CONTRACT_NOT_SET = SEABATTLE_CONTRACT_ADDRESS === ZERO_ADDR;

function formatRevert(msg: string): string {
  const lower = msg.toLowerCase();
  if (lower.includes("user rejected") || lower.includes("user denied"))
    return "Transaction rejected. Try again.";
  if (lower.includes("transfer amount exceeds balance"))
    return "Prize pool is empty — opponent likely didn't stake. Contact admin or hide with ×.";
  if (lower.includes("429") || lower.includes("rate limit"))
    return "RPC rate-limited. Retry in a few seconds.";
  const reasonMatch = msg.match(/reason:\s*(.+?)(?:\n|$)/i);
  if (reasonMatch) return reasonMatch[1].trim();
  const revertMatch = msg.match(/revert(?:ed)?(?: with reason string)?\s*['"]?([^'"\n]+?)['"]?(?:\n|$)/i);
  if (revertMatch) return revertMatch[1].trim();
  return msg.slice(0, 140);
}

type GameMode = "offchain" | "bot" | "hybrid" | "wager";

const WAGER_OPTIONS = [
  { label: "1 USDC", value: 1_000_000 },
  { label: "5 USDC", value: 5_000_000 },
  { label: "10 USDC", value: 10_000_000 },
];

export default function Home() {
  const { context } = useMiniApp();
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { switchChain } = useSwitchChain();
  const { chainId } = useAccount();

  const [joinGameId, setJoinGameId] = useState("");
  const [error, setError] = useState("");
  const [action, setAction] = useState<"create" | "join" | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const [mode, setMode] = useState<GameMode>("offchain");
  const [offchainLoading, setOffchainLoading] = useState(false);
  const [offchainGames, setOffchainGames] = useState<{ id: number; player1: string; game_mode: string; wager_amount: number }[]>([]);
  const [checkin, setCheckin] = useState<CheckinStatus | null>(null);
  const [checkinLoading, setCheckinLoading] = useState(false);
  const [checkinMsg, setCheckinMsg] = useState("");
  const [wagerAmount, setWagerAmount] = useState(WAGER_OPTIONS[0].value);
  const [botOnchain, setBotOnchain] = useState(false);
  const [unclaimedWins, setUnclaimedWins] = useState<UnclaimedWin[]>([]);
  const [claimingId, setClaimingId] = useState<number | null>(null);
  const [claimStep, setClaimStep] = useState<"idle" | "recording" | "claiming">("idle");
  const [claimErr, setClaimErr] = useState("");
  const [refundableGames, setRefundableGames] = useState<RefundableGame[]>([]);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [cancelErr, setCancelErr] = useState("");
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const wagmiConfig = useConfig();
  const autoConnected = useRef(false);

  // ─── Onchain write (hybrid/bot/wager) ───
  const {
    data: txHash,
    isPending,
    writeContract,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, data: receipt } =
    useWaitForTransactionReceipt({ hash: txHash });

  // ─── USDC approve for wager ───
  const {
    data: approveTxHash,
    isPending: approvePending,
    writeContract: writeApprove,
  } = useWriteContract();
  const { isSuccess: approveSuccess } = useWaitForTransactionReceipt({
    hash: approveTxHash,
  });

  // ─── Claim prize for old unclaimed wins ───
  const {
    data: claimTxHash,
    writeContract: writeClaim,
    isPending: claimPending,
    error: claimWriteError,
    reset: resetClaim,
  } = useWriteContract();
  const { isSuccess: claimConfirmed } = useWaitForTransactionReceipt({
    hash: claimTxHash,
  });

  // ─── Record result for unclaimed wins that never finalized ───
  const {
    data: recordTxHash,
    writeContract: writeRecord,
    isPending: recordPending,
    error: recordWriteError,
    reset: resetRecord,
  } = useWriteContract();
  const { isSuccess: recordConfirmed } = useWaitForTransactionReceipt({
    hash: recordTxHash,
  });

  // ─── Cancel wager (refund) ───
  const {
    data: cancelTxHash,
    writeContract: writeCancel,
    isPending: cancelPending,
    error: cancelWriteError,
    reset: resetCancel,
  } = useWriteContract();
  const { isSuccess: cancelConfirmed } = useWaitForTransactionReceipt({
    hash: cancelTxHash,
  });

  // Auto-connect
  useEffect(() => {
    if (isConnected || autoConnected.current || connectors.length === 0) return;
    autoConnected.current = true;
    connect({ connector: connectors[0] });
  }, [isConnected, connectors, connect]);

  // Auto-switch chain
  useEffect(() => {
    if (isConnected && chainId && chainId !== base.id) {
      switchChain({ chainId: base.id });
    }
  }, [isConnected, chainId, switchChain]);

  // Show write errors
  useEffect(() => {
    if (writeError) {
      const msg = writeError.message || "Transaction failed";
      const reasonMatch = msg.match(/reason:\s*(.+?)(?:\n|$)/);
      setError(reasonMatch ? reasonMatch[1] : msg.slice(0, 150));
    }
  }, [writeError]);

  // ─── After onchain tx confirms — route to game ───
  const pendingAction = useRef<{
    action: "create" | "join";
    mode: GameMode;
    joinId?: string;
    wager?: number;
  } | null>(null);

  useEffect(() => {
    if (!isSuccess || !receipt || !pendingAction.current) return;
    const pa = pendingAction.current;
    pendingAction.current = null;

    if (pa.mode === "bot") {
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: seaBattleAbi,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === "GameCreated") {
            const gameId = (decoded.args as { gameId: bigint }).gameId;
            router.push(`/game?id=${gameId.toString()}&mode=bot&oid=${gameId.toString()}`);
            return;
          }
        } catch { /* not our event */ }
      }
      router.push(`/game?id=0&mode=bot`);
      return;
    }

    if (pa.mode === "hybrid") {
      if (pa.action === "create") {
        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: seaBattleAbi,
              data: log.data,
              topics: log.topics,
            });
            if (decoded.eventName === "GameCreated") {
              const onchainId = (decoded.args as { gameId: bigint }).gameId;
              createOffchainGame(address!, isPrivate, {
                game_mode: "hybrid",
                onchain_game_id: Number(onchainId),
              })
                .then((offId) => {
                  router.push(`/game?id=${offId}&mode=hybrid&oid=${onchainId.toString()}`);
                })
                .catch(() => setError("Failed to create offchain game"));
              return;
            }
          } catch { /* not our event */ }
        }
      } else {
        // Join hybrid: fetch onchain_game_id from Supabase
        getGameOnchainId(Number(pa.joinId)).then((oid) => {
          router.push(`/game?id=${pa.joinId}&mode=hybrid&oid=${oid || pa.joinId}`);
        });
      }
      return;
    }

    if (pa.mode === "wager") {
      if (pa.action === "create") {
        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: seaBattleAbi,
              data: log.data,
              topics: log.topics,
            });
            if (decoded.eventName === "GameCreated") {
              const onchainId = (decoded.args as { gameId: bigint }).gameId;
              createOffchainGame(address!, isPrivate, {
                game_mode: "wager",
                onchain_game_id: Number(onchainId),
                wager_amount: pa.wager,
              })
                .then((offId) => {
                  router.push(`/game?id=${offId}&mode=wager&oid=${onchainId.toString()}`);
                })
                .catch(() => setError("Failed to create offchain game"));
              return;
            }
          } catch { /* not our event */ }
        }
      } else if (pa.action === "join") {
        // Onchain join succeeded — now mirror the join into Supabase, then route
        const gid = Number(pa.joinId);
        joinOffchainGame(gid, address!)
          .catch(() => { /* already joined / race — harmless */ })
          .finally(() => {
            getGameOnchainId(gid).then((oid) => {
              router.push(`/game?id=${pa.joinId}&mode=wager&oid=${oid || pa.joinId}`);
            });
          });
      }
      return;
    }
  }, [isSuccess, receipt, address, isPrivate, router]);

  // After USDC approve confirms, call the actual contract function
  const wagerActionRef = useRef<{
    action: "create" | "join";
    amount: number;
    joinId?: string;
  } | null>(null);

  useEffect(() => {
    if (!approveSuccess || !wagerActionRef.current) return;
    const wa = wagerActionRef.current;
    wagerActionRef.current = null;

    if (wa.action === "create") {
      pendingAction.current = { action: "create", mode: "wager", wager: wa.amount };
      writeContract({
        address: SEABATTLE_CONTRACT_ADDRESS,
        abi: seaBattleAbi,
        functionName: "createWagerGame",
        args: [BigInt(wa.amount)],
        chainId: base.id,
        dataSuffix: BUILDER_CODE_SUFFIX,
      });
    } else {
      // Fetch onchain_game_id from Supabase, use it for the contract call
      getGameOnchainId(Number(wa.joinId!)).then((oid) => {
        if (!oid) { setError("Onchain game ID not found"); return; }
        pendingAction.current = { action: "join", mode: "wager", joinId: wa.joinId };
        writeContract({
          address: SEABATTLE_CONTRACT_ADDRESS,
          abi: seaBattleAbi,
          functionName: "joinWagerGame",
          args: [BigInt(oid)],
          chainId: base.id,
          dataSuffix: BUILDER_CODE_SUFFIX,
        });
      });
    }
  }, [approveSuccess, writeContract]);

  // ─── Check-in ───
  const {
    sendTransaction,
    data: checkinTxHash,
    isPending: checkinTxPending,
  } = useSendTransaction();
  const { isSuccess: checkinTxSuccess } = useWaitForTransactionReceipt({
    hash: checkinTxHash,
  });

  useEffect(() => {
    if (address) {
      getCheckinStatus(address).then(setCheckin).catch(() => {});
    }
  }, [address]);

  const checkinRecorded = useRef(false);
  useEffect(() => {
    if (checkinTxSuccess && address && !checkinRecorded.current) {
      checkinRecorded.current = true;
      dailyCheckin(address)
        .then(async (result) => {
          setCheckinMsg(`+${result.points} pts! Streak: ${result.streak} days`);
          // Re-fetch status so whitelisted wallets get canCheckin=true again
          // (they can check in unlimited times), regular wallets get
          // canCheckin=false after their daily click.
          try {
            const status = await getCheckinStatus(address);
            setCheckin(status);
          } catch {
            setCheckin({
              canCheckin: false,
              streak: result.streak,
              nextReward: Math.ceil((result.streak + 1) / 5) * 5,
            });
          }
        })
        .catch(() => setCheckinMsg("Already checked in today"))
        .finally(() => setCheckinLoading(false));
    }
  }, [checkinTxSuccess, address]);

  const handleCheckin = () => {
    if (!address || !checkin?.canCheckin) return;
    setCheckinLoading(true);
    setCheckinMsg("");
    checkinRecorded.current = false;
    // Self-transfer with zero value. Base App miniapp rejects tx with
    // a data field on self-transfers — keep it off for compatibility.
    sendTransaction({
      to: address,
      value: BigInt(0),
      chainId: base.id,
    });
  };

  // ─── Load player profile ───
  const loadProfile = useCallback(async () => {
    if (!address) return;
    try {
      const p = await getPlayerProfile(address);
      setProfile(p);
    } catch { /* ignore */ }
  }, [address]);

  useEffect(() => {
    if (address) loadProfile();
  }, [address, loadProfile]);

  // Refresh profile when check-in confirmed or a claim confirms
  useEffect(() => {
    if (checkinTxSuccess || claimConfirmed) loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkinTxSuccess, claimConfirmed]);

  // ─── Load unclaimed wins list ───
  const loadUnclaimedWins = useCallback(async () => {
    if (!address) return;
    const wins = await getUnclaimedWins(address);
    setUnclaimedWins(wins);
  }, [address]);

  useEffect(() => {
    if (address) loadUnclaimedWins();
  }, [address, loadUnclaimedWins]);

  // ─── Auto-close stale free/onchain games + load refundable wager games ───
  const loadRefundable = useCallback(async () => {
    if (!address) return;
    const games = await getRefundableGames(address);
    setRefundableGames(games);
  }, [address]);

  useEffect(() => {
    // Fire on every mount: sweeps stale free/hybrid, then loads wager refunds for this user.
    autoCloseStaleGames().catch(() => {});
    if (address) loadRefundable();
  }, [address, loadRefundable]);

  // After onchain cancel confirms — mark DB state=4 and refresh lists.
  // Lobby list self-refreshes on its 5s interval, no explicit call needed.
  useEffect(() => {
    if (cancelConfirmed && cancellingId !== null) {
      markGameCancelled(cancellingId).catch(() => {});
      setCancellingId(null);
      setCancelErr("");
      resetCancel();
      loadRefundable();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelConfirmed, cancellingId]);

  useEffect(() => {
    if (cancelWriteError && cancellingId !== null) {
      const msg = cancelWriteError.message || "Refund failed";
      setCancelErr(formatRevert(msg));
      setCancellingId(null);
    }
  }, [cancelWriteError, cancellingId]);

  const handleRefund = useCallback((g: RefundableGame) => {
    if (g.onchain_game_id === null) return;
    setCancelErr("");
    resetCancel();
    setCancellingId(g.id);
    writeCancel({
      address: SEABATTLE_CONTRACT_ADDRESS,
      abi: seaBattleAbi,
      functionName: "cancelWagerGame",
      args: [BigInt(g.onchain_game_id)],
      chainId: base.id,
      dataSuffix: BUILDER_CODE_SUFFIX,
    });
  }, [writeCancel, resetCancel]);

  const handleDismissRefund = useCallback(async (gameId: number) => {
    await markGameCancelled(gameId).catch(() => {});
    loadRefundable();
  }, [loadRefundable]);

  const claimingOidRef = useRef<number | null>(null);

  // After recordResult confirms, trigger claimPrize
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

  // After claim confirms, mark in DB and refresh
  useEffect(() => {
    if (claimConfirmed && claimingId !== null) {
      markPrizeClaimed(claimingId).catch(() => {});
      setClaimingId(null);
      claimingOidRef.current = null;
      setClaimStep("idle");
      loadUnclaimedWins();
    }
  }, [claimConfirmed, claimingId, loadUnclaimedWins]);

  // On claim write error — show reason, DO NOT auto-mark as claimed.
  // (User could have rejected, gas failed, etc. Only Dismiss should mark.)
  useEffect(() => {
    if (claimWriteError && claimingId !== null) {
      const msg = claimWriteError.message || "Claim failed";
      setClaimErr(formatRevert(msg));
      setClaimingId(null);
      claimingOidRef.current = null;
      setClaimStep("idle");
    }
  }, [claimWriteError, claimingId]);

  useEffect(() => {
    if (recordWriteError && claimingId !== null) {
      const msg = recordWriteError.message || "Record failed";
      setClaimErr(formatRevert(msg));
      setClaimingId(null);
      claimingOidRef.current = null;
      setClaimStep("idle");
    }
  }, [recordWriteError, claimingId]);

  const handleClaimWin = async (win: UnclaimedWin) => {
    if (!win.onchain_game_id || !address || claimPending || recordPending) return;
    setClaimErr("");
    resetClaim();
    resetRecord();
    setClaimingId(win.id);
    claimingOidRef.current = win.onchain_game_id;

    try {
      // 1) Read current onchain state
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

      // 1b) Check USDC balance on contract can cover the payout (wager * 2 * 0.9)
      const required = (wagerAmountOnchain * BigInt(18)) / BigInt(10);
      const balance = await readContract(wagmiConfig, {
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [SEABATTLE_CONTRACT_ADDRESS],
        chainId: base.id,
      }) as bigint;
      if (balance < required) {
        setClaimErr(
          `Prize pool short: contract has ${(Number(balance) / 1_000_000).toFixed(2)} USDC, ` +
          `needs ${(Number(required) / 1_000_000).toFixed(2)}. Opponent didn't stake. Hide with ×.`
        );
        setClaimingId(null);
        claimingOidRef.current = null;
        setClaimStep("idle");
        return;
      }

      // 2) If not finalized — simulate recordResult first. Only submit if simulation passes.
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
          setClaimErr("Cannot finalize: " + formatRevert((simErr as Error).message || ""));
          setClaimingId(null);
          claimingOidRef.current = null;
          setClaimStep("idle");
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

      // 3) Finalized but winner is someone else — do not submit; user must Dismiss manually
      if (onchainWinner.toLowerCase() !== address.toLowerCase()) {
        setClaimErr(
          `Onchain winner is ${onchainWinner.slice(0, 6)}...${onchainWinner.slice(-4)}, not you. Use × to hide.`
        );
        setClaimingId(null);
        claimingOidRef.current = null;
        setClaimStep("idle");
        return;
      }

      // 4) Simulate claimPrize — catches "already claimed" or any other contract revert
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
        const reason = formatRevert((simErr as Error).message || "");
        if (/already|claimed/i.test(reason)) {
          setClaimErr(`Already claimed onchain. Use × to hide this record.`);
        } else {
          setClaimErr("Cannot claim: " + reason);
        }
        setClaimingId(null);
        claimingOidRef.current = null;
        setClaimStep("idle");
        return;
      }

      setClaimStep("claiming");
      writeClaim({
        address: SEABATTLE_CONTRACT_ADDRESS,
        abi: seaBattleAbi,
        functionName: "claimPrize",
        args: [BigInt(win.onchain_game_id)],
        chainId: base.id,
        dataSuffix: BUILDER_CODE_SUFFIX,
      });
    } catch (e: unknown) {
      setClaimErr((e as Error).message?.slice(0, 140) || "Failed to read game state");
      setClaimingId(null);
      claimingOidRef.current = null;
      setClaimStep("idle");
    }
  };

  const handleDismissWin = async (winId: number) => {
    await markPrizeClaimed(winId).catch(() => {});
    loadUnclaimedWins();
  };

  // ─── Load offchain games list ───
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

  // ─── Handlers ───

  const handleCreate = async () => {
    setError("");
    setAction("create");

    if (mode === "offchain") {
      if (!address) return;
      setOffchainLoading(true);
      try {
        const gameId = await createOffchainGame(address, isPrivate);
        router.push(`/game?id=${gameId}&mode=offchain`);
      } catch (e: unknown) {
        setError((e as Error).message);
      } finally {
        setOffchainLoading(false);
      }
      return;
    }

    if (mode === "bot") {
      if (botOnchain) {
        if (CONTRACT_NOT_SET) { setError("Contract not deployed"); return; }
        pendingAction.current = { action: "create", mode: "bot" };
        writeContract({
          address: SEABATTLE_CONTRACT_ADDRESS,
          abi: seaBattleAbi,
          functionName: "createBotGame",
          chainId: base.id,
          dataSuffix: BUILDER_CODE_SUFFIX,
        });
      } else {
        router.push(`/game?id=0&mode=bot`);
      }
      return;
    }

    if (mode === "hybrid") {
      if (CONTRACT_NOT_SET) { setError("Contract not deployed"); return; }
      pendingAction.current = { action: "create", mode: "hybrid" };
      writeContract({
        address: SEABATTLE_CONTRACT_ADDRESS,
        abi: seaBattleAbi,
        functionName: "createGame",
        chainId: base.id,
        dataSuffix: BUILDER_CODE_SUFFIX,
      });
      return;
    }

    if (mode === "wager") {
      if (CONTRACT_NOT_SET) { setError("Contract not deployed"); return; }
      wagerActionRef.current = { action: "create", amount: wagerAmount };
      writeApprove({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "approve",
        args: [SEABATTLE_CONTRACT_ADDRESS, BigInt(wagerAmount)],
        chainId: base.id,
        dataSuffix: BUILDER_CODE_SUFFIX,
      });
      return;
    }
  };

  const handleJoin = async (id?: string) => {
    const gid = id || joinGameId;
    if (!gid || isNaN(Number(gid))) { setError("Enter a valid game ID"); return; }
    if (!address) return;
    setError("");
    setAction("join");
    setJoinGameId(gid);

    if (mode === "offchain") {
      setOffchainLoading(true);
      try {
        await joinOffchainGame(Number(gid), address);
        router.push(`/game?id=${gid}&mode=offchain`);
      } catch (e: unknown) {
        setError((e as Error).message);
      } finally {
        setOffchainLoading(false);
      }
      return;
    }

    if (mode === "hybrid") {
      if (CONTRACT_NOT_SET) { setError("Contract not deployed"); return; }
      setOffchainLoading(true);
      try {
        await joinOffchainGame(Number(gid), address);
        const oid = await getGameOnchainId(Number(gid));
        setOffchainLoading(false);
        if (!oid) { setError("Onchain game ID not found"); return; }
        pendingAction.current = { action: "join", mode: "hybrid", joinId: gid };
        writeContract({
          address: SEABATTLE_CONTRACT_ADDRESS,
          abi: seaBattleAbi,
          functionName: "joinGame",
          args: [BigInt(oid)],
          chainId: base.id,
          dataSuffix: BUILDER_CODE_SUFFIX,
        });
      } catch (e: unknown) {
        setError((e as Error).message);
        setOffchainLoading(false);
      }
      return;
    }

    if (mode === "wager") {
      if (CONTRACT_NOT_SET) { setError("Contract not deployed"); return; }
      setOffchainLoading(true);
      try {
        // Read actual wager amount & onchain id from DB (not from local selector)
        const info = await getGameJoinInfo(Number(gid));
        if (!info) { setError("Game not found"); setOffchainLoading(false); return; }
        if (info.game_mode !== "wager" || !info.wager_amount || !info.onchain_game_id) {
          setError("This is not a wager game"); setOffchainLoading(false); return;
        }
        if (info.player1.toLowerCase() === address.toLowerCase()) {
          setError("Cannot join your own game"); setOffchainLoading(false); return;
        }
        // Allow retry: DB may say state=1 / player2 set from a prior failed attempt,
        // but onchain may still be open. Block only if a different player2 owns the seat.
        if (info.player2 && info.player2.toLowerCase() !== address.toLowerCase()) {
          setError("Game already has another player"); setOffchainLoading(false); return;
        }

        // Double-check onchain: must not be finished, and if player2 onchain is
        // already someone else, we can't join.
        const onchainGame = await readContract(wagmiConfig, {
          address: SEABATTLE_CONTRACT_ADDRESS,
          abi: seaBattleAbi,
          functionName: "getGame",
          args: [BigInt(info.onchain_game_id)],
          chainId: base.id,
        }) as readonly [
          `0x${string}`, `0x${string}`, number, bigint, boolean, `0x${string}`, boolean
        ];
        const onchainP2 = onchainGame[1];
        const onchainFinished = onchainGame[4];
        if (onchainFinished) {
          setError("Game already finished onchain"); setOffchainLoading(false); return;
        }
        const alreadyJoinedOnchain =
          onchainP2 !== ZERO_ADDR &&
          onchainP2.toLowerCase() === address.toLowerCase();

        const actualAmount = info.wager_amount;
        setOffchainLoading(false);

        // If onchain join already done (prior retry), just mirror offchain and route.
        if (alreadyJoinedOnchain) {
          try { await joinOffchainGame(Number(gid), address); } catch { /* already seated */ }
          router.push(`/game?id=${gid}&mode=wager&oid=${info.onchain_game_id}`);
          return;
        }

        // Otherwise start approve → onchain join flow. Mirror offchain happens
        // only after onchain join is confirmed (see isSuccess effect).
        wagerActionRef.current = { action: "join", amount: actualAmount, joinId: gid };
        writeApprove({
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: "approve",
          args: [SEABATTLE_CONTRACT_ADDRESS, BigInt(actualAmount)],
          chainId: base.id,
          dataSuffix: BUILDER_CODE_SUFFIX,
        });
      } catch (e: unknown) {
        setError((e as Error).message);
        setOffchainLoading(false);
      }
      return;
    }
  };

  const loading =
    mode === "offchain"
      ? offchainLoading
      : isPending || isConfirming || approvePending || offchainLoading;

  const displayName = context?.user?.displayName || "Captain";

  const modeSubtitle: Record<GameMode, string> = {
    offchain: "Free to play, no gas fees.",
    bot: "Play against the bot.",
    hybrid: "2 transactions, gameplay is free.",
    wager: "Bet USDC, winner takes 90%.",
  };

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <div className={styles.header}>
          <h1 className={styles.title}>SEA BATTLE</h1>
          <p className={styles.subtitle}>
            Ahoy, {displayName}! {modeSubtitle[mode]}
          </p>
        </div>

        {/* Mode selector */}
        {isConnected && (
          <div className={styles.modeGrid}>
            {(
              [
                { id: "offchain", label: "Free", icon: "🌊", hint: "No stakes, instant play" },
                { id: "bot", label: "Bot", icon: "🤖", hint: "Solo vs AI captain" },
                { id: "hybrid", label: "Onchain", icon: "⚓", hint: "Verified on Base" },
                { id: "wager", label: "Wager", icon: "💰", hint: "USDC stakes" },
              ] as { id: GameMode; label: string; icon: string; hint: string }[]
            ).map((m) => (
              <button
                key={m.id}
                className={`${styles.modeCard} ${mode === m.id ? styles.modeCardActive : ""}`}
                onClick={() => { setMode(m.id); setError(""); resetWrite(); }}
              >
                <span className={styles.modeCardIcon} aria-hidden="true">
                  {m.icon}
                </span>
                <span className={styles.modeCardLabel}>{m.label}</span>
                <span className={styles.modeCardHint}>{m.hint}</span>
              </button>
            ))}
          </div>
        )}

        {!isConnected ? (
          <div className={styles.connectSection}>
            <p className={styles.connectText}>Connect your wallet to play</p>
            <button
              className={styles.primaryButton}
              onClick={() => connectors[0] && connect({ connector: connectors[0] })}
            >
              Connect Wallet
            </button>
          </div>
        ) : (
          <div className={styles.actions}>
            {(mode === "hybrid" || mode === "wager") && CONTRACT_NOT_SET && (
              <div className={styles.contractWarning}>
                Contract not deployed yet. Set NEXT_PUBLIC_SEABATTLE_CONTRACT_ADDRESS in .env
              </div>
            )}

            {/* Wager amount selector */}
            {mode === "wager" && (
              <div className={styles.wagerSelector}>
                {WAGER_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className={`${styles.wagerOption} ${wagerAmount === opt.value ? styles.wagerActive : ""}`}
                    onClick={() => setWagerAmount(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            {/* Bot onchain toggle */}
            {mode === "bot" && (
              <label className={`${styles.privateToggle} ${botOnchain ? styles.toggleActive : ""}`}>
                <span>Onchain mode (2 txs)</span>
                <input
                  type="checkbox"
                  checked={botOnchain}
                  onChange={(e) => setBotOnchain(e.target.checked)}
                />
                <span className={`${styles.toggleSwitch} ${botOnchain ? styles.toggleOn : ""}`} />
              </label>
            )}

            <button
              className={styles.primaryButton}
              onClick={handleCreate}
              disabled={loading || ((mode === "hybrid" || mode === "wager" || (mode === "bot" && botOnchain)) && CONTRACT_NOT_SET)}
            >
              {loading && action === "create"
                ? approvePending
                  ? "Approve USDC..."
                  : isPending
                    ? "Confirm in wallet..."
                    : isConfirming
                      ? "Confirming..."
                      : "Creating..."
                : mode === "bot"
                  ? "Play vs Bot"
                  : "Create Game"}
            </button>

            {mode !== "bot" && (
              <>
                <label className={`${styles.privateToggle} ${isPrivate ? styles.toggleActive : ""}`}>
                  <span>Private game (invite only)</span>
                  <input
                    type="checkbox"
                    checked={isPrivate}
                    onChange={(e) => setIsPrivate(e.target.checked)}
                  />
                  <span className={`${styles.toggleSwitch} ${isPrivate ? styles.toggleOn : ""}`} />
                </label>

                <div className={styles.divider}>
                  <span>or join by ID</span>
                </div>

                <div className={styles.joinSection}>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Game ID"
                    value={joinGameId}
                    onChange={(e) => setJoinGameId(e.target.value)}
                    className={styles.input}
                  />
                  <button
                    className={styles.secondaryButton}
                    onClick={() => handleJoin()}
                    disabled={loading || !joinGameId || ((mode === "hybrid" || mode === "wager") && CONTRACT_NOT_SET)}
                  >
                    {loading && action === "join" ? "Joining..." : "Join"}
                  </button>
                </div>
              </>
            )}

            {error && <p className={styles.error}>{error}</p>}

            {/* Game list */}
            {mode !== "bot" && offchainGames.length > 0 && (
              <div className={styles.gameList}>
                <h3 className={styles.gameListTitle}>
                  Open Games ({offchainGames.length})
                </h3>
                {offchainGames.map((g) => (
                  <div key={g.id} className={styles.gameItem}>
                    <div className={styles.gameItemInfo}>
                      <span className={styles.gameItemId}>#{g.id}</span>
                      <span className={styles.gameItemPlayer}>
                        {g.player1.slice(0, 6)}...{g.player1.slice(-4)}
                      </span>
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
                      Join
                    </button>
                  </div>
                ))}
              </div>
            )}

            {mode !== "bot" && offchainGames.length === 0 && (
              <p className={styles.noGames}>No open games. Create one!</p>
            )}

            {/* Unclaimed wager prizes */}
            {unclaimedWins.length > 0 && (
              <div className={styles.unclaimedSection}>
                <h3 className={styles.unclaimedTitle}>
                  Unclaimed Prizes ({unclaimedWins.length})
                </h3>
                {unclaimedWins.map((w) => {
                  const isActive = claimingId === w.id;
                  const amount = (w.wager_amount * 2 * 0.9) / 1_000_000;
                  const btnLabel = !isActive
                    ? "Claim"
                    : claimStep === "recording"
                      ? recordPending
                        ? "Confirm 1/2..."
                        : "Finalizing..."
                      : claimStep === "claiming"
                        ? claimPending
                          ? "Confirm 2/2..."
                          : "Claiming..."
                        : "Checking...";
                  return (
                    <div key={w.id} className={styles.unclaimedItem}>
                      <div className={styles.unclaimedInfo}>
                        <span className={styles.unclaimedGameId}>Game #{w.id}</span>
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
                            recordPending ||
                            (claimingId !== null && claimingId !== w.id)
                          }
                        >
                          {btnLabel}
                        </button>
                        <button
                          className={styles.unclaimedDismissBtn}
                          onClick={() => handleDismissWin(w.id)}
                          disabled={isActive}
                          title="Hide this record (if already claimed)"
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

            {/* Refundable wager games (unjoined, older than 3 min) */}
            {refundableGames.length > 0 && (
              <div className={`${styles.unclaimedSection} ${styles.refundSection}`}>
                <h3 className={`${styles.unclaimedTitle} ${styles.refundTitle}`}>
                  Refundable Games ({refundableGames.length})
                </h3>
                {refundableGames.map((g) => {
                  const isActive = cancellingId === g.id;
                  const amount = g.wager_amount / 1_000_000;
                  const btnLabel = !isActive
                    ? "Refund"
                    : cancelPending
                      ? "Confirm in wallet..."
                      : "Refunding...";
                  return (
                    <div key={g.id} className={styles.unclaimedItem}>
                      <div className={styles.unclaimedInfo}>
                        <span className={styles.unclaimedGameId}>Game #{g.id}</span>
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
                            (cancellingId !== null && cancellingId !== g.id)
                          }
                        >
                          {btnLabel}
                        </button>
                        <button
                          className={styles.unclaimedDismissBtn}
                          onClick={() => handleDismissRefund(g.id)}
                          disabled={isActive}
                          title="Hide this record"
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

            {/* Daily check-in */}
            {checkin && (
              <div className={styles.checkinSection}>
                <button
                  className={`${styles.checkinBtn} ${!checkin.canCheckin ? styles.checkinDone : ""}`}
                  onClick={handleCheckin}
                  disabled={!checkin.canCheckin || checkinLoading}
                >
                  {checkinTxPending
                    ? "Confirm in wallet..."
                    : checkinLoading
                      ? "Confirming tx..."
                      : checkin.canCheckin
                        ? `Daily Check-in (+${checkin.nextReward} pts)`
                        : `Checked in! Streak: ${checkin.streak}d`}
                </button>
                {checkinMsg && <p className={styles.checkinMsg}>{checkinMsg}</p>}
              </div>
            )}

            {profile && (
              <div className={styles.profileCard}>
                <button
                  className={styles.profileHeader}
                  onClick={() => setShowProfile((v) => !v)}
                  type="button"
                >
                  <div className={styles.profileHeaderLeft}>
                    <span className={styles.profileLabel}>Profile</span>
                    <span className={styles.profilePoints}>
                      {profile.points} pts
                    </span>
                  </div>
                  <span className={styles.profileChevron}>
                    {showProfile ? "▾" : "▸"}
                  </span>
                </button>

                {showProfile && (
                  <div className={styles.profileBody}>
                    <div className={styles.profileGrid}>
                      <div className={styles.profileStat}>
                        <span className={styles.profileValue}>
                          {profile.totalCheckins}
                        </span>
                        <span className={styles.profileKey}>Check-ins</span>
                      </div>
                      <div className={styles.profileStat}>
                        <span className={styles.profileValue}>
                          {profile.totalWins}
                        </span>
                        <span className={styles.profileKey}>Wins</span>
                      </div>
                      <div className={styles.profileStat}>
                        <span className={styles.profileValue}>
                          {profile.totalShots}
                        </span>
                        <span className={styles.profileKey}>Shots</span>
                      </div>
                      <div className={styles.profileStat}>
                        <span className={styles.profileValue}>
                          {profile.checkinStreak}d
                        </span>
                        <span className={styles.profileKey}>Streak</span>
                      </div>
                    </div>

                    <div className={styles.profileOnchain}>
                      <div className={styles.profileOnchainRow}>
                        <span className={styles.profileOnchainLabel}>
                          Onchain winrate
                        </span>
                        <span className={styles.profileOnchainValue}>
                          {profile.onchainGames > 0
                            ? `${Math.round(profile.onchainWinRate * 100)}% (${profile.onchainWins}/${profile.onchainGames})`
                            : "—"}
                        </span>
                      </div>
                      <div className={styles.profileOnchainRow}>
                        <span className={styles.profileOnchainLabel}>
                          Net P&amp;L (wager)
                        </span>
                        <span
                          className={
                            profile.earningsUsdc >= 0
                              ? styles.profileEarnings
                              : styles.profileLoss
                          }
                        >
                          {profile.earningsUsdc >= 0 ? "+" : ""}
                          {profile.earningsUsdc.toFixed(2)} USDC
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            <button
              className={styles.leaderboardBtn}
              onClick={() => router.push("/leaderboard")}
            >
              Leaderboard
            </button>
          </div>
        )}

        <div className={styles.walletInfo}>
          {address && (
            <span className={styles.address}>
              {address.slice(0, 6)}...{address.slice(-4)}
            </span>
          )}
          <span className={styles.network}>Base</span>
        </div>
      </div>

      <footer className={styles.footer}>
        <div className={styles.socialLinks}>
          <a
            href="https://t.me/+xWV1zyGwNOM1ZTFi"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.socialLink}
          >
            <span className={styles.socialIcon}>&#9993;</span>
            Telegram
          </a>
          <a
            href="https://www.youtube.com/@hermescrypt"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.socialLink}
          >
            <span className={styles.socialIcon}>&#9654;</span>
            YouTube
          </a>
        </div>
        <span className={styles.footerText}>Sea Battle on Base</span>
      </footer>
    </div>
  );
}
