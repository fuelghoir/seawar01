"use client";

import { useState, useEffect, useRef, CSSProperties } from "react";
import {
  createBotState,
  botChooseTarget,
  botProcessResult,
  botNotifySunk,
} from "../lib/botAI";
import styles from "./HeroBattleGrid.module.css";

const COLS = 10;
const ROWS = 10;
const COL_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];

// Standard Battleship fleet (1×4, 2×3, 3×2, 4×1) placed with surrounding gaps
// — same fleet shape as the design preview.
type ShipDef = { id: number; cells: [number, number][] };
type BattleLayout = {
  ships: ShipDef[];
  shipMap: Record<string, number>;
  shipCells: Set<string>;
  totalHitsToWin: number;
};
type Rng = () => number;

const SHIP_SIZES = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];

const FALLBACK_SHIPS_DEF: ShipDef[] = [
  { id: 0, cells: [[0, 0], [1, 0], [2, 0], [3, 0]] },
  { id: 1, cells: [[5, 0], [6, 0], [7, 0]] },
  { id: 2, cells: [[9, 2], [9, 3], [9, 4]] },
  { id: 3, cells: [[0, 2], [1, 2]] },
  { id: 4, cells: [[3, 3], [4, 3]] },
  { id: 5, cells: [[6, 2], [7, 2]] },
  { id: 6, cells: [[0, 5]] },
  { id: 7, cells: [[2, 6]] },
  { id: 8, cells: [[5, 5]] },
  { id: 9, cells: [[8, 6]] },
];

function createSeededRng(seed: number): Rng {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

function randomInt(rng: Rng, maxExclusive: number) {
  return Math.floor(rng() * maxExclusive);
}

function buildLayout(ships: ShipDef[]): BattleLayout {
  const shipMap: Record<string, number> = {};
  ships.forEach((ship) =>
    ship.cells.forEach(([x, y]) => {
      shipMap[`${x},${y}`] = ship.id;
    })
  );
  const shipCells = new Set(Object.keys(shipMap));
  return {
    ships,
    shipMap,
    shipCells,
    totalHitsToWin: shipCells.size,
  };
}

function shipCellsFor(size: number, x: number, y: number, horizontal: boolean): [number, number][] {
  return Array.from({ length: size }, (_, i) => [
    horizontal ? x + i : x,
    horizontal ? y : y + i,
  ]);
}

function canPlaceShip(cells: [number, number][], occupied: Set<string>) {
  for (const [x, y] of cells) {
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return false;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (occupied.has(`${x + dx},${y + dy}`)) return false;
      }
    }
  }
  return true;
}

function createBattleLayout(rng: Rng = Math.random): BattleLayout {
  for (let restart = 0; restart < 80; restart++) {
    const occupied = new Set<string>();
    const ships: ShipDef[] = [];

    for (let id = 0; id < SHIP_SIZES.length; id++) {
      const size = SHIP_SIZES[id];
      let placed = false;

      for (let attempt = 0; attempt < 220; attempt++) {
        const horizontal = rng() < 0.5;
        const maxX = horizontal ? COLS - size + 1 : COLS;
        const maxY = horizontal ? ROWS : ROWS - size + 1;
        const cells = shipCellsFor(
          size,
          randomInt(rng, maxX),
          randomInt(rng, maxY),
          horizontal
        );

        if (!canPlaceShip(cells, occupied)) continue;

        ships.push({ id, cells });
        cells.forEach(([x, y]) => occupied.add(`${x},${y}`));
        placed = true;
        break;
      }

      if (!placed) break;
    }

    if (ships.length === SHIP_SIZES.length) return buildLayout(ships);
  }

  return buildLayout(FALLBACK_SHIPS_DEF);
}

const INITIAL_LAYOUT = createBattleLayout(createSeededRng(0x51ea));

function createStaticPreview(layout: BattleLayout) {
  const hits = new Set<string>();
  const sunkIds = new Set<number>();
  const sunkShip = layout.ships[0];
  const damagedShip = layout.ships[1];

  sunkShip?.cells.forEach(([x, y]) => hits.add(`${x},${y}`));
  if (sunkShip) sunkIds.add(sunkShip.id);
  if (damagedShip?.cells[0]) {
    const [x, y] = damagedShip.cells[0];
    hits.add(`${x},${y}`);
  }

  const misses = new Set<string>();
  for (let y = 0; y < ROWS && misses.size < 8; y++) {
    for (let x = 0; x < COLS && misses.size < 8; x++) {
      const key = `${x},${y}`;
      if (!layout.shipCells.has(key)) misses.add(key);
    }
  }

  return { hits, misses, sunkIds };
}

