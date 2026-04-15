"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  useAccount,
  useConnect,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useSwitchChain,
} from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { base } from "wagmi/chains";
import { keccak256, toHex, concatHex } from "viem";
import sdk from "@farcaster/miniapp-sdk";
import {
  seaBattleAbi,
  SEABATTLE_CONTRACT_ADDRESS,
} from "../contracts/seaBattleAbi";
import { Board } from "../components/Board";
import { CellState } from "../components/Cell";
import { ShipPlacement } from "../components/ShipPlacement";
import { GameStatus } from "../components/GameStatus";
import { ShotTransaction } from "../components/ShotTransaction";
import { OffchainGameContent } from "./OffchainGame";
import {
  recordGameResult,
  addPoints,
  getSunkReports,
  reportSunkShip,
  SunkReport,
} from "../lib/offchainGame";
import { findShips, isShipSunk, getSurroundingCells } from "../lib/shipUtils";
import { gameSounds } from "../lib/sounds";
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

// --- Onchain game component ---

function OnchainGameContent({ gameIdStr }: { gameIdStr: string }) {
  const router = useRouter();
  const gameId = BigInt(gameIdStr);

  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors } = useConnect();
  const { switchChain } = useSwitchChain();
  const queryClient = useQueryClient();
  const autoConnected = useRef(false);

  const [selectedCell, setSelectedCell] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [currentAction, setCurrentAction] = useState<
    "commit" | "shoot" | "report" | null
  >(null);
  const [sunkReports, setSunkReports] = useState<SunkReport[]>([]);

  // Sound tracking refs
  const prevMyHits = useRef(0);
  const prevNeedsReport = useRef(false);
  const prevSunkCount = useRef(0);
  const prevTurnPhase = useRef(-1);
  const prevCurrentTurn = useRef(-1);

  useEffect(() => {
    if (isConnected || autoConnected.current || connectors.length === 0) return;
    autoConnected.current = true;
    connect({ connector: connectors[0] });
  }, [isConnected, connectors, connect]);

  useEffect(() => {
    if (isConnected && chainId && chainId !== base.id) {
      switchChain({ chainId: base.id });
    }
  }, [isConnected, chainId, switchChain]);

  const { data: gameData } = useReadContract({
    address: SEABATTLE_CONTRACT_ADDRESS,
    abi: seaBattleAbi,
    functionName: "getGame",
    args: [gameId],
    query: { refetchInterval: 5000 },
  });

  const { data: gameExtra } = useReadContract({
    address: SEABATTLE_CONTRACT_ADDRESS,
    abi: seaBattleAbi,
    functionName: "getGameExtra",
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

  const {
    data: txHash,
    isPending,
    writeContract,
    reset: resetWrite,
  } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } =
    useWaitForTransactionReceipt({ hash: txHash });

  // Load sunk reports
  const loadSunkReports = useCallback(async () => {
    const reports = await getSunkReports(`on_${gameIdStr}`);
    setSunkReports(reports);
  }, [gameIdStr]);

  useEffect(() => {
    loadSunkReports();
    const interval = setInterval(loadSunkReports, 5000);
    return () => clearInterval(interval);
  }, [loadSunkReports]);

  useEffect(() => {
    if (isSuccess) {
      queryClient.invalidateQueries();

      // After auto-report, check for sunk ship
      const localData = loadLocalBoard(gameIdStr);
      if (currentAction === "report" && localData && gameExtra) {
        const lx = Number(gameExtra[2]);
        const ly = Number(gameExtra[3]);
        const idx = ly * 10 + lx;
        if (localData.board[idx] === 1) {
          const hitCells = new Set<number>();
          if (opponentBoardData) {
            const [, oppHits] = opponentBoardData as [boolean[], boolean[]];
            for (let i = 0; i < 100; i++) {
              if (oppHits[i]) {
                const x = Math.floor(i / 10);
                const y = i % 10;
                hitCells.add(y * 10 + x);
              }
            }
          }
          hitCells.add(idx);

          const ships = findShips(localData.board);
          const ship = ships.find(sh => sh.includes(idx));
          if (ship && isShipSunk(ship, hitCells)) {
            const lastShooter = gameExtra[4] as string;
            const shipCells = ship.map(i => [i % 10, Math.floor(i / 10)]);
            reportSunkShip(`on_${gameIdStr}`, shipCells, lastShooter).catch(() => {});
          }
        }
      }

      resetWrite();
      setCurrentAction(null);
      setSelectedCell(null);
    }
  }, [isSuccess, queryClient, resetWrite, currentAction, gameIdStr, gameExtra, opponentBoardData]);

  const gameState = gameData ? Number(gameData[5]) : -1;
  const turnPhase = gameData ? Number(gameData[6]) : 0;
  const currentTurn = gameData ? Number(gameData[2]) : 0;
  const myHits = gameData
    ? playerNum === 1 ? Number(gameData[3]) : Number(gameData[4])
    : 0;
  const enemyHits = gameData
    ? playerNum === 1 ? Number(gameData[4]) : Number(gameData[3])
    : 0;
  const winner = gameData ? (gameData[7] as string) : ZERO_ADDR;
  const isMyTurn = currentTurn === playerNum;
  const lastShotX = gameExtra ? Number(gameExtra[2]) : 0;
  const lastShotY = gameExtra ? Number(gameExtra[3]) : 0;
  const lastShooter = gameExtra ? (gameExtra[4] as string) : ZERO_ADDR;
  const myBoardCommitted = gameExtra
    ? playerNum === 1 ? gameExtra[0] : gameExtra[1]
    : false;
  const opponentBoardCommitted = gameExtra
    ? playerNum === 1 ? gameExtra[1] : gameExtra[0]
    : false;

  const needsReport =
    gameState === 2 && turnPhase === 1 && address !== undefined &&
    lastShooter !== ZERO_ADDR && lastShooter.toLowerCase() !== address.toLowerCase();

  const localData = loadLocalBoard(gameIdStr);

  // ── Sound effects ──

  if (myHits > prevMyHits.current && prevMyHits.current > 0) {
    gameSounds.playHit();
  }
  prevMyHits.current = myHits;

  if (needsReport && !prevNeedsReport.current) {
    gameSounds.playAlert();
  }
  prevNeedsReport.current = needsReport;

  const mySunks = address
    ? sunkReports.filter(r => r.killed_by === address.toLowerCase()).length
    : 0;
  if (mySunks > prevSunkCount.current && prevSunkCount.current > 0) {
    gameSounds.playSunk();
  }
  prevSunkCount.current = mySunks;

  if (
    prevTurnPhase.current === 1 &&
    turnPhase === 0 &&
    myHits === prevMyHits.current &&
    prevCurrentTurn.current === playerNum
  ) {
    gameSounds.playMiss();
  }
  prevTurnPhase.current = turnPhase;
  prevCurrentTurn.current = currentTurn;

  // Record result to leaderboard when game finishes
  const resultRecorded = useRef(false);
  useEffect(() => {
    if (gameState === 3 && address && playerNum > 0 && !resultRecorded.current) {
      resultRecorded.current = true;
      const didWin = winner.toLowerCase() === address.toLowerCase();
      recordGameResult(address, didWin).catch(() => {});
      if (myHits > 0) addPoints(address, myHits).catch(() => {});
    }
  }, [gameState, address, playerNum, winner, myHits]);

  const autoReported = useRef(false);
  useEffect(() => {
    if (needsReport && localData && !isPending && !isConfirming && !autoReported.current) {
      autoReported.current = true;
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
    }
    if (!needsReport) autoReported.current = false;
  }, [needsReport, localData, isPending, isConfirming, lastShotX, lastShotY, gameId, writeContract]);

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
    gameSounds.playShot();
    setCurrentAction("shoot");
    writeContract({
      address: SEABATTLE_CONTRACT_ADDRESS,
      abi: seaBattleAbi,
      functionName: "shoot",
      args: [gameId, selectedCell.x, selectedCell.y],
      chainId: base.id,
    });
  }, [gameId, selectedCell, writeContract]);

  const handleShareResult = async () => {
    const didWin = winner.toLowerCase() === address?.toLowerCase();
    try {
      await sdk.actions.composeCast({
        text: didWin ? "I won a Sea Battle on Base!" : "Good game of Sea Battle on Base!",
        embeds: [process.env.NEXT_PUBLIC_URL || ""],
      });
    } catch { /* cancelled */ }
  };

  // ── Build board cells with sunk detection ──

  const myBoardCells: CellState[][] = Array.from({ length: 10 }, () =>
    Array(10).fill("empty" as CellState)
  );

  if (localData) {
    for (let y = 0; y < 10; y++)
      for (let x = 0; x < 10; x++)
        if (localData.board[y * 10 + x] === 1) myBoardCells[y][x] = "ship";

    const ships = findShips(localData.board);
    const oppHitCells = new Set<number>();
    if (opponentBoardData) {
      const [, oppHits] = opponentBoardData as [boolean[], boolean[]];
      for (let i = 0; i < 100; i++) {
        if (oppHits[i]) {
          const x = Math.floor(i / 10);
          const y = i % 10;
          oppHitCells.add(y * 10 + x);
        }
      }
    }

    const sunkShipCells = new Set<number>();
    for (const ship of ships) {
      if (isShipSunk(ship, oppHitCells)) {
        for (const c of ship) sunkShipCells.add(c);
      }
    }

    if (opponentBoardData) {
      const [oppShots, oppHits] = opponentBoardData as [boolean[], boolean[]];
      for (let i = 0; i < 100; i++) {
        const x = Math.floor(i / 10);
        const y = i % 10;
        if (oppShots[i]) {
          const idx = y * 10 + x;
          if (oppHits[i]) {
            myBoardCells[y][x] = sunkShipCells.has(idx) ? "sunk" : "hit";
          } else {
            myBoardCells[y][x] = "miss";
          }
        }
      }
    }
  } else if (opponentBoardData) {
    const [oppShots, oppHits] = opponentBoardData as [boolean[], boolean[]];
    for (let i = 0; i < 100; i++) {
      const x = Math.floor(i / 10);
      const y = i % 10;
      if (oppShots[i]) myBoardCells[y][x] = oppHits[i] ? "hit" : "miss";
    }
  }

  const enemyBoardCells: CellState[][] = Array.from({ length: 10 }, () =>
    Array(10).fill("empty" as CellState)
  );

  const sunkCellSet = new Set<string>();
  const surroundSet = new Set<string>();
  if (address) {
    for (const report of sunkReports) {
      if (report.killed_by === address.toLowerCase()) {
        for (const [cx, cy] of report.ship_cells) {
          sunkCellSet.add(`${cx},${cy}`);
        }
        const shipIndices = report.ship_cells.map(([cx, cy]) => cy * 10 + cx);
        for (const idx of getSurroundingCells(shipIndices)) {
          const sx = idx % 10, sy = Math.floor(idx / 10);
          if (!sunkCellSet.has(`${sx},${sy}`)) surroundSet.add(`${sx},${sy}`);
        }
      }
    }
  }

  if (myBoardData) {
    const [myShots, myHitsData] = myBoardData as [boolean[], boolean[]];
    for (let i = 0; i < 100; i++) {
      const x = Math.floor(i / 10);
      const y = i % 10;
      if (myShots[i]) {
        if (myHitsData[i]) {
          enemyBoardCells[y][x] = sunkCellSet.has(`${x},${y}`) ? "sunk" : "hit";
        } else {
          enemyBoardCells[y][x] = "miss";
        }
      }
    }
  }

  for (const key of surroundSet) {
    const [sx, sy] = key.split(",").map(Number);
    if (enemyBoardCells[sy][sx] === "empty") {
      enemyBoardCells[sy][sx] = "miss";
    }
  }

  if (selectedCell && enemyBoardCells[selectedCell.y][selectedCell.x] === "empty") {
    enemyBoardCells[selectedCell.y][selectedCell.x] = "pending";
  }

  const handleEnemyCellClick = (x: number, y: number) => {
    if (!isMyTurn || turnPhase !== 0) return;
    if (enemyBoardCells[y][x] !== "empty" && enemyBoardCells[y][x] !== "pending") return;
    setSelectedCell({ x, y });
  };

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

  if (playerNum === 0 && gameState >= 1) {
    return (
      <div className={styles.container}>
        <div className={styles.centered}>
          <p className={styles.errorText}>You are not a player in this game.</p>
          <button className={styles.backButton} onClick={() => router.push("/")}>Back to Lobby</button>
        </div>
      </div>
    );
  }

  if (gameState === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.centered}>
          <h2 className={styles.phaseTitle}>Game #{gameIdStr}</h2>
          <p className={styles.waitingText}>Waiting for opponent to join...</p>
          <p className={styles.hint}>Share this game ID with a friend:</p>
          <div className={styles.gameIdDisplay}>{gameIdStr}</div>
          <button className={styles.shareBtn} onClick={async () => {
            try {
              await sdk.actions.composeCast({
                text: `Play Sea Battle with me! Game #${gameIdStr}`,
                embeds: [process.env.NEXT_PUBLIC_URL || ""],
              });
            } catch { /* cancelled */ }
          }}>Share Game</button>
          <button className={styles.backButton} onClick={() => router.push("/")}>Back</button>
        </div>
      </div>
    );
  }

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

  if (gameState === 1 && myBoardCommitted && !opponentBoardCommitted) {
    return (
      <div className={styles.container}>
        <div className={styles.centered}>
          <h2 className={styles.phaseTitle}>Ships Placed!</h2>
          <p className={styles.waitingText}>Waiting for opponent to place their ships...</p>
          <div className={styles.spinner} />
        </div>
      </div>
    );
  }

  if (gameState === 3) {
    const didWin = winner.toLowerCase() === address?.toLowerCase();
    return (
      <div className={styles.container}>
        <div className={styles.scrollContent}>
          <div className={styles.resultSection}>
            <h2 className={`${styles.resultTitle} ${didWin ? styles.winTitle : styles.loseTitle}`}>
              {didWin ? "VICTORY!" : "DEFEAT"}
            </h2>
            <p className={styles.resultSubtitle}>
              {didWin ? "You sank all enemy ships!" : "Your fleet has been destroyed."}
            </p>
            <div className={styles.resultScores}>
              <span>You: {myHits}/20</span>
              <span>Enemy: {enemyHits}/20</span>
            </div>
            <div className={styles.resultBoards}>
              <Board cells={myBoardCells} isInteractive={false} label="Your Board" />
              <Board cells={enemyBoardCells} isInteractive={false} label="Enemy Board" />
            </div>
            <div className={styles.resultActions}>
              <button className={styles.shareBtn} onClick={handleShareResult}>Share Result</button>
              <button className={styles.backButton} onClick={() => router.push("/")}>New Game</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const canShoot = isMyTurn && turnPhase === 0 && !isPending && !isConfirming;

  return (
    <div className={styles.container}>
      <div className={styles.scrollContent}>
        <GameStatus
          isMyTurn={isMyTurn} myHits={myHits} enemyHits={enemyHits}
          isPending={isPending} isConfirming={isConfirming}
          turnPhase={turnPhase} needsReport={needsReport}
        />
        <div className={styles.boards}>
          <Board cells={enemyBoardCells} onCellClick={handleEnemyCellClick} isInteractive={canShoot} label="Enemy Waters" />
          <Board cells={myBoardCells} isInteractive={false} label="Your Fleet" />
        </div>
        <ShotTransaction
          selectedCell={selectedCell} isPending={isPending} isConfirming={isConfirming}
          isSuccess={isSuccess} onShoot={handleShoot} needsReport={needsReport} disabled={!canShoot}
        />
        {needsReport && !localData && (
          <p className={styles.warningText}>Board data missing from local storage. Cannot auto-determine hit.</p>
        )}
      </div>
    </div>
  );
}

// --- Router component ---

function GameContent() {
  const searchParams = useSearchParams();
  const gameIdStr = searchParams.get("id") || "0";
  const mode = searchParams.get("mode") || "offchain";

  if (mode === "offchain") {
    return <OffchainGameContent gameIdStr={gameIdStr} />;
  }
  return <OnchainGameContent gameIdStr={gameIdStr} />;
}

export default function GamePage() {
  return (
    <Suspense
      fallback={
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          minHeight: "100vh", background: "#0A1628", color: "#8ab4d4",
        }}>
          Loading...
        </div>
      }
    >
      <GameContent />
    </Suspense>
  );
}
