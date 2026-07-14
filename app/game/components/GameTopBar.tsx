"use client";

import { useRouter } from "next/navigation";
import styles from "./game-ui.module.css";

interface GameTopBarProps {
  mode: "bot" | "friend" | "wager";
  phase: "lobby" | "placement" | "battle" | "result";
  turnLabel?: string;
  turnAccent?: string;
  yourShips?: number;
  enemyShips?: number;
  timer?: number;
}

const MODE_INFO: Record<
  GameTopBarProps["mode"],
  { label: string; accent: string }
> = {
  bot: { label: "VS AI BOT", accent: "var(--accent)" },
  friend: { label: "VS FRIEND", accent: "var(--accent-2)" },
  wager: { label: "USDC WAGER", accent: "var(--accent)" },
};

function alphaColor(color: string, hexAlpha: string, alpha: number) {
  if (color === "var(--accent)") return `rgba(var(--accent-rgb), ${alpha})`;
  if (color === "var(--accent-2)") return `rgba(var(--accent-2-rgb), ${alpha})`;
  return `${color}${hexAlpha}`;
}

export function GameTopBar({
  mode,
  phase,
  turnLabel,
  turnAccent,
  yourShips,
  enemyShips,
  timer,
}: GameTopBarProps) {
  const router = useRouter();
  const info = MODE_INFO[mode];
  const activeTurnAccent = turnAccent ?? info.accent;
  const phaseLabel =
    phase === "lobby"
      ? "PHASE 0 · LOBBY"
      : phase === "placement"
        ? "PHASE 1 · PLACE SHIPS"
        : phase === "battle"
          ? "PHASE 2 · BATTLE"
          : "PHASE 3 · RESULT";

  return (
    <div className={styles.topBar}>
      <div className={styles.left}>
        <button
          className={styles.exit}
          onClick={() => router.push("/")}
          type="button"
          aria-label="Exit"
        >
          ←
        </button>

        <div className={styles.title}>SEA BATTLE</div>
      </div>

      {phase === "battle" && turnLabel ? (
        <div className={styles.turnBlock}>
          <div
            className={styles.turnPill}
            style={{
              background: alphaColor(activeTurnAccent, "18", 0.1),
              border: `1px solid ${alphaColor(activeTurnAccent, "55", 0.34)}`,
              color: activeTurnAccent,
            }}
          >
            <span
              className={styles.turnDot}
              style={{
                background: activeTurnAccent,
                boxShadow: `0 0 6px ${activeTurnAccent}`,
              }}
            />
            {turnLabel}
          </div>
          {timer != null && (
            <div
              className={styles.turnTimer}
              style={{ color: timer < 10 ? "#ef4444" : activeTurnAccent }}
            >
              {timer}s
            </div>
          )}
        </div>
      ) : (
        <div
          className={styles.modeBadge}
          style={{
            color: info.accent,
            borderColor: alphaColor(info.accent, "55", 0.34),
          }}
        >
          <span
            className={styles.modeDot}
            style={{ background: info.accent, boxShadow: `0 0 6px ${info.accent}` }}
          />
          {info.label}
        </div>
      )}

      <div className={styles.right}>
        {phase !== "battle" && (
          <span className={styles.phase}>{phaseLabel}</span>
        )}
      </div>
    </div>
  );
}
