"use client";

import { useRef, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useSettings, THEMES, TR } from "../lib/settings";
import { isGameSoundEnabled, setGameSoundEnabled } from "../lib/sounds";
import { SocialConnectPanel } from "./SocialConnectPanel";
import styles from "./SettingsPanel.module.css";

export function SettingsPanel() {
  const { theme, lang, effects, setTheme, setLang, setEffects } = useSettings();
  const { address } = useAccount();
  const [open, setOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  const tr = TR[lang];
  const ru = lang === "ru";

  useEffect(() => {
    setSoundOn(isGameSoundEnabled());
  }, []);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  return (
    <div ref={ref} className={styles.container}>
      <button
        className={`${styles.gearBtn} ${open ? styles.gearOpen : ""}`}
        onClick={() => setOpen(v => !v)}
        title={tr.settings_title}
        type="button"
      >
        ⚙
      </button>

      {open && (
        <div className={styles.panel}>
          <p className={styles.sectionLabel}>{tr.theme_label}</p>
          <div className={styles.themeRow}>
            {THEMES.map(t => (
              <button
                key={t.id}
                className={`${styles.swatch} ${theme === t.id ? styles.swatchActive : ""}`}
                style={{ "--sw-color": t.color } as React.CSSProperties}
                onClick={() => setTheme(t.id)}
                title={t.label}
                type="button"
              />
            ))}
          </div>
          <p className={styles.themeLabel}>{THEMES.find(t => t.id === theme)?.label}</p>

          <p className={styles.sectionLabel}>{tr.lang_label}</p>
          <div className={styles.langRow}>
            {(["en", "ru"] as const).map(l => (
              <button
                key={l}
                className={`${styles.langBtn} ${lang === l ? styles.langActive : ""}`}
                onClick={() => setLang(l)}
                type="button"
              >
                {l === "en" ? "🇺🇸 EN" : "🇷🇺 RU"}
              </button>
            ))}
          </div>

          <p className={styles.sectionLabel}>{ru ? "Р—РІСѓРє" : "Sound"}</p>
          <button
            className={`${styles.soundToggle} ${soundOn ? styles.soundToggleOn : ""}`}
            onClick={() => {
              const next = !soundOn;
              setSoundOn(next);
              setGameSoundEnabled(next);
            }}
            type="button"
            aria-pressed={soundOn}
          >
            <span>{ru ? "SFX" : "SFX"}</span>
            <b>{soundOn ? "ON" : "OFF"}</b>
          </button>

          <p className={styles.sectionLabel}>{ru ? "Визуал" : "Visual FX"}</p>
          <div className={styles.modeRow}>
            {(["full", "reduced"] as const).map(mode => (
              <button
                key={mode}
                className={`${styles.modeBtn} ${effects === mode ? styles.modeActive : ""}`}
                onClick={() => setEffects(mode)}
                type="button"
                aria-pressed={effects === mode}
              >
                {mode === "full" ? "Full FX" : "Reduced"}
              </button>
            ))}
          </div>

          <div className={styles.divider} />

          <p className={styles.sectionLabel}>{ru ? "Соцсети" : "Socials"}</p>
          {address ? (
            <SocialConnectPanel address={address} />
          ) : (
            <p className={styles.connectHint}>
              {ru
                ? "Подключи кошелек, чтобы привязать X и Telegram для квестов."
                : "Connect wallet to link X and Telegram for quests."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
