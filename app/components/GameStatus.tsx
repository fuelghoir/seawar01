"use client";

import styles from "./GameStatus.module.css";

interface GameStatusProps {
  isMyTurn: boolean;
  myHits: number;
  enemyHits: number;
  isPending: boolean;
  isConfirming: boolean;
  turnPhase: number; // 0 = Shooting, 1 = WaitingReport
  needsReport: boolean;
  statusText?: string;
}

export function GameStatus({
  isMyTurn,
  myHits,
  enemyHits,
  isPending,
  isConfirming,
  turnPhase,
  needsReport,
  statusText,
}: GameStatusProps) {
  let message = "";
  let messageClass = styles.statusNeutral;

  if (statusText) {
    message = statusText;
  } else if (isPending) {
    message = "Confirm in wallet...";
    messageClass = styles.statusPending;
  } else if (isConfirming) {
    message = "Shot in flight...";
    messageClass = styles.statusConfirming;
  } else if (needsReport) {
    message = "Auto-reporting shot result...";
    messageClass = styles.statusReport;
  } else if (turnPhase === 1 && isMyTurn) {
    message = "Waiting for opponent to confirm...";
    messageClass = styles.statusWaiting;
  } else if (isMyTurn) {
    message = "Your turn — fire!";
    messageClass = styles.statusActive;
  } else {
    message = "Opponent's turn";
    messageClass = styles.statusWaiting;
  }

  return (
    <div className={styles.container}>
      <div className={styles.scores}>
        <div className={styles.scoreBlock}>
          <span className={styles.scoreLabel}>You</span>
          <span className={styles.scoreValue}>{myHits}/20</span>
        </div>
        <div className={styles.divider} />
        <div className={styles.scoreBlock}>
          <span className={styles.scoreLabel}>Enemy</span>
          <span className={styles.scoreValue}>{enemyHits}/20</span>
        </div>
      </div>
      <div className={`${styles.status} ${messageClass}`}>{message}</div>
    </div>
  );
}
