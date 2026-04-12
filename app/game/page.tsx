"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  useAccount,
  useConnect,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { base } from "wagmi/chains";
import { keccak256, toHex, concatHex } from "viem";
import sdk from "@farcaster/miniapp-sdk";
import { useMiniApp } from "../providers/MiniAppProvider";
import {
  seaBattleAbi,
  SEABATTLE_CONTRACT_ADDRESS,
} from "../contracts/seaBattleAbi";
import { Board } from "../components/Board";
import { CellState } from "../components/Cell";
import { ShipPlacement } from "../components/ShipPlacement";
import { GameStatus } from "../components/GameStatus";
import { ShotTransaction } from "../components/ShotTransaction";
import styles from "./page.module.css";

// --- helpers ---

function buildBoardHash(
  boardLayout: number[],
  salt: Uint8Array
): `0x${string}` {
  const boardHex = toHex(new Uint8Array(boardLayout));
  const saltHex = toHex(salt);
  return keccak256(concatHex([boardHex, saltHex as `0x${string}`]));
}

function loadLocalBoard(gameId: string): {
  board: number[];
  salt: string;
} | null {
  try {
    const raw = localStorage.getItem(`seabattle_${gameId}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveLocalBoard(gameId: string, board: number[], salt: string) {
  localStorage.setItem(`seabattle_${gameId}`, JSON.stringify({ board, salt }));
}

// --- constants ---

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

// --- main component ---

function GameContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const gameIdStr = searchParams.get("id") || "0";
  const gameId = BigInt(gameIdStr);

  const { address, isConnected } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { isReady } = useMiniApp();
  const queryClient = useQueryClient();

  const [selectedCell, setSelectedCell] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [currentAction, setCurrentAction] = useState<
    "commit" | "shoot" | "report" | "reveal" | null
  >(null);

  // Auto-connect: try each connector until one works
  useEffect(() => {
    if (isConnected || !isReady || connectors.length === 0) return;
    const tryConnect = async () => {
      for (const connector of connectors) {
        try {
          await connectAsync({ connector });
          break;
        } catch {
          // try next
        }
      }
    };
    tryConnect();
  }, [isConnected, isReady, connectors, connectAsync]);

  // --- contract reads ---

  const { data: gameData } = useReadContract({
    address: SEABATTLE_CONTRACT_ADDRESS,
    abi: seaBattleAbi,
    functionName: "getGame",
    args: [gameId],
    query: { refetchInterval: 5000 },
  });

  const playerNum =
    address && gameData
      ? address.toLowerCase() === (gameData[0] as string).toLowerCase()
        ? 1
        : address.toLowerCase() === (gameData[1] as string).toLowerCase()
          ? 2
          : 0
      : 0;

  const opponentNum = playerNum === 1 ? 2 : 1;

  // My shots (attacks I made on opponent's board)
  const { data: myBoardData } = useReadContract({
    address: SEABATTLE_CONTRACT_ADDRESS,
    abi: seaBattleAbi,
    functionName: "getBoardState",
    args: [gameId, playerNum as unknown as number],
    query: {
      refetchInterval: 5000,
      enabled: playerNum > 0 && gameData !== undefined && Number(gameData[5]) >= 2,
    },
  });

  // Opponent's shots (attacks they made on my board)
  const { data: opponentBoardData } = useReadContract({
    address: SEABATTLE_CONTRACT_ADDRESS,
    abi: seaBattleAbi,
    functionName: "getBoardState",
    args: [gameId, opponentNum as unknown as number],
    query: {
      refetchInterval: 5000,
      enabled: playerNum > 0 && gameData !== undefined && Number(gameData[5]) >= 2,
    },
  });

  // --- contract write ---

  const {
    data: txHash,
    isPending,
    writeContract,
    reset: resetWrite,
  } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } =
    useWaitForTransactionReceipt({ hash: txHash });

  // Invalidate queries on success
  useEffect(() => {
    if (isSuccess) {
      queryClient.invalidateQueries();
      resetWrite();
      setCurrentAction(null);
      setSelectedCell(null);
    }
  }, [isSuccess, queryClient, resetWrite]);

  // --- derived state ---

  const gameState = gameData ? Number(gameData[5]) : -1; // 0=Created 1=PlacingShips 2=Active 3=Finished
  const turnPhase = gameData ? Number(gameData[6]) : 0; // 0=Shooting 1=WaitingReport
  const currentTurn = gameData ? Number(gameData[2]) : 0;
  const myHits = gameData
    ? playerNum === 1
      ? Number(gameData[3])
      : Number(gameData[4])
    : 0;
  const enemyHits = gameData
    ? playerNum === 1
      ? Number(gameData[4])
      : Number(gameData[3])
    : 0;
  const winner = gameData ? (gameData[7] as string) : ZERO_ADDR;
  const isMyTurn = currentTurn === playerNum;
  const lastShotX = gameData ? Number(gameData[10]) : 0;
  const lastShotY = gameData ? Number(gameData[11]) : 0;
  const lastShooter = gameData ? (gameData[12] as string) : ZERO_ADDR;
  const myBoardCommitted = gameData
    ? playerNum === 1
      ? gameData[8]
      : gameData[9]
    : false;
  const opponentBoardCommitted = gameData
    ? playerNum === 1
      ? gameData[9]
      : gameData[8]
    : false;

  // Need to report: game active, waiting report, I'm the opponent of lastShooter
  const needsReport =
    gameState === 2 &&
    turnPhase === 1 &&
    address !== undefined &&
    lastShooter !== ZERO_ADDR &&
    lastShooter.toLowerCase() !== address.toLowerCase();

  // --- local board ---
  const localData = loadLocalBoard(gameIdStr);

  // --- actions ---

  const handleCommitBoard = useCallback(
    (boardLayout: number[]) => {
      const salt = crypto.getRandomValues(new Uint8Array(32));
      const saltHex = toHex(salt);
      const boardHash = buildBoardHash(boardLayout, salt);

      saveLocalBoard(gameIdStr, boardLayout, saltHex);
      setCurrentAction("commit");

      writeContract({
        address: SEABATTLE_CONTRACT_ADDRESS,
        abi: seaBattleAbi,
        functionName: "commitBoard",
        args: [gameId, boardHash],
        chainId: base.id,
      });
    },
    [gameId, gameIdStr, writeContract]
  );

  const handleShoot = useCallback(() => {
    if (!selectedCell) return;
    setCurrentAction("shoot");
    writeContract({
      address: SEABATTLE_CONTRACT_ADDRESS,
      abi: seaBattleAbi,
      functionName: "shoot",
      args: [gameId, selectedCell.x, selectedCell.y],
      chainId: base.id,
    });
  }, [gameId, selectedCell, writeContract]);

  const handleReport = useCallback(() => {
    if (!localData) return;
    const idx = lastShotY * 10 + lastShotX;
    const isHit = localData.board[idx] === 1;
    setCurrentAction("report");
    writeContract({
      address: SEABATTLE_CONTRACT_ADDRESS,
      abi: seaBattleAbi,
      functionName: "reportHit",
      args: [gameId, lastShotX, lastShotY, isHit],
      chainId: base.id,
    });
  }, [gameId, lastShotX, lastShotY, localData, writeContract]);

  const handleReveal = useCallback(() => {
    if (!localData) return;
    setCurrentAction("reveal");
    const boardArr = localData.board.map((v: number) => v) as number[];
    writeContract({
      address: SEABATTLE_CONTRACT_ADDRESS,
      abi: seaBattleAbi,
      functionName: "revealBoard",
      args: [
        gameId,
        boardArr as unknown as readonly number[],
        localData.salt as `0x${string}`,
      ],
      chainId: base.id,
    });
  }, [gameId, localData, writeContract]);

  const handleShareResult = async () => {
    const didWin = winner.toLowerCase() === address?.toLowerCase();
    try {
      await sdk.actions.composeCast({
        text: didWin
          ? "I won a Sea Battle on Base!"
          : "Good game of Sea Battle on Base!",
        embeds: [process.env.NEXT_PUBLIC_URL || ""],
      });
    } catch {
      // cancelled
    }
  };

  // --- build board cells ---

  // My board: show my ships + opponent's shots on my board
  const myBoardCells: CellState[][] = Array.from({ length: 10 }, () =>
    Array(10).fill("empty" as CellState)
  );

  if (localData) {
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        if (localData.board[y * 10 + x] === 1) {
          myBoardCells[y][x] = "ship";
        }
      }
    }
  }

  // Overlay opponent shots on my board
  if (opponentBoardData) {
    const [oppShots, oppHits] = opponentBoardData as [boolean[], boolean[]];
    for (let i = 0; i < 100; i++) {
      const x = i % 10;
      const y = Math.floor(i / 10);
      if (oppShots[i]) {
        myBoardCells[y][x] = oppHits[i] ? "hit" : "miss";
      }
    }
  }

  // Enemy board: show my shots/hits
  const enemyBoardCells: CellState[][] = Array.from({ length: 10 }, () =>
    Array(10).fill("empty" as CellState)
  );

  if (myBoardData) {
    const [myShots, myHitsData] = myBoardData as [boolean[], boolean[]];
    for (let i = 0; i < 100; i++) {
      const x = i % 10;
      const y = Math.floor(i / 10);
      if (myShots[i]) {
        enemyBoardCells[y][x] = myHitsData[i] ? "hit" : "miss";
      }
    }
  }

  // Highlight selected cell
  if (selectedCell && enemyBoardCells[selectedCell.y][selectedCell.x] === "empty") {
    enemyBoardCells[selectedCell.y][selectedCell.x] = "pending";
  }

  // --- enemy cell click ---
  const handleEnemyCellClick = (x: number, y: number) => {
    if (!isMyTurn || turnPhase !== 0) return;
    if (enemyBoardCells[y][x] !== "empty" && enemyBoardCells[y][x] !== "pending")
      return;
    setSelectedCell({ x, y });
  };

  // --- render ---

  // Loading
  if (!gameData) {
    return (
      <div className={styles.container}>
        <div className={styles.centered}>
          <div className={styles.spinner} />
          <p className={styles.loadingText}>Loading game #{gameIdStr}...</p>
        </div>
      </div>
    );
  }

  // Not a player
  if (playerNum === 0 && gameState >= 1) {
    return (
      <div className={styles.container}>
        <div className={styles.centered}>
          <p className={styles.errorText}>You are not a player in this game.</p>
          <button className={styles.backButton} onClick={() => router.push("/")}>
            Back to Lobby
          </button>
        </div>
      </div>
    );
  }

  // Waiting for player 2
  if (gameState === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.centered}>
          <h2 className={styles.phaseTitle}>Game #{gameIdStr}</h2>
          <p className={styles.waitingText}>Waiting for opponent to join...</p>
          <p className={styles.hint}>
            Share this game ID with a friend:
          </p>
          <div className={styles.gameIdDisplay}>{gameIdStr}</div>
          <button
            className={styles.shareBtn}
            onClick={async () => {
              try {
                await sdk.actions.composeCast({
                  text: `Play Sea Battle with me! Game #${gameIdStr}`,
                  embeds: [process.env.NEXT_PUBLIC_URL || ""],
                });
              } catch { /* cancelled */ }
            }}
          >
            Share Game
          </button>
          <button className={styles.backButton} onClick={() => router.push("/")}>
            Back
          </button>
        </div>
      </div>
    );
  }

  // Ship placement phase
  if (gameState === 1 && !myBoardCommitted) {
    return (
      <div className={styles.container}>
        <div className={styles.scrollContent}>
          <ShipPlacement
            onConfirm={handleCommitBoard}
            isPending={isPending && currentAction === "commit"}
            isConfirming={isConfirming && currentAction === "commit"}
          />
        </div>
      </div>
    );
  }

  // Waiting for opponent to place ships
  if (gameState === 1 && myBoardCommitted && !opponentBoardCommitted) {
    return (
      <div className={styles.container}>
        <div className={styles.centered}>
          <h2 className={styles.phaseTitle}>Ships Placed!</h2>
          <p className={styles.waitingText}>
            Waiting for opponent to place their ships...
          </p>
          <div className={styles.spinner} />
        </div>
      </div>
    );
  }

  // Game finished
  if (gameState === 3) {
    const didWin = winner.toLowerCase() === address?.toLowerCase();
    return (
      <div className={styles.container}>
        <div className={styles.scrollContent}>
          <div className={styles.resultSection}>
            <h2
              className={`${styles.resultTitle} ${didWin ? styles.winTitle : styles.loseTitle}`}
            >
              {didWin ? "VICTORY!" : "DEFEAT"}
            </h2>
            <p className={styles.resultSubtitle}>
              {didWin
                ? "You sank all enemy ships!"
                : "Your fleet has been destroyed."}
            </p>

            <div className={styles.resultScores}>
              <span>You: {myHits}/20</span>
              <span>Enemy: {enemyHits}/20</span>
            </div>

            <div className={styles.resultBoards}>
              <Board
                cells={myBoardCells}
                isInteractive={false}
                label="Your Board"
              />
              <Board
                cells={enemyBoardCells}
                isInteractive={false}
                label="Enemy Board"
              />
            </div>

            {localData && (
              <button
                className={styles.revealButton}
                onClick={handleReveal}
                disabled={isPending || isConfirming}
              >
                {isPending && currentAction === "reveal"
                  ? "Confirm in wallet..."
                  : isConfirming && currentAction === "reveal"
                    ? "Revealing..."
                    : "Reveal Board"}
              </button>
            )}

            <div className={styles.resultActions}>
              <button className={styles.shareBtn} onClick={handleShareResult}>
                Share Result
              </button>
              <button
                className={styles.backButton}
                onClick={() => router.push("/")}
              >
                New Game
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Active game (state === 2)
  const canShoot = isMyTurn && turnPhase === 0 && !isPending && !isConfirming;

  return (
    <div className={styles.container}>
      <div className={styles.scrollContent}>
        <GameStatus
          isMyTurn={isMyTurn}
          myHits={myHits}
          enemyHits={enemyHits}
          isPending={isPending}
          isConfirming={isConfirming}
          turnPhase={turnPhase}
          needsReport={needsReport}
        />

        <div className={styles.boards}>
          <Board
            cells={enemyBoardCells}
            onCellClick={handleEnemyCellClick}
            isInteractive={canShoot}
            label="Enemy Waters"
          />
          <Board
            cells={myBoardCells}
            isInteractive={false}
            label="Your Fleet"
          />
        </div>

        <ShotTransaction
          selectedCell={selectedCell}
          isPending={isPending}
          isConfirming={isConfirming}
          isSuccess={isSuccess}
          onShoot={handleShoot}
          onReport={handleReport}
          needsReport={needsReport}
          disabled={!canShoot}
        />

        {needsReport && !localData && (
          <p className={styles.warningText}>
            Board data missing from local storage. Cannot auto-determine hit.
          </p>
        )}
      </div>
    </div>
  );
}

export default function GamePage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            background: "#0A1628",
            color: "#8ab4d4",
          }}
        >
          Loading...
        </div>
      }
    >
      <GameContent />
    </Suspense>
  );
}
