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
} from "wagmi";
import { base } from "wagmi/chains";
import { decodeEventLog } from "viem";
import {
  seaBattleAbi,
  erc20Abi,
  SEABATTLE_CONTRACT_ADDRESS,
  USDC_ADDRESS,
} from "./contracts/seaBattleAbi";
import {
  createOffchainGame,
  joinOffchainGame,
  getAvailableGames,
  getCheckinStatus,
  dailyCheckin,
  CheckinStatus,
} from "./lib/offchainGame";
import styles from "./page.module.css";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const CONTRACT_NOT_SET = SEABATTLE_CONTRACT_ADDRESS === ZERO_ADDR;

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
  const [offchainGames, setOffchainGames] = useState<{ id: number; player1: string }[]>([]);
  const [checkin, setCheckin] = useState<CheckinStatus | null>(null);
  const [checkinLoading, setCheckinLoading] = useState(false);
  const [checkinMsg, setCheckinMsg] = useState("");
  const [wagerAmount, setWagerAmount] = useState(WAGER_OPTIONS[0].value);
  const [botOnchain, setBotOnchain] = useState(false);
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
              createOffchainGame(address!, isPrivate)
                .then((offId) => {
                  router.push(`/game?id=${offId}&mode=hybrid&oid=${onchainId.toString()}`);
                })
                .catch(() => setError("Failed to create offchain game"));
              return;
            }
          } catch { /* not our event */ }
        }
      } else {
        router.push(`/game?id=${pa.joinId}&mode=hybrid&oid=${pa.joinId}`);
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
              createOffchainGame(address!, isPrivate)
                .then((offId) => {
                  router.push(`/game?id=${offId}&mode=wager&oid=${onchainId.toString()}`);
                })
                .catch(() => setError("Failed to create offchain game"));
              return;
            }
          } catch { /* not our event */ }
        }
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
      });
    } else {
      pendingAction.current = { action: "join", mode: "wager", joinId: wa.joinId };
      writeContract({
        address: SEABATTLE_CONTRACT_ADDRESS,
        abi: seaBattleAbi,
        functionName: "joinWagerGame",
        args: [BigInt(wa.joinId!)],
        chainId: base.id,
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
        .then((result) => {
          setCheckinMsg(`+${result.points} pts! Streak: ${result.streak} days`);
          setCheckin({
            canCheckin: false,
            streak: result.streak,
            nextReward: Math.ceil((result.streak + 1) / 5) * 5,
          });
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
    sendTransaction({
      to: address,
      value: BigInt(0),
      chainId: base.id,
    });
  };

  // ─── Load offchain games list ───
  const loadOffchainGames = useCallback(async () => {
    const games = await getAvailableGames(address);
    setOffchainGames(games);
  }, [address]);

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
        setOffchainLoading(false);
        pendingAction.current = { action: "join", mode: "hybrid", joinId: gid };
        writeContract({
          address: SEABATTLE_CONTRACT_ADDRESS,
          abi: seaBattleAbi,
          functionName: "joinGame",
          args: [BigInt(gid)],
          chainId: base.id,
        });
      } catch (e: unknown) {
        setError((e as Error).message);
        setOffchainLoading(false);
      }
      return;
    }

    if (mode === "wager") {
      if (CONTRACT_NOT_SET) { setError("Contract not deployed"); return; }
      wagerActionRef.current = { action: "join", amount: wagerAmount, joinId: gid };
      writeApprove({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "approve",
        args: [SEABATTLE_CONTRACT_ADDRESS, BigInt(wagerAmount)],
        chainId: base.id,
      });
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
          <div className={styles.modeSelector}>
            {(["offchain", "bot", "hybrid", "wager"] as GameMode[]).map((m) => (
              <button
                key={m}
                className={`${styles.modeButton} ${mode === m ? styles.modeActive : ""}`}
                onClick={() => { setMode(m); setError(""); resetWrite(); }}
              >
                {m === "offchain"
                  ? "Free"
                  : m === "bot"
                    ? "Bot"
                    : m === "hybrid"
                      ? "Onchain"
                      : "Wager"}
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
              <label className={styles.privateToggle}>
                <input
                  type="checkbox"
                  checked={botOnchain}
                  onChange={(e) => setBotOnchain(e.target.checked)}
                />
                <span>Record on blockchain (2 txs)</span>
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
                <label className={styles.privateToggle}>
                  <input
                    type="checkbox"
                    checked={isPrivate}
                    onChange={(e) => setIsPrivate(e.target.checked)}
                  />
                  <span>Private game (invite only)</span>
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
