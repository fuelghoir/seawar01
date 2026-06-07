"use client";

import { useSettings, type Lang } from "../lib/settings";
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

const COPY: Record<Lang, {
  confirmingResult: string;
  processing: string;
  autoReporting: string;
  selectTarget: string;
  confirmWallet: string;
  shotInFlight: (cell: string) => string;
  hitConfirmed: string;
  fireAt: (cell: string) => string;
}> = {
  en: {
    confirmingResult: "Confirming shot result...",
    processing: "Processing...",
    autoReporting: "Auto-reporting shot result...",
    selectTarget: "Select a target",
    confirmWallet: "Confirm in wallet...",
    shotInFlight: (cell) => `Shot at ${cell} in flight...`,
    hitConfirmed: "Hit confirmed!",
    fireAt: (cell) => `Fire at ${cell}`,
  },
  ru: {
    confirmingResult: "Подтверждаем результат выстрела...",
    processing: "Обработка...",
    autoReporting: "Автоматически отправляем результат...",
    selectTarget: "Выбери цель",
    confirmWallet: "Подтверди в кошельке...",
    shotInFlight: (cell) => `Выстрел по ${cell} летит...`,
    hitConfirmed: "Попадание подтверждено!",
    fireAt: (cell) => `Огонь по ${cell}`,
  },
};

export function ShotTransaction({
  selectedCell,
  isPending,
  isConfirming,
  isSuccess,
  onShoot,
  needsReport,
  disabled,
}: ShotTransactionProps) {
  const { lang } = useSettings();
  const copy = COPY[lang];
  const colLabels = "ABCDEFGHIJ";

  if (needsReport) {
    return (
      <button
        className={`${styles.button} ${styles.reportButton}`}
        disabled
      >
        {isPending
          ? copy.confirmingResult
          : isConfirming
            ? copy.processing
            : copy.autoReporting}
      </button>
    );
  }

  if (!selectedCell) {
    return (
      <button className={styles.button} disabled>
        {copy.selectTarget}
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
        ? copy.confirmWallet
        : isConfirming
          ? copy.shotInFlight(cellLabel)
          : isSuccess
            ? copy.hitConfirmed
            : copy.fireAt(cellLabel)}
    </button>
  );
}
