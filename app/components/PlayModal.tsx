"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { RobotIcon, UsersIcon, DollarIcon, ChevronRightIcon } from "./Icons";
import { useSettings, TR } from "../lib/settings";
import styles from "./PlayModal.module.css";

interface PlayModalProps {
  open: boolean;
  onClose: () => void;
}

export function PlayModal({ open, onClose }: PlayModalProps) {
  const router = useRouter();
  const { lang } = useSettings();
  const tr = TR[lang];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const modes = [
    {
      id: "bot" as const,
      label: tr.home_play_bot,
      sub: tr.home_play_bot_sub,
      accent: "#00dcb4",
      Icon: RobotIcon,
      onSelect: () => router.push("/game?id=0&mode=bot"),
    },
    {
      id: "friend" as const,
      label: tr.home_play_friend,
      sub: tr.home_play_friend_sub,
      accent: "#3b82f6",
      Icon: UsersIcon,
      onSelect: () => router.push("/play?mode=friend"),
    },
    {
      id: "wager" as const,
      label: tr.home_play_wager,
      sub: tr.home_play_wager_sub,
      accent: "#a855f7",
      Icon: DollarIcon,
      onSelect: () => router.push("/play?mode=wager"),
    },
  ];

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <button className={styles.close} onClick={onClose} aria-label={tr.play_modal_close}>
          ✕
        </button>

        <div className={styles.heading}>
          <div className={styles.kicker}>{tr.play_modal_kicker.toUpperCase()}</div>
          <div className={styles.title}>{tr.play_modal_title.toUpperCase()}</div>
        </div>

        <div className={styles.grid}>
          {modes.map((m, i) => {
            const Icon = m.Icon;
            return (
              <button
                key={m.id}
                onClick={m.onSelect}
                className={styles.modeCard}
                style={{
                  ["--accent" as string]: m.accent,
                  animationDelay: `${i * 0.06}s`,
                }}
                type="button"
              >
                <span className={styles.iconCircle}>
                  <Icon size={26} />
                </span>
                <span className={styles.modeLabel}>{m.label}</span>
                <span className={styles.modeSub}>{m.sub}</span>
                <span className={styles.selectBar}>
                  {tr.play_modal_select.toUpperCase()}
                  <ChevronRightIcon size={14} />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
