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

  const occupiedSet = new Set<string>();
  for (const ps of placed) {
    for (const [cx, cy] of getShipCells(ps)) {
      occupiedSet.add(`${cx},${cy}`);
    }
  }

  for (let i = 0; i < ship.size; i++) {
    const cx = orientation === "h" ? x + i : x;
    const cy = orientation === "v" ? y + i : y;
    if (occupiedSet.has(`${cx},${cy}`)) return false;
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

export function ShipPlacement({ onConfirm, isPending, isConfirming }: ShipPlacementProps) {
  const [placedShips, setPlacedShips] = useState<PlacedShip[]>([]);
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
        <button className={styles.controlButton} onClick={handleAutoPlace}>
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
      />

      <button
        className={styles.confirmButton}
        disabled={!allPlaced || isPending || isConfirming}
        onClick={() => onConfirm(boardFromPlaced(placedShips))}
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
