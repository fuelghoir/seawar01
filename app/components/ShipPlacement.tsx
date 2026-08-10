"use client";

import { useState, useCallback } from "react";
import { Board } from "./Board";
import { CellState } from "./Cell";
import styles from "./ShipPlacement.module.css";

interface Ship {
  id: string;
  size: number;
  name: string;
}

interface PlacedShip extends Ship {
  x: number;
  y: number;
  orientation: "h" | "v";
}

const ALL_SHIPS: Ship[] = [
  { id: "battleship", size: 4, name: "Battleship (4)" },
  { id: "cruiser1", size: 3, name: "Cruiser (3)" },
  { id: "cruiser2", size: 3, name: "Cruiser (3)" },
  { id: "destroyer1", size: 2, name: "Destroyer (2)" },
  { id: "destroyer2", size: 2, name: "Destroyer (2)" },
  { id: "destroyer3", size: 2, name: "Destroyer (2)" },
  { id: "sub1", size: 1, name: "Patrol (1)" },
  { id: "sub2", size: 1, name: "Patrol (1)" },
  { id: "sub3", size: 1, name: "Patrol (1)" },
  { id: "sub4", size: 1, name: "Patrol (1)" },
];

interface ShipPlacementProps {
  onConfirm: (boardLayout: number[]) => void;
  isPending: boolean;
  isConfirming: boolean;
  trainingTarget?: "autoplace" | "confirm" | null;
  onAutoPlace?: (boardLayout: number[]) => void;
  initialBoardLayout?: number[];
}

function getShipCells(ship: PlacedShip): [number, number][] {
  const cells: [number, number][] = [];
  for (let i = 0; i < ship.size; i++) {
    const cx = ship.orientation === "h" ? ship.x + i : ship.x;
    const cy = ship.orientation === "v" ? ship.y + i : ship.y;
    cells.push([cx, cy]);
  }
  return cells;
}

function isValidPlacement(
  ship: Ship,
  x: number,
  y: number,
  orientation: "h" | "v",
  placed: PlacedShip[]
): boolean {
  const endX = orientation === "h" ? x + ship.size - 1 : x;
  const endY = orientation === "v" ? y + ship.size - 1 : y;
  if (endX > 9 || endY > 9) return false;

  // Build set of occupied cells AND their 1-cell buffer zones
  const blockedSet = new Set<string>();
  for (const ps of placed) {
    for (const [cx, cy] of getShipCells(ps)) {
      // Mark the cell and all 8 neighbors as blocked
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          blockedSet.add(`${cx + dx},${cy + dy}`);
        }
      }
    }
  }

  for (let i = 0; i < ship.size; i++) {
    const cx = orientation === "h" ? x + i : x;
    const cy = orientation === "v" ? y + i : y;
    if (blockedSet.has(`${cx},${cy}`)) return false;
  }

  return true;
}

function boardFromPlaced(placed: PlacedShip[]): number[] {
  const board = new Array(100).fill(0);
  for (const ship of placed) {
    for (const [cx, cy] of getShipCells(ship)) {
      board[cy * 10 + cx] = 1;
    }
  }
  return board;
}

