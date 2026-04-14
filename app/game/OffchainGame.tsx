"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { keccak256, toHex, concatHex } from "viem";
import { supabase, OffchainGame } from "../lib/supabase";
import {
  commitOffchainBoard,
  shootOffchain,
  reportHitOffchain,
  getPlayerShots,
} from "../lib/offchainGame";
import { Board } from "../components/Board";
import { CellState } from "../components/Cell";
import { ShipPlacement } from "../components/ShipPlacement";
import { GameStatus } from "../components/GameStatus";
import { ShotTransaction } from "../components/ShotTransaction";
import styles from "./page.module.css";

function buildBoardHash(boardLayout: number[], salt: Uint8Array): string {
  const boardHex = toHex(new Uint8Array(boardLayout));
  const saltHex = toHex(salt);
  return keccak256(concatHex([boardHex, saltHex as `0x${string}`]));
}

function loadLocalBoard(gameId: string): { board: number[]; salt: string } | null {
  try {
    const raw = localStorage.getItem(`seabattle_off_${gameId}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function saveLocalBoard(gameId: string, board: number[], salt: string) {
  localStorage.setItem(`seabattle_off_${gameId}`, JSON.stringify({ board, salt }));
}

export function OffchainGameContent({ gameIdStr }: { gameIdStr: string }) {
  const router = useRouter();
  const { address } = useAccount();
  const gameIdNum = Number(gameIdStr);

  const [game, setGame] = useState<OffchainGame | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedCell, setSelectedCell] = useState<{ x: number; y: number } | null>(null);
  const [myShots, setMyShots] = useState<{ x: number; y: number; is_hit: boolean | null }[]>([]);
  const [oppShots, setOppShots] = useState<{ x: number; y: number; is_hit: boolean | null }[]>([]);
  const autoReported = useRef(false);

  // Load game data
  const loadGame = useCallback(async () => {
    const { data } = await supabase
      .from("games")
      .select("*")
      .eq("id", gameIdNum)
      .single();
    if (data) setGame(data as OffchainGame);
  }, [gameIdNum]);

  // Load shots
  const loadShots = useCallback(async () => {
    if (!address || !game) return;
    const pNum = game.player1 === address.toLowerCase() ? 1 : 2;
    const oppNum = pNum === 1 ? 2 : 1;
    const [my, opp] = await Promise.all([
      getPlayerShots(gameIdNum, pNum),
      getPlayerShots(gameIdNum, oppNum),
    ]);
    setMyShots(my);
    setOppShots(opp);
  }, [gameIdNum, address, game]);

  // Initial load
  useEffect(() => { loadGame(); }, [loadGame]);
  useEffect(() => { if (game && game.state >= 2) loadShots(); }, [game, loadShots]);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel(`game-${gameIdNum}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "games",
        filter: `id=eq.${gameIdNum}`,
      }, () => { loadGame(); })
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "shots",
        filter: `game_id=eq.${gameIdNum}`,
      }, () => { loadShots(); })
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "shots",
        filter: `game_id=eq.${gameIdNum}`,
      }, () => { loadShots(); })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [gameIdNum, loadGame, loadShots]);

  if (!game || !address) {
    return (
      <div className={styles.container}>
        <div className={styles.centered}>
          <div className={styles.spinner} />
          <p className={styles.loadingText}>Loading game #{gameIdStr}...</p>
        </div>
      </div>
    );
  }

  const addr = address.toLowerCase();
  const playerNum = game.player1 === addr ? 1 : game.player2 === addr ? 2 : 0;
  const isMyTurn = game.current_turn === playerNum;
  const myHits = playerNum === 1 ? game.player1_hits : game.player2_hits;
  const enemyHits = playerNum === 1 ? game.player2_hits : game.player1_hits;
  const myBoardCommitted = playerNum === 1 ? !!game.player1_board_hash : !!game.player2_board_hash;
  const oppBoardCommitted = playerNum === 1 ? !!game.player2_board_hash : !!game.player1_board_hash;
  const localData = loadLocalBoard(gameIdStr);

  const needsReport =
    game.state === 2 &&
    game.turn_phase === 1 &&
    game.last_shooter !== null &&
    game.last_shooter !== addr;

  // Auto-report for offchain
  if (needsReport && localData && !loading && !autoReported.current) {
    autoReported.current = true;
    const idx = (game.last_shot_y ?? 0) * 10 + (game.last_shot_x ?? 0);
    const isHit = localData.board[idx] === 1;
    reportHitOffchain(gameIdNum, address, game.last_shot_x ?? 0, game.last_shot_y ?? 0, isHit)
      .then(() => { loadGame(); loadShots(); })
      .finally(() => { autoReported.current = false; });
  }
  if (!needsReport) autoReported.current = false;

  // Handlers
  const handleCommitBoard = async (boardLayout: number[]) => {
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const saltHex = toHex(salt);
    const boardHash = buildBoardHash(boardLayout, salt);
    saveLocalBoard(gameIdStr, boardLayout, saltHex);
    setLoading(true);
    try {
      await commitOffchainBoard(gameIdNum, address, boardHash);
      await loadGame();
    } catch { /* ignore */ }
    setLoading(false);
  };

  const handleShoot = async () => {
    if (!selectedCell) return;
    setLoading(true);
    try {
      await shootOffchain(gameIdNum, address, selectedCell.x, selectedCell.y);
      setSelectedCell(null);
      await loadGame();
      await loadShots();
    } catch { /* ignore */ }
    setLoading(false);
  };

  // Build board cells
  const myBoardCells: CellState[][] = Array.from({ length: 10 }, () =>
    Array(10).fill("empty" as CellState)
  );
  if (localData) {
    for (let y = 0; y < 10; y++)
      for (let x = 0; x < 10; x++)
        if (localData.board[y * 10 + x] === 1) myBoardCells[y][x] = "ship";
  }
  for (const s of oppShots) {
    if (s.is_hit !== null) myBoardCells[s.y][s.x] = s.is_hit ? "hit" : "miss";
  }

  const enemyBoardCells: CellState[][] = Array.from({ length: 10 }, () =>
    Array(10).fill("empty" as CellState)
  );
  for (const s of myShots) {
    if (s.is_hit !== null) enemyBoardCells[s.y][s.x] = s.is_hit ? "hit" : "miss";
  }
  if (selectedCell && enemyBoardCells[selectedCell.y][selectedCell.x] === "empty") {
    enemyBoardCells[selectedCell.y][selectedCell.x] = "pending";
  }

  const handleEnemyCellClick = (x: number, y: number) => {
    if (!isMyTurn || game.turn_phase !== 0) return;
    if (enemyBoardCells[y][x] !== "empty" && enemyBoardCells[y][x] !== "pending") return;
    setSelectedCell({ x, y });
  };

  // Not a player
  if (playerNum === 0 && game.state >= 1) {
    return (
      <div className={styles.container}>
        <div className={styles.centered}>
          <p className={styles.errorText}>You are not a player in this game.</p>
          <button className={styles.backButton} onClick={() => router.push("/")}>Back to Lobby</button>
        </div>
      </div>
    );
  }

  // Waiting for player 2
  if (game.state === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.centered}>
          <h2 className={styles.phaseTitle}>Game #{gameIdStr}</h2>
          <p className={styles.waitingText}>Waiting for opponent to join...</p>
          <p className={styles.hint}>Share this game ID with a friend:</p>
          <div className={styles.gameIdDisplay}>{gameIdStr}</div>
          <button className={styles.backButton} onClick={() => router.push("/")}>Back</button>
        </div>
      </div>
    );
  }

  // Ship placement
  if (game.state === 1 && !myBoardCommitted) {
    return (
      <div className={styles.container}>
        <div className={styles.scrollContent}>
          <ShipPlacement
            onConfirm={handleCommitBoard}
            isPending={loading}
            isConfirming={false}
          />
        </div>
      </div>
    );
  }

  // Waiting for opponent ships
  if (game.state === 1 && myBoardCommitted && !oppBoardCommitted) {
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

  // Game finished
  if (game.state === 3) {
    const didWin = game.winner === addr;
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
              <button className={styles.backButton} onClick={() => router.push("/")}>New Game</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Active game
  const canShoot = isMyTurn && game.turn_phase === 0 && !loading;

  return (
    <div className={styles.container}>
      <div className={styles.scrollContent}>
        <GameStatus
          isMyTurn={isMyTurn}
          myHits={myHits}
          enemyHits={enemyHits}
          isPending={loading}
          isConfirming={false}
          turnPhase={game.turn_phase}
          needsReport={needsReport}
        />

        <div className={styles.boards}>
          <Board
            cells={enemyBoardCells}
            onCellClick={handleEnemyCellClick}
            isInteractive={canShoot}
            label="Enemy Waters"
          />
          <Board cells={myBoardCells} isInteractive={false} label="Your Fleet" />
        </div>

        <ShotTransaction
          selectedCell={selectedCell}
          isPending={loading}
          isConfirming={false}
          isSuccess={false}
          onShoot={handleShoot}
          needsReport={needsReport}
          disabled={!canShoot}
        />
      </div>
    </div>
  );
}
