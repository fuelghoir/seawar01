"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { base } from "wagmi/chains";
import {
  seaBattleAbi,
  SEABATTLE_CONTRACT_ADDRESS,
} from "../contracts/seaBattleAbi";
import { BUILDER_CODE_SUFFIX } from "../providers";
import {
  generateRandomBoard,
  createBotState,
  botChooseTarget,
  botProcessResult,
  botNotifySunk,
  BotState,
} from "../lib/botAI";
import { findShips, isShipSunk, getSurroundingCells } from "../lib/shipUtils";
import { addPoints, recordGameResult } from "../lib/offchainGame";
import { gameSounds } from "../lib/sounds";
import { Board } from "../components/Board";
import { CellState } from "../components/Cell";
import { ShipPlacement } from "../components/ShipPlacement";
import styles from "./page.module.css";

const BOT_DELAY = 800; // ms delay for bot actions

type GamePhase = "placing" | "playing" | "finished";

export function BotGameContent({
  gameIdStr,
  isOnchain,
}: {
  gameIdStr: string;
  isOnchain: boolean;
}) {
  const router = useRouter();
  const { address } = useAccount();

  // Game state
  const [phase, setPhase] = useState<GamePhase>("placing");
  const [myBoard, setMyBoard] = useState<number[]>([]);
  const [botBoard, setBotBoard] = useState<number[]>([]);
  const [isMyTurn, setIsMyTurn] = useState(true);
  const [myHits, setMyHits] = useState(0);
  const [botHits, setBotHits] = useState(0);
  const [winner, setWinner] = useState<"me" | "bot" | null>(null);
  const [selectedCell, setSelectedCell] = useState<{ x: number; y: number } | null>(null);
  const [botProcessing, setBotProcessing] = useState(false);

  // Track all shots
  const [myShotsMap, setMyShotsMap] = useState<Map<number, boolean>>(new Map());
  const [botShotsMap, setBotShotsMap] = useState<Map<number, boolean>>(new Map());

  // Bot AI state
  const botState = useRef<BotState>(createBotState());

  // Refs for doBotTurn to avoid stale closures
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const myBoardRef = useRef(myBoard);
  myBoardRef.current = myBoard;
  const botHitsRef = useRef(botHits);
  botHitsRef.current = botHits;
  const doBotTurnRef = useRef<() => void>(() => {});

  // Onchain: record result
  const {
    data: resultTxHash,
    writeContract,
    isPending: resultPending,
  } = useWriteContract();
  const { isSuccess: resultConfirmed } = useWaitForTransactionReceipt({
    hash: resultTxHash,
  });
  const resultRecorded = useRef(false);

  // Record result onchain when game finishes
  useEffect(() => {
    if (winner && isOnchain && address && !resultRecorded.current && gameIdStr !== "0") {
      resultRecorded.current = true;
      const winnerAddr = winner === "me" ? address : "0x0000000000000000000000000000000000000001";
      writeContract({
        address: SEABATTLE_CONTRACT_ADDRESS,
        abi: seaBattleAbi,
        functionName: "recordResult",
        args: [BigInt(gameIdStr), winnerAddr as `0x${string}`],
        chainId: base.id,
        dataSuffix: BUILDER_CODE_SUFFIX,
      });
    }
  }, [winner, isOnchain, address, gameIdStr, writeContract]);

  // Record points (only for onchain bot games)
  const pointsRecorded = useRef(false);
  useEffect(() => {
    if (winner && address && isOnchain && !pointsRecorded.current) {
      pointsRecorded.current = true;
      const didWin = winner === "me";
      const hitPts = didWin ? myHits : 0;
      addPoints(address, hitPts + (didWin ? 50 : 0))
        .then(() => recordGameResult(address, didWin))
        .catch(() => {});
    }
  }, [winner, address, myHits]);

  // Start game after ship placement
  const handleConfirmBoard = useCallback((boardLayout: number[]) => {
    setMyBoard(boardLayout);
    const botBoardLayout = generateRandomBoard();
    setBotBoard(botBoardLayout);
    setPhase("playing");
    setIsMyTurn(true);
  }, []);

  // Player shoots
  const handleShoot = useCallback(() => {
    if (!selectedCell || !isMyTurn || phase !== "playing") return;
    gameSounds.playShot();

    const { x, y } = selectedCell;
    const idx = y * 10 + x;
    const isHit = botBoard[idx] === 1;

    setMyShotsMap((prev) => {
      const next = new Map(prev);
      next.set(idx, isHit);
      return next;
    });

    if (isHit) {
      const newHits = myHits + 1;
      setMyHits(newHits);
      setTimeout(() => gameSounds.playHit(), 200);

      // Check for sunk ship
      const ships = findShips(botBoard);
      const hitCells = new Set<number>();
      myShotsMap.forEach((hit, i) => { if (hit) hitCells.add(i); });
      hitCells.add(idx);
      const ship = ships.find((s) => s.includes(idx));
      if (ship && isShipSunk(ship, hitCells)) {
        setTimeout(() => gameSounds.playSunk(), 400);
      }

      if (newHits >= 20) {
        setWinner("me");
        setPhase("finished");
        setSelectedCell(null);
        return;
      }
      // Hit = keep turn
      setSelectedCell(null);
    } else {
      setTimeout(() => gameSounds.playMiss(), 200);
      setSelectedCell(null);
      setIsMyTurn(false);
      // Bot's turn after delay
      setBotProcessing(true);
      setTimeout(() => doBotTurnRef.current(), BOT_DELAY);
    }
  }, [selectedCell, isMyTurn, phase, botBoard, myHits, myShotsMap]);

  // Bot turn — uses refs to avoid stale closures
  doBotTurnRef.current = useCallback(() => {
    if (phaseRef.current !== "playing") return;

    const { x, y } = botChooseTarget(botState.current);
    const idx = y * 10 + x;
    const isHit = myBoardRef.current[idx] === 1;

    botProcessResult(botState.current, x, y, isHit);

    // Check if bot sunk a ship (we know the player's board)
    if (isHit) {
      const ships = findShips(myBoardRef.current);
      const allBotHits = new Set(botState.current.hits);
      const alreadySunk = new Set<number>();
      for (const s of botState.current.sunkShips) {
        for (const c of s) alreadySunk.add(c);
      }
      for (const ship of ships) {
        if (ship.every((c) => alreadySunk.has(c))) continue; // already reported
        if (isShipSunk(ship, allBotHits)) {
          botNotifySunk(botState.current, ship);
        }
      }
    }

    setBotShotsMap((prev) => {
      const next = new Map(prev);
      next.set(idx, isHit);
      return next;
    });

    if (isHit) {
      const newBotHits = botHitsRef.current + 1;
      setBotHits(newBotHits);
      botHitsRef.current = newBotHits;
      setTimeout(() => gameSounds.playAlert(), 200);

      if (newBotHits >= 20) {
        setWinner("bot");
        setPhase("finished");
        setBotProcessing(false);
        return;
      }
      // Bot hit = bot keeps turn
      setTimeout(() => doBotTurnRef.current(), BOT_DELAY);
    } else {
      // Bot missed = your turn
      setIsMyTurn(true);
      setBotProcessing(false);
    }
  }, []);

  // Build my board cells
  const myBoardCells: CellState[][] = Array.from({ length: 10 }, () =>
    Array(10).fill("empty" as CellState)
  );
  if (myBoard.length > 0) {
    for (let y = 0; y < 10; y++)
      for (let x = 0; x < 10; x++)
        if (myBoard[y * 10 + x] === 1) myBoardCells[y][x] = "ship";

    const ships = findShips(myBoard);
    const botHitCells = new Set<number>();
    botShotsMap.forEach((hit, i) => { if (hit) botHitCells.add(i); });

    const sunkShipCells = new Set<number>();
    for (const ship of ships) {
      if (isShipSunk(ship, botHitCells)) {
        for (const c of ship) sunkShipCells.add(c);
      }
    }

    botShotsMap.forEach((isHit, idx) => {
      const x = idx % 10;
      const y = Math.floor(idx / 10);
      if (isHit) {
        myBoardCells[y][x] = sunkShipCells.has(idx) ? "sunk" : "hit";
      } else {
        myBoardCells[y][x] = "miss";
      }
    });
  }

  // Build enemy (bot) board cells
  const enemyBoardCells: CellState[][] = Array.from({ length: 10 }, () =>
    Array(10).fill("empty" as CellState)
  );

  const sunkCellSet = new Set<number>();
  const surroundSet = new Set<number>();
  if (botBoard.length > 0) {
    const ships = findShips(botBoard);
    const myHitCells = new Set<number>();
    myShotsMap.forEach((hit, i) => { if (hit) myHitCells.add(i); });

    for (const ship of ships) {
      if (isShipSunk(ship, myHitCells)) {
        for (const c of ship) sunkCellSet.add(c);
        for (const idx of getSurroundingCells(ship)) {
          if (!sunkCellSet.has(idx)) surroundSet.add(idx);
        }
      }
    }
  }

  myShotsMap.forEach((isHit, idx) => {
    const x = idx % 10;
    const y = Math.floor(idx / 10);
    if (isHit) {
      enemyBoardCells[y][x] = sunkCellSet.has(idx) ? "sunk" : "hit";
    } else {
      enemyBoardCells[y][x] = "miss";
    }
  });

  for (const idx of surroundSet) {
    const x = idx % 10;
    const y = Math.floor(idx / 10);
    if (enemyBoardCells[y][x] === "empty") {
      enemyBoardCells[y][x] = "miss";
    }
  }

  if (selectedCell && enemyBoardCells[selectedCell.y][selectedCell.x] === "empty") {
    enemyBoardCells[selectedCell.y][selectedCell.x] = "pending";
  }

  const handleEnemyCellClick = (x: number, y: number) => {
    if (!isMyTurn || phase !== "playing" || botProcessing) return;
    if (enemyBoardCells[y][x] !== "empty" && enemyBoardCells[y][x] !== "pending") return;
    setSelectedCell({ x, y });
  };

  // ── Render ──

  if (phase === "placing") {
    return (
      <div className={styles.container}>
        <div className={styles.scrollContent}>
          <ShipPlacement
            onConfirm={handleConfirmBoard}
            isPending={false}
            isConfirming={false}
          />
        </div>
      </div>
    );
  }

  if (phase === "finished") {
    const didWin = winner === "me";
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
              {didWin ? "You sank all bot ships!" : "The bot destroyed your fleet."}
            </p>
            <div className={styles.resultScores}>
              <span>You: {myHits}/20</span>
              <span>Bot: {botHits}/20</span>
            </div>
            {isOnchain && resultPending && (
              <p className={styles.waitingText}>Recording result onchain...</p>
            )}
            {isOnchain && resultConfirmed && (
              <p className={styles.hint}>Result recorded onchain!</p>
            )}
            <div className={styles.resultBoards}>
              <Board cells={myBoardCells} isInteractive={false} label="Your Board" />
              <Board cells={enemyBoardCells} isInteractive={false} label="Bot Board" />
            </div>
            <div className={styles.resultActions}>
              <button className={styles.backButton} onClick={() => router.push("/")}>
                New Game
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.scrollContent}>
        <div className={styles.botStatus}>
          <div className={styles.turnIndicator}>
            {botProcessing ? "Bot is thinking..." : isMyTurn ? "Your Turn" : ""}
          </div>
          <div className={styles.hitCounters}>
            <span>You: {myHits}/20</span>
            <span>Bot: {botHits}/20</span>
          </div>
        </div>

        <div className={styles.boards}>
          <Board
            cells={enemyBoardCells}
            onCellClick={handleEnemyCellClick}
            isInteractive={isMyTurn && !botProcessing}
            label="Bot Waters"
          />
          <Board cells={myBoardCells} isInteractive={false} label="Your Fleet" />
        </div>

        {isMyTurn && !botProcessing && selectedCell && (
          <button className={styles.shareBtn} onClick={handleShoot}>
            Fire at {String.fromCharCode(1040 + selectedCell.x)}
            {selectedCell.y + 1}
          </button>
        )}
      </div>
    </div>
  );
}
