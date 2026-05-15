"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
  useReadContract,
  useConfig,
} from "wagmi";
import { readContract, simulateContract } from "@wagmi/core";
import { keccak256, toHex, concatHex } from "viem";
import { base } from "wagmi/chains";
import { supabase, OffchainGame } from "../lib/supabase";
import {
  seaBattleAbi,
  SEABATTLE_CONTRACT_ADDRESS,
} from "../contracts/seaBattleAbi";
import { BUILDER_CODE_SUFFIX } from "../providers";
import {
  commitOffchainBoard,
  shootOffchain,
  shootBombOffchain,
  shootLineOffchain,
  reportHitOffchain,
  getPlayerShots,
  getSunkReports,
  reportSunkShip,
  markPrizeClaimed,
  SunkReport,
} from "../lib/offchainGame";
import { consumeItem, getItemQuantity } from "../lib/season";
import { findShips, isShipSunk, getSurroundingCells } from "../lib/shipUtils";
import { gameSounds } from "../lib/sounds";
import { Board } from "../components/Board";
import { CellState } from "../components/Cell";
import { ShipPlacement } from "../components/ShipPlacement";
import { GameStatus } from "../components/GameStatus";
import { ShotTransaction } from "../components/ShotTransaction";
import { EmojiReactions } from "../components/EmojiReactions";
import { GameTopBar } from "./components/GameTopBar";
import { GameLobby } from "./components/GameLobby";
import { GameWaitOpponent } from "./components/GameWaitOpponent";
import { GameResult } from "./components/GameResult";
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

function friendResultSaveKey(gameId: string, wallet: string) {
  return `seabattle_friend_result_saved_${gameId}_${wallet.toLowerCase()}`;
}

type GameMode = "friend" | "wager";
type TacticalDirection = "up" | "right" | "down" | "left";

const TORPEDO_LENGTH = 3;
const TACTICAL_DIRS: Record<TacticalDirection, { dx: number; dy: number; label: string }> = {
  up: { dx: 0, dy: -1, label: "^" },
  right: { dx: 1, dy: 0, label: ">" },
  down: { dx: 0, dy: 1, label: "v" },
  left: { dx: -1, dy: 0, label: "<" },
};

function buildTorpedoLine(
  start: { x: number; y: number },
  direction: TacticalDirection
): { x: number; y: number }[] {
  const dir = TACTICAL_DIRS[direction];
  const cells: { x: number; y: number }[] = [];
  for (let i = 0; i < TORPEDO_LENGTH; i++) {
    const x = start.x + dir.dx * i;
    const y = start.y + dir.dy * i;
    if (x >= 0 && x < 10 && y >= 0 && y < 10) {
      cells.push({ x, y });
    }
  }
  return cells;
}

