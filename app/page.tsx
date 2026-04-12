"use client";

import { useState, useEffect } from "react";
import sdk from "@farcaster/miniapp-sdk";
import { useMiniApp } from "./providers/MiniAppProvider";
import { useRouter } from "next/navigation";
import {
  useAccount,
  useConnect,
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

export default function Home() {
  const { context, isReady } = useMiniApp();
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();

  const [joinGameId, setJoinGameId] = useState("");
  const [error, setError] = useState("");
  const [action, setAction] = useState<"create" | "join" | null>(null);

  // Auth
  const [_isAuthLoading, setIsAuthLoading] = useState(true);

  useEffect(() => {
    const authenticate = async () => {
      try {
        await sdk.quickAuth.fetch("/api/auth");
      } catch {
        // Auth optional for lobby
      } finally {
        setIsAuthLoading(false);
      }
    };
    if (isReady) authenticate();
  }, [isReady]);

  // Auto-connect wallet when inside Farcaster
  useEffect(() => {
    if (!isConnected && isReady && connectors.length > 0) {
      connect({ connector: connectors[0] });
    }
  }, [isConnected, isReady, connectors, connect]);

  const handleConnect = () => {
    if (connectors.length > 0) {
      connect({ connector: connectors[0] });
    }
  };

  // Contract write
  const {
    data: txHash,
    isPending,
    writeContract,
    reset: _reset,
  } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, data: receipt } =
    useWaitForTransactionReceipt({ hash: txHash });

  // After create game tx succeeds, extract gameId from logs and navigate
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
    setError("");
    setAction("create");
    writeContract({
      address: SEABATTLE_CONTRACT_ADDRESS,
      abi: seaBattleAbi,
      functionName: "createGame",
      chainId: base.id,
    });
  };

  const handleJoinGame = () => {
    setError("");
    if (!joinGameId || isNaN(Number(joinGameId))) {
      setError("Enter a valid game ID");
      return;
    }
    setAction("join");
    writeContract({
      address: SEABATTLE_CONTRACT_ADDRESS,
      abi: seaBattleAbi,
      functionName: "joinGame",
      args: [BigInt(joinGameId)],
      chainId: base.id,
    });
  };

  const handleShare = async (gameId?: string) => {
    try {
      await sdk.actions.composeCast({
        text: gameId
          ? `Play Sea Battle with me! Game #${gameId}`
          : "Play Sea Battle on Base!",
        embeds: [process.env.NEXT_PUBLIC_URL || ""],
      });
    } catch {
      // user cancelled
    }
  };

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
            <p className={styles.connectText}>
              {isReady
                ? "Connecting wallet..."
                : "Open this app in Farcaster to connect"}
            </p>
            <button
              className={styles.primaryButton}
              onClick={handleConnect}
              disabled={connectors.length === 0}
            >
              Connect Wallet
            </button>
          </div>
        ) : (
          <div className={styles.actions}>
            <button
              className={styles.primaryButton}
              onClick={handleCreateGame}
              disabled={isPending || isConfirming}
            >
              {isPending && action === "create"
                ? "Confirm in wallet..."
                : isConfirming && action === "create"
                  ? "Creating game..."
                  : "Create Game"}
            </button>

            <div className={styles.divider}>
              <span>or</span>
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
                onClick={handleJoinGame}
                disabled={isPending || isConfirming || !joinGameId}
              >
                {isPending && action === "join"
                  ? "Confirm..."
                  : isConfirming && action === "join"
                    ? "Joining..."
                    : "Join Game"}
              </button>
            </div>

            {error && <p className={styles.error}>{error}</p>}

            <button
              className={styles.shareButton}
              onClick={() => handleShare()}
            >
              Share with friends
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
    </div>
  );
}
