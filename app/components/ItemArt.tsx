"use client";

import type { ShopItemSlug } from "../lib/season";
import styles from "./ItemArt.module.css";

export type ItemArtKind = ShopItemSlug | "bomb_3x3" | "points";

type ItemArtProps = {
  kind: ItemArtKind;
  size?: "tiny" | "small" | "medium" | "large" | "showcase" | "hero";
  className?: string;
};

const LABELS: Record<ItemArtKind, string> = {
  bomb_3x3: "Bomb 3x3",
  double_points_1h: "Double Points",
  quest_reroll: "Quest Reroll",
  streak_freeze: "Streak Freeze",
  radar_scan: "Radar Scan",
  torpedo: "Torpedo",
  points: "Points",
};

function BombMark() {
  return (
    <>
      <span className={styles.bombGrid} aria-hidden="true">
        {Array.from({ length: 9 }, (_, index) => (
          <span key={index} className={index === 4 ? styles.bombCore : undefined} />
        ))}
      </span>
      <span className={styles.bombSpark} aria-hidden="true" />
    </>
  );
}

function DoublePointsMark() {
  return (
    <>
      <span className={styles.coinBack} aria-hidden="true" />
      <span className={styles.coinFront} aria-hidden="true">2X</span>
    </>
  );
}

function RerollMark() {
  return (
    <svg className={styles.rerollSvg} viewBox="0 0 24 24" aria-hidden="true">
      <path
        className={styles.rerollPath}
        d="M20,8 C18.5974037,5.04031171 15.536972,3 12,3 C7.02943725,3 3,7.02943725 3,12 C3,16.9705627 7.02943725,21 12,21 L12,21 C16.9705627,21 21,16.9705627 21,12 M21,3 L21,9 L15,9"
      />
    </svg>
  );
}

function FreezeMark() {
  return (
    <svg className={styles.freezeSvg} viewBox="0 0 64 64" aria-hidden="true">
      <path
        className={styles.freezeShieldPath}
        d="M32 7 48 14.5 44.8 41.4 32 56 19.2 41.4 16 14.5 32 7Z"
      />
      <path className={styles.freezeFlakeMain} d="M32 15v34M17.5 23.5l29 17M46.5 23.5l-29 17" />
      <path className={styles.freezeFlakeBranch} d="M25 19.5 32 26.5l7-7M25 44.5l7-7 7 7M19.5 32l9.5-2.6M35 34.6l9.5-2.6M19.5 32l9.5 2.6M35 29.4l9.5 2.6" />
      <circle className={styles.freezeCore} cx="32" cy="32" r="3.2" />
    </svg>
  );
}

function RadarMark() {
  return (
    <>
      <span className={styles.radarRingA} aria-hidden="true" />
      <span className={styles.radarRingB} aria-hidden="true" />
      <span className={styles.radarSweep} aria-hidden="true" />
      <span className={styles.radarDot} aria-hidden="true" />
    </>
  );
}

function TorpedoMark() {
  return (
    <>
      <span className={styles.torpedoWake} aria-hidden="true" />
      <span className={styles.torpedoBody} aria-hidden="true" />
      <span className={styles.torpedoNose} aria-hidden="true" />
    </>
  );
}

function PointsMark() {
  return (
    <svg className={styles.pointsSvg} viewBox="0 0 64 64" aria-hidden="true">
      <circle className={styles.pointsCoinOuter} cx="32" cy="32" r="22" />
      <circle className={styles.pointsCoinInner} cx="32" cy="32" r="14" />
      <path
        className={styles.pointsStar}
        d="M32 19l4 8 9 1-7 6 2 9-8-4-8 4 2-9-7-6 9-1z"
      />
    </svg>
  );
}

function renderMark(kind: ItemArtKind) {
  switch (kind) {
    case "bomb_3x3":
      return <BombMark />;
    case "double_points_1h":
      return <DoublePointsMark />;
    case "quest_reroll":
      return <RerollMark />;
    case "streak_freeze":
      return <FreezeMark />;
    case "radar_scan":
      return <RadarMark />;
    case "torpedo":
      return <TorpedoMark />;
    case "points":
      return <PointsMark />;
  }
}

export function ItemArt({ kind, size = "medium", className }: ItemArtProps) {
  return (
    <span
      className={`${styles.itemArt} ${styles[kind]} ${styles[size]} ${className ?? ""}`}
      aria-label={LABELS[kind]}
      title={LABELS[kind]}
    >
      <span className={styles.itemGlow} aria-hidden="true" />
      {renderMark(kind)}
    </span>
  );
}
