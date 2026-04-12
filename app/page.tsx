"use client";

import { useState, useEffect, useRef } from "react";
import { useMiniApp } from "./providers/MiniAppProvider";
import { useRouter } from "next/navigation";
import {
  useAccount,
  useConnect,
  useReadContract,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { base } from "wagmi/chains";
import { decodeEventLog } from "viem";
import {
  seaBattleAbi,
  SEABATTLE_CONTRACT_ADDRESS,
} from "./contracts/seaBattleAbi";
import styles from "./page.module.css";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const MAX_GAMES_TO_LOAD = 20;
const CONTRACT_NOT_SET = SEABATTLE_CONTRACT_ADDRESS === ZERO_ADDR;

export default function Home() {
  const { context } = useMiniApp();
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();

  const [joinGameId, setJoinGameId] = useState("");
  const [error, setError] = useState("");
  const [action, setAction] = useState<"create" | "join" | null>(null);
  const autoConnected = useRef(false);

  // Auto-connect once: try injected first (Base app), then baseAccount
  useEffect(() => {
    if (isConnected || autoConnected.current || connectors.length === 0) return;
    autoConnected.current = true;
    connect({ connector: connectors[0] });
  }, [isConnected, connectors, connect]);

  // Contract write
  const {
    data: txHash,
    isPending,
    writeContract,
    error: writeError,
  } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, data: receipt } =
    useWaitForTransactionReceipt({ hash: txHash });

  // Show write errors
  useEffect(() => {
    if (writeError) {
      const msg = writeError.message || "Transaction failed";
      // Extract short reason from error
      const reasonMatch = msg.match(/reason:\s*(.+?)(?:\n|$)/);
      setError(reasonMatch ? reasonMatch[1] : msg.slice(0, 150));
    }
  }, [writeError]);

  // After create game tx, navigate
  useEffect(() => {
    if (isSuccess && receipt && action === "create") {
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: seaBattleAbi,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === "GameCreated") {
            const gameId = (decoded.args as { gameId: bigint }).gameId;
            router.push(`/game?id=${gameId.toString()}`);
            return;
          }
        } catch {
          // not our event
        }
      }
    }
    if (isSuccess && action === "join") {
      router.push(`/game?id=${joinGameId}`);
    }
  }, [isSuccess, receipt, action, joinGameId, router]);

  const handleCreateGame = () => {
    if (CONTRACT_NOT_SET) {
      setError("Contract not deployed. Set NEXT_PUBLIC_SEABATTLE_CONTRACT_ADDRESS in .env");
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

  const handleJoinGame = (id?: string) => {
    const gid = id || joinGameId;
    if (CONTRACT_NOT_SET) {
      setError("Contract not deployed. Set NEXT_PUBLIC_SEABATTLE_CONTRACT_ADDRESS in .env");
      return;
    }
    setError("");
    if (!gid || isNaN(Number(gid))) {
      setError("Enter a valid game ID");
      return;
    }
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

  // --- Available games list ---
  const { data: nextGameId } = useReadContract({
    address: SEABATTLE_CONTRACT_ADDRESS,
    abi: seaBattleAbi,
    functionName: "nextGameId",
    query: { refetchInterval: 8000, enabled: !CONTRACT_NOT_SET },
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
    query: { enabled: loadCount > 0, refetchInterval: 8000 },
  });

  const availableGames: { id: number; player1: string }[] = [];
  if (gamesRaw) {
    for (let i = 0; i < gamesRaw.length; i++) {
      const result = gamesRaw[i];
      if (result.status !== "success" || !result.result) continue;
      const data = result.result as readonly unknown[];
      const state = Number(data[5]);
      const player1 = data[0] as string;
      if (
        state === 0 &&
        player1 !== ZERO_ADDR &&
        player1.toLowerCase() !== address?.toLowerCase()
      ) {
        availableGames.push({ id: totalGames - 1 - i, player1 });
      }
    }
  }

  const displayName = context?.user?.displayName || "Captain";

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <div className={styles.header}>
          <h1 className={styles.title}>SEA BATTLE</h1>
          <p className={styles.subtitle}>
            Ahoy, {displayName}! Every shot is an onchain transaction.
          </p>
        </div>

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
            {CONTRACT_NOT_SET && (
              <div className={styles.contractWarning}>
                Contract not deployed yet. Set NEXT_PUBLIC_SEABATTLE_CONTRACT_ADDRESS in .env
              </div>
            )}

            <button
              className={styles.primaryButton}
              onClick={handleCreateGame}
              disabled={isPending || isConfirming || CONTRACT_NOT_SET}
            >
              {isPending && action === "create"
                ? "Confirm in wallet..."
                : isConfirming && action === "create"
                  ? "Creating game..."
                  : "Create Game"}
            </button>

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
                onClick={() => handleJoinGame()}
                disabled={isPending || isConfirming || !joinGameId || CONTRACT_NOT_SET}
              >
                {isPending && action === "join" ? "Joining..." : "Join"}
              </button>
            </div>

            {error && <p className={styles.error}>{error}</p>}

            {availableGames.length > 0 && (
              <div className={styles.gameList}>
                <h3 className={styles.gameListTitle}>
                  Open Games ({availableGames.length})
                </h3>
                {availableGames.map((g) => (
                  <div key={g.id} className={styles.gameItem}>
                    <div className={styles.gameItemInfo}>
                      <span className={styles.gameItemId}>#{g.id}</span>
                      <span className={styles.gameItemPlayer}>
                        {g.player1.slice(0, 6)}...{g.player1.slice(-4)}
                      </span>
                    </div>
                    <button
                      className={styles.gameItemJoin}
                      onClick={() => handleJoinGame(g.id.toString())}
                      disabled={isPending || isConfirming}
                    >
                      Join
                    </button>
                  </div>
                ))}
              </div>
            )}

            {isConnected && availableGames.length === 0 && totalGames > 0 && (
              <p className={styles.noGames}>No open games. Create one!</p>
            )}
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
    </div>
  );
}
