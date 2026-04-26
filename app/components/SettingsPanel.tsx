"use client";

import { useRef, useEffect, useState } from "react";
import { useSettings, THEMES, TR } from "../lib/settings";
import styles from "./SettingsPanel.module.css";

export function SettingsPanel() {
  const { theme, lang, setTheme, setLang } = useSettings();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const tr = TR[lang];

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
        </div>
      )}
    </div>
  );
}
