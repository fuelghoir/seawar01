"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
  useReadContract,
} from "wagmi";
import { keccak256, toHex, concatHex } from "viem";
import { base } from "wagmi/chains";
import { supabase, OffchainGame } from "../lib/supabase";
import {
  seaBattleAbi,
  erc20Abi,
  SEABATTLE_CONTRACT_ADDRESS,
  USDC_ADDRESS,
} from "../contracts/seaBattleAbi";
import {
  commitOffchainBoard,
  shootOffchain,
  reportHitOffchain,
  getPlayerShots,
  getSunkReports,
  reportSunkShip,
  SunkReport,
} from "../lib/offchainGame";
import { findShips, isShipSunk, getSurroundingCells } from "../lib/shipUtils";
import { gameSounds } from "../lib/sounds";
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

type GameMode = "offchain" | "hybrid" | "wager";

export function OffchainGameContent({
  gameIdStr,
  mode = "offchain",
  onchainGameId,
}: {
  gameIdStr: string;
  mode?: GameMode;
  onchainGameId?: string;
}) {
  const router = useRouter();
  const { address } = useAccount();
  const gameIdNum = Number(gameIdStr);

  const [game, setGame] = useState<OffchainGame | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedCell, setSelectedCell] = useState<{ x: number; y: number } | null>(null);
  const [myShots, setMyShots] = useState<{ x: number; y: number; is_hit: boolean | null }[]>([]);
  const [oppShots, setOppShots] = useState<{ x: number; y: number; is_hit: boolean | null }[]>([]);
  const [sunkReports, setSunkReports] = useState<SunkReport[]>([]);
  const autoReported = useRef(false);

  // Sound tracking refs
  const prevMyHits = useRef(0);
  const prevNeedsReport = useRef(false);
  const prevSunkCount = useRef(0);
  const prevTurnPhase = useRef(-1);
  const prevCurrentTurn = useRef(-1);

  // ─── Onchain result recording (hybrid/wager) ───
  const {
    data: resultTxHash,
    writeContract: writeResult,
    isPending: resultPending,
  } = useWriteContract();
  const { isSuccess: resultConfirmed } = useWaitForTransactionReceipt({
    hash: resultTxHash,
  });

  // ─── Claim prize (wager) ───
  const {
    data: claimTxHash,
    writeContract: writeClaim,
    isPending: claimPending,
  } = useWriteContract();
  const { isSuccess: claimConfirmed } = useWaitForTransactionReceipt({
    hash: claimTxHash,
  });

  // ─── Buy bomb (wager) ───
  const {
    data: bombApproveTxHash,
    writeContract: writeBombApprove,
    isPending: bombApprovePending,
  } = useWriteContract();
  const { isSuccess: bombApproveConfirmed } = useWaitForTransactionReceipt({
    hash: bombApproveTxHash,
  });
  const {
    data: bombBuyTxHash,
    writeContract: writeBombBuy,
    isPending: bombBuyPending,
  } = useWriteContract();
  const { isSuccess: bombBuyConfirmed } = useWaitForTransactionReceipt({
    hash: bombBuyTxHash,
  });

  const [bombOwned, setBombOwned] = useState(false);
  const [bombUsed, setBombUsed] = useState(false);
  const [bombActive, setBombActive] = useState(false); // toggle for firing bomb
  const [bombBuying, setBombBuying] = useState(false);

  // Check bomb ownership from contract
  const { data: hasBombData } = useReadContract({
    address: SEABATTLE_CONTRACT_ADDRESS,
    abi: seaBattleAbi,
    functionName: "playerHasBomb",
    args: [BigInt(onchainGameId || "0"), address || "0x0000000000000000000000000000000000000000"],
    query: {
      enabled: mode === "wager" && !!onchainGameId && !!address,
      refetchInterval: 5000,
    },
  });

  useEffect(() => {
    if (hasBombData === true) setBombOwned(true);
  }, [hasBombData]);

  // After bomb approve, buy bomb
  useEffect(() => {
    if (bombApproveConfirmed && bombBuying && onchainGameId) {
      writeBombBuy({
        address: SEABATTLE_CONTRACT_ADDRESS,
        abi: seaBattleAbi,
        functionName: "buyBomb",
        args: [BigInt(onchainGameId)],
        chainId: base.id,
      });
    }
  }, [bombApproveConfirmed, bombBuying, onchainGameId, writeBombBuy]);

  useEffect(() => {
    if (bombBuyConfirmed) {
      setBombOwned(true);
      setBombBuying(false);
    }
  }, [bombBuyConfirmed]);

  const handleBuyBomb = () => {
    if (!address || bombOwned || bombBuying) return;
    setBombBuying(true);
    // Approve 2 USDC to contract
    writeBombApprove({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: "approve",
      args: [SEABATTLE_CONTRACT_ADDRESS, BigInt(2_000_000)],
      chainId: base.id,
    });
  };

  // ─── Record result onchain (hybrid/wager) ───
  const resultRecordedRef = useRef(false);
  useEffect(() => {
    if (
      game?.state === 3 &&
      game.winner &&
      address &&
      (mode === "hybrid" || mode === "wager") &&
      onchainGameId &&
      !resultRecordedRef.current
    ) {
      resultRecordedRef.current = true;
      writeResult({
        address: SEABATTLE_CONTRACT_ADDRESS,
        abi: seaBattleAbi,
        functionName: "recordResult",
        args: [BigInt(onchainGameId), game.winner as `0x${string}`],
        chainId: base.id,
      });
    }
  }, [game?.state, game?.winner, address, mode, onchainGameId, writeResult]);

  // Auto-claim prize after result confirmed (wager, winner only)
  useEffect(() => {
    if (
      resultConfirmed &&
      mode === "wager" &&
      onchainGameId &&
      game?.winner === address?.toLowerCase()
    ) {
      writeClaim({
        address: SEABATTLE_CONTRACT_ADDRESS,
        abi: seaBattleAbi,
        functionName: "claimPrize",
        args: [BigInt(onchainGameId)],
        chainId: base.id,
      });
    }
  }, [resultConfirmed, mode, onchainGameId, game?.winner, address, writeClaim]);

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

  // Load sunk reports
  const loadSunkReports = useCallback(async () => {
    const reports = await getSunkReports(`off_${gameIdNum}`);
    setSunkReports(reports);
  }, [gameIdNum]);

  // Initial load
  useEffect(() => { loadGame(); }, [loadGame]);
  useEffect(() => {
    if (game && game.state >= 2) {
      loadShots();
      loadSunkReports();
    }
  }, [game, loadShots, loadSunkReports]);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel(`game-${gameIdNum}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "games",
        filter: `id=eq.${gameIdNum}`,
      }, () => { loadGame(); })
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "shots",
        filter: `game_id=eq.${gameIdNum}`,
      }, () => { loadShots(); })
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "shots",
        filter: `game_id=eq.${gameIdNum}`,
      }, () => { loadShots(); })
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "sunk_reports",
        filter: `game_key=eq.off_${gameIdNum}`,
      }, () => { loadSunkReports(); })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [gameIdNum, loadGame, loadShots, loadSunkReports]);

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

  // ── Sound effects ──

  if (myHits > prevMyHits.current && prevMyHits.current > 0) {
    gameSounds.playHit();
  }
  prevMyHits.current = myHits;

  if (needsReport && !prevNeedsReport.current) {
    gameSounds.playAlert();
  }
  prevNeedsReport.current = needsReport;

  const mySunks = sunkReports.filter(r => r.killed_by === addr).length;
  if (mySunks > prevSunkCount.current && prevSunkCount.current > 0) {
    gameSounds.playSunk();
  }
  prevSunkCount.current = mySunks;

  if (
    prevTurnPhase.current === 1 &&
    game.turn_phase === 0 &&
    myHits === prevMyHits.current &&
    prevCurrentTurn.current === playerNum
  ) {
    gameSounds.playMiss();
  }
  prevTurnPhase.current = game.turn_phase;
  prevCurrentTurn.current = game.current_turn;

  // ── Auto-report with sunk detection ──

  if (needsReport && localData && !loading && !autoReported.current) {
    autoReported.current = true;
    const shotX = game.last_shot_x ?? 0;
    const shotY = game.last_shot_y ?? 0;
    const idx = shotY * 10 + shotX;
    const isHit = localData.board[idx] === 1;

    reportHitOffchain(gameIdNum, address, shotX, shotY, isHit)
      .then(async () => {
        if (isHit) {
          const hitCells = new Set<number>();
          for (const s of oppShots) {
            if (s.is_hit) hitCells.add(s.y * 10 + s.x);
          }
          hitCells.add(idx);

          const ships = findShips(localData.board);
          const ship = ships.find(sh => sh.includes(idx));
          if (ship && isShipSunk(ship, hitCells)) {
            const shipCells = ship.map(i => [i % 10, Math.floor(i / 10)]);
            await reportSunkShip(`off_${gameIdNum}`, shipCells, game.last_shooter!);
          }
        }
        loadGame();
        loadShots();
        loadSunkReports();
      })
      .finally(() => { autoReported.current = false; });
  }
  if (!needsReport) autoReported.current = false;

  // ── Handlers ──

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
    gameSounds.playShot();
    setLoading(true);

    if (bombActive && bombOwned && !bombUsed) {
      // Bomb shot: fire 3x3 area
      setBombUsed(true);
      setBombActive(false);
      const { x: cx, y: cy } = selectedCell;
      const cells: { x: number; y: number }[] = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx >= 0 && nx < 10 && ny >= 0 && ny < 10) {
            // Skip already-shot cells
            const alreadyShot = myShots.some(s => s.x === nx && s.y === ny);
            if (!alreadyShot) cells.push({ x: nx, y: ny });
          }
        }
      }
      // Fire each cell sequentially
      for (const cell of cells) {
        try {
          await shootOffchain(gameIdNum, address, cell.x, cell.y);
        } catch { /* cell may already be shot */ }
        // Small delay between shots for the auto-report to process
        await new Promise(r => setTimeout(r, 300));
        await loadGame();
        await loadShots();
        // Wait for auto-report to complete
        await new Promise(r => setTimeout(r, 500));
        await loadGame();
        await loadShots();
      }
      setSelectedCell(null);
      setLoading(false);
      return;
    }

    try {
      await shootOffchain(gameIdNum, address, selectedCell.x, selectedCell.y);
      setSelectedCell(null);
      await loadGame();
      await loadShots();
    } catch { /* ignore */ }
    setLoading(false);
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
    for (const s of oppShots) {
      if (s.is_hit) oppHitCells.add(s.y * 10 + s.x);
    }
    const sunkShipCells = new Set<number>();
    for (const ship of ships) {
      if (isShipSunk(ship, oppHitCells)) {
        for (const c of ship) sunkShipCells.add(c);
      }
    }

    for (const s of oppShots) {
      if (s.is_hit === null) continue;
      if (s.is_hit) {
        const idx = s.y * 10 + s.x;
        myBoardCells[s.y][s.x] = sunkShipCells.has(idx) ? "sunk" : "hit";
      } else {
        myBoardCells[s.y][s.x] = "miss";
      }
    }
  } else {
    for (const s of oppShots) {
      if (s.is_hit !== null) myBoardCells[s.y][s.x] = s.is_hit ? "hit" : "miss";
    }
  }

  const enemyBoardCells: CellState[][] = Array.from({ length: 10 }, () =>
    Array(10).fill("empty" as CellState)
  );

  const sunkCellSet = new Set<string>();
  const surroundSet = new Set<string>();
  for (const report of sunkReports) {
    if (report.killed_by === addr) {
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

  for (const s of myShots) {
    if (s.is_hit === null) continue;
    if (s.is_hit) {
      enemyBoardCells[s.y][s.x] = sunkCellSet.has(`${s.x},${s.y}`) ? "sunk" : "hit";
    } else {
      enemyBoardCells[s.y][s.x] = "miss";
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
    if (!isMyTurn || game.turn_phase !== 0) return;
    if (enemyBoardCells[y][x] !== "empty" && enemyBoardCells[y][x] !== "pending") return;
    setSelectedCell({ x, y });
  };

  // ── Render states ──

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

            {(mode === "hybrid" || mode === "wager") && (
              <div className={styles.onchainStatus}>
                {resultPending && <p className={styles.hint}>Recording result onchain...</p>}
                {resultConfirmed && !claimPending && mode !== "wager" && (
                  <p className={styles.hint}>Result recorded onchain!</p>
                )}
                {mode === "wager" && didWin && claimPending && (
                  <p className={styles.hint}>Claiming prize...</p>
                )}
                {mode === "wager" && didWin && claimConfirmed && (
                  <p className={styles.hint}>Prize claimed! 90% sent to your wallet.</p>
                )}
                {mode === "wager" && !didWin && resultConfirmed && (
                  <p className={styles.hint}>Result recorded. Better luck next time!</p>
                )}
              </div>
            )}

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

        {/* Bomb controls (wager only) */}
        {mode === "wager" && game.state === 2 && (
          <div className={styles.bombSection}>
            {!bombOwned && !bombBuying && (
              <button className={styles.bombBuyBtn} onClick={handleBuyBomb}>
                Buy Bomb 3x3 (2 USDC)
              </button>
            )}
            {bombBuying && (
              <p className={styles.hint}>
                {bombApprovePending
                  ? "Approve USDC..."
                  : bombBuyPending
                    ? "Buying bomb..."
                    : "Processing..."}
              </p>
            )}
            {bombOwned && !bombUsed && (
              <button
                className={`${styles.bombToggleBtn} ${bombActive ? styles.bombActiveBtn : ""}`}
                onClick={() => setBombActive(!bombActive)}
              >
                {bombActive ? "Bomb Active (3x3)" : "Use Bomb (3x3)"}
              </button>
            )}
            {bombUsed && (
              <p className={styles.hint}>Bomb used</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
