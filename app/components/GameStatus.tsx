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
  let bannerText = "";
  let bannerClass = styles.bannerEnemy;
  let subText = "";

  if (statusText) {
    bannerText = statusText;
    bannerClass = styles.bannerNeutral;
  } else if (isPending) {
    bannerText = "CONFIRM IN WALLET";
    bannerClass = styles.bannerPending;
  } else if (isConfirming) {
    bannerText = "SHOT IN FLIGHT";
    bannerClass = styles.bannerPending;
  } else if (needsReport) {
    bannerText = "REPORTING RESULT";
    bannerClass = styles.bannerPending;
    subText = "Auto-reporting enemy shot...";
  } else if (turnPhase === 1 && isMyTurn) {
    bannerText = "WAITING OPPONENT";
    bannerClass = styles.bannerEnemy;
    subText = "Enemy is confirming your shot...";
  } else if (isMyTurn) {
    bannerText = "YOUR TURN";
    bannerClass = styles.bannerYou;
    subText = "Pick a cell and fire!";
  } else {
    bannerText = "ENEMY TURN";
    bannerClass = styles.bannerEnemy;
    subText = "Waiting for opponent's shot...";
  }

  return (
    <div className={styles.container}>
      <div className={`${styles.banner} ${bannerClass}`}>
        <span className={styles.bannerText}>{bannerText}</span>
        <span className={`${styles.bannerSub} ${!subText ? styles.bannerSubEmpty : ""}`}>
          {subText || "\u00a0"}
        </span>
      </div>
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
    </div>
  );
}
