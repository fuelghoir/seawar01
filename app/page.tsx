"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useMiniApp } from "./providers/MiniAppProvider";
import { useRouter } from "next/navigation";
import {
  useAccount,
  useConnect,
  useReadContract,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
  useSwitchChain,
} from "wagmi";
import { base } from "wagmi/chains";
import { decodeEventLog } from "viem";
import {
  seaBattleAbi,
  SEABATTLE_CONTRACT_ADDRESS,
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
const MAX_GAMES_TO_LOAD = 20;
const CONTRACT_NOT_SET = SEABATTLE_CONTRACT_ADDRESS === ZERO_ADDR;

type GameMode = "onchain" | "offchain";

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
  const autoConnected = useRef(false);

  // Auto-connect
  useEffect(() => {
    if (isConnected || autoConnected.current || connectors.length === 0) return;
    autoConnected.current = true;
    connect({ connector: connectors[0] });
  }, [isConnected, connectors, connect]);

  // Auto-switch chain (onchain mode)
  useEffect(() => {
    if (isConnected && chainId && chainId !== base.id && mode === "onchain") {
      switchChain({ chainId: base.id });
    }
  }, [isConnected, chainId, switchChain, mode]);

  // --- ONCHAIN logic ---
  const {
    data: txHash,
    isPending,
    writeContract,
    error: writeError,
  } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, data: receipt } =
    useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (writeError) {
      const msg = writeError.message || "Transaction failed";
      const reasonMatch = msg.match(/reason:\s*(.+?)(?:\n|$)/);
      setError(reasonMatch ? reasonMatch[1] : msg.slice(0, 150));
    }
  }, [writeError]);

  useEffect(() => {
    if (isSuccess && receipt && action === "create" && mode === "onchain") {
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: seaBattleAbi,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === "GameCreated") {
            const gameId = (decoded.args as { gameId: bigint }).gameId;
            if (isPrivate) {
              const pGames = JSON.parse(localStorage.getItem("seabattle_private_games") || "[]");
              pGames.push(gameId.toString());
              localStorage.setItem("seabattle_private_games", JSON.stringify(pGames));
            }
            router.push(`/game?id=${gameId.toString()}&mode=onchain`);
            return;
          }
        } catch { /* not our event */ }
      }
    }
    if (isSuccess && action === "join" && mode === "onchain") {
      router.push(`/game?id=${joinGameId}&mode=onchain`);
    }
  }, [isSuccess, receipt, action, joinGameId, router, isPrivate, mode]);

  const handleCreateOnchain = () => {
    if (CONTRACT_NOT_SET) {
      setError("Contract not deployed");
      return;
    }
    setError("");
    setAction("create");
    writeContract({
      address: SEABATTLE_CONTRACT_ADDRESS,
      abi: seaBattleAbi,
      functionName: "createGame",
      chainId: base.id,
    });
  };

  const handleJoinOnchain = (id?: string) => {
    const gid = id || joinGameId;
    if (CONTRACT_NOT_SET) { setError("Contract not deployed"); return; }
    if (!gid || isNaN(Number(gid))) { setError("Enter a valid game ID"); return; }
    setError("");
    setAction("join");
    setJoinGameId(gid);
    writeContract({
      address: SEABATTLE_CONTRACT_ADDRESS,
      abi: seaBattleAbi,
      functionName: "joinGame",
      args: [BigInt(gid)],
      chainId: base.id,
    });
  };

  // Onchain games list
  const { data: nextGameId } = useReadContract({
    address: SEABATTLE_CONTRACT_ADDRESS,
    abi: seaBattleAbi,
    functionName: "nextGameId",
    query: { refetchInterval: 8000, enabled: !CONTRACT_NOT_SET && mode === "onchain" },
  });

  const totalGames = nextGameId ? Number(nextGameId) : 0;
  const loadCount = Math.min(totalGames, MAX_GAMES_TO_LOAD);

  const gameContracts = Array.from({ length: loadCount }, (_, i) => ({
    address: SEABATTLE_CONTRACT_ADDRESS,
    abi: seaBattleAbi,
    functionName: "getGame" as const,
    args: [BigInt(totalGames - 1 - i)] as const,
  }));

  const { data: gamesRaw } = useReadContracts({
    contracts: gameContracts,
    query: { enabled: loadCount > 0 && mode === "onchain", refetchInterval: 8000 },
  });

  const privateGameIds = typeof window !== "undefined"
    ? JSON.parse(localStorage.getItem("seabattle_private_games") || "[]") as string[]
    : [];

  const onchainGames: { id: number; player1: string }[] = [];
  if (gamesRaw) {
    for (let i = 0; i < gamesRaw.length; i++) {
      const result = gamesRaw[i];
      if (result.status !== "success" || !result.result) continue;
      const data = result.result as readonly unknown[];
      const state = Number(data[5]);
      const player1 = data[0] as string;
      const gid = totalGames - 1 - i;
      if (
        state === 0 && player1 !== ZERO_ADDR &&
        player1.toLowerCase() !== address?.toLowerCase() &&
        !privateGameIds.includes(gid.toString())
      ) {
        onchainGames.push({ id: gid, player1 });
      }
    }
  }

  // --- Check-in ---
  useEffect(() => {
    if (address) {
      getCheckinStatus(address).then(setCheckin).catch(() => {});
    }
  }, [address]);

  const handleCheckin = async () => {
    if (!address) return;
    setCheckinLoading(true);
    setCheckinMsg("");
    try {
      const result = await dailyCheckin(address);
      setCheckinMsg(`+${result.points} pts! Streak: ${result.streak} days`);
      setCheckin({ canCheckin: false, streak: result.streak, nextReward: Math.ceil((result.streak + 1) / 5) * 5 });
    } catch {
      setCheckinMsg("Already checked in today");
    }
    setCheckinLoading(false);
  };

  // --- OFFCHAIN logic ---
  const loadOffchainGames = useCallback(async () => {
    const games = await getAvailableGames(address);
    setOffchainGames(games);
  }, [address]);

  useEffect(() => {
    if (mode !== "offchain") return;
    loadOffchainGames();
    const interval = setInterval(loadOffchainGames, 5000);
    return () => clearInterval(interval);
  }, [mode, loadOffchainGames]);

  const handleCreateOffchain = async () => {
    if (!address) return;
    setError("");
    setOffchainLoading(true);
    try {
      const gameId = await createOffchainGame(address, isPrivate);
      router.push(`/game?id=${gameId}&mode=offchain`);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setOffchainLoading(false);
    }
  };

  const handleJoinOffchain = async (id?: string) => {
    const gid = id || joinGameId;
    if (!address) return;
    if (!gid || isNaN(Number(gid))) { setError("Enter a valid game ID"); return; }
    setError("");
    setOffchainLoading(true);
    try {
      await joinOffchainGame(Number(gid), address);
      router.push(`/game?id=${gid}&mode=offchain`);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setOffchainLoading(false);
    }
  };

  // --- Unified handlers ---
  const handleCreate = mode === "onchain" ? handleCreateOnchain : handleCreateOffchain;
  const handleJoin = mode === "onchain" ? handleJoinOnchain : handleJoinOffchain;
  const loading = mode === "onchain" ? (isPending || isConfirming) : offchainLoading;
  const games = mode === "onchain" ? onchainGames : offchainGames;

  const displayName = context?.user?.displayName || "Captain";

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <div className={styles.header}>
          <h1 className={styles.title}>SEA BATTLE</h1>
          <p className={styles.subtitle}>
            Ahoy, {displayName}!{" "}
            {mode === "onchain"
              ? "Every shot is an onchain transaction."
              : "Free to play, no gas fees."}
          </p>
        </div>

        {/* Mode selector */}
        {isConnected && (
          <div className={styles.modeSelector}>
            <button
              className={`${styles.modeButton} ${mode === "offchain" ? styles.modeActive : ""}`}
              onClick={() => { setMode("offchain"); setError(""); }}
            >
              Free Play
            </button>
            <button
              className={`${styles.modeButton} ${mode === "onchain" ? styles.modeActive : ""}`}
              onClick={() => { setMode("onchain"); setError(""); }}
            >
              Onchain
            </button>
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
            {mode === "onchain" && CONTRACT_NOT_SET && (
              <div className={styles.contractWarning}>
                Contract not deployed yet. Set NEXT_PUBLIC_SEABATTLE_CONTRACT_ADDRESS in .env
              </div>
            )}

            <button
              className={styles.primaryButton}
              onClick={handleCreate}
              disabled={loading || (mode === "onchain" && CONTRACT_NOT_SET)}
            >
              {loading && action === "create"
                ? mode === "onchain" ? "Confirm in wallet..." : "Creating..."
                : "Create Game"}
            </button>

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
                disabled={loading || !joinGameId || (mode === "onchain" && CONTRACT_NOT_SET)}
              >
                {loading && action === "join" ? "Joining..." : "Join"}
              </button>
            </div>

            {error && <p className={styles.error}>{error}</p>}

            {games.length > 0 && (
              <div className={styles.gameList}>
                <h3 className={styles.gameListTitle}>
                  Open Games ({games.length})
                </h3>
                {games.map((g) => (
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

            {games.length === 0 && (
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
                  {checkinLoading
                    ? "Checking in..."
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
          {mode === "onchain" && <span className={styles.network}>Base</span>}
          {mode === "offchain" && <span className={styles.networkFree}>Free Play</span>}
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
