"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSettings, TR } from "../lib/settings";
import styles from "./PlayModal.module.css";

interface PlayModalProps {
  open: boolean;
  onClose: () => void;
  walletConnected?: boolean;
  onConnectRequest?: () => void;
  tutorialBotMode?: boolean;
}

function BotModeArt() {
  return (
    <svg viewBox="0 0 220 112">
      <path className={styles.chartLine} d="M8 88h204M18 70h184M32 52h156" />
      <circle className={styles.sonarRing} cx="110" cy="54" r="39" />
      <circle className={styles.sonarRingMuted} cx="110" cy="54" r="25" />
      <path className={styles.sonarSweep} d="M110 54 142 30A40 40 0 0 1 149 54Z" />
      <path className={styles.shipBody} d="m61 70 10-17h35l8-12h25l8 12h18l-9 17-20 8H82Z" />
      <path className={styles.shipDetail} d="M94 52V39h13v13m17-11V30h8v11M74 60h83" />
      <path className={styles.reticle} d="M104 18h12m-6-6v12m-6 68h12m-6-6v12" />
      <circle className={styles.contactDot} cx="166" cy="31" r="3" />
    </svg>
  );
}

function FriendModeArt() {
  return (
    <svg viewBox="0 0 220 112">
      <path className={styles.chartLine} d="M8 89h204M18 72h184M32 55h156" />
      <path className={styles.linkLine} d="M73 41c21-19 53-19 74 0" />
      <circle className={styles.linkNode} cx="69" cy="44" r="5" />
      <circle className={styles.linkNode} cx="151" cy="44" r="5" />
      <path className={styles.shipBody} d="m25 76 8-14h25l7-10h20l7 10h12l-8 14-15 6H43Z" />
      <path className={styles.shipDetail} d="M52 61V49h12v12m8-9V41h7v11M35 69h58" />
      <path className={styles.shipBody} d="m116 76 8-14h25l7-10h20l7 10h12l-8 14-15 6h-38Z" />
      <path className={styles.shipDetail} d="M143 61V49h12v12m8-9V41h7v11m-44 17h58" />
      <path className={styles.signalMark} d="M101 29a13 13 0 0 1 18 0m-13 5a6 6 0 0 1 8 0" />
    </svg>
  );
}

function WagerModeArt() {
  return (
    <svg viewBox="0 0 220 112">
      <path className={styles.chartLine} d="M8 89h204M18 72h184M32 55h156" />
      <circle className={styles.coinOuter} cx="166" cy="35" r="25" />
      <circle className={styles.coinInner} cx="166" cy="35" r="18" />
      <path className={styles.coinMark} d="M173 27c-2-2-5-3-8-3-5 0-8 2-8 6 0 9 18 3 18 12 0 4-4 6-9 6-4 0-8-1-10-4m10-24v31" />
      <path className={styles.shipBody} d="m38 77 10-18h34l8-13h28l9 13h19l-10 18-20 7H59Z" />
      <path className={styles.shipDetail} d="M72 58V44h14v14m11-12V33h8v13M50 68h87" />
      <path className={styles.armourLine} d="m46 77 14 11h57l17-11" />
      <path className={styles.reticle} d="M23 28h18m-9-9v18" />
    </svg>
  );
}

export function PlayModal({
  open,
  onClose,
  walletConnected = true,
  onConnectRequest,
  tutorialBotMode = false,
}: PlayModalProps) {
  const router = useRouter();
  const { lang } = useSettings();
  const tr = TR[lang];
  const firstModeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => firstModeRef.current?.focus(), 80);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const modes = [
    {
      id: "bot" as const,
      code: "01 / TRAINING",
      label: tr.home_play_bot,
      sub: tr.home_play_bot_sub,
      accent: "#35e6c1",
      accentRgb: "53 230 193",
      Art: BotModeArt,
      onSelect: () => router.push(
        tutorialBotMode
          ? "/game?id=0&mode=bot&tutorial=1"
          : "/game?id=0&mode=bot",
      ),
    },
    {
      id: "friend" as const,
      code: "02 / PRIVATE LINK",
      label: tr.home_play_friend,
      sub: tr.home_play_friend_sub,
      accent: "#66a6ff",
      accentRgb: "102 166 255",
      Art: FriendModeArt,
      onSelect: () => {
        if (!walletConnected) {
          onClose();
          onConnectRequest?.();
          return;
        }
        router.push("/play?mode=friend");
      },
    },
    {
      id: "wager" as const,
      code: "03 / USDC STAKE",
      label: tr.home_play_wager,
      sub: tr.home_play_wager_sub,
      accent: "#f3bc62",
      accentRgb: "243 188 98",
      Art: WagerModeArt,
      onSelect: () => {
        if (!walletConnected) {
          onClose();
          onConnectRequest?.();
          return;
        }
        router.push("/play?mode=wager");
      },
    },
  ];

  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <section
        className={styles.modal}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="play-mode-title"
      >
        <span className={styles.dragHandle} aria-hidden="true" />
        <button
          className={styles.close}
          onClick={onClose}
          aria-label={tr.play_modal_close}
          type="button"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="m5 5 10 10M15 5 5 15" />
          </svg>
        </button>

        <header className={styles.heading}>
          <div>
            <span className={styles.kicker}>{tr.play_modal_kicker.toUpperCase()}</span>
            <h2 className={styles.title} id="play-mode-title">
              {tr.play_modal_title.toUpperCase()}
            </h2>
          </div>
          <div className={styles.headingStatus} aria-hidden="true">
            <span>COMBAT DECK</span>
            <b><i /> ONLINE</b>
          </div>
        </header>

        <div className={styles.grid}>
          {modes.map((mode, index) => {
            const Art = mode.Art;
            return (
              <button
                key={mode.id}
                ref={index === 0 ? firstModeRef : undefined}
                data-tour={mode.id === "bot" ? "bot-mode" : undefined}
                onClick={mode.onSelect}
                className={styles.modeCard}
                style={{
                  ["--mode-accent" as string]: mode.accent,
                  ["--mode-rgb" as string]: mode.accentRgb,
                }}
                type="button"
              >
                <span className={styles.modeCode}>{mode.code}</span>
                <span className={styles.artFrame} aria-hidden="true">
                  <Art />
                </span>
                <span className={styles.modeCopy}>
                  <span className={styles.modeLabel}>{mode.label}</span>
                  <span className={styles.modeSub}>{mode.sub}</span>
                </span>
                <span className={styles.selectBar}>
                  <span>{tr.play_modal_select.toUpperCase()}</span>
                  <svg viewBox="0 0 18 18" aria-hidden="true">
                    <path d="M3 9h11m-4-4 4 4-4 4" />
                  </svg>
                </span>
              </button>
            );
          })}
        </div>

        <footer className={styles.footer}>
          <span>{lang === "ru" ? "Выберите боевой протокол" : "Select a battle protocol"}</span>
          <span>BASE NETWORK / SECURE SESSION</span>
        </footer>
      </section>
    </div>
  );
}
