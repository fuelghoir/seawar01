"use client";

import { useCallback, useState } from "react";
import { Board } from "./Board";
import { CellState } from "./Cell";
import {
  CHALLENGE_GRID_SIZE,
  CHALLENGE_SHIP_SIZES,
} from "../lib/challengeShared";
import styles from "./ChallengeShipPlacement.module.css";

type Orientation = "h" | "v";

type Ship = {
  id: string;
  size: number;
  name: string;
};

type PlacedShip = Ship & {
  x: number;
  y: number;
  orientation: Orientation;
};

const SHIPS: Ship[] = CHALLENGE_SHIP_SIZES.map((size, index) => ({
  id: `ship-${index}`,
  size,
  name: size === 3 ? "Frigate (3)" : size === 2 ? "Cutter (2)" : "Scout (1)",
}));

interface ChallengeShipPlacementProps {
  onConfirm: (boardLayout: number[]) => void;
  isPending: boolean;
  isConfirming: boolean;
}

function getShipCells(ship: PlacedShip): [number, number][] {
  return Array.from({ length: ship.size }, (_, index) => [
    ship.orientation === "h" ? ship.x + index : ship.x,
    ship.orientation === "v" ? ship.y + index : ship.y,
  ]);
}

function isValidPlacement(
  ship: Ship,
  x: number,
  y: number,
  orientation: Orientation,
  placed: PlacedShip[],
) {
  const endX = orientation === "h" ? x + ship.size - 1 : x;
  const endY = orientation === "v" ? y + ship.size - 1 : y;
  if (x < 0 || y < 0 || endX >= CHALLENGE_GRID_SIZE || endY >= CHALLENGE_GRID_SIZE) {
    return false;
  }

  const blocked = new Set<string>();
  for (const existing of placed) {
    for (const [cx, cy] of getShipCells(existing)) {
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          blocked.add(`${cx + dx},${cy + dy}`);
        }
      }
    }
  }

  for (let i = 0; i < ship.size; i += 1) {
    const cx = orientation === "h" ? x + i : x;
    const cy = orientation === "v" ? y + i : y;
    if (blocked.has(`${cx},${cy}`)) return false;
  }
  return true;
}

function boardFromPlaced(placed: PlacedShip[]) {
  const board = Array(CHALLENGE_GRID_SIZE * CHALLENGE_GRID_SIZE).fill(0);
  for (const ship of placed) {
    for (const [x, y] of getShipCells(ship)) {
      board[y * CHALLENGE_GRID_SIZE + x] = 1;
    }
  }
  return board;
}

function randomPlacement() {
  for (let round = 0; round < 120; round += 1) {
    const placed: PlacedShip[] = [];
    for (const ship of SHIPS) {
      let placedShip: PlacedShip | null = null;
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const orientation: Orientation = Math.random() < 0.5 ? "h" : "v";
        const maxX = orientation === "h" ? CHALLENGE_GRID_SIZE - ship.size : CHALLENGE_GRID_SIZE - 1;
        const maxY = orientation === "v" ? CHALLENGE_GRID_SIZE - ship.size : CHALLENGE_GRID_SIZE - 1;
        const x = Math.floor(Math.random() * (maxX + 1));
        const y = Math.floor(Math.random() * (maxY + 1));
        if (isValidPlacement(ship, x, y, orientation, placed)) {
          placedShip = { ...ship, x, y, orientation };
          break;
        }
      }
      if (!placedShip) break;
      placed.push(placedShip);
    }
    if (placed.length === SHIPS.length) return placed;
  }
  return [];
}

export function ChallengeShipPlacement({
  onConfirm,
  isPending,
  isConfirming,
}: ChallengeShipPlacementProps) {
  const [placedShips, setPlacedShips] = useState<PlacedShip[]>([]);
  const [selectedShipId, setSelectedShipId] = useState<string | null>(SHIPS[0]?.id ?? null);
  const [orientation, setOrientation] = useState<Orientation>("h");

  const availableShips = SHIPS.filter((ship) => !placedShips.some((placed) => placed.id === ship.id));
  const selectedShip = availableShips.find((ship) => ship.id === selectedShipId) ?? null;
  const allPlaced = placedShips.length === SHIPS.length;

  const handleCellClick = useCallback(
    (x: number, y: number) => {
      const clickedShip = placedShips.find((ship) =>
        getShipCells(ship).some(([cx, cy]) => cx === x && cy === y),
      );
      if (clickedShip) {
        setPlacedShips((current) => current.filter((ship) => ship.id !== clickedShip.id));
        setSelectedShipId(clickedShip.id);
        return;
      }

      if (!selectedShip) return;
      if (!isValidPlacement(selectedShip, x, y, orientation, placedShips)) return;

      setPlacedShips((current) => [...current, { ...selectedShip, x, y, orientation }]);
      const nextShip = availableShips.find((ship) => ship.id !== selectedShip.id);
      setSelectedShipId(nextShip?.id ?? null);
    },
    [availableShips, orientation, placedShips, selectedShip],
  );

  const cells: CellState[][] = Array.from({ length: CHALLENGE_GRID_SIZE }, () =>
    Array(CHALLENGE_GRID_SIZE).fill("empty" as CellState),
  );
  for (const ship of placedShips) {
    for (const [x, y] of getShipCells(ship)) cells[y][x] = "ship";
  }

  return (
    <div className={styles.container}>
      <div className={styles.summary}>
        <span>Quick 5x5 fleet</span>
        <b>{CHALLENGE_SHIP_SIZES.join(" / ")}</b>
      </div>

      <div className={styles.shipList}>
        {availableShips.map((ship) => (
          <button
            key={ship.id}
            type="button"
            className={`${styles.shipButton} ${selectedShipId === ship.id ? styles.selected : ""}`}
            onClick={() => setSelectedShipId(ship.id)}
          >
            <span className={styles.shipBlocks}>
              {Array.from({ length: ship.size }, (_, index) => (
                <span key={index} className={styles.shipBlock} />
              ))}
            </span>
            <span>{ship.name}</span>
          </button>
        ))}
      </div>

      <div className={styles.controls}>
        <button
          type="button"
          className={styles.controlButton}
          onClick={() => setOrientation((value) => (value === "h" ? "v" : "h"))}
          disabled={!selectedShip}
        >
          Rotate {orientation.toUpperCase()}
        </button>
        <button
          type="button"
          className={styles.controlButton}
          onClick={() => {
            const next = randomPlacement();
            if (next.length) {
              setPlacedShips(next);
              setSelectedShipId(null);
            }
          }}
        >
          Random
        </button>
        <button
          type="button"
          className={styles.controlButton}
          onClick={() => {
            setPlacedShips([]);
            setSelectedShipId(SHIPS[0]?.id ?? null);
          }}
        >
          Clear
        </button>
      </div>

      <Board
        cells={cells}
        onCellClick={handleCellClick}
        isInteractive
        label="Bounty Fleet"
        variant="placement"
        cellSize="42px"
      />

      <button
        type="button"
        className={styles.confirmButton}
        disabled={!allPlaced || isPending || isConfirming}
        onClick={() => onConfirm(boardFromPlaced(placedShips))}
      >
        {isPending
          ? "Confirm in wallet..."
          : isConfirming
            ? "Saving challenge..."
            : allPlaced
              ? "Create 5x5 Challenge"
              : `Place ${SHIPS.length - placedShips.length} ship(s)`}
      </button>
    </div>
  );
}
