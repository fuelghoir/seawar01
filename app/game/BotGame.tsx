"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
import {
  createBotStatsGame,
  finishBotStatsGame,
  recordBotStatsShots,
  resolveOffchainGame,
} from "../lib/offchainGame";
import { consumeItem, getItemQuantity } from "../lib/season";
import { notifyPlayerDataRefresh } from "../lib/playerDataEvents";
import { gameSounds } from "../lib/sounds";
import { Board } from "../components/Board";
import { CellState } from "../components/Cell";
import { MissionGuide } from "../components/MissionGuide";
import { ShipPlacement } from "../components/ShipPlacement";
import { useOnboarding } from "../providers/OnboardingProvider";
import { GameTopBar } from "./components/GameTopBar";
import { GameResult } from "./components/GameResult";
import { useSettings, TR } from "../lib/settings";
import styles from "./page.module.css";

const BOT_DELAY = 800;
type GamePhase = "placing" | "playing" | "finished";
type TacticalDirection = "up" | "right" | "down" | "left";
const BOT_OPPONENT = "0x0000000000000000000000000000000000000001" as const;
const BOT_RESULT_SAVE_KEY = "sbt_bot_result_saved";
const TUTORIAL_SAVE_VERSION = 3;

type TutorialStep =
  | "autoplace"
  | "confirm"
  | "radar"
  | "torpedo"
  | "freeplay";

const TUTORIAL_GUIDE_STEPS: TutorialStep[] = [
  "autoplace",
  "confirm",
  "radar",
  "torpedo",
];

const TUTORIAL_COPY = {
  ru: {
    eyebrow: "учебный бой · обычные правила",
    skip: "пропустить обучение",
    autoplace: ["собери флот", "нажми random — корабли встанут по правилам автоматически"],
    confirm: ["флот готов", "проверь поле и подтверди расстановку"],
    radar: ["попробуй радар", "он один раз покажет настоящую клетку корабля. дальше решай сам, куда стрелять"],
    torpedo: ["попробуй торпеду", "выбери любое направление и цель. после этого бой продолжится без подсказок"],
    result: "бой завершён — забери свой результат и закончи обучение",
    claim: "CLAIM SCORE",
  },
  en: {
    eyebrow: "training battle · standard rules",
    skip: "skip tutorial",
    autoplace: ["build your fleet", "tap random to place every ship correctly"],
    confirm: ["fleet ready", "check the board and confirm your deployment"],
    radar: ["try the radar", "it reveals one real ship cell. after that, you decide where to fire"],
    torpedo: ["try the torpedo", "pick any direction and target. the rest of the battle has no hints"],
    result: "battle complete — claim your score to finish training",
    claim: "CLAIM SCORE",
  },
} as const;

const TORPEDO_LENGTH = 3;
const TACTICAL_DIRS: Record<TacticalDirection, { dx: number; dy: number; label: string }> = {
  up: { dx: 0, dy: -1, label: "^" },
  right: { dx: 1, dy: 0, label: ">" },
  down: { dx: 0, dy: 1, label: "v" },
  left: { dx: -1, dy: 0, label: "<" },
};

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
  statsGameId?: number | null;
  isMyTurn: boolean;
  myHits: number;
  botHits: number;
  winner: "me" | "bot" | null;
  myShotsEntries: [number, boolean][];
  botShotsEntries: [number, boolean][];
  botStateData: SerializedBotState;
  tutorialVersion?: number;
  tutorialStep?: TutorialStep;
  tutorialRadarHints?: number[];
  tutorialTorpedoActive?: boolean;
  tutorialTorpedoDir?: TacticalDirection;
  tutorialSelectedCell?: { x: number; y: number } | null;
  tutorialRadarUsed?: boolean;
  tutorialTorpedoUsed?: boolean;
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

function tutorialSaveKey(wallet: string) {
  return `sbt_training:v${TUTORIAL_SAVE_VERSION}:${wallet.toLowerCase()}`;
}

function loadSave(key: string | null = SAVE_KEY): SavedBotGame | null {
  if (!key) return null;
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as SavedBotGame) : null;
  } catch {
    return null;
  }
}

function deleteSave(key = SAVE_KEY, clearResult = true) {
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(key);
      if (clearResult) localStorage.removeItem(BOT_RESULT_SAVE_KEY);
    } catch {}
  }
}

function formatCellLabel(cell: { x: number; y: number }, _lang?: "en" | "ru") {
  const col = String.fromCharCode(65 + cell.x);
  return `${col}${cell.y + 1}`;
}