function placedFromBoard(board: number[]): PlacedShip[] {
  if (board.length !== 100) return [];
  const occupied = new Set(
    board.flatMap((value, index) => value === 1 ? [index] : [])
  );
  const visited = new Set<number>();
  const components: number[][] = [];

  for (const start of occupied) {
    if (visited.has(start)) continue;
    const component: number[] = [];
    const queue = [start];
    visited.add(start);

    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      const x = current % 10;
      const y = Math.floor(current / 10);
      const neighbors = [
        x > 0 ? current - 1 : -1,
        x < 9 ? current + 1 : -1,
        y > 0 ? current - 10 : -1,
        y < 9 ? current + 10 : -1,
      ];
      for (const next of neighbors) {
        if (next >= 0 && occupied.has(next) && !visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    components.push(component.sort((a, b) => a - b));
  }

  const remainingShips = [...ALL_SHIPS];
  const placed: PlacedShip[] = [];
  for (const component of components.sort((a, b) => b.length - a.length)) {
    const shipIndex = remainingShips.findIndex((ship) => ship.size === component.length);
    if (shipIndex < 0) return [];
    const [ship] = remainingShips.splice(shipIndex, 1);
    const xs = component.map((index) => index % 10);
    const ys = component.map((index) => Math.floor(index / 10));
    const orientation: "h" | "v" = new Set(ys).size === 1 ? "h" : "v";
    placed.push({
      ...ship,
      x: Math.min(...xs),
      y: Math.min(...ys),
      orientation,
    });
  }

  return placed.length === ALL_SHIPS.length ? placed : [];
}

function randomPlacement(): PlacedShip[] {
  const placed: PlacedShip[] = [];
  for (const ship of ALL_SHIPS) {
    let attempts = 0;
    while (attempts < 200) {
      const orientation: "h" | "v" = Math.random() < 0.5 ? "h" : "v";
      const maxX = orientation === "h" ? 10 - ship.size : 9;
      const maxY = orientation === "v" ? 10 - ship.size : 9;
      const x = Math.floor(Math.random() * (maxX + 1));
      const y = Math.floor(Math.random() * (maxY + 1));
      if (isValidPlacement(ship, x, y, orientation, placed)) {
        placed.push({ ...ship, x, y, orientation });
        break;
      }
      attempts++;
    }
  }
  return placed;
}

export function ShipPlacement({
  onConfirm,
  isPending,
  isConfirming,
  trainingTarget = null,
  onAutoPlace,
  initialBoardLayout,
}: ShipPlacementProps) {
  const [placedShips, setPlacedShips] = useState<PlacedShip[]>(() =>
    initialBoardLayout ? placedFromBoard(initialBoardLayout) : []
  );
  const [selectedShipId, setSelectedShipId] = useState<string | null>(null);
  const [orientation, setOrientation] = useState<"h" | "v">("h");

  const availableShips = ALL_SHIPS.filter(
    (s) => !placedShips.find((ps) => ps.id === s.id)
  );

  const selectedShip = availableShips.find((s) => s.id === selectedShipId) || null;

  const handleCellClick = useCallback(
    (x: number, y: number) => {
      // If clicking on a placed ship, remove it
      const clickedShip = placedShips.find((ps) =>
        getShipCells(ps).some(([cx, cy]) => cx === x && cy === y)
      );
      if (clickedShip) {
        setPlacedShips((prev) => prev.filter((ps) => ps.id !== clickedShip.id));
        return;
      }

      if (!selectedShip) return;
      if (!isValidPlacement(selectedShip, x, y, orientation, placedShips)) return;

      setPlacedShips((prev) => [...prev, { ...selectedShip, x, y, orientation }]);
      setSelectedShipId(null);
    },
    [selectedShip, orientation, placedShips]
  );

  const handleAutoPlace = () => {
    const placed = randomPlacement();
    if (placed.length === ALL_SHIPS.length) {
      setPlacedShips(placed);
      setSelectedShipId(null);
      onAutoPlace?.(boardFromPlaced(placed));
    }
  };

  const handleClear = () => {
    setPlacedShips([]);
    setSelectedShipId(null);
  };

  // Build cell grid for Board
  const cells: CellState[][] = Array.from({ length: 10 }, () =>
    Array(10).fill("empty" as CellState)
  );

  // Mark placed ships
  for (const ship of placedShips) {
    for (const [cx, cy] of getShipCells(ship)) {
      cells[cy][cx] = "ship";
    }
  }

  const allPlaced = placedShips.length === ALL_SHIPS.length;

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>Place Your Ships</h2>

      <div className={styles.shipList}>
        {availableShips.map((ship) => (
          <button
            key={ship.id}
            className={`${styles.shipButton} ${selectedShipId === ship.id ? styles.selected : ""}`}
            onClick={() => setSelectedShipId(ship.id === selectedShipId ? null : ship.id)}
          >
            <span className={styles.shipBlocks}>
              {Array.from({ length: ship.size }, (_, i) => (
                <span key={i} className={styles.shipBlock} />
              ))}
            </span>
            <span className={styles.shipName}>{ship.name}</span>
          </button>
        ))}
      </div>

      <div className={styles.controls}>
        <button
          className={styles.controlButton}
          onClick={() => setOrientation((o) => (o === "h" ? "v" : "h"))}
          disabled={!selectedShip}
        >
          Rotate ({orientation === "h" ? "horiz" : "vert"})
        </button>
        <button
          className={styles.controlButton}
          onClick={handleAutoPlace}
          type="button"
          data-training-target={trainingTarget === "autoplace" ? "autoplace" : undefined}
        >
          Random
        </button>
        <button className={styles.controlButton} onClick={handleClear}>
          Clear
        </button>
      </div>

      <Board
        cells={cells}
        onCellClick={handleCellClick}
        isInteractive={true}
        label="Your Fleet"
        variant="placement"
      />

      <button
        className={styles.confirmButton}
        disabled={!allPlaced || isPending || isConfirming}
        onClick={() => onConfirm(boardFromPlaced(placedShips))}
        type="button"
        data-training-target={trainingTarget === "confirm" ? "confirm" : undefined}
      >
        {isPending
          ? "Confirm in wallet..."
          : isConfirming
            ? "Committing board..."
            : allPlaced
              ? "Ready for Battle!"
              : `Place ${ALL_SHIPS.length - placedShips.length} more ship(s)`}
      </button>
    </div>
  );
}
