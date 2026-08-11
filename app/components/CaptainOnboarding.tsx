"use client";

import { useState, type KeyboardEvent } from "react";
import type { Lang } from "../lib/settings";
import { useOnboarding } from "../providers/OnboardingProvider";
import { MissionGuide } from "./MissionGuide";
import styles from "./CaptainOnboarding.module.css";

const COPY = {
  ru: {
    skip: "пропустить обучение",
    offerCode: "CAPTAIN'S BRIEF · 3 МИН",
    offerTitle: "пройти короткое обучение?",
    offerBody: "покажем check-in, бесплатное снаряжение и первый бой прямо на экранах игры",
    start: "начать обучение",
    notNow: "играть без обучения",
    language: "язык",
    ru: "русский",
    en: "english",
    route: ["HOME", "SHOP", "BATTLE", "SCORE"],
    routeLabel: "маршрут обучения",
    onlineLabel: "в сети",
    checkinEyebrow: "приказ 01 · check-in",
    checkinTitle: "забери первые пойнты",
    checkinBody: "нажми настоящий check-in в рамке и подтверди транзакцию\nесли Base App покажет FREE, газ оплачивает приложение",
    loadoutEyebrow: "приказ 02 · снаряжение",
    loadoutTitle: "зайди в магазин",
    loadoutBody: "там заберёшь радар и торпеду за 0 пойнтов. подсказка останется поверх настоящего магазина",
    battleHomeEyebrow: "приказ 03A · home",
    battleHomeTitle: "нажми PLAY",
    battleHomeBody: "открой настоящее меню режимов игры",
    battleModeEyebrow: "приказ 03B · режим",
    battleModeTitle: "выбери бой с ботом",
    battleModeBody: "это будет обычный бой. покажем только как использовать радар и торпеду, дальше играешь сам",
    debriefEyebrow: "приказ выполнен",
    debriefTitle: "обучение пройдено",
    debriefBody: "первый бой закончен, управление освоено. теперь можно играть с ботом, другом или за USDC",
    debriefCta: "готово",
  },
  en: {
    skip: "skip tutorial",
    offerCode: "CAPTAIN'S BRIEF · 3 MIN",
    offerTitle: "take a quick tutorial?",
    offerBody: "we'll show check-in, free gear and your first battle on the real game screens",
    start: "start tutorial",
    notNow: "play without tutorial",
    language: "language",
    ru: "русский",
    en: "english",
    route: ["HOME", "SHOP", "BATTLE", "SCORE"],
    routeLabel: "tutorial route",
    onlineLabel: "online",
    checkinEyebrow: "order 01 · check-in",
    checkinTitle: "collect your first points",
    checkinBody: "tap the real check-in inside the brackets and confirm the transaction\nwhen Base App shows FREE, the app sponsors the gas",
    loadoutEyebrow: "order 02 · loadout",
    loadoutTitle: "open the shop",
    loadoutBody: "claim a radar and torpedo for 0 points. the guide stays over the real shop",
    battleHomeEyebrow: "order 03A · home",
    battleHomeTitle: "tap PLAY",
    battleHomeBody: "open the real game mode selector",
    battleModeEyebrow: "order 03B · mode",
    battleModeTitle: "choose bot battle",
    battleModeBody: "this is a regular match. we'll only show Radar and Torpedo, then you play on your own",
    debriefEyebrow: "order complete",
    debriefTitle: "tutorial complete",
    debriefBody: "your first battle is complete and the controls are clear. next, fight a bot, a friend, or play for USDC",
    debriefCta: "done",
  },
} as const;

type CaptainOnboardingProps = {
  lang: Lang;
  reducedMotion: boolean;
  onLanguageChange: (language: Lang) => void;
  playModalOpen: boolean;
};

