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
  label: string;
}

const STATE_LABELS: Record<CellState, string> = {
  empty: "unshot water",
  ship: "friendly ship",
  hit: "hit",
  miss: "blocked water",
  sunk: "sunk ship",
  pending: "target locked",
  radar: "radar contact",
  preview: "ship preview",
  "preview-invalid": "invalid ship position",
};

export function Cell({ state, onClick, isInteractive, label }: CellProps) {
  const content = (
    <>
      {state === "hit" && <span className={styles.marker}>X</span>}
      {state === "sunk" && <span className={styles.marker}>X</span>}
      {state === "miss" && <span className={styles.marker}>&bull;</span>}
      {state === "pending" && <span className={styles.targetCorners} aria-hidden="true" />}
    </>
  );

  if (isInteractive) {
    return (
      <button
        type="button"
        className={`${styles.cell} ${styles[state]} ${styles.interactive}`}
        onClick={onClick}
        aria-label={`${label}: ${STATE_LABELS[state]}`}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className={`${styles.cell} ${styles[state]}`}
      aria-label={`${label}: ${STATE_LABELS[state]}`}
    >
      {content}
    </div>
  );
}
