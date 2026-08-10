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
  trainingTarget?: string;
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

export function Cell({ state, onClick, isInteractive, label, trainingTarget }: CellProps) {
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
        className={`${styles.cell} ${styles[state]} ${styles.interactive} ${trainingTarget ? styles.trainingTarget : ""}`}
        onClick={onClick}
        aria-label={`${label}: ${STATE_LABELS[state]}`}
        data-training-target={trainingTarget}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className={`${styles.cell} ${styles[state]} ${trainingTarget ? styles.trainingTarget : ""}`}
      aria-label={`${label}: ${STATE_LABELS[state]}`}
      data-training-target={trainingTarget}
    >
      {content}
    </div>
  );
}