export function CaptainOnboarding({
  lang,
  reducedMotion,
  onLanguageChange,
  playModalOpen,
}: CaptainOnboardingProps) {
  const { status, progress, dismiss, complete } = useOnboarding();
  const [selectedLanguage, setSelectedLanguage] = useState<Lang>(status?.language ?? lang);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const displayLanguage = status?.step === "language" ? selectedLanguage : lang;
  const copy = COPY[displayLanguage];

  if (!status?.required || status.step === "complete") return null;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "training is unavailable");
    } finally {
      setBusy(false);
    }
  };

  const chooseLanguage = (language: Lang) => {
    setSelectedLanguage(language);
    onLanguageChange(language);
  };
  const skip = () => void run(dismiss);

  const keepDialogFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      skip();
      return;
    }
    if (event.key !== "Tab") return;
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
    );
    if (buttons.length === 0) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.shiftKey
      ? current <= 0 ? buttons.length - 1 : current - 1
      : current < 0 || current === buttons.length - 1 ? 0 : current + 1;
    event.preventDefault();
    buttons[next]?.focus();
  };

  if (status.step === "language") {
    return (
      <div
        className={`${styles.languageBackdrop} ${reducedMotion ? styles.reducedMotion : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="recruit-offer-title"
        aria-describedby="recruit-offer-body"
        onKeyDown={keepDialogFocus}
      >
        <section className={styles.languageCard}>
          <header className={styles.briefHeader}>
            <span className={styles.orderFlag}>{copy.offerCode}</span>
            <span className={styles.liveMark} aria-label={copy.onlineLabel}>ONLINE</span>
          </header>

          <h2 id="recruit-offer-title">{copy.offerTitle}</h2>
          <p id="recruit-offer-body">{copy.offerBody}</p>

          <ol className={styles.route} aria-label={copy.routeLabel}>
            {copy.route.map((label, index) => (
              <li key={label}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                {label}
              </li>
            ))}
          </ol>

          <div className={styles.languageRow}>
            <span>{copy.language}</span>
            <div className={styles.languageOptions}>
              <button
                type="button"
                className={selectedLanguage === "ru" ? styles.languageActive : ""}
                aria-pressed={selectedLanguage === "ru"}
                disabled={busy}
                onClick={() => chooseLanguage("ru")}
              >
                <strong>RU</strong><small>{copy.ru}</small>
              </button>
              <button
                type="button"
                className={selectedLanguage === "en" ? styles.languageActive : ""}
                aria-pressed={selectedLanguage === "en"}
                disabled={busy}
                onClick={() => chooseLanguage("en")}
              >
                <strong>EN</strong><small>{copy.en}</small>
              </button>
            </div>
          </div>

          <div className={styles.offerActions}>
            <button
              className={styles.startButton}
              type="button"
              autoFocus
              disabled={busy}
              onClick={() => void run(() => progress("checkin", selectedLanguage))}
            >
              <span>{busy ? "…" : copy.start}</span>
              <span aria-hidden="true">→</span>
            </button>
            <button className={styles.notNowButton} type="button" onClick={skip} disabled={busy}>
              {copy.notNow}
            </button>
          </div>
          {error && <div className={styles.languageError} role="alert">{error}</div>}
        </section>
      </div>
    );
  }

  if (status.step === "checkin") {
    return (
      <MissionGuide
        key="checkin"
        target='[data-tour="checkin"]'
        eyebrow={copy.checkinEyebrow}
        title={copy.checkinTitle}
        body={copy.checkinBody}
        step={1}
        total={4}
        skipLabel={copy.skip}
        onSkip={skip}
        busy={busy}
        error={error}
        reducedMotion={reducedMotion}
      />
    );
  }

  if (status.step === "loadout") {
    return (
      <MissionGuide
        key="loadout"
        target='[data-tour="shop"]'
        eyebrow={copy.loadoutEyebrow}
        title={copy.loadoutTitle}
        body={copy.loadoutBody}
        step={2}
        total={4}
        skipLabel={copy.skip}
        onSkip={skip}
        busy={busy}
        error={error}
        reducedMotion={reducedMotion}
      />
    );
  }

  if (status.step === "battle") {
    return (
      <MissionGuide
        key={playModalOpen ? "battle-mode" : "battle-home"}
        target={playModalOpen ? '[data-tour="bot-mode"]' : '[data-tour="play"]'}
        eyebrow={playModalOpen ? copy.battleModeEyebrow : copy.battleHomeEyebrow}
        title={playModalOpen ? copy.battleModeTitle : copy.battleHomeTitle}
        body={playModalOpen ? copy.battleModeBody : copy.battleHomeBody}
        step={3}
        total={4}
        skipLabel={copy.skip}
        onSkip={skip}
        busy={busy}
        error={error}
        reducedMotion={reducedMotion}
      />
    );
  }

  return (
    <MissionGuide
      key="debrief"
      eyebrow={copy.debriefEyebrow}
      title={copy.debriefTitle}
      body={copy.debriefBody}
      step={4}
      total={4}
      primaryLabel={copy.debriefCta}
      onPrimary={() => void run(complete)}
      skipLabel={copy.skip}
      onSkip={skip}
      busy={busy}
      error={error}
      reducedMotion={reducedMotion}
    />
  );
}