const STATIC_PREVIEW = createStaticPreview(INITIAL_LAYOUT);

function getNeighbors(cells: [number, number][]): Set<string> {
  const nbrs = new Set<string>();
  cells.forEach(([x, y]) => {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS) {
          nbrs.add(`${nx},${ny}`);
        }
      }
    }
  });
  return nbrs;
}

type Flash = { key: string; type: "hit" | "miss" } | null;

export function HeroBattleGrid({
  compact = false,
  reducedFx = false,
  staticPreview = false,
}: {
  compact?: boolean;
  reducedFx?: boolean;
  staticPreview?: boolean;
}) {
  const [layout, setLayout] = useState<BattleLayout>(INITIAL_LAYOUT);
  const [hits, setHits] = useState<Set<string>>(new Set());
  const [misses, setMisses] = useState<Set<string>>(new Set());
  const [sunkIds, setSunkIds] = useState<Set<number>>(new Set());
  const [flash, setFlash] = useState<Flash>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [victory, setVictory] = useState(false);

  const aliveRef = useRef(true);
  const layoutRef = useRef(layout);
  const botStateRef = useRef(createBotState());
  const hitsRef = useRef(hits);
  const sunkIdsRef = useRef(sunkIds);

  useEffect(() => { layoutRef.current = layout; }, [layout]);
  useEffect(() => { hitsRef.current = hits; }, [hits]);
  useEffect(() => { sunkIdsRef.current = sunkIds; }, [sunkIds]);

  // Auto-fire AI loop — uses the production botAI for targeting so the
  // animation respects ship orientation (no perpendicular-to-line shots).
  useEffect(() => {
    if (staticPreview) {
      const nextHits = new Set(STATIC_PREVIEW.hits);
      const nextSunkIds = new Set(STATIC_PREVIEW.sunkIds);

      aliveRef.current = false;
      layoutRef.current = INITIAL_LAYOUT;
      hitsRef.current = nextHits;
      sunkIdsRef.current = nextSunkIds;
      botStateRef.current = createBotState();

      setLayout(INITIAL_LAYOUT);
      setHits(nextHits);
      setMisses(new Set(STATIC_PREVIEW.misses));
      setSunkIds(nextSunkIds);
      setFlash(null);
      setCursor(null);
      setVictory(false);
      return;
    }

    aliveRef.current = true;
    const sleep = (ms: number) =>
      new Promise<void>((r) => setTimeout(r, ms));
    const resetBattle = () => {
      const nextLayout = createBattleLayout();
      const nextHits = new Set<string>();
      const nextSunkIds = new Set<number>();

      layoutRef.current = nextLayout;
      hitsRef.current = nextHits;
      sunkIdsRef.current = nextSunkIds;
      botStateRef.current = createBotState();

      setLayout(nextLayout);
      setHits(nextHits);
      setMisses(new Set());
      setSunkIds(nextSunkIds);
      setFlash(null);
      setCursor(null);
      setVictory(false);
    };

    resetBattle();

    async function fire() {
      while (aliveRef.current) {
        const currentLayout = layoutRef.current;

        // Win → flash overlay → reset.
        if (sunkIdsRef.current.size >= currentLayout.ships.length) {
          setVictory(true);
          setCursor(null);
          setFlash(null);
          await sleep(1800);
          if (!aliveRef.current) return;
          resetBattle();
          await sleep(700);
          continue;
        }

        const { x, y } = botChooseTarget(botStateRef.current);
        const key = `${x},${y}`;
        const isHit = currentLayout.shipCells.has(key);

        // Cursor preview is nice on desktop, but it costs an extra full grid
        // repaint on phones. Compact mode keeps the hit/miss animation only.
        if (!compact) setCursor({ x, y });
        await sleep(compact ? 240 : 450);
        if (!aliveRef.current) return;

        // Fire flash + visual commit.
        setFlash({ key, type: isHit ? "hit" : "miss" });
        if (isHit) {
          setHits((s) => {
            const n = new Set(s);
            n.add(key);
            return n;
          });
        } else {
          setMisses((s) => {
            const n = new Set(s);
            n.add(key);
            return n;
          });
        }

        // Tell the bot what happened.
        botProcessResult(botStateRef.current, x, y, isHit);

        // If this hit just sunk a ship → mark sunk + auto-miss surroundings
        // + notify the bot so it stops targeting that ship.
        if (isHit) {
          const sid = currentLayout.shipMap[key];
          const ship = currentLayout.ships.find((s) => s.id === sid)!;
          const justSunk = ship.cells.every(
            ([cx, cy]) =>
              hitsRef.current.has(`${cx},${cy}`) || (cx === x && cy === y)
          );
          if (justSunk) {
            setSunkIds((s) => {
              const n = new Set(s);
              n.add(sid);
              return n;
            });
            setMisses((prev) => {
              const n = new Set(prev);
              getNeighbors(ship.cells).forEach((k) => {
                if (!currentLayout.shipCells.has(k)) n.add(k);
              });
              return n;
            });
            botNotifySunk(
              botStateRef.current,
              ship.cells.map(([cx, cy]) => cy * 10 + cx)
            );
          }
        }

        await sleep(280);
        if (!aliveRef.current) return;

        setFlash(null);
        setCursor(null);

        const delay = compact
          ? isHit ? 480 : 760 + Math.random() * 180
          : isHit ? 280 : 480 + Math.random() * 240;
        await sleep(delay);
      }
    }

    const t = setTimeout(fire, 500);
    return () => {
      aliveRef.current = false;
      clearTimeout(t);
    };
  }, [compact, staticPreview]);

  const trimVisualFx = reducedFx || staticPreview;
  const partialIds = new Set<number>();
  hits.forEach((k) => {
    const sid = layout.shipMap[k];
    if (sid !== undefined && !sunkIds.has(sid)) partialIds.add(sid);
  });

  const hitCount = [...hits].filter((k) => layout.shipCells.has(k)).length;
  const sunkCount = sunkIds.size;
  const remain = layout.ships.length - sunkCount;

  function cellStyle(col: number, row: number): {
    bg: string;
    border: string;
    shadow: string;
    flashing: boolean;
  } {
    const key = `${col},${row}`;
    const sid = layout.shipMap[key];
    const isShip = sid !== undefined;
    const isSunk = isShip && sunkIds.has(sid);
    const isPartial = isShip && partialIds.has(sid);
    const isHit = hits.has(key);
    const isMiss = misses.has(key);
    const isCursor = cursor?.x === col && cursor?.y === row;
    const isFlashNow = flash?.key === key;
    const flashHit = isFlashNow && flash?.type === "hit";
    const flashMiss = isFlashNow && flash?.type === "miss";

    if (flashHit) return { bg: "rgba(239,68,68,0.7)", border: "rgba(239,68,68,1)", shadow: "0 0 24px rgba(239,68,68,1), inset 0 0 12px rgba(239,68,68,0.5)", flashing: true };
    if (flashMiss) return { bg: "rgba(100,130,200,0.25)", border: "rgba(100,150,255,0.7)", shadow: "0 0 16px rgba(100,150,255,0.8)", flashing: true };
    if (isSunk && isHit) return { bg: "rgba(239,68,68,0.35)", border: "rgba(239,68,68,0.7)", shadow: "0 0 10px rgba(239,68,68,0.6)", flashing: false };
    if (isPartial && isHit) return { bg: "rgba(251,191,36,0.35)", border: "rgba(251,191,36,0.8)", shadow: "0 0 10px rgba(251,191,36,0.6)", flashing: false };
    if (isSunk && !isHit) return { bg: "rgba(239,68,68,0.15)", border: "rgba(239,68,68,0.4)", shadow: "none", flashing: false };
    if (isPartial && !isHit) return { bg: "rgba(251,191,36,0.1)", border: "rgba(251,191,36,0.3)", shadow: "none", flashing: false };
    if (isHit) return { bg: "rgba(239,68,68,0.32)", border: "rgba(239,68,68,0.6)", shadow: "0 0 8px rgba(239,68,68,0.5)", flashing: false };
    if (isMiss) return { bg: "rgba(59,130,246,0.06)", border: "rgba(59,130,246,0.2)", shadow: "none", flashing: false };
    if (isCursor) return { bg: "rgba(0,220,180,0.12)", border: "rgba(0,220,180,0.9)", shadow: "0 0 16px rgba(0,220,180,0.7)", flashing: false };
    if (isShip) return { bg: "rgba(0,220,180,0.08)", border: "rgba(0,220,180,0.22)", shadow: "none", flashing: false };
    return { bg: "rgba(0,220,180,0.012)", border: "rgba(0,220,180,0.07)", shadow: "none", flashing: false };
  }

  return (
    <div className={`${styles.outer} ${compact ? styles.compact : ""}`}>
      {/* Stats header */}
      <div className={styles.statsRow}>
        <div className={styles.brand}>SEA BATTLE</div>
        <div className={styles.stats}>
          {(
            [
              ["HITS", hitCount, "#fbbf24"],
              ["SUNK", sunkCount, "#ef4444"],
              ["REMAIN", remain, "#00dcb4"],
            ] as [string, number, string][]
          ).map(([label, val, c]) => (
            <div key={label} className={styles.stat}>
              <div className={styles.statValue} style={{ color: c }}>
                {val}
              </div>
              <div className={styles.statLabel}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.frame}>
        <div className={styles.colHeader}>
          {COL_LETTERS.map((l) => (
            <div key={l} className={styles.headerCell}>
              {l}
            </div>
          ))}
        </div>

        <div className={styles.body}>
          <div className={styles.rowLabels}>
            {Array.from({ length: ROWS }, (_, row) => (
              <div key={row} className={styles.rowLabel}>
                {row + 1}
              </div>
            ))}
          </div>

          <div className={styles.panel}>
            <div className={styles.bgGridLines} aria-hidden="true" />
            <div className={styles.bgGlow} aria-hidden="true" />

            {Array.from({ length: ROWS }, (_, row) => (
              <div key={row} className={styles.row}>
                {Array.from({ length: COLS }, (_, col) => {
                  const key = `${col},${row}`;
                  const sid = layout.shipMap[key];
                  const isShip = sid !== undefined;
                  const isSunk = isShip && sunkIds.has(sid);
                  const isPartial = isShip && partialIds.has(sid);
                  const isHit = hits.has(key);
                  const isMiss = misses.has(key);
                  const isCursor = cursor?.x === col && cursor?.y === row;
                  const isFlashNow = flash?.key === key;
                  const cs = cellStyle(col, row);

                  const cellStyleObj: CSSProperties = {
                    background: cs.bg,
                    borderColor: cs.border,
                    boxShadow: trimVisualFx ? "none" : cs.shadow,
                  };

                  return (
                    <div
                      key={col}
                      className={`${styles.cell} ${cs.flashing ? styles.cellFlash : ""}`}
                      style={cellStyleObj}
                    >
                      {isCursor && !isHit && !isMiss && (
                        <>
                          <div className={styles.crosshairH} />
                          <div className={styles.crosshairV} />
                          <div className={styles.crosshairDot} />
                        </>
                      )}
                      {isHit && (
                        <span
                          className={`${styles.glyph} ${isFlashNow ? styles.glyphPop : ""} ${isSunk ? styles.glyphSunk : isPartial ? styles.glyphPartial : ""}`}
                          aria-hidden="true"
                        >
                          💥
                        </span>
                      )}
                      {!isHit && isMiss && (
                        <div
                          className={`${styles.missDot} ${isFlashNow ? styles.missDotIn : ""}`}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            ))}

            {victory && (
              <div className={styles.victory} aria-hidden="true">
                <div className={styles.victoryText}>VICTORY</div>
                <div className={styles.victorySub}>
                  {layout.totalHitsToWin} HITS · ALL SHIPS SUNK
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={styles.legend}>
        {[
          { color: "rgba(0,220,180,0.5)", border: "rgba(0,220,180,0.4)", label: "INTACT" },
          { color: "rgba(251,191,36,0.4)", border: "rgba(251,191,36,0.7)", label: "DAMAGED" },
          { color: "rgba(239,68,68,0.4)", border: "rgba(239,68,68,0.7)", label: "DESTROYED" },
          { color: "rgba(100,150,255,0.3)", border: "rgba(100,150,255,0.5)", label: "MISSED" },
        ].map((item) => (
          <div key={item.label} className={styles.legendItem}>
            <div
              className={styles.legendSwatch}
              style={{ background: item.color, borderColor: item.border }}
            />
            <span className={styles.legendLabel}>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