export function OffchainGameContent({
  gameIdStr,
  mode = "friend",
  onchainGameId,
}: {
  gameIdStr: string;
  mode?: GameMode;
  onchainGameId?: string;
}) {
  const router = useRouter();
  const { address } = useAccount();
  const wagmiConfig = useConfig();
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
  const { data: resultReceipt } = useWaitForTransactionReceipt({
    hash: resultTxHash,
  });
  const resultConfirmed = resultReceipt?.status === "success";
  const [wagerResultRecorded, setWagerResultRecorded] = useState(false);

  useEffect(() => {
    if (!address || mode !== "friend") {
      setFriendResultSaved(false);
      return;
    }
    setFriendResultSaved(
      typeof window !== "undefined" &&
        localStorage.getItem(friendResultSaveKey(gameIdStr, address)) === "1"
    );
  }, [address, gameIdStr, mode]);

  useEffect(() => {
    if (!resultConfirmed || !address || mode !== "friend") return;
    setFriendResultSaved(true);
    if (typeof window !== "undefined") {
      localStorage.setItem(friendResultSaveKey(gameIdStr, address), "1");
    }
  }, [resultConfirmed, address, gameIdStr, mode]);

  useEffect(() => {
    if (resultConfirmed && mode === "wager") {
      setWagerResultRecorded(true);
    }
  }, [resultConfirmed, mode]);

  useEffect(() => {
    if (mode !== "wager" || game?.state !== 3 || !onchainGameId) {
      setWagerResultRecorded(false);
      return;
    }

    let cancelled = false;
    const refreshOnchainResult = async () => {
      try {
        const onchain = (await readContract(wagmiConfig, {
          address: SEABATTLE_CONTRACT_ADDRESS,
          abi: seaBattleAbi,
          functionName: "getGame",
          args: [BigInt(onchainGameId)],
        })) as readonly [
          `0x${string}`,
          `0x${string}`,
          number,
          bigint,
          boolean,
          `0x${string}`,
          boolean,
        ];
        const [, , , , finished, winner, cancelledOnchain] = onchain;
        if (!cancelled) {
          setWagerResultRecorded(
            finished &&
              !cancelledOnchain &&
              !!game.winner &&
              winner.toLowerCase() === (game.winner as string).toLowerCase()
          );
        }
      } catch {
        // Keep the result screen usable even if one poll fails.
      }
    };

    refreshOnchainResult();
    const interval = window.setInterval(refreshOnchainResult, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [mode, game?.state, game?.winner, onchainGameId, wagmiConfig]);

  // ─── Claim prize (wager) ───
  const {
    data: claimTxHash,
    writeContract: writeClaim,
    isPending: claimPending,
  } = useWriteContract();
  const { data: claimReceipt } = useWaitForTransactionReceipt({
    hash: claimTxHash,
  });
  const claimConfirmed = claimReceipt?.status === "success";

  // ─── V5 bomb inventory (purchase in /shop, consume off-chain) ───
  // Contract tracks total purchased; off-chain games track which fired.
  // Available now = total - count(games where this addr fired a bomb).
  const [bombsUsedAcrossGames, setBombsUsedAcrossGames] = useState(0);
  const [bombActive, setBombActive] = useState(false);
  const [bombFiredLocal, setBombFiredLocal] = useState(false); // optimistic UI
  const bombQueueRef = useRef<{ x: number; y: number }[]>([]);
  const bombFiringRef = useRef(false);
  const [radarQty, setRadarQty] = useState(0);
  const [torpedoQty, setTorpedoQty] = useState(0);
  const [radarHints, setRadarHints] = useState<Set<string>>(() => new Set());
  const [torpedoActive, setTorpedoActive] = useState(false);
  const [torpedoDir, setTorpedoDir] = useState<TacticalDirection>("right");
  const [itemHint, setItemHint] = useState("");
  const [friendResultSaved, setFriendResultSaved] = useState(false);
  const torpedoQueueRef = useRef<{ x: number; y: number }[]>([]);
  const torpedoFiringRef = useRef(false);

  const { data: bombsData } = useReadContract({
    address: SEABATTLE_CONTRACT_ADDRESS,
    abi: seaBattleAbi,
    functionName: "playerBombs",
    args: [address || "0x0000000000000000000000000000000000000000"],
    query: {
      enabled: mode === "wager" && !!address,
      refetchInterval: 10000,
    },
  });
  const bombsTotal = Number(bombsData ?? BigInt(0));

  // Refresh "used across games" whenever the game state polls back.
  useEffect(() => {
    if (!address || mode !== "wager") return;
    import("../lib/offchainGame").then(({ getBombsUsedCount }) =>
      getBombsUsedCount(address).then(setBombsUsedAcrossGames).catch(() => {})
    );
  }, [address, mode, game?.id, game?.bomb_used_p1, game?.bomb_used_p2]);

  const refreshTacticalItems = useCallback(async () => {
    if (!address || mode !== "friend") {
      setRadarQty(0);
      setTorpedoQty(0);
      return;
    }
    const [radar, torpedo] = await Promise.all([
      getItemQuantity(address, "radar_scan").catch(() => 0),
      getItemQuantity(address, "torpedo").catch(() => 0),
    ]);
    setRadarQty(radar);
    setTorpedoQty(torpedo);
  }, [address, mode]);

  useEffect(() => {
    if (game?.state !== 2) return;
    refreshTacticalItems().catch(() => {});
  }, [game?.state, refreshTacticalItems]);

  const playerNumForBomb =
    address && game
      ? game.player1 === address.toLowerCase()
        ? 1
        : game.player2 === address.toLowerCase()
          ? 2
          : 0
      : 0;
  const bombUsedThisGame =
    bombFiredLocal ||
    (playerNumForBomb === 1 ? !!game?.bomb_used_p1 :
     playerNumForBomb === 2 ? !!game?.bomb_used_p2 : false);
  const bombsAvailable = Math.max(0, bombsTotal - bombsUsedAcrossGames);
  const canUseBomb = bombsAvailable > 0 && !bombUsedThisGame;

  // ─── Record result onchain (wager only) ───
  // Only the WINNER auto-calls recordResult — that's all claimPrize needs.
  // If both sides called like before we'd race: winner's tx wins the block,
  // loser's tx reverts with "Already finished" and burns gas. Loser updates
  // their stats from the off-chain game state alone in wager mode.
  // Friend mode: each player explicitly calls recordSoloResult via the
  // Save Result button — no auto-fire here.
  const resultRecordedRef = useRef(false);
  const handleRecordWagerResult = useCallback(async () => {
    if (
      game?.state !== 3 ||
      !game.winner ||
      !address ||
      mode !== "wager" ||
      !onchainGameId ||
      wagerResultRecorded
    ) {
      return;
    }

    const me = address.toLowerCase();
    if ((game.winner as string).toLowerCase() !== me) return;

    try {
      const onchain = (await readContract(wagmiConfig, {
        address: SEABATTLE_CONTRACT_ADDRESS,
        abi: seaBattleAbi,
        functionName: "getGame",
        args: [BigInt(onchainGameId)],
      })) as readonly [
        `0x${string}`,
        `0x${string}`,
        number,
        bigint,
        boolean,
        `0x${string}`,
        boolean,
      ];
      const [p1, p2, , , finished, onchainWinner, cancelled] = onchain;
      if (cancelled) return;
      if (
        finished &&
        onchainWinner.toLowerCase() === (game.winner as string).toLowerCase()
      ) {
        setWagerResultRecorded(true);
        return;
      }
      if (p1 === "0x0000000000000000000000000000000000000000") return;
      if (p1.toLowerCase() !== me && p2.toLowerCase() !== me) return;
    } catch {
      // If the read is flaky, still let the wallet/simulation surface the result.
    }

    writeResult({
      address: SEABATTLE_CONTRACT_ADDRESS,
      abi: seaBattleAbi,
      functionName: "recordResult",
      args: [BigInt(onchainGameId), game.winner as `0x${string}`],
      chainId: base.id,
      dataSuffix: BUILDER_CODE_SUFFIX,
    });
  }, [
    address,
    game?.state,
    game?.winner,
    mode,
    onchainGameId,
    wagerResultRecorded,
    wagmiConfig,
    writeResult,
  ]);
  useEffect(() => {
    if (
      game?.state !== 3 ||
      !game.winner ||
      !address ||
      mode !== "wager" ||
      !onchainGameId ||
      wagerResultRecorded ||
      resultRecordedRef.current
    ) {
      return;
    }
    // Only the winner records; loser does nothing onchain in wager mode.
    if ((game.winner as string).toLowerCase() !== address.toLowerCase()) {
      resultRecordedRef.current = true;
      return;
    }
    resultRecordedRef.current = true;

    (async () => {
      try {
        const onchain = (await readContract(wagmiConfig, {
          address: SEABATTLE_CONTRACT_ADDRESS,
          abi: seaBattleAbi,
          functionName: "getGame",
          args: [BigInt(onchainGameId)],
        })) as readonly [
          `0x${string}`,
          `0x${string}`,
          number,
          bigint,
          boolean,
          `0x${string}`,
          boolean,
        ];
        const [p1, p2, , , finished, , cancelled] = onchain;
        if (finished || cancelled) return;
        if (p1 === "0x0000000000000000000000000000000000000000") return;
        const me = address.toLowerCase();
        if (p1.toLowerCase() !== me && p2.toLowerCase() !== me) return;
        const w = (game.winner as string).toLowerCase();
        if (w !== p1.toLowerCase() && w !== p2.toLowerCase()) return;

        // Pre-simulate: if the call would revert anyway (race lost, etc.),
        // skip submitting so we don't waste gas on a confirmed revert.
        await simulateContract(wagmiConfig, {
          address: SEABATTLE_CONTRACT_ADDRESS,
          abi: seaBattleAbi,
          functionName: "recordResult",
          args: [BigInt(onchainGameId), game.winner as `0x${string}`],
          account: address,
        });
      } catch {
        return;
      }

      writeResult({
        address: SEABATTLE_CONTRACT_ADDRESS,
        abi: seaBattleAbi,
        functionName: "recordResult",
        args: [BigInt(onchainGameId), game.winner as `0x${string}`],
        chainId: base.id,
        dataSuffix: BUILDER_CODE_SUFFIX,
      });
    })();
  }, [game?.state, game?.winner, address, mode, onchainGameId, wagerResultRecorded, writeResult, wagmiConfig]);

  // Friend mode: explicit per-player save via V4 recordSoloResult.
  const handleSaveFriendResult = useCallback(() => {
    if (!address || !game?.winner || mode !== "friend") return;
    const me = address.toLowerCase();
    const isWin = (game.winner as string).toLowerCase() === me;
    const opponent = (
      game.player1.toLowerCase() === me ? game.player2 : game.player1
    ) as `0x${string}`;
    writeResult({
      address: SEABATTLE_CONTRACT_ADDRESS,
      abi: seaBattleAbi,
      functionName: "recordSoloResult",
      args: [opponent, isWin],
      chainId: base.id,
      dataSuffix: BUILDER_CODE_SUFFIX,
    });
  }, [address, game?.winner, game?.player1, game?.player2, mode, writeResult]);

  // Mark prize as claimed in DB after onchain tx confirms
  useEffect(() => {
    if (claimConfirmed && gameIdNum) {
      markPrizeClaimed(gameIdNum).catch(() => {});
    }
  }, [claimConfirmed, gameIdNum]);

  const handleClaim = useCallback(() => {
    if (!onchainGameId) return;
    writeClaim({
      address: SEABATTLE_CONTRACT_ADDRESS,
      abi: seaBattleAbi,
      functionName: "claimPrize",
      args: [BigInt(onchainGameId)],
      chainId: base.id,
      dataSuffix: BUILDER_CODE_SUFFIX,
    });
  }, [onchainGameId, writeClaim]);

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

  // Auto-fire remaining bomb shots when turn_phase returns to 0
  useEffect(() => {
    if (
      !game ||
      !address ||
      !bombFiringRef.current ||
      bombQueueRef.current.length === 0 ||
      game.turn_phase !== 0 ||
      game.state !== 2
    ) return;

    const addr2 = address.toLowerCase();
    const pNum = game.player1 === addr2 ? 1 : game.player2 === addr2 ? 2 : 0;
    if (game.current_turn !== pNum) {
      // Turn switched = bomb sequence ended
      bombFiringRef.current = false;
      bombQueueRef.current = [];
      return;
    }

    const nextCell = bombQueueRef.current.shift()!;
    shootOffchain(gameIdNum, address, nextCell.x, nextCell.y)
      .then(() => { loadGame(); loadShots(); })
      .catch(() => {
        // Cell might already be shot, try next
        if (bombQueueRef.current.length === 0) {
          bombFiringRef.current = false;
        }
      });

    if (bombQueueRef.current.length === 0) {
      bombFiringRef.current = false;
    }
  }, [game?.turn_phase, game?.state, game?.current_turn, address, gameIdNum, loadGame, loadShots]);

  useEffect(() => {
    if (
      !game ||
      !address ||
      !torpedoFiringRef.current ||
      torpedoQueueRef.current.length === 0 ||
      game.turn_phase !== 0 ||
      game.state !== 2
    ) return;

    const addr2 = address.toLowerCase();
    const pNum = game.player1 === addr2 ? 1 : game.player2 === addr2 ? 2 : 0;
    if (game.current_turn !== pNum) {
      torpedoFiringRef.current = false;
      torpedoQueueRef.current = [];
      return;
    }

    const nextCell = torpedoQueueRef.current.shift()!;
    setMyShots(prev => [...prev, { x: nextCell.x, y: nextCell.y, is_hit: null }]);
    shootOffchain(gameIdNum, address, nextCell.x, nextCell.y)
      .then(() => { loadGame(); loadShots(); })
      .catch(() => {
        setMyShots(prev => prev.filter(s => !(s.x === nextCell.x && s.y === nextCell.y && s.is_hit === null)));
        if (torpedoQueueRef.current.length === 0) {
          torpedoFiringRef.current = false;
        }
      });

    if (torpedoQueueRef.current.length === 0) {
      torpedoFiringRef.current = false;
    }
  }, [game?.turn_phase, game?.state, game?.current_turn, address, gameIdNum, loadGame, loadShots]);

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
          const oppNum = playerNum === 1 ? 2 : 1;
          const freshOppShots = await getPlayerShots(gameIdNum, oppNum);
          const hitCells = new Set<number>();
          for (const s of freshOppShots) {
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
      await commitOffchainBoard(gameIdNum, address, boardHash, boardLayout);
      await loadGame();
    } catch { /* ignore */ }
    setLoading(false);
  };

  const handleShoot = async () => {
    if (!selectedCell) return;
    gameSounds.playShot();
    setLoading(true);

    if (bombActive && canUseBomb) {
      // Bomb shot: fire 3x3 area via shootBombOffchain
      setBombFiredLocal(true);
      setBombActive(false);
      bombFiringRef.current = true;
      const { x: cx, y: cy } = selectedCell;

      // Build remaining cells queue (excluding first cell which shootBombOffchain fires)
      const cells: { x: number; y: number }[] = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx >= 0 && nx < 10 && ny >= 0 && ny < 10) {
            const alreadyShot = myShots.some(s => s.x === nx && s.y === ny);
            if (!alreadyShot) cells.push({ x: nx, y: ny });
          }
        }
      }

      // Store remaining cells (after first) in queue
      bombQueueRef.current = cells.slice(1);

      try {
        await shootBombOffchain(gameIdNum, address, cx, cy);
        Promise.all([loadGame(), loadShots()]).catch(() => {});
      } catch {
        bombFiringRef.current = false;
        bombQueueRef.current = [];
      }
      setSelectedCell(null);
      setLoading(false);
      return;
    }

    const { x, y } = selectedCell;
    // Optimistic: show shot immediately without waiting for server
    setMyShots(prev => [...prev, { x, y, is_hit: null }]);
    setSelectedCell(null);
    setLoading(false);

    try {
      await shootOffchain(gameIdNum, address, x, y);
      // Reload game + shots in parallel (not sequential)
      Promise.all([loadGame(), loadShots()]).catch(() => {});
    } catch {
      // Revert optimistic shot on error
      setMyShots(prev => prev.filter(s => !(s.x === x && s.y === y)));
    }
  };

  const handleUseRadar = async () => {
    if (mode !== "friend" || !address || !game || !isMyTurn || game.turn_phase !== 0 || loading) return;
    if (radarQty <= 0) {
      setItemHint("No radar scans in inventory");
      return;
    }

    const opponentBoardStr = playerNum === 1 ? game.player2_board : game.player1_board;
    if (!opponentBoardStr) {
      setItemHint("Radar needs the enemy board to be placed");
      return;
    }

    let opponentBoard: number[];
    try {
      opponentBoard = JSON.parse(opponentBoardStr) as number[];
    } catch {
      setItemHint("Radar could not read enemy board");
      return;
    }

    const candidates = opponentBoard
      .map((value, idx) => ({ value, idx, key: `${idx % 10},${Math.floor(idx / 10)}` }))
      .filter(({ value, key }) =>
        value === 1 &&
        !radarHints.has(key) &&
        !myShots.some(s => `${s.x},${s.y}` === key)
      );

    if (candidates.length === 0) {
      setItemHint("Radar found no new targets");
      return;
    }

    setLoading(true);
    try {
      await consumeItem(address, "radar_scan", 1);
      const hit = candidates[Math.floor(Math.random() * candidates.length)];
      setRadarHints(prev => {
        const next = new Set(prev);
        next.add(hit.key);
        return next;
      });
      setRadarQty(qty => Math.max(0, qty - 1));
      setItemHint(`Radar ping: ${String.fromCharCode(65 + (hit.idx % 10))}${Math.floor(hit.idx / 10) + 1}`);
    } catch (err) {
      setItemHint(err instanceof Error ? err.message : "Radar failed");
      refreshTacticalItems().catch(() => {});
    } finally {
      setLoading(false);
    }
  };

  const handleUseTorpedo = async () => {
    if (mode !== "friend" || !address || !game || !isMyTurn || game.turn_phase !== 0 || loading) return;
    if (!selectedCell) {
      setItemHint("Select torpedo start cell");
      return;
    }
    if (torpedoQty <= 0) {
      setItemHint("No torpedoes in inventory");
      return;
    }

    const line = buildTorpedoLine(selectedCell, torpedoDir)
      .filter(cell => !myShots.some(s => s.x === cell.x && s.y === cell.y));
    if (line.length === 0) {
      setItemHint("Pick a line with unshot cells");
      return;
    }

    setLoading(true);
    try {
      await consumeItem(address, "torpedo", 1);
      setTorpedoQty(qty => Math.max(0, qty - 1));
      setTorpedoActive(false);
      gameSounds.playShot();

      const [first, ...rest] = line;
      torpedoQueueRef.current = rest;
      torpedoFiringRef.current = rest.length > 0;
      setMyShots(prev => [...prev, { x: first.x, y: first.y, is_hit: null }]);
      setSelectedCell(null);
      setItemHint(`Torpedo line: ${line.length} cells`);

      await shootLineOffchain(gameIdNum, address, line);
      Promise.all([loadGame(), loadShots()]).catch(() => {});
    } catch (err) {
      torpedoFiringRef.current = false;
      torpedoQueueRef.current = [];
      setMyShots(prev => prev.filter(s => s.is_hit !== null));
      setItemHint(err instanceof Error ? err.message : "Torpedo failed");
      refreshTacticalItems().catch(() => {});
    } finally {
      setLoading(false);
    }
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
    if (s.is_hit === null) {
      // Shot fired but opponent hasn't reported yet — show as pending
      if (enemyBoardCells[s.y][s.x] === "empty") {
        enemyBoardCells[s.y][s.x] = "pending";
      }
      continue;
    }
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

  for (const key of radarHints) {
    const [sx, sy] = key.split(",").map(Number);
    if (enemyBoardCells[sy]?.[sx] === "empty") {
      enemyBoardCells[sy][sx] = "radar";
    }
  }

  if (
    selectedCell &&
    (enemyBoardCells[selectedCell.y][selectedCell.x] === "empty" ||
      enemyBoardCells[selectedCell.y][selectedCell.x] === "radar")
  ) {
    enemyBoardCells[selectedCell.y][selectedCell.x] = "pending";
  }

  const handleEnemyCellClick = (x: number, y: number) => {
    if (!isMyTurn || game.turn_phase !== 0) return;
    // Block already-fired cells (including optimistic pending shots)
    if (myShots.some(s => s.x === x && s.y === y)) return;
    if (
      enemyBoardCells[y][x] !== "empty" &&
      enemyBoardCells[y][x] !== "pending" &&
      enemyBoardCells[y][x] !== "radar"
    ) return;
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
      <>
        <GameTopBar mode={mode} phase="lobby" />
        <GameLobby
          mode={mode}
          gameId={gameIdStr}
          wagerAmount={mode === "wager" ? game.wager_amount ?? undefined : undefined}
          onCancel={() => router.push("/")}
        />
      </>
    );
  }

  if (game.state === 1 && !myBoardCommitted) {
    return (
      <>
        <GameTopBar mode={mode} phase="placement" />
        <div className={styles.container}>
          <div className={styles.scrollContent}>
            <ShipPlacement
              onConfirm={handleCommitBoard}
              isPending={loading}
              isConfirming={false}
            />
          </div>
        </div>
      </>
    );
  }

  if (game.state === 1 && myBoardCommitted && !oppBoardCommitted) {
    const accent =
      mode === "wager" ? "var(--accent)" : mode === "friend" ? "var(--accent-2)" : "var(--accent)";
    return (
      <>
        <GameTopBar mode={mode} phase="placement" />
        <GameWaitOpponent accent={accent} />
      </>
    );
  }

  if (game.state === 3) {
    const didWin = game.winner === addr;
    const wagerResultReady = mode === "wager" ? wagerResultRecorded : resultConfirmed;
    const resultSaving =
      resultPending ||
      (!!resultTxHash && !resultReceipt && (mode !== "wager" || !wagerResultRecorded));

    // Build full enemy board revealing undestroyed ships
    const fullEnemyBoard: CellState[][] = Array.from({ length: 10 }, () =>
      Array(10).fill("empty" as CellState)
    );
    const opponentBoardStr = playerNum === 1 ? game.player2_board : game.player1_board;
    if (opponentBoardStr) {
      try {
        const opponentBoard = JSON.parse(opponentBoardStr) as number[];
        for (let y = 0; y < 10; y++) {
          for (let x = 0; x < 10; x++) {
            if (opponentBoard[y * 10 + x] === 1) fullEnemyBoard[y][x] = "ship";
          }
        }
        // Overlay my shots (hits/misses) on top; game over = all hits are sunk
        for (const s of myShots) {
          if (s.is_hit === null) continue;
          fullEnemyBoard[s.y][s.x] = s.is_hit ? (didWin ? "sunk" : "hit") : "miss";
        }
      } catch { /* fall through to shot-only view */ }
    }

    // Build full my board showing opponent's hits/misses
    const fullMyBoard: CellState[][] = Array.from({ length: 10 }, () =>
      Array(10).fill("empty" as CellState)
    );
    if (localData) {
      for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
          if (localData.board[y * 10 + x] === 1) fullMyBoard[y][x] = "ship";
        }
      }
      for (const s of oppShots) {
        if (s.is_hit === null) continue;
        fullMyBoard[s.y][s.x] = s.is_hit ? (!didWin ? "sunk" : "hit") : "miss";
      }
    }

    const showClaimButton =
      mode === "wager" &&
      didWin &&
      wagerResultReady &&
      !game.prize_claimed &&
      !claimConfirmed;

    const prizeUsdc =
      mode === "wager" && game.wager_amount && didWin
        ? `+${((game.wager_amount * 2 * 0.9) / 1_000_000).toFixed(2)}`
        : null;

    const primaryHandler = () => router.push("/");
    const primaryLabel = "← Main Menu";
    const primaryDisabled = false;
    let secondaryHandler: (() => void) | undefined;
    let secondaryLabel: string | undefined;
    let secondaryVariant: "default" | "claim" = "default";
    let message =
      didWin
        ? "All enemy ships sunk! The ocean is yours, Captain."
        : "Your fleet was destroyed. Regroup and fight back.";

    if (mode === "wager") {
      if (didWin) {
        if (claimConfirmed) {
          message = "Prize claimed — 90% transferred to your wallet ⚓";
        } else if (showClaimButton) {
          secondaryHandler = handleClaim;
          secondaryVariant = "claim";
          secondaryLabel = "💰 CLAIM PRIZE (90%)";
        } else if (claimPending) {
          message = "Claiming prize…";
        } else if (resultSaving) {
          message = "Recording result onchain…";
        } else if (!wagerResultReady) {
          secondaryHandler = handleRecordWagerResult;
          secondaryLabel = "RECORD RESULT (1 TX)";
          message = "Wait for result to be recorded onchain…";
        }
      } else if (!wagerResultReady) {
        message = "Result is being recorded onchain…";
      }
      if (!didWin && !wagerResultReady) {
        message = "Waiting for winner to record result onchain.";
      }
    } else if (mode === "friend") {
      if (!resultConfirmed && !friendResultSaved) {
        if (resultSaving) {
          message = "Confirming result save…";
        } else {
          secondaryHandler = handleSaveFriendResult;
          secondaryLabel = "💾 SAVE RESULT (1 TX)";
        }
      }
    }

    return (
      <>
        <GameTopBar mode={mode} phase="result" />
        <GameResult
          didWin={didWin}
          mode={mode}
          myHits={myHits}
          enemyHits={enemyHits}
          prizeUsdc={prizeUsdc}
          message={message}
          onPrimary={primaryHandler}
          primaryLabel={primaryLabel}
          primaryDisabled={primaryDisabled}
          onSecondary={secondaryHandler}
          secondaryLabel={secondaryLabel}
          secondaryVariant={secondaryVariant}
        >
          <div className={styles.resultBoards}>
            <Board cells={fullMyBoard} isInteractive={false} label="Your Fleet" />
            <Board cells={fullEnemyBoard} isInteractive={false} label="Enemy Fleet" />
          </div>
        </GameResult>
      </>
    );
  }

  const canUseTactical = mode === "friend" && isMyTurn && game.turn_phase === 0 && !loading;
  const canShoot = isMyTurn && game.turn_phase === 0 && !loading && !torpedoActive;
  const canFireTorpedo = canUseTactical && !!selectedCell && torpedoQty > 0;

  // Hit-count proxies for the top bar (each board has 20 ship cells).
  const enemyShipsAlive = Math.max(0, 20 - myHits);
  const yourShipsAlive = Math.max(0, 20 - enemyHits);

  const turnLabel = needsReport
    ? "REPORT HIT"
    : isMyTurn
      ? "YOUR TURN"
      : "ENEMY TURN";
  const modeAccent =
    mode === "wager" ? "var(--accent)" : mode === "friend" ? "var(--accent-2)" : "var(--accent)";
  const turnAccent = isMyTurn ? modeAccent : "#ef4444";

  return (
    <div className={styles.gameShell}>
      <GameTopBar
        mode={mode}
        phase="battle"
        turnLabel={turnLabel}
        turnAccent={turnAccent}
        yourShips={yourShipsAlive}
        enemyShips={enemyShipsAlive}
      />
      <EmojiReactions gameId={gameIdNum} playerNum={playerNum} />

      <div className={styles.gameScroll}>
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
            isInteractive={isMyTurn && game.turn_phase === 0 && !loading}
            label="Enemy Waters"
          />
          <Board cells={myBoardCells} isInteractive={false} label="Your Fleet" />
        </div>
      </div>

      <div className={styles.stickyFire}>
        {mode === "friend" && game.state === 2 && (
          <div className={styles.tacticalSection}>
            <div className={styles.tacticalButtons}>
              <button
                type="button"
                className={`${styles.tacticalBtn} ${styles.radarBtn}`}
                onClick={handleUseRadar}
                disabled={!canUseTactical || radarQty <= 0}
              >
                Radar · {radarQty}
              </button>
              <button
                type="button"
                className={`${styles.tacticalBtn} ${styles.torpedoBtn} ${torpedoActive ? styles.tacticalActive : ""}`}
                onClick={() => setTorpedoActive(active => !active)}
                disabled={!canUseTactical || torpedoQty <= 0}
              >
                Torpedo · {torpedoQty}
              </button>
            </div>
            {torpedoActive && (
              <>
                <div className={styles.directionPanel}>
                  {(Object.keys(TACTICAL_DIRS) as TacticalDirection[]).map((direction) => (
                    <button
                      type="button"
                      key={direction}
                      className={`${styles.directionBtn} ${torpedoDir === direction ? styles.directionActive : ""}`}
                      onClick={() => setTorpedoDir(direction)}
                      disabled={!canUseTactical}
                    >
                      {TACTICAL_DIRS[direction].label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className={styles.torpedoFireBtn}
                  onClick={handleUseTorpedo}
                  disabled={!canFireTorpedo}
                >
                  {selectedCell
                    ? `Fire Line ${String.fromCharCode(65 + selectedCell.x)}${selectedCell.y + 1}`
                    : "Select Torpedo Start"}
                </button>
              </>
            )}
            <div className={styles.itemHint}>{itemHint}</div>
          </div>
        )}
        <ShotTransaction
          selectedCell={selectedCell}
          isPending={loading}
          isConfirming={false}
          isSuccess={false}
          onShoot={handleShoot}
          needsReport={needsReport}
          disabled={!canShoot}
        />

        {/* Bomb controls (wager only) — inventory bought in /shop */}
        {mode === "wager" && game.state === 2 && (
          <div className={styles.bombSection}>
            {canUseBomb && (
              <button
                className={`${styles.bombToggleBtn} ${bombActive ? styles.bombActiveBtn : ""}`}
                onClick={() => setBombActive(!bombActive)}
              >
                {bombActive
                  ? `Bomb Active (3x3)`
                  : `Use Bomb (3x3) · ${bombsAvailable}`}
              </button>
            )}
            {bombUsedThisGame && (
              <p className={styles.hint}>Bomb used</p>
            )}
            {!canUseBomb && !bombUsedThisGame && bombsAvailable === 0 && (
              <p className={styles.hint}>Buy bombs in Shop</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