function buildTorpedoLine(
  start: { x: number; y: number },
  direction: TacticalDirection
): { x: number; y: number; idx: number }[] {
  const dir = TACTICAL_DIRS[direction];
  const cells: { x: number; y: number; idx: number }[] = [];
  for (let i = 0; i < TORPEDO_LENGTH; i++) {
    const x = start.x + dir.dx * i;
    const y = start.y + dir.dy * i;
    if (x >= 0 && x < 10 && y >= 0 && y < 10) {
      cells.push({ x, y, idx: y * 10 + x });
    }
  }
  return cells;
}

// ─── Component ───

export function BotGameContent({
  gameIdStr: _gameIdStr,
  tutorial = false,
}: {
  gameIdStr: string;
  tutorial?: boolean;
}) {
  void _gameIdStr;
  const router = useRouter();
  const { address } = useAccount();
  const { lang, effects } = useSettings();
  const tr = TR[lang];
  const tutorialCopy = TUTORIAL_COPY[lang];
  const { status: onboardingStatus, loaded: onboardingLoaded, progress, dismiss } = useOnboarding();

  // Load saved game once on mount
  const [save] = useState(() => loadSave(
    tutorial ? (address ? tutorialSaveKey(address) : null) : SAVE_KEY
  ));

  // Restore state from save (or start fresh)
  const [phase, setPhase] = useState<GamePhase>(() => save?.phase || "placing");
  const [myBoard, setMyBoard] = useState<number[]>(() => save?.myBoard || []);
  const [botBoard, setBotBoard] = useState<number[]>(() => save?.botBoard || []);
  const [statsGameId, setStatsGameId] = useState<number | null>(() => save?.statsGameId ?? null);
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
  const [selectedCell, setSelectedCell] = useState<{ x: number; y: number } | null>(
    () => tutorial ? save?.tutorialSelectedCell ?? null : null
  );
  const [radarQty, setRadarQty] = useState(0);
  const [torpedoQty, setTorpedoQty] = useState(0);
  const [radarHints, setRadarHints] = useState<Set<number>>(
    () => new Set(tutorial ? save?.tutorialRadarHints ?? [] : [])
  );
  const [torpedoActive, setTorpedoActive] = useState(
    () => tutorial ? save?.tutorialTorpedoActive ?? false : false
  );
  const [torpedoDir, setTorpedoDir] = useState<TacticalDirection>(
    () => tutorial ? save?.tutorialTorpedoDir ?? "right" : "right"
  );
  const [itemBusy, setItemBusy] = useState(false);
  const [itemHint, setItemHint] = useState("");
  const [tutorialStep, setTutorialStep] = useState<TutorialStep>(
    () => tutorial ? save?.tutorialStep ?? "autoplace" : "autoplace"
  );
  const [tutorialRadarUsed, setTutorialRadarUsed] = useState(
    () => tutorial ? save?.tutorialRadarUsed ?? false : false
  );
  const [tutorialTorpedoUsed, setTutorialTorpedoUsed] = useState(
    () => tutorial ? save?.tutorialTorpedoUsed ?? false : false
  );
  const [tutorialBusy, setTutorialBusy] = useState(false);
  const [tutorialError, setTutorialError] = useState("");
  const [tutorialHydratedWallet, setTutorialHydratedWallet] = useState<string | null>(
    () => tutorial ? address?.toLowerCase() ?? null : "normal"
  );
  const [resultSaved, setResultSaved] = useState(
    () => !tutorial && typeof window !== "undefined" && localStorage.getItem(BOT_RESULT_SAVE_KEY) === "1"
  );

  // Restore bot AI state from save
  const botState = useRef<BotState>(
    save?.botStateData ? deserializeBotState(save.botStateData) : createBotState()
  );

  const statsFinishedRecorded = useRef(!!(save?.winner && save?.statsGameId));

  // Refs for stale-closure safety in doBotTurn
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const myBoardRef = useRef(myBoard);
  myBoardRef.current = myBoard;
  const botHitsRef = useRef(botHits);
  botHitsRef.current = botHits;
  const doBotTurnRef = useRef<() => void>(() => {});
  const statsGameIdRef = useRef<number | null>(save?.statsGameId ?? null);
  const statsGameCreateRef = useRef<Promise<number | null> | null>(null);

  useEffect(() => {
    if (!tutorial || !address) return;
    const wallet = address.toLowerCase();
    if (tutorialHydratedWallet === wallet) return;

    const restored = loadSave(tutorialSaveKey(wallet));
    const shouldResumeBotTurn = Boolean(
      restored?.tutorialVersion === TUTORIAL_SAVE_VERSION &&
      restored.phase === "playing" &&
      !restored.isMyTurn &&
      !restored.winner
    );
    if (restored?.tutorialVersion === TUTORIAL_SAVE_VERSION) {
      setPhase(restored.phase);
      setMyBoard(restored.myBoard);
      setBotBoard(restored.botBoard);
      setStatsGameId(null);
      setIsMyTurn(restored.isMyTurn);
      setMyHits(restored.myHits);
      setBotHits(restored.botHits);
      setWinner(restored.winner);
      setMyShotsMap(new Map(restored.myShotsEntries));
      setBotShotsMap(new Map(restored.botShotsEntries));
      setSelectedCell(restored.tutorialSelectedCell ?? null);
      setRadarHints(new Set(restored.tutorialRadarHints ?? []));
      setTorpedoActive(restored.tutorialTorpedoActive ?? false);
      setTorpedoDir(restored.tutorialTorpedoDir ?? "right");
      setTutorialStep(restored.tutorialStep ?? "autoplace");
      setTutorialRadarUsed(restored.tutorialRadarUsed ?? false);
      setTutorialTorpedoUsed(restored.tutorialTorpedoUsed ?? false);
      botState.current = restored.botStateData
        ? deserializeBotState(restored.botStateData)
        : createBotState();
    } else {
      setPhase("placing");
      setMyBoard([]);
      setBotBoard([]);
      setStatsGameId(null);
      setIsMyTurn(true);
      setMyHits(0);
      setBotHits(0);
      setWinner(null);
      setMyShotsMap(new Map());
      setBotShotsMap(new Map());
      setSelectedCell(null);
      setRadarHints(new Set());
      setTorpedoActive(false);
      setTorpedoDir("right");
      setTutorialStep("autoplace");
      setTutorialRadarUsed(false);
      setTutorialTorpedoUsed(false);
      botState.current = createBotState();
    }
    statsGameIdRef.current = null;
    setTutorialHydratedWallet(wallet);
    if (shouldResumeBotTurn) {
      setBotProcessing(true);
      setTimeout(() => doBotTurnRef.current(), BOT_DELAY);
    }
  }, [address, tutorial, tutorialHydratedWallet]);

  useEffect(() => {
    statsGameIdRef.current = statsGameId;
  }, [statsGameId]);

  // ─── Save state to localStorage after every meaningful change ───
  useEffect(() => {
    if (phase === "placing" && (!tutorial || myBoard.length !== 100)) return;
    if (tutorial && (!address || tutorialHydratedWallet !== address.toLowerCase())) return;
    try {
      const data: SavedBotGame = {
        phase,
        myBoard,
        botBoard,
        statsGameId: tutorial ? null : statsGameId,
        isMyTurn,
        myHits,
        botHits,
        winner,
        myShotsEntries: [...myShotsMap.entries()],
        botShotsEntries: [...botShotsMap.entries()],
        botStateData: serializeBotState(botState.current),
        ...(tutorial ? {
          tutorialVersion: TUTORIAL_SAVE_VERSION,
          tutorialStep,
          tutorialRadarHints: [...radarHints],
          tutorialTorpedoActive: torpedoActive,
          tutorialTorpedoDir: torpedoDir,
          tutorialSelectedCell: selectedCell,
          tutorialRadarUsed,
          tutorialTorpedoUsed,
        } : {}),
      };
      const key = tutorial ? tutorialSaveKey(address!) : SAVE_KEY;
      localStorage.setItem(key, JSON.stringify(data));
    } catch { /* storage full or unavailable */ }
  }, [
    address,
    phase,
    myBoard,
    botBoard,
    statsGameId,
    isMyTurn,
    myHits,
    botHits,
    winner,
    myShotsMap,
    botShotsMap,
    radarHints,
    selectedCell,
    torpedoActive,
    torpedoDir,
    tutorial,
    tutorialHydratedWallet,
    tutorialRadarUsed,
    tutorialStep,
    tutorialTorpedoUsed,
  ]);

  // ─── If restored mid-game on bot's turn, auto-trigger bot ───
  const needsBotTurnOnMount = useRef(
    !!(save?.phase === "playing" && !save?.isMyTurn && !save?.winner)
  );
  useEffect(() => {
    if (!needsBotTurnOnMount.current) return;
    needsBotTurnOnMount.current = false;
    setBotProcessing(true);
    setTimeout(() => doBotTurnRef.current(), BOT_DELAY);
  }, []);

  // ─── Onchain save result ───
  const ensureStatsGame = useCallback(async () => {
    if (tutorial) return null;
    if (!address) return null;
    if (statsGameIdRef.current) return statsGameIdRef.current;

    if (!statsGameCreateRef.current) {
      statsGameCreateRef.current = (async () => {
        try {
          const id = await createBotStatsGame(address);
          statsGameIdRef.current = id;
          setStatsGameId(id);
          const existingShots = [...myShotsMap.entries()].map(([idx, isHit]) => ({
            x: idx % 10,
            y: Math.floor(idx / 10),
            isHit,
          }));
          await recordBotStatsShots(id, existingShots);
          return id;
        } catch {
          return null;
        } finally {
          statsGameCreateRef.current = null;
        }
      })();
    }

    return statsGameCreateRef.current;
  }, [address, myShotsMap, tutorial]);

  const recordBotShots = useCallback(async (
    shots: Array<{ x: number; y: number; isHit?: boolean }>
  ) => {
    const id = await ensureStatsGame();
    if (!id) return;
    await recordBotStatsShots(id, shots);
  }, [ensureStatsGame]);

  const {
    data: resultTxHash,
    writeContract,
    isPending: resultPending,
  } = useWriteContract();
  const { data: resultReceipt } = useWaitForTransactionReceipt({ hash: resultTxHash });
  const resultConfirmed = resultReceipt?.status === "success";

  const handleSaveResult = useCallback(() => {
    if (tutorial) return;
    if (!winner || !address) return;
    writeContract({
      address: SEABATTLE_CONTRACT_ADDRESS,
      abi: seaBattleAbi,
      functionName: "recordSoloResult",
      args: [BOT_OPPONENT, winner === "me"],
      chainId: base.id,
      dataSuffix: BUILDER_CODE_SUFFIX,
    });
  }, [winner, address, writeContract, tutorial]);

  useEffect(() => {
    if (tutorial) return;
    if (!resultConfirmed) return;
    setResultSaved(true);
    if (typeof window !== "undefined") {
      localStorage.setItem(BOT_RESULT_SAVE_KEY, "1");
    }
  }, [resultConfirmed, tutorial]);

  // Award local points and close the bot stats game when the match ends.
  useEffect(() => {
    if (tutorial) return;
    if (!winner || !address) return;

    const didWin = winner === "me";

    if (!statsFinishedRecorded.current) {
      statsFinishedRecorded.current = true;
      ensureStatsGame()
        .then(async (id) => {
          if (!id) {
            statsFinishedRecorded.current = false;
            return;
          }
          await finishBotStatsGame(
            id,
            address,
            didWin,
            didWin ? Math.max(myHits, 20) : myHits,
            didWin ? botHits : Math.max(botHits, 20)
          );
          await resolveOffchainGame(id, address);
        })
        .then(() => notifyPlayerDataRefresh())
        .catch(() => {
          statsFinishedRecorded.current = false;
        });
    }
  }, [winner, address, myHits, botHits, ensureStatsGame, tutorial]);

  const refreshTacticalItems = useCallback(async () => {
    if (tutorial) {
      setRadarQty(tutorialRadarUsed ? 0 : 1);
      setTorpedoQty(tutorialTorpedoUsed ? 0 : 1);
      return;
    }
    if (!address) {
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
  }, [address, tutorial, tutorialRadarUsed, tutorialTorpedoUsed]);

  useEffect(() => {
    if (phase !== "playing") return;
    refreshTacticalItems().catch(() => {});
  }, [phase, refreshTacticalItems]);

  useEffect(() => {
    if (!tutorial || !onboardingLoaded || !onboardingStatus || phase === "finished") return;
    if (onboardingStatus.status === "unavailable") return;
    if (onboardingStatus.step !== "battle") router.replace("/");
  }, [onboardingLoaded, onboardingStatus, phase, router, tutorial]);

  const handleTutorialSkip = useCallback(async () => {
    if (!tutorial || !address || tutorialBusy) return;
    setTutorialBusy(true);
    setTutorialError("");
    try {
      await dismiss();
      deleteSave(tutorialSaveKey(address), false);
      router.replace("/");
    } catch (cause) {
      setTutorialError(cause instanceof Error ? cause.message : "Could not skip training");
      setTutorialBusy(false);
    }
  }, [address, dismiss, router, tutorial, tutorialBusy]);

  const handleClaimScore = useCallback(async () => {
    if (!tutorial || !address || tutorialBusy) return;
    setTutorialBusy(true);
    setTutorialError("");
    try {
      await progress("debrief");
      deleteSave(tutorialSaveKey(address), false);
      router.replace("/");
    } catch (cause) {
      setTutorialError(cause instanceof Error ? cause.message : "Could not claim score");
      setTutorialBusy(false);
    }
  }, [address, progress, router, tutorial, tutorialBusy]);

  const handleTutorialAutoPlace = useCallback((boardLayout: number[]) => {
    if (!tutorial) return;
    setMyBoard(boardLayout);
    setTutorialStep("confirm");
  }, [tutorial]);

  // ─── Ship placement ───
  const handleConfirmBoard = useCallback((boardLayout: number[]) => {
    if (!tutorial && typeof window !== "undefined") {
      localStorage.removeItem(BOT_RESULT_SAVE_KEY);
    }
    setResultSaved(false);
    statsGameIdRef.current = null;
    statsGameCreateRef.current = null;
    setStatsGameId(null);
    setMyBoard(boardLayout);
    const botBoardLayout = generateRandomBoard();
    setBotBoard(botBoardLayout);
    setPhase("playing");
    setIsMyTurn(true);
    if (tutorial) setTutorialStep("radar");
  }, [tutorial]);

  // ─── Player shoots ───
  const handleShoot = useCallback(() => {
    if (!selectedCell || !isMyTurn || phase !== "playing") return;
    gameSounds.playShot();

    const { x, y } = selectedCell;
    const idx = y * 10 + x;
    const isHit = botBoard[idx] === 1;
    if (!tutorial) recordBotShots([{ x, y, isHit }]).catch(() => {});

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
  }, [selectedCell, isMyTurn, phase, botBoard, myHits, myShotsMap, recordBotShots, tutorial]);

  const handleUseRadar = useCallback(async () => {
    if (!address) {
      setItemHint(lang === "ru" ? "Подключи кошелек для предметов" : "Connect wallet to use items");
      return;
    }
    if (!isMyTurn || phase !== "playing" || botProcessing || itemBusy) return;
    if (radarQty <= 0) {
      setItemHint(lang === "ru" ? "Радара нет в инвентаре" : "No radar scans in inventory");
      return;
    }

    const candidates = botBoard
      .map((value, idx) => ({ value, idx }))
      .filter(({ value, idx }) => value === 1 && !myShotsMap.has(idx) && !radarHints.has(idx));

    if (candidates.length === 0) {
      setItemHint(lang === "ru" ? "Радар не нашел новых целей" : "Radar found no new targets");
      return;
    }

    setItemBusy(true);
    try {
      if (!tutorial) await consumeItem(address, "radar_scan", 1);
      const hit = candidates[Math.floor(Math.random() * candidates.length)].idx;
      setRadarHints((prev) => {
        const next = new Set(prev);
        next.add(hit);
        return next;
      });
      setRadarQty((qty) => Math.max(0, qty - 1));
      if (tutorial) {
        setTutorialRadarUsed(true);
        if (tutorialStep === "radar") setTutorialStep("torpedo");
      }
      setItemHint(
        lang === "ru"
          ? `Радар подсветил ${formatCellLabel({ x: hit % 10, y: Math.floor(hit / 10) }, lang)}`
          : `Radar ping: ${formatCellLabel({ x: hit % 10, y: Math.floor(hit / 10) }, lang)}`
      );
    } catch (err) {
      setItemHint(err instanceof Error ? err.message : "Radar failed");
      refreshTacticalItems().catch(() => {});
    } finally {
      setItemBusy(false);
    }
  }, [
    address,
    botBoard,
    botProcessing,
    isMyTurn,
    itemBusy,
    lang,
    myShotsMap,
    phase,
    radarHints,
    radarQty,
    refreshTacticalItems,
    tutorial,
    tutorialStep,
  ]);

  const handleUseTorpedo = useCallback(async () => {
    if (!address) {
      setItemHint(lang === "ru" ? "Подключи кошелек для предметов" : "Connect wallet to use items");
      return;
    }
    if (!selectedCell || !isMyTurn || phase !== "playing" || botProcessing || itemBusy) return;
    if (torpedoQty <= 0) {
      setItemHint(lang === "ru" ? "Торпеды нет в инвентаре" : "No torpedoes in inventory");
      return;
    }

    const line = buildTorpedoLine(selectedCell, torpedoDir)
      .filter(({ idx }) => !myShotsMap.has(idx));
    if (line.length === 0) {
      setItemHint(lang === "ru" ? "Выбери линию с новыми клетками" : "Pick a line with unshot cells");
      return;
    }

    setItemBusy(true);
    try {
      if (!tutorial) {
        await consumeItem(address, "torpedo", 1);
      }
      setTorpedoQty((qty) => Math.max(0, qty - 1));
      if (tutorial) {
        setTutorialTorpedoUsed(true);
        setTutorialStep("freeplay");
      }
      setTorpedoActive(false);
      gameSounds.playShot();

      const nextShots = new Map(myShotsMap);
      let hitsAdded = 0;
      const statsShots: Array<{ x: number; y: number; isHit: boolean }> = [];
      for (const { idx } of line) {
        const isHit = botBoard[idx] === 1;
        nextShots.set(idx, isHit);
        statsShots.push({
          x: idx % 10,
          y: Math.floor(idx / 10),
          isHit,
        });
        if (isHit) hitsAdded += 1;
      }
      if (!tutorial) recordBotShots(statsShots).catch(() => {});

      setMyShotsMap(nextShots);
      setSelectedCell(null);

      if (hitsAdded > 0) {
        const newHits = myHits + hitsAdded;
        setMyHits(newHits);
        setTimeout(() => gameSounds.playHit(), 180);

        const ships = findShips(botBoard);
        const hitCells = new Set<number>();
        nextShots.forEach((hit, idx) => { if (hit) hitCells.add(idx); });
        const sunkByLine = ships.some((ship) =>
          isShipSunk(ship, hitCells) && ship.some((idx) => line.some((cell) => cell.idx === idx))
        );
        if (sunkByLine) {
          setTimeout(() => gameSounds.playSunk(), 360);
        }

        if (newHits >= 20) {
          setWinner("me");
          setPhase("finished");
        }
      } else {
        setTimeout(() => gameSounds.playMiss(), 180);
        setIsMyTurn(false);
        setBotProcessing(true);
        setTimeout(() => doBotTurnRef.current(), BOT_DELAY);
      }

      setItemHint(
        lang === "ru"
          ? `Торпеда: ${line.length} кл.`
          : `Torpedo fired ${line.length} cells`
      );
    } catch (err) {
      setItemHint(err instanceof Error ? err.message : "Torpedo failed");
      refreshTacticalItems().catch(() => {});
    } finally {
      setItemBusy(false);
    }
  }, [
    address,
    botBoard,
    botProcessing,
    isMyTurn,
    itemBusy,
    lang,
    myHits,
    myShotsMap,
    phase,
    recordBotShots,
    refreshTacticalItems,
    selectedCell,
    torpedoDir,
    torpedoQty,
    tutorial,
  ]);

  // ─── Bot turn ───
  const handleToggleTorpedo = useCallback(() => {
    setTorpedoActive((active) => !active);
    if (tutorial && tutorialStep === "torpedo") {
      setSelectedCell(null);
    }
  }, [tutorial, tutorialStep]);

  const handleTorpedoDirection = useCallback((direction: TacticalDirection) => {
    setTorpedoDir(direction);
  }, []);

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

  for (const idx of radarHints) {
    const x = idx % 10;
    const y = Math.floor(idx / 10);
    if (enemyBoardCells[y][x] === "empty") {
      enemyBoardCells[y][x] = "radar";
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
    if (!isMyTurn || phase !== "playing" || botProcessing) return;
    if (
      enemyBoardCells[y][x] !== "empty" &&
      enemyBoardCells[y][x] !== "pending" &&
      enemyBoardCells[y][x] !== "radar"
    ) return;
    setSelectedCell({ x, y });
  };

  const tutorialGuide = useMemo(() => {
    if (
      !tutorial ||
      tutorialStep === "freeplay" ||
      (tutorialStep === "torpedo" && torpedoActive) ||
      !address ||
      tutorialHydratedWallet !== address.toLowerCase()
    ) return null;
    const [title, body] = tutorialCopy[tutorialStep];
    return (
      <MissionGuide
        target={`[data-training-target="${tutorialStep}"]`}
        eyebrow={tutorialCopy.eyebrow}
        title={title}
        body={body}
        step={TUTORIAL_GUIDE_STEPS.indexOf(tutorialStep) + 1}
        total={TUTORIAL_GUIDE_STEPS.length}
        skipLabel={tutorialCopy.skip}
        onSkip={() => void handleTutorialSkip()}
        busy={tutorialBusy}
        error={tutorialError}
        reducedMotion={effects === "reduced"}
      />
    );
  }, [
    address,
    effects,
    handleTutorialSkip,
    tutorial,
    tutorialBusy,
    tutorialCopy,
    tutorialError,
    tutorialHydratedWallet,
    tutorialStep,
    torpedoActive,
  ]);

  // ─── Render ───

  if (phase === "placing") {
    return (
      <>
        <GameTopBar
          mode="bot"
          phase="placement"
          onExit={tutorial ? () => void handleTutorialSkip() : undefined}
        />
        <div className={styles.container}>
          <div className={styles.scrollContent}>
            <ShipPlacement
              key={tutorial ? `${tutorialHydratedWallet}:${tutorialStep}` : "standard-bot"}
              onConfirm={handleConfirmBoard}
              isPending={false}
              isConfirming={false}
              onAutoPlace={tutorial ? handleTutorialAutoPlace : undefined}
              initialBoardLayout={tutorial && myBoard.length === 100 ? myBoard : undefined}
              trainingTarget={tutorial ? (tutorialStep === "confirm" ? "confirm" : "autoplace") : null}
            />
          </div>
        </div>
        {tutorialGuide}
      </>
    );
  }

  if (phase === "finished") {
    const didWin = winner === "me";
    const resultSaving = resultPending || (!!resultTxHash && !resultReceipt);

    // Revealed bot board: if player won, all ships are sunk; otherwise show partial state
    const revealedBotBoard: CellState[][] = Array.from({ length: 10 }, () =>
      Array(10).fill("empty" as CellState)
    );
    if (botBoard.length > 0) {
      if (didWin) {
        for (let y = 0; y < 10; y++)
          for (let x = 0; x < 10; x++)
            if (botBoard[y * 10 + x] === 1) revealedBotBoard[y][x] = "sunk";
        myShotsMap.forEach((isHit, idx) => {
          if (!isHit) revealedBotBoard[Math.floor(idx / 10)][idx % 10] = "miss";
        });
      } else {
        for (let y = 0; y < 10; y++)
          for (let x = 0; x < 10; x++)
            if (botBoard[y * 10 + x] === 1) revealedBotBoard[y][x] = "ship";
        myShotsMap.forEach((isHit, idx) => {
          const x = idx % 10, y = Math.floor(idx / 10);
          revealedBotBoard[y][x] = isHit ? (sunkCellSet.has(idx) ? "sunk" : "hit") : "miss";
        });
      }
    }

    // Player's final board: if bot won, all player ships are sunk
    const myBoardFinal: CellState[][] = myBoardCells.map(row => [...row]);
    if (!didWin && myBoard.length > 0) {
      for (let y = 0; y < 10; y++)
        for (let x = 0; x < 10; x++)
          if (myBoard[y * 10 + x] === 1) myBoardFinal[y][x] = "sunk";
    }

    const message = tutorial
      ? tutorialError || tutorialCopy.result
      : didWin
        ? resultSaved
          ? tr.bot_msg_saved
          : resultSaving
            ? tr.confirming
          : tr.bot_msg_win
        : tr.bot_msg_lose;

    const secondaryHandler = tutorial
      ? () => void handleClaimScore()
      : !resultSaved && !resultSaving && address
        ? handleSaveResult
        : undefined;
    const secondaryLabel = tutorial
      ? tutorialBusy
        ? tr.confirming
        : `${tutorialCopy.claim} ${myHits}/20`
      : secondaryHandler
        ? resultPending
          ? tr.confirming
          : `💾 ${tr.save_result_tx}`
        : undefined;

    return (
      <>
        <GameTopBar mode="bot" phase="result" />
        <GameResult
          didWin={didWin}
          mode="bot"
          myHits={myHits}
          enemyHits={botHits}
          message={message}
          onPrimary={() => {
            if (!tutorial) {
              deleteSave();
            }
            router.push("/");
          }}
          primaryLabel={`← ${tr.main_menu}`}
          primaryDisabled={tutorial && tutorialBusy}
          onSecondary={secondaryHandler}
          secondaryLabel={secondaryLabel}
          secondaryVariant={tutorial ? "claim" : "default"}
          secondaryDisabled={tutorial && tutorialBusy}
          shareReward={
            !tutorial && address
              ? {
                  kind: "game",
                  wallet: address,
                  game: {
                    gameId: statsGameId,
                    mode: "bot",
                    didWin,
                    myHits,
                    enemyHits: botHits,
                  },
                }
              : undefined
          }
        >
          <div className={styles.resultBoards}>
            <Board cells={myBoardFinal} isInteractive={false} label={tr.your_board} />
            <Board cells={revealedBotBoard} isInteractive={false} label={tr.bot_fleet} />
          </div>
        </GameResult>
      </>
    );
  }

  const canUseTactical = isMyTurn && !botProcessing && phase === "playing" && !itemBusy;
  const canFire = canUseTactical && !!selectedCell && !torpedoActive;
  const canFireTorpedo = canUseTactical && !!selectedCell && torpedoQty > 0;
  const turnLabel = botProcessing
    ? tr.turn_bot_thinking
    : isMyTurn
      ? tr.turn_your
      : tr.turn_bot;
  const turnAccent = isMyTurn ? "var(--accent)" : "#b96a72";

  return (
    <div className={styles.gameShell}>
      <GameTopBar
        mode="bot"
        phase="battle"
        turnLabel={turnLabel}
        turnAccent={turnAccent}
        myHits={myHits}
        enemyHits={botHits}
        onExit={tutorial ? () => void handleTutorialSkip() : undefined}
      />
      <div className={styles.gameScroll}>
        <div className={styles.battleLayout}>
          {/* Main target board — large */}
          <div className={styles.mainBoard}>
            <Board
              cells={enemyBoardCells}
              onCellClick={handleEnemyCellClick}
              isInteractive={isMyTurn && !botProcessing}
              label={tr.bot_waters}
              variant="target"
            />
          </div>

          {/* Fleet minimap — small on the side */}
          <div className={styles.fleetMinimap}>
            <Board
              cells={myBoardCells}
              isInteractive={false}
              label={tr.your_fleet}
            />
            <div className={styles.minimapStatus}>
              <span>{tr.you_short}: {myHits}/20</span>
              <span>{tr.bot_short}: {botHits}/20</span>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.stickyFire}>
        <div className={styles.fireRow}>
          <button
            type="button"
            className={`${styles.tacticalBtn} ${styles.radarBtn}`}
            onClick={handleUseRadar}
            disabled={!canUseTactical || radarQty <= 0}
            data-training-target={tutorial && tutorialStep === "radar" ? "radar" : undefined}
          >
            🛰 Radar · {radarQty}
          </button>
          <button
            className={styles.fireButton}
            onClick={torpedoActive ? handleUseTorpedo : handleShoot}
            disabled={torpedoActive ? !canFireTorpedo : !canFire}
          >
            {torpedoActive
              ? selectedCell
                ? `🔥 TORPEDO ${formatCellLabel(selectedCell, lang)}`
                : "SELECT TARGET"
              : canFire
                ? `🔥 ${tr.fire_at} ${formatCellLabel(selectedCell!, lang)}`
                : botProcessing
                  ? tr.bot_thinking
                  : isMyTurn
                    ? tr.select_cell
                    : tr.waiting}
          </button>
          <button
            type="button"
            className={`${styles.tacticalBtn} ${styles.torpedoBtn} ${torpedoActive ? styles.tacticalActive : ""}`}
            onClick={handleToggleTorpedo}
            disabled={!canUseTactical || torpedoQty <= 0}
            data-training-target={tutorial && tutorialStep === "torpedo" ? "torpedo" : undefined}
          >
            💣 Torpedo · {torpedoQty}
          </button>
        </div>
        {torpedoActive && (
          <div className={styles.directionPanel}>
            {(Object.keys(TACTICAL_DIRS) as TacticalDirection[]).map((direction) => (
              <button
                type="button"
                key={direction}
                className={`${styles.directionBtn} ${torpedoDir === direction ? styles.directionActive : ""}`}
                onClick={() => handleTorpedoDirection(direction)}
                disabled={!canUseTactical}
              >
                {TACTICAL_DIRS[direction].label}
              </button>
            ))}
          </div>
        )}
        {itemHint && <div className={styles.itemHint}>{itemHint}</div>}
      </div>
      {tutorialGuide}
    </div>
  );
}
