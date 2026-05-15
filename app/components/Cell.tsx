"use client";

import styles from "./Cell.module.css";

export type CellState =
  | "empty"
  | "ship"
  | "hit"
  | "miss"
  | "sunk"
  | "pending"
  | "radar"
  | "preview"
  | "preview-invalid";

interface CellProps {
  state: CellState;
  onClick?: () => void;
  isInteractive: boolean;
}

export function Cell({ state, onClick, isInteractive }: CellProps) {
  return (
    <div
      className={`${styles.cell} ${styles[state]} ${isInteractive ? styles.interactive : ""}`}
      onClick={isInteractive ? onClick : undefined}
    >
      {state === "hit" && <span className={styles.marker}>X</span>}
      {state === "sunk" && <span className={styles.marker}>X</span>}
      {state === "miss" && <span className={styles.marker}>&bull;</span>}
    </div>
  );
}
