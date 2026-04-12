"use client";

import { useState, useEffect, useCallback } from "react";
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
  const { context, isReady, isInMiniApp } = useMiniApp();
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { connectAsync, connectors } = useConnect();

  const [joinGameId, setJoinGameId] = useState("");
  const [error, setError] = useState("");
  const [action, setAction] = useState<"create" | "join" | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  // Auth (only in mini app context)
  useEffect(() => {
    const authenticate = async () => {
      try {
        await sdk.quickAuth.fetch("/api/auth");
      } catch {
        // Auth optional for lobby
      }
    };
    if (isReady && isInMiniApp) authenticate();
  }, [isReady, isInMiniApp]);

  // Try connecting with each connector until one works
  const tryConnect = useCallback(async () => {
    if (isConnected || isConnecting || connectors.length === 0) return;
    setIsConnecting(true);
    for (const connector of connectors) {
      try {
        await connectAsync({ connector });
        break;
      } catch {
        // try next connector
      }
    }
    setIsConnecting(false);
  }, [isConnected, isConnecting, connectors, connectAsync]);

  // Auto-connect on load
  useEffect(() => {
    if (isReady && !isConnected) {
      tryConnect();
    }
  }, [isReady, isConnected, tryConnect]);

  // Contract write
  const {
    data: txHash,
    isPending,
    writeContract,
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
      // user cancelled or not in mini app
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
            <p className={styles.connectText}>Connect your wallet to play</p>
            <button
              className={styles.primaryButton}
              onClick={tryConnect}
              disabled={isConnecting}
            >
              {isConnecting ? "Connecting..." : "Connect Wallet"}
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
