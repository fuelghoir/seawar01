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

const BOT_DELAY = 800;
type GamePhase = "placing" | "playing" | "finished";
const BOT_OPPONENT = "0x0000000000000000000000000000000000000001" as const;

// ─── localStorage persistence ───

const SAVE_KEY = "sbt_bot";

interface SerializedBotState {
  shotsMade: number[];
  hits: number[];
  misses: number[];
  excluded: number[];
  sunkShips: number[][];
  remainingShipSizes: number[];
  targetHits: number[];
}

interface SavedBotGame {
  phase: GamePhase;
  myBoard: number[];
  botBoard: number[];
  isMyTurn: boolean;
  myHits: number;
  botHits: number;
  winner: "me" | "bot" | null;
  myShotsEntries: [number, boolean][];
  botShotsEntries: [number, boolean][];
  botStateData: SerializedBotState;
}

function serializeBotState(bs: BotState): SerializedBotState {
  return {
    shotsMade: [...bs.shotsMade],
    hits: [...bs.hits],
    misses: [...bs.misses],
    excluded: [...bs.excluded],
    sunkShips: bs.sunkShips,
    remainingShipSizes: bs.remainingShipSizes,
    targetHits: bs.targetHits,
  };
}

function deserializeBotState(d: SerializedBotState): BotState {
  return {
    shotsMade: new Set(d.shotsMade),
    hits: new Set(d.hits),
    misses: new Set(d.misses),
    excluded: new Set(d.excluded),
    sunkShips: d.sunkShips,
    remainingShipSizes: d.remainingShipSizes,
    targetHits: d.targetHits,
  };
}

function loadSave(): SavedBotGame | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? (JSON.parse(raw) as SavedBotGame) : null;
  } catch {
    return null;
  }
}

function deleteSave() {
  if (typeof window !== "undefined") localStorage.removeItem(SAVE_KEY);
}

// ─── Component ───

