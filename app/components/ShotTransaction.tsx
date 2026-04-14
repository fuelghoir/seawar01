"use client";

import styles from "./ShotTransaction.module.css";

interface ShotTransactionProps {
  selectedCell: { x: number; y: number } | null;
  isPending: boolean;
  isConfirming: boolean;
  isSuccess: boolean;
  onShoot: () => void;
  needsReport: boolean;
  disabled: boolean;
}

export function ShotTransaction({
  selectedCell,
  isPending,
  isConfirming,
  isSuccess,
  onShoot,
  needsReport,
  disabled,
}: ShotTransactionProps) {
  const colLabels = "АБВГДЕЁЖЗИ";

  if (needsReport) {
    return (
      <button
        className={`${styles.button} ${styles.reportButton}`}
        disabled
      >
        {isPending
          ? "Confirming shot result..."
          : isConfirming
            ? "Processing..."
            : "Auto-reporting shot result..."}
      </button>
    );
  }

  if (!selectedCell) {
    return (
      <button className={styles.button} disabled>
        Select a target
      </button>
    );
  }

  const cellLabel = `${colLabels[selectedCell.x]}${selectedCell.y + 1}`;

  return (
    <button
      className={`${styles.button} ${styles.fireButton}`}
      onClick={onShoot}
      disabled={disabled || isPending || isConfirming}
    >
      {isPending
        ? "Confirm in wallet..."
        : isConfirming
          ? `Shot at ${cellLabel} in flight...`
          : isSuccess
            ? "Hit confirmed!"
            : `Fire at ${cellLabel}`}
    </button>
  );
}