export function BotGameContent({ gameIdStr: _gameIdStr }: { gameIdStr: string }) {
  void _gameIdStr;
  const router = useRouter();
  const { address } = useAccount();

  // Load saved game once on mount
  const [save] = useState(loadSave);

  // Restore state from save (or start fresh)
  const [phase, setPhase] = useState<GamePhase>(() => save?.phase || "placing");
  const [myBoard, setMyBoard] = useState<number[]>(() => save?.myBoard || []);
  const [botBoard, setBotBoard] = useState<number[]>(() => save?.botBoard || []);
  const [isMyTurn, setIsMyTurn] = useState<boolean>(() => save?.isMyTurn ?? true);
  const [myHits, setMyHits] = useState<number>(() => save?.myHits ?? 0);
  const [botHits, setBotHits] = useState<number>(() => save?.botHits ?? 0);
  const [winner, setWinner] = useState<"me" | "bot" | null>(() => save?.winner ?? null);
  const [myShotsMap, setMyShotsMap] = useState<Map<number, boolean>>(
    () => save ? new Map(save.myShotsEntries) : new Map()
  );
  const [botShotsMap, setBotShotsMap] = useState<Map<number, boolean>>(
    () => save ? new Map(save.botShotsEntries) : new Map()
  );
  const [botProcessing, setBotProcessing] = useState(false);
  const [selectedCell, setSelectedCell] = useState<{ x: number; y: number } | null>(null);

  // Restore bot AI state from save
  const botState = useRef<BotState>(
    save?.botStateData ? deserializeBotState(save.botStateData) : createBotState()
  );

  // Don't re-award points if restoring a finished game
  const pointsRecorded = useRef(!!(save?.winner));

  // Refs for stale-closure safety in doBotTurn
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const myBoardRef = useRef(myBoard);
  myBoardRef.current = myBoard;
  const botHitsRef = useRef(botHits);
  botHitsRef.current = botHits;
  const doBotTurnRef = useRef<() => void>(() => {});

  // ─── Save state to localStorage after every meaningful change ───
  useEffect(() => {
    if (phase === "placing") return; // nothing to save yet
    try {
      const data: SavedBotGame = {
        phase,
        myBoard,
        botBoard,
        isMyTurn,
        myHits,
        botHits,
        winner,
        myShotsEntries: [...myShotsMap.entries()],
        botShotsEntries: [...botShotsMap.entries()],
        botStateData: serializeBotState(botState.current),
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch { /* storage full or unavailable */ }
  }, [phase, myBoard, botBoard, isMyTurn, myHits, botHits, winner, myShotsMap, botShotsMap]);

  // ─── If restored mid-game on bot's turn, auto-trigger bot ───
  const needsBotTurnOnMount = useRef(
    !!(save?.phase === "playing" && !save?.isMyTurn && !save?.winner)
  );
  useEffect(() => {
    if (!needsBotTurnOnMount.current) return;
    needsBotTurnOnMount.current = false;
    setBotProcessing(true);
    setTimeout(() => doBotTurnRef.current(), BOT_DELAY);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Onchain save result ───
  const {
    data: resultTxHash,
    writeContract,
    isPending: resultPending,
  } = useWriteContract();
  const { isSuccess: resultConfirmed } = useWaitForTransactionReceipt({ hash: resultTxHash });

  const handleSaveResult = useCallback(() => {
    if (!winner || !address) return;
    writeContract({
      address: SEABATTLE_CONTRACT_ADDRESS,
      abi: seaBattleAbi,
      functionName: "recordSoloResult",
      args: [BOT_OPPONENT, winner === "me"],
      chainId: base.id,
      dataSuffix: BUILDER_CODE_SUFFIX,
    });
  }, [winner, address, writeContract]);

  // Award local points + DB stats when game ends
  useEffect(() => {
    if (winner && address && !pointsRecorded.current) {
      pointsRecorded.current = true;
      const didWin = winner === "me";
      addPoints(address, myHits + (didWin ? 50 : 0))
        .then(() => recordGameResult(address, didWin))
        .catch(() => {});
    }
  }, [winner, address, myHits]);

  // ─── Ship placement ───
  const handleConfirmBoard = useCallback((boardLayout: number[]) => {
    setMyBoard(boardLayout);
    const botBoardLayout = generateRandomBoard();
    setBotBoard(botBoardLayout);
    setPhase("playing");
    setIsMyTurn(true);
  }, []);

  // ─── Player shoots ───
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
      setSelectedCell(null);
    } else {
      setTimeout(() => gameSounds.playMiss(), 200);
      setSelectedCell(null);
      setIsMyTurn(false);
      setBotProcessing(true);
      setTimeout(() => doBotTurnRef.current(), BOT_DELAY);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCell, isMyTurn, phase, botBoard, myHits, myShotsMap]);

  // ─── Bot turn ───
  doBotTurnRef.current = useCallback(() => {
    if (phaseRef.current !== "playing") return;

    const { x, y } = botChooseTarget(botState.current);
    const idx = y * 10 + x;
    const isHit = myBoardRef.current[idx] === 1;

    botProcessResult(botState.current, x, y, isHit);

    if (isHit) {
      const ships = findShips(myBoardRef.current);
      const allBotHits = new Set(botState.current.hits);
      const alreadySunk = new Set<number>();
      for (const s of botState.current.sunkShips) {
        for (const c of s) alreadySunk.add(c);
      }
      for (const ship of ships) {
        if (ship.every((c) => alreadySunk.has(c))) continue;
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
      setTimeout(() => doBotTurnRef.current(), BOT_DELAY);
    } else {
      setIsMyTurn(true);
      setBotProcessing(false);
    }
  }, []);

  // ─── Board rendering ───

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

  // ─── Render ───

  if (phase === "placing") {
    return (
      <div className={styles.container}>
        <div className={styles.scrollContent}>
          <ShipPlacement onConfirm={handleConfirmBoard} isPending={false} isConfirming={false} />
        </div>
      </div>
    );
  }

  if (phase === "finished") {
    const didWin = winner === "me";

    const revealedBotBoard: CellState[][] = Array.from({ length: 10 }, () =>
      Array(10).fill("empty" as CellState)
    );
    if (botBoard.length > 0) {
      for (let y = 0; y < 10; y++)
        for (let x = 0; x < 10; x++)
          if (botBoard[y * 10 + x] === 1) revealedBotBoard[y][x] = "ship";

      myShotsMap.forEach((isHit, idx) => {
        const x = idx % 10;
        const y = Math.floor(idx / 10);
        revealedBotBoard[y][x] = isHit
          ? sunkCellSet.has(idx) ? "sunk" : "hit"
          : "miss";
      });
    }

    return (
      <div className={styles.container}>
        <div className={styles.scrollContent}>
          <div className={styles.resultSection}>
            <h2 className={`${styles.resultTitle} ${didWin ? styles.winTitle : styles.loseTitle}`}>
              {didWin ? "VICTORY!" : "DEFEAT"}
            </h2>
            <p className={styles.resultSubtitle}>
              {didWin ? "You sank all bot ships!" : "The bot destroyed your fleet."}
            </p>
            <div className={styles.resultScores}>
              <span>You: {myHits}/20</span>
              <span>Bot: {botHits}/20</span>
            </div>
            <div className={styles.resultBoards}>
              <Board cells={myBoardCells} isInteractive={false} label="Your Board" />
              <Board cells={revealedBotBoard} isInteractive={false} label="Bot Fleet (revealed)" />
            </div>
            <div className={styles.resultActions}>
              {!resultConfirmed ? (
                <button
                  className={styles.saveResultButton}
                  onClick={handleSaveResult}
                  disabled={resultPending || !address}
                >
                  {resultPending ? "Confirming..." : "Save Result (1 tx)"}
                </button>
              ) : (
                <p className={styles.hint}>Saved onchain ✓</p>
              )}
              <button
                className={styles.backButton}
                onClick={() => { deleteSave(); router.push("/"); }}
              >
                New Game
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const canFire = isMyTurn && !botProcessing && !!selectedCell;

  return (
    <div className={styles.gameShell}>
      <div className={styles.gameScroll}>
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
      </div>

      <div className={styles.stickyFire}>
        <button
          className={styles.fireButton}
          onClick={handleShoot}
          disabled={!canFire}
        >
          {canFire
            ? `Fire at ${String.fromCharCode(1040 + selectedCell!.x)}${selectedCell!.y + 1}`
            : botProcessing
              ? "Bot is thinking..."
              : isMyTurn
                ? "Select a cell to fire"
                : "Waiting..."}
        </button>
      </div>
    </div>
  );
}
